import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { LineCounter, parseDocument } from "yaml";
import type { Config } from "../../core/config.ts";
import { DiscoveryError } from "../../core/discovery.ts";
import { phaseKeysOf } from "../../core/phases.ts";
import type { Stack } from "../../core/stack.ts";

const PROJECT_FILE = "Pulumi";

// The tool looks for a project file under these extensions, in this order, and
// takes the first it finds (findProjectInDir in the tool's source).
const EXTENSIONS = [".json", ".yaml", ".yml"];

// Directories that are never part of the repo's own code. A package can ship a
// project file of its own, and it is not the user's stack.
const SKIPPED = new Set([".git", "node_modules"]);

// Finds stacks from the files under root alone. It never asks the backend and
// never starts the tool, so it is safe in a job that holds no credentials
// (record 0014). A stack that the backend knows and no stack file names does
// not exist for Sluiceway. For each key of the project file that a
// `phase: { from }` entry points at (record 0067), the text under it is
// handed on with the stack, and nothing else of the file.
export async function discover(root: string, config?: Config): Promise<Stack[]> {
  const phaseKeys = config === undefined ? [] : phaseKeysOf(config);
  const stacks: Stack[] = [];
  const problems: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    const extension = EXTENSIONS.find((ext) => fileNames(entries).includes(PROJECT_FILE + ext));
    if (extension !== undefined) {
      const projectFile = join(dir, PROJECT_FILE + extension);
      try {
        const { stackDir, project } = await readProjectFile(root, projectFile);
        const files = stackDir === dir ? fileNames(entries) : await fileNamesIn(stackDir);
        const path = slashed(relative(root, dir)) || ".";
        const read = keysOf(project, phaseKeys);
        for (const name of stackNames(files, extension)) {
          stacks.push({
            path,
            name,
            options: {},
            ...(read === undefined ? {} : { phaseKeys: read }),
          });
        }
      } catch (error) {
        if (!(error instanceof ProjectFileProblem)) throw error;
        problems.push(`${slashed(relative(root, projectFile))}: ${error.message}`);
      }
    }
    // Symlinks are not followed: a link can loop, or lead out of the repo.
    for (const entry of entries) {
      if (entry.isDirectory() && !SKIPPED.has(entry.name)) await walk(join(dir, entry.name));
    }
  };

  await walk(root);
  if (problems.length > 0) throw new DiscoveryError(problems.sort(compare));
  return stacks.sort((a, b) => compare(a.path, b.path) || compare(a.name ?? "", b.name ?? ""));
}

class ProjectFileProblem extends Error {}

// The name a project file gives its project, which a stack reference names
// (record 0059). Undefined when the directory holds no project file, or one
// that does not parse or names none: no reference can then name its stacks.
export async function projectName(root: string, path: string): Promise<string | undefined> {
  const dir = join(root, path);
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const extension = EXTENSIONS.find((ext) => fileNames(entries).includes(PROJECT_FILE + ext));
  if (extension === undefined) return undefined;
  const document = parseDocument(await readFile(join(dir, PROJECT_FILE + extension), "utf8"), {
    uniqueKeys: false,
  });
  if (document.errors.length > 0) return undefined;
  const project: unknown = document.toJS();
  if (typeof project !== "object" || project === null || !("name" in project)) return undefined;
  return typeof project.name === "string" ? project.name : undefined;
}

// The text under each key a phase points at (record 0067), where Pulumi
// lets a project file hold one: under `config`, as text or as a mapping with
// a text `value` or `default`, or at the top level. A value marked secret is
// never read. Undefined when no key is found.
function keysOf(project: unknown, keys: readonly string[]): Record<string, string> | undefined {
  if (keys.length === 0 || !isMapping(project)) return undefined;
  const config = isMapping(project.config) ? project.config : {};
  const read: Record<string, string> = {};
  for (const key of keys) {
    const text = configText(config[key]) ?? project[key];
    if (typeof text === "string") read[key] = text;
  }
  return Object.keys(read).length === 0 ? undefined : read;
}

function configText(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (!isMapping(entry) || entry.secret === true) return undefined;
  const text = entry.value ?? entry.default;
  return typeof text === "string" ? text : undefined;
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Where the project's stack files are: next to the project file, unless the
// project file names another directory. Besides the keys a phase points at,
// this is the only thing discovery reads from a project file. A file it can parse is taken as it stands, however
// wrong it is otherwise: the tool refuses it, and that is a preview failure on
// the stack's row. Discovery fails only when it cannot know where to look.
async function readProjectFile(
  root: string,
  projectFile: string,
): Promise<{ stackDir: string; project: unknown }> {
  const dir = join(projectFile, "..");
  const lineCounter = new LineCounter();
  // The YAML parser reads JSON too.
  const document = parseDocument(await readFile(projectFile, "utf8"), {
    lineCounter,
    prettyErrors: false,
    uniqueKeys: false,
  });
  const broken = document.errors[0];
  if (broken !== undefined) {
    // A project file can hold config values, and the parser's message can
    // quote the file. So only the place is given (record 0021).
    const { line, col } = lineCounter.linePos(broken.pos[0]);
    throw new ProjectFileProblem(`line ${line}, column ${col}: not valid YAML.`);
  }
  const project: unknown = document.toJS();
  if (typeof project !== "object" || project === null || !("stackConfigDir" in project))
    return { stackDir: dir, project };
  const named = project.stackConfigDir;
  if (typeof named !== "string") {
    throw new ProjectFileProblem(
      "stackConfigDir must be text, the directory that holds the stack files.",
    );
  }
  // The tool joins the two, so a leading slash does not make it absolute.
  const stackDir = join(dir, named);
  const fromRoot = relative(root, stackDir);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new ProjectFileProblem(
      `stackConfigDir points outside the repo (${JSON.stringify(named)}). Sluiceway only reads files inside the repo.`,
    );
  }
  return { stackDir, project };
}

// The tool builds a stack file's name from the extension of the project file,
// so Pulumi.prod.yml next to Pulumi.yaml is a file it never reads.
function stackNames(files: string[], extension: string): string[] {
  const prefix = `${PROJECT_FILE}.`;
  return files
    .filter((file) => file.startsWith(prefix) && file.endsWith(extension))
    .map((file) => file.slice(prefix.length, -extension.length))
    .filter((name) => name !== "");
}

function fileNames(entries: Dirent[]): string[] {
  return entries.filter((entry) => !entry.isDirectory()).map((entry) => entry.name);
}

async function fileNamesIn(dir: string): Promise<string[]> {
  try {
    return fileNames(await readdir(dir, { withFileTypes: true }));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw error;
  }
}

function slashed(path: string): string {
  return path.split(sep).join("/");
}

// By code unit, so the order is the same on every machine.
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
