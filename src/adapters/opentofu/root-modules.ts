import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import type { Config } from "../../core/config.ts";
import type { DiscoveryNote } from "../../core/discovery.ts";
import type { Stack } from "../../core/stack.ts";
import { type HclBlock, readHcl } from "./hcl.ts";
import { type FamilyTool, OPENTOFU, TERRAFORM } from "./options.ts";

// Root module discovery (record 0092). A directory of OpenTofu or Terraform
// files is a stack when the repo's own files say it is a root module, and
// only then. What they must say, in the order it is asked:
//
// 1. Nothing declares it. A directory that a `stacks` entry with a tool names
//    is that entry's, exactly as before, and discovery does not look at it.
// 2. No other directory names it as a local module source (`source = "../x"`
//    or `"./x"`). This is the signal trusted most, because it is the repo's
//    own statement that the directory is a module, not a guess from a name.
// 3. It does not sit under a directory named `modules`, the convention of
//    both tools' docs for a module of the repo. It only ever leaves a
//    directory out: sitting next to a `modules` directory proves nothing.
// 4. A `backend` or `cloud` block in a `terraform` block. Only a root module
//    chooses where its state lives, and a root without one keeps its state
//    on the runner, where a deploy would lose it.
// 5. One workspace: the code does not read `terraform.workspace`, and a
//    `cloud` block does not pick its workspaces by tags. A found stack is the
//    default workspace (record 0092), so a root built for several is left to
//    a `stacks` entry per workspace.
// 6. No var file or backend file that the tool does not load by itself, in
//    the directory or a subdirectory of var files only: which one a stack
//    takes is the repo's to say.
// 7. Which tool runs it: the registry the lock file's providers come from,
//    or `.tofu` files, which only OpenTofu reads. Not both, and not neither.
//
// A lock file alone, or a `.terraform` directory, is never evidence: module
// CI and validate hooks initialise modules too, and `.terraform` is not in
// the repo's files, so a checkout and a job that ran init would disagree.
//
// A repo with Terragrunt files finds nothing: its root modules are its units,
// declared with `wrapper: terragrunt`, and the modules they run commonly
// carry an empty backend block and sources this reader cannot resolve.

// The switch of `discovery` that turns this rule off for a repo.
export const ROOT_MODULES = "rootModules";

const MODULE_FILE = /\.(tf|tofu|tf\.json|tofu\.json)$/;
const TOFU_FILE = /\.tofu(\.json)?$/;
const LOCK_FILE = ".terraform.lock.hcl";
const TERRAGRUNT_FILE = /^terragrunt(\.stack)?\.hcl(\.json)?$/;
// Loaded by the tool without being named, so they choose nothing.
const AUTO_VAR_FILE = /^terraform\.tfvars(\.json)?$|\.auto\.tfvars(\.json)?$/;
const VAR_FILE = /\.tfvars(\.json)?$/;
const BACKEND_FILE = /\.tfbackend$/;
const READS_WORKSPACE = /\b(terraform|tofu)\.workspace\b/;
// Never the repo's own code: caches of the tools and of package managers,
// and what CDK for Terraform writes. Every directory whose name starts with a
// dot is skipped too, `.terraform` and `.terragrunt-cache` among them.
const SKIPPED = new Set(["node_modules", "cdktf.out"]);

// The registry each tool writes into its lock file for a provider it
// installed from its own default registry.
const REGISTRIES: Record<string, FamilyTool> = {
  "registry.opentofu.org": OPENTOFU,
  "registry.terraform.io": TERRAFORM,
};

const TOOL_WORDS: Record<FamilyTool, string> = { opentofu: "OpenTofu", terraform: "Terraform" };

interface Directory {
  path: string;
  files: string[];
  // The first backend or cloud block, and the file it is in.
  state?: { kind: "backend" | "cloud"; label?: string; file: string; tags: boolean };
  readsWorkspace?: string;
  sources: string[];
  lockTools: FamilyTool[];
  hasLockFile: boolean;
  // Var and backend files the tool does not load by itself, from the
  // directory, relative to it.
  chosenFiles: string[];
}

interface Repo {
  directories: Directory[];
  // Directories of var files only, by path, with their var files.
  varDirectories: Map<string, string[]>;
  terragrunt?: string;
}

// Every stack the rule finds, in path order.
export function findRootModules(root: string, config: Config): Stack[] {
  return judge(root, config).flatMap(({ path, tool }) =>
    tool === undefined ? [] : [{ path, options: { tool, varFiles: [] } }],
  );
}

// What the rule made of every directory of OpenTofu or Terraform files, for
// the check (record 0092): what it found and by what, and what it left out
// and why. A directory a `stacks` entry declares is listed as declared.
export function explainRootModules(root: string, config: Config): DiscoveryNote[] {
  return judge(root, config).map(({ path, tool, declared, because }) => ({
    path,
    outcome: tool !== undefined ? "found" : declared ? "declared" : "left-out",
    ...(tool === undefined ? {} : { stackId: path }),
    because,
  }));
}

interface Judged {
  path: string;
  tool?: FamilyTool;
  declared?: true;
  because: string;
}

function judge(root: string, config: Config): Judged[] {
  const repo = readRepo(root);
  const declared = new Map<string, number>();
  config.stacks.forEach((entry, index) => {
    if (entry.tool !== undefined && !declared.has(entry.path)) declared.set(entry.path, index);
  });
  const namedBy = new Map<string, string>();
  for (const directory of repo.directories) {
    for (const source of directory.sources) {
      const target = localSource(directory.path, source);
      if (target !== undefined && target !== directory.path && !namedBy.has(target)) {
        namedBy.set(target, directory.path);
      }
    }
  }
  const off = config.discovery[ROOT_MODULES] === false;

  return repo.directories.map((directory): Judged => {
    const { path } = directory;
    const left = (because: string): Judged => ({ path, because });
    const index = declared.get(path);
    if (index !== undefined) {
      return { path, declared: true, because: `declared by stacks[${index}], which it keeps` };
    }
    if (off) return left(`discovery.${ROOT_MODULES} is false in the config file`);
    if (repo.terragrunt !== undefined) {
      return left(
        `the repo uses Terragrunt (${repo.terragrunt}): its units are declared with wrapper: terragrunt, and the modules they run are not stacks`,
      );
    }
    const user = namedBy.get(path);
    if (user !== undefined) return left(`${user} uses it as a module source`);
    if (path.split("/").includes("modules")) return left("it sits under a modules directory");
    const { state } = directory;
    if (state === undefined) {
      return left(
        "no backend or cloud block: only a root module chooses where its state lives, and state left on the runner is lost",
      );
    }
    if (directory.readsWorkspace !== undefined) {
      return left(
        `${directory.readsWorkspace} reads the workspace, so the root runs in workspaces its files do not name: declare one stack per workspace`,
      );
    }
    if (state.tags) {
      return left(
        `the cloud block in ${state.file} picks its workspaces by tags: declare one stack per workspace`,
      );
    }
    const chosen = [
      ...directory.chosenFiles,
      ...[...repo.varDirectories]
        .filter(([under]) => posix.dirname(under) === path)
        .flatMap(([under, files]) => files.map((file) => posix.relative(path, `${under}/${file}`))),
    ].sort(byCodeUnit);
    if (chosen.length > 0) {
      return left(
        `${listed(chosen)} ${chosen.length === 1 ? "is a file" : "are files"} the tool loads only when told to: which one a stack takes is the repo's to say`,
      );
    }
    const tools = [...new Set(directory.lockTools)];
    const tofuFiles = directory.files.some((file) => TOFU_FILE.test(file));
    if (tofuFiles && !tools.includes(OPENTOFU)) tools.push(OPENTOFU);
    const [tool, ...others] = tools.sort();
    if (tool === undefined || others.length > 0) {
      return left(
        tool === undefined
          ? directory.hasLockFile
            ? "its lock file names no provider of the OpenTofu or the Terraform registry, and it has no .tofu files, so its files do not say which tool runs it"
            : "no lock file and no .tofu files, so its files do not say whether OpenTofu or Terraform runs it"
          : "its files point at both OpenTofu and Terraform, so they do not say which tool runs it",
      );
    }
    const where = state.label === undefined ? state.kind : `${state.kind} "${state.label}"`;
    const which =
      tofuFiles && directory.lockTools.length === 0
        ? ".tofu files, which only OpenTofu reads"
        : `a lock file of ${TOOL_WORDS[tool]} providers`;
    return { path, tool, because: `a ${where} block in ${state.file}, and ${which}` };
  });
}

function readRepo(root: string): Repo {
  const repo: Repo = { directories: [], varDirectories: new Map() };
  const walk = (relative: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(join(root, relative), { withFileTypes: true });
    } catch {
      return;
    }
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort(byCodeUnit);
    const path = relative || ".";
    const terragrunt = files.find((file) => TERRAGRUNT_FILE.test(file));
    if (terragrunt !== undefined && repo.terragrunt === undefined) {
      repo.terragrunt = relative === "" ? terragrunt : `${relative}/${terragrunt}`;
    }
    const code = files.filter((file) => MODULE_FILE.test(file));
    const chosenFiles = files.filter(
      (file) => (VAR_FILE.test(file) && !AUTO_VAR_FILE.test(file)) || BACKEND_FILE.test(file),
    );
    if (code.length > 0) {
      repo.directories.push(readDirectory(root, path, files, code, chosenFiles));
    } else if (chosenFiles.length > 0) {
      repo.varDirectories.set(path, chosenFiles);
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || SKIPPED.has(entry.name)) continue;
      walk(relative === "" ? entry.name : `${relative}/${entry.name}`);
    }
  };
  walk("");
  repo.directories.sort((a, b) => byCodeUnit(a.path, b.path));
  return repo;
}

function readDirectory(
  root: string,
  path: string,
  files: string[],
  code: string[],
  chosenFiles: string[],
): Directory {
  const directory: Directory = {
    path,
    files: code,
    sources: [],
    lockTools: [],
    hasLockFile: files.includes(LOCK_FILE),
    chosenFiles,
  };
  for (const file of code) {
    const text = read(join(root, path, file));
    const parsed = file.endsWith(".json") ? readJson(text) : readNative(text);
    if (parsed.state !== undefined) directory.state ??= { ...parsed.state, file };
    if (parsed.readsWorkspace) directory.readsWorkspace ??= file;
    directory.sources.push(...parsed.sources);
  }
  if (directory.hasLockFile) {
    const blocks = readHcl(read(join(root, path, LOCK_FILE))).blocks;
    for (const block of blocks.filter((one) => one.type === "provider")) {
      const tool = REGISTRIES[block.labels[0]?.split("/")[0] ?? ""];
      if (tool !== undefined) directory.lockTools.push(tool);
    }
  }
  return directory;
}

interface ReadFile {
  state?: { kind: "backend" | "cloud"; label?: string; tags: boolean };
  readsWorkspace: boolean;
  sources: string[];
}

function readNative(text: string): ReadFile {
  const { blocks, code } = readHcl(text);
  let state: ReadFile["state"];
  for (const block of blocks.filter((one) => one.type === "terraform")) {
    for (const inner of block.blocks) {
      if (state !== undefined) break;
      if (inner.type === "backend") {
        state = { kind: "backend", ...labelOf(inner), tags: false };
      } else if (inner.type === "cloud") {
        const tags = inner.blocks.some(
          (one) => one.type === "workspaces" && one.attributes.includes("tags"),
        );
        state = { kind: "cloud", tags };
      }
    }
  }
  const sources = blocks
    .filter((block) => block.type === "module")
    .flatMap((block) => (block.strings.source === undefined ? [] : [block.strings.source]));
  return {
    ...(state === undefined ? {} : { state }),
    readsWorkspace: READS_WORKSPACE.test(code),
    sources,
  };
}

function labelOf(block: HclBlock): { label?: string } {
  const [label] = block.labels;
  return label === undefined ? {} : { label };
}

// The JSON syntax: a block type is a key, and a block that may repeat may be
// a list of objects (the tools' docs, "JSON Configuration Syntax").
function readJson(text: string): ReadFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { readsWorkspace: false, sources: [] };
  }
  let state: ReadFile["state"];
  for (const terraform of objects(field(parsed, "terraform"))) {
    if (state !== undefined) break;
    const backend = objects(field(terraform, "backend"))[0];
    const cloud = objects(field(terraform, "cloud"))[0];
    if (backend !== undefined) {
      const [label] = Object.keys(backend);
      state = { kind: "backend", ...(label === undefined ? {} : { label }), tags: false };
    } else if (cloud !== undefined) {
      const tags = objects(field(cloud, "workspaces")).some((one) => "tags" in one);
      state = { kind: "cloud", tags };
    }
  }
  const sources = objects(field(parsed, "module")).flatMap((modules) =>
    Object.values(modules).flatMap((module) =>
      objects(module).flatMap((one) => (typeof one.source === "string" ? [one.source] : [])),
    ),
  );
  return {
    ...(state === undefined ? {} : { state }),
    readsWorkspace: READS_WORKSPACE.test(text),
    sources,
  };
}

function field(value: unknown, name: string): unknown {
  return isObject(value) ? value[name] : undefined;
}

function objects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isObject);
  return isObject(value) ? [value] : [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The directory a local source names, from the repo root, or undefined for a
// source that is not a local path or leaves the repo. The tools take a local
// path only when it starts with "./" or "../" (their docs, "Module Sources").
function localSource(from: string, source: string): string | undefined {
  if (!source.startsWith("./") && !source.startsWith("../")) return undefined;
  const joined = posix.normalize(posix.join(from, source));
  const target = joined.replace(/\/+$/, "") || ".";
  if (target === ".." || target.startsWith("../")) return undefined;
  return target;
}

function listed(files: string[]): string {
  const shown = files.slice(0, 3).join(", ");
  return files.length > 3 ? `${shown} and ${files.length - 3} more` : shown;
}

function read(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

// By code unit, so the order is the same on every machine.
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
