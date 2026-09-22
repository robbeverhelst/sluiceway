import { posix } from "node:path";
import { parse } from "yaml";
import type { Stack } from "../core/stack.ts";
import { HELM } from "./helm/options.ts";
import { OPENTOFU } from "./opentofu/options.ts";

// What init learns from the files of a repo (record 0065): the stacks it can
// declare in a new sluiceway.yaml, and what the workflow has to install for
// the stacks there are. Files only, like discovery: no tool, no credential,
// no network. It knows tool files, so it sits with the adapters (record 0006).
//
// `files` are the files of the checkout, relative to the root, with forward
// slashes. `read` gives the text of one of them, or undefined.

export type Read = (file: string) => string | undefined;

// A directory of .tf or .tofu files that looks like a root module. With more
// than one var file, each gets a stack of its own with a workspace of the same
// name: two stacks of one root module in one workspace would share one state,
// and a deploy of one would undo the other.
export interface OpenTofuRoot {
  path: string;
  varFiles: string[];
}

// A local application chart. Files cannot say which release it is installed
// as or in which namespace, so both start as the chart's name.
export interface HelmChart {
  path: string;
  release: string;
}

export interface Declarable {
  opentofu: OpenTofuRoot[];
  helm: HelmChart[];
}

// Directories that are never a stack of the repo's own.
const SKIPPED = /(^|\/)(\.terraform|node_modules|\.git)(\/|$)/;

// The stacks a new sluiceway.yaml can declare, leaving out a directory that is
// a stack already, such as a Pulumi project.
export function findDeclarable(files: string[], read: Read, taken: string[]): Declarable {
  const used = new Set(taken);
  const opentofu = openTofuRoots(files, read).filter(({ path }) => !used.has(path));
  for (const { path } of opentofu) used.add(path);
  const helm = helmCharts(files, read).filter(({ path }) => !used.has(path));
  return { opentofu, helm };
}

function openTofuRoots(files: string[], read: Read): OpenTofuRoot[] {
  const code = files.filter((file) => /\.(tf|tofu)$/.test(file) && !SKIPPED.test(file));
  const directories = [...new Set(code.map(directoryOf))];
  // A module another directory calls with a local source is not a root.
  const called = new Set(
    code.flatMap((file) =>
      [...(read(file) ?? "").matchAll(/^\s*source\s*=\s*"(\.\.?\/[^"]*)"/gm)].map((match) =>
        normal(posix.join(directoryOf(file), match[1] ?? "")),
      ),
    ),
  );
  return directories
    .filter((path) => !called.has(path) && !path.split("/").includes("modules"))
    .sort(byCodeUnit)
    .map((path) => ({
      path,
      varFiles: files
        .filter((file) => directoryOf(file) === path)
        .map((file) => posix.basename(file))
        // Loaded by the tool without being named.
        .filter((name) => /\.tfvars(\.json)?$/.test(name))
        .filter((name) => !/^terraform\.tfvars(\.json)?$|\.auto\.tfvars(\.json)?$/.test(name))
        .sort(byCodeUnit),
    }));
}

// The id of each stack an OpenTofu root becomes, as its entry declares it.
export function openTofuStacks(root: OpenTofuRoot): { name?: string; varFile?: string }[] {
  if (root.varFiles.length === 0) return [{}];
  const [only] = root.varFiles;
  if (root.varFiles.length === 1 && only !== undefined) return [{ varFile: only }];
  return root.varFiles.map((varFile) => ({ name: varFileName(varFile), varFile }));
}

function varFileName(file: string): string {
  return file.replace(/\.tfvars(\.json)?$/, "");
}

function helmCharts(files: string[], read: Read): HelmChart[] {
  const charts = files.filter((file) => /(^|\/)Chart\.yaml$/.test(file) && !SKIPPED.test(file));
  const chartDirectories = new Set(charts.map(directoryOf));
  return charts
    .flatMap((file) => {
      const path = directoryOf(file);
      // A subchart sits in the charts/ directory of another chart.
      const parent = directoryOf(path);
      if (posix.basename(parent) === "charts" && chartDirectories.has(directoryOf(parent))) {
        return [];
      }
      const chart = yamlObject(read(file));
      if (chart === undefined || chart.type === "library") return [];
      const release = releaseName(typeof chart.name === "string" ? chart.name : "", path);
      return release === undefined ? [] : [{ path, release }];
    })
    .sort((a, b) => byCodeUnit(a.path, b.path));
}

// The chart's name made into a release name and a namespace, which Helm and
// Kubernetes hold to the same few characters.
function releaseName(name: string, path: string): string | undefined {
  for (const candidate of [name, posix.basename(path)]) {
    const cleaned = candidate
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 53)
      .replace(/-+$/, "");
    if (cleaned !== "") return cleaned;
  }
  return undefined;
}

// What the workflow has to install, from the stacks the config gives.
export interface WorkflowFindings {
  pulumi: boolean;
  opentofu: boolean;
  helm: boolean;
  node: NodeFindings | undefined;
  // Pulumi projects in another language than JavaScript or YAML, by runtime:
  // `pulumi install` gets their packages.
  otherRuntimes: { runtime: string; paths: string[] }[];
  // Chart repositories a local chart's dependencies come from, which the
  // workflow has to add before a preview.
  helmRepositories: string[];
  // An env file of secret references (docs/credentials.md), per job.
  envFiles: EnvFiles | undefined;
}

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface NodeFindings {
  // Where to install, with which package manager: the directory of the
  // nearest lockfile of every Node project, once.
  installs: { directory: string; manager: PackageManager }[];
  // Node projects with no lockfile at or above them.
  withoutLockfile: string[];
  // A file that names the Node version.
  versionFile: string | undefined;
  // Yarn 2 or newer, which corepack installs.
  yarnBerry: boolean;
  // pnpm with no version in package.json for its setup action to read.
  pnpmWithoutVersion: boolean;
}

export interface EnvFiles {
  preview: string;
  deploy: string;
  // Other env files of references that init did not use.
  others: string[];
}

const LOCKFILES: [string, PackageManager][] = [
  ["package-lock.json", "npm"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
];

// What 1Password's references start with. The script of docs/credentials.md
// looks for the same.
export const SECRET_REFERENCE = "op://";

export function findForWorkflow(stacks: Stack[], files: string[], read: Read): WorkflowFindings {
  const tool = (stack: Stack) => stack.options.tool;
  const pulumiPaths = [
    ...new Set(stacks.filter((stack) => tool(stack) === undefined).map((s) => s.path)),
  ];
  const runtimes = pulumiPaths.map((path) => ({ path, runtime: pulumiRuntime(path, files, read) }));
  const nodePaths = runtimes.filter(({ runtime }) => runtime === "nodejs").map((p) => p.path);
  const other = Map.groupBy(
    runtimes.filter(({ runtime }) => runtime !== "nodejs" && runtime !== "yaml"),
    ({ runtime }) => runtime,
  );
  return {
    pulumi: pulumiPaths.length > 0,
    opentofu: stacks.some((stack) => tool(stack) === OPENTOFU),
    helm: stacks.some((stack) => tool(stack) === HELM),
    node: nodePaths.length === 0 ? undefined : nodeFindings(nodePaths, files, read),
    otherRuntimes: [...other]
      .map(([runtime, found]) => ({ runtime, paths: found.map(({ path }) => path) }))
      .sort((a, b) => byCodeUnit(a.runtime, b.runtime)),
    helmRepositories: helmRepositories(stacks, read),
    envFiles: envFiles(files, read),
  };
}

// The runtime a Pulumi project names, `yaml` when its file cannot say.
function pulumiRuntime(path: string, files: string[], read: Read): string {
  const file = ["Pulumi.yaml", "Pulumi.yml", "Pulumi.json"]
    .map((name) => (path === "." ? name : `${path}/${name}`))
    .find((candidate) => files.includes(candidate));
  const project = file === undefined ? undefined : yamlObject(read(file));
  const runtime = project?.runtime;
  if (typeof runtime === "string") return runtime;
  if (typeof runtime === "object" && runtime !== null && "name" in runtime) {
    return typeof runtime.name === "string" ? runtime.name : "yaml";
  }
  return "yaml";
}

function nodeFindings(paths: string[], files: string[], read: Read): NodeFindings {
  const lockfile = (directory: string) =>
    LOCKFILES.find(([name]) => files.includes(directory === "." ? name : `${directory}/${name}`));
  const installs = new Map<string, PackageManager>();
  const withoutLockfile: string[] = [];
  for (const path of paths) {
    const directory = ancestors(path).find((candidate) => lockfile(candidate) !== undefined);
    const found = directory === undefined ? undefined : lockfile(directory);
    if (directory === undefined || found === undefined) withoutLockfile.push(path);
    else installs.set(directory, found[1]);
  }
  const managers = new Set(installs.values());
  const manifest = yamlObject(read("package.json"));
  return {
    installs: [...installs]
      .map(([directory, manager]) => ({ directory, manager }))
      .sort((a, b) => byCodeUnit(a.directory, b.directory)),
    withoutLockfile,
    versionFile: [".nvmrc", ".node-version"].find((file) => files.includes(file)),
    yarnBerry: managers.has("yarn") && files.includes(".yarnrc.yml"),
    pnpmWithoutVersion:
      managers.has("pnpm") &&
      !(
        typeof manifest?.packageManager === "string" && manifest.packageManager.startsWith("pnpm@")
      ),
  };
}

function helmRepositories(stacks: Stack[], read: Read): string[] {
  const repositories = stacks.flatMap((stack) => {
    const chartDir = stack.options.tool === HELM ? stack.options.chartDir : undefined;
    if (typeof chartDir !== "string") return [];
    const chart = yamlObject(read(chartDir === "." ? "Chart.yaml" : `${chartDir}/Chart.yaml`));
    const dependencies = Array.isArray(chart?.dependencies) ? chart.dependencies : [];
    return dependencies.flatMap((dependency: unknown) => {
      const repository = (dependency as { repository?: unknown } | null)?.repository;
      return typeof repository === "string" && /^https?:\/\//.test(repository) ? [repository] : [];
    });
  });
  return [...new Set(repositories)].sort(byCodeUnit);
}

// Env files that hold at least one secret reference. One that names deploys
// goes to `apply`, one that names previews to the scan; a single file serves
// both.
function envFiles(files: string[], read: Read): EnvFiles | undefined {
  const found = files
    .filter((file) => /(^|\/)(\.env(\.[^/]+)?|[^/]+\.env)$/.test(file))
    // A path the workflow can name on a command line without quoting.
    .filter((file) => /^[\w./-]+$/.test(file))
    .filter((file) =>
      (read(file) ?? "")
        .split("\n")
        .some(
          (line) =>
            /^\s*(export\s+)?[A-Za-z_]\w*\s*=/.test(line) && line.includes(SECRET_REFERENCE),
        ),
    );
  if (found.length === 0) return undefined;
  const named = (pattern: RegExp) => found.find((file) => pattern.test(posix.basename(file)));
  const deploy = named(/deploy|apply|write/i);
  const preview = named(/preview|read|scan|plan/i);
  const [first] = found as [string, ...string[]];
  const pair =
    deploy !== undefined && preview !== undefined && deploy !== preview
      ? { preview, deploy }
      : { preview: first, deploy: first };
  return {
    ...pair,
    others: found.filter((file) => file !== pair.preview && file !== pair.deploy),
  };
}

function yamlObject(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) return undefined;
  try {
    const value: unknown = parse(text, { uniqueKeys: false });
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

// The path and every directory above it, nearest first, the root last.
function ancestors(path: string): string[] {
  const found = [path];
  let current = path;
  while (current !== ".") {
    current = directoryOf(current);
    found.push(current);
  }
  return found;
}

function directoryOf(file: string): string {
  const directory = posix.dirname(file);
  return directory === "" ? "." : directory;
}

function normal(path: string): string {
  const joined = posix.normalize(path).replace(/\/$/, "");
  return joined === "" ? "." : joined;
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
