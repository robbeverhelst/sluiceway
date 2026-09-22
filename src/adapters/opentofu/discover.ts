import { readdirSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, relative, sep } from "node:path";
import type { Config } from "../../core/config.ts";
import { DiscoveryError } from "../../core/discovery.ts";
import type { Stack } from "../../core/stack.ts";
import {
  CDKTF,
  type FamilyTool,
  isFamilyTool,
  type OpenTofuStackOptions,
  parseOpenTofuOptions,
  TERRAGRUNT,
} from "./options.ts";

// The files that make a directory a module (OpenTofu docs, "Files and
// Directories"; Terraform reads only the .tf ones). A root module and a child
// module look the same on disk, and a workspace lives in the backend, so a
// stack cannot be found from the files alone (the adapter research). A
// `stacks` entry with `tool: opentofu` or `tool: terraform` names it, and
// discovery checks from the files alone that the entry can work. It never
// starts the tool (record 0014).
const MODULE_FILES: Record<FamilyTool, { pattern: RegExp; shown: string; word: string }> = {
  opentofu: {
    pattern: /\.(tf|tofu|tf\.json|tofu\.json)$/,
    shown: "*.tf, *.tofu, *.tf.json, *.tofu.json",
    word: "OpenTofu",
  },
  terraform: { pattern: /\.(tf|tf\.json)$/, shown: "*.tf, *.tf.json", word: "Terraform" },
};

// A Terragrunt unit is a directory with its configuration file (Terragrunt
// docs, "Units"). Its code may come from anywhere its `source` says.
const TERRAGRUNT_FILES = ["terragrunt.hcl", "terragrunt.hcl.json"];

// A CDK for Terraform app is a directory with cdktf.json. Its stacks exist
// only in the program, so the entry's name picks one, and cdktf synth writes
// it to a directory of that name (record 0068). Letters, digits, "-" and "_"
// is what a stack's directory can hold without leaving cdktf.out.
const CDKTF_FILE = "cdktf.json";
const CDKTF_STACK_NAME = /^[A-Za-z0-9_-]+$/;

// The option problems are config problems and are thrown by the caller, so
// they come back here instead. What is wrong with the files is a
// DiscoveryError.
export function discoverOpenTofu(
  root: string,
  config: Config,
): { stacks: Stack[]; optionProblems: string[] } {
  const stacks: Stack[] = [];
  const optionProblems: string[] = [];
  const problems: string[] = [];
  // Which entry first declared each directory, and with what, because the
  // stacks of one directory share its init.
  const declaredBy = new Map<string, { index: number; kind: string }>();

  config.stacks.forEach((entry, index) => {
    if (!isFamilyTool(entry.tool)) return;
    const tool = entry.tool;
    const parsed = parseOpenTofuOptions(entry.options, index, tool);
    if (!parsed.ok) {
      optionProblems.push(...parsed.problems);
      return;
    }
    const { wrapper } = parsed.options;
    const before = optionProblems.length;
    if (wrapper !== undefined && parsed.options.varFiles.length > 0) {
      optionProblems.push(
        wrapper === TERRAGRUNT
          ? `stacks[${index}].options.varFiles: a Terragrunt unit passes its var files in its own terragrunt.hcl (extra_arguments), so the entry takes none.`
          : `stacks[${index}].options.varFiles: a CDK for Terraform app sets its variables in code, so the entry takes none.`,
      );
    }
    if (wrapper === CDKTF && entry.name === undefined) {
      optionProblems.push(
        `stacks[${index}].name: an entry with wrapper: cdktf names the CDK for Terraform stack it deploys, as the app calls it.`,
      );
    }
    if (wrapper === CDKTF && entry.name !== undefined && !CDKTF_STACK_NAME.test(entry.name)) {
      optionProblems.push(
        `stacks[${index}].name: ${JSON.stringify(entry.name)} is not a CDK for Terraform stack name: letters, digits, "-" and "_" only.`,
      );
    }
    const kind = `tool: ${tool}${wrapper === undefined ? "" : ` and wrapper: ${wrapper}`}`;
    const earlier = declaredBy.get(entry.path);
    if (earlier === undefined) {
      declaredBy.set(entry.path, { index, kind });
    } else if (earlier.kind !== kind) {
      optionProblems.push(
        `stacks[${index}]: ${JSON.stringify(entry.path)} is declared with ${earlier.kind} by stacks[${earlier.index}]. The stacks of one directory share its init, so they name the same tool and wrapper.`,
      );
    }
    if (optionProblems.length > before) return;

    const dir = join(root, entry.path);
    const shown = JSON.stringify(entry.path);
    const files = filesIn(dir);
    const names =
      wrapper === TERRAGRUNT
        ? "the directory of one Terragrunt unit"
        : wrapper === CDKTF
          ? "the directory of a CDK for Terraform app"
          : "the directory of a root module";
    const about =
      wrapper === undefined ? `An entry with tool: ${tool}` : `An entry with wrapper: ${wrapper}`;
    if (files === undefined) {
      problems.push(
        `stacks[${index}]: ${shown} is not a directory of the repo. ${about} names ${names}.`,
      );
      return;
    }
    if (wrapper === TERRAGRUNT && !files.some((file) => TERRAGRUNT_FILES.includes(file))) {
      problems.push(
        `stacks[${index}]: ${shown} holds no terragrunt.hcl or terragrunt.hcl.json. ${about} names ${names}.`,
      );
      return;
    }
    if (wrapper === CDKTF && !files.includes(CDKTF_FILE)) {
      problems.push(`stacks[${index}]: ${shown} holds no ${CDKTF_FILE}. ${about} names ${names}.`);
      return;
    }
    const module = MODULE_FILES[tool];
    if (wrapper === undefined && !files.some((file) => module.pattern.test(file))) {
      problems.push(
        `stacks[${index}]: ${shown} holds no ${module.word} files (${module.shown}). ${about} names ${names}.`,
      );
      return;
    }
    const varProblems = problems.length;
    parsed.options.varFiles.forEach((file, at) => {
      const where = `stacks[${index}].options.varFiles[${at}]: ${JSON.stringify(file)}`;
      if (isAbsolute(file)) {
        problems.push(`${where} must be relative to the directory of the stack.`);
        return;
      }
      const fromRoot = relative(root, normalize(join(dir, file)));
      if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
        problems.push(`${where} must stay inside the repo.`);
        return;
      }
      if (!isFile(join(root, fromRoot))) problems.push(`${where} is not a file in ${shown}.`);
    });
    if (problems.length > varProblems) return;

    const options: OpenTofuStackOptions = { tool, ...parsed.options };
    stacks.push({
      path: entry.path,
      ...(entry.name === undefined ? {} : { name: entry.name }),
      options: { ...options },
    });
  });

  if (optionProblems.length === 0 && problems.length > 0) throw new DiscoveryError(problems);
  return { stacks, optionProblems };
}

function filesIn(dir: string): string[] | undefined {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return undefined;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
