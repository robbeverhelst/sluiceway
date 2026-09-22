import { readdirSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, relative, sep } from "node:path";
import type { Config } from "../../core/config.ts";
import { DiscoveryError } from "../../core/discovery.ts";
import type { Stack } from "../../core/stack.ts";
import { OPENTOFU, type OpenTofuStackOptions, parseOpenTofuOptions } from "./options.ts";

// The files that make a directory a module (OpenTofu docs, "Files and
// Directories"). A root module and a child module look the same on disk, and
// a workspace lives in the backend, so a stack cannot be found from the files
// alone (the adapter research). A `stacks` entry with `tool: opentofu` names
// it, and discovery checks from the files alone that the entry can work. It
// never starts the tool (record 0014).
const MODULE_FILE = /\.(tf|tofu|tf\.json|tofu\.json)$/;

const ROOT_MODULE = "An entry with tool: opentofu names the directory of a root module.";

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

  config.stacks.forEach((entry, index) => {
    if (entry.tool !== OPENTOFU) return;
    const parsed = parseOpenTofuOptions(entry.options, index);
    if (!parsed.ok) {
      optionProblems.push(...parsed.problems);
      return;
    }
    const dir = join(root, entry.path);
    const shown = JSON.stringify(entry.path);
    const files = filesIn(dir);
    if (files === undefined) {
      problems.push(`stacks[${index}]: ${shown} is not a directory of the repo. ${ROOT_MODULE}`);
      return;
    }
    if (!files.some((file) => MODULE_FILE.test(file))) {
      problems.push(
        `stacks[${index}]: ${shown} holds no OpenTofu files (*.tf, *.tofu, *.tf.json, *.tofu.json). ${ROOT_MODULE}`,
      );
      return;
    }
    const before = problems.length;
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
    if (problems.length > before) return;

    const options: OpenTofuStackOptions = { tool: OPENTOFU, ...parsed.options };
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
