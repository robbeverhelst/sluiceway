import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, relative, sep } from "node:path";
import { parse } from "yaml";
import type { Stack } from "../../core/stack.ts";
import type { FileReference } from "../adapter.ts";

// The files of the repo that a Pulumi stack's own files name as read (record
// 0074), for the check to suggest as inputs. Read from the files alone, like
// discovery: the tool never starts.
//
// - A YAML program's fn::readFile, fn::fileAsset and fn::fileArchive, with
//   ${pulumi.cwd} as the program's directory. Any other interpolation is only
//   known at run time and is left alone.
// - A plain value of the stack's config, or a default of the project's, that
//   is the path of a file or directory of the repo, from the project's
//   directory. A program in another language often reads a file named in its
//   config. A secure value is never read.
//
// A path is kept only when it is inside the repo and there. Nothing else of a
// value leaves this file: the check prints the path it names.

// The tool's order (discover.ts).
const EXTENSIONS = [".json", ".yaml", ".yml"];

const PROGRAM_FUNCTIONS: Record<string, FileReference["kind"] | "either"> = {
  "fn::readFile": "file",
  "fn::fileAsset": "file",
  "fn::fileArchive": "either",
};

export async function readsFiles(root: string, stack: Stack): Promise<FileReference[]> {
  const found = new Map<string, FileReference>();
  const projectDir = join(root, stack.path);
  const extension = EXTENSIONS.find((ext) => isFile(join(projectDir, `Pulumi${ext}`)));
  if (extension === undefined) return [];
  const projectPath = join(projectDir, `Pulumi${extension}`);
  const project = read(projectPath);
  if (!isRecord(project)) return [];

  const keep = (
    path: string,
    from: string,
    namedIn: string,
    want: "file" | "directory" | "either" | "any",
  ) => {
    if (isAbsolute(path) || path.includes("${")) return;
    const full = normalize(join(from, path));
    const fromRoot = relative(root, full);
    if (
      fromRoot === "" ||
      fromRoot === ".." ||
      fromRoot.startsWith(`..${sep}`) ||
      isAbsolute(fromRoot)
    ) {
      return;
    }
    const kind = kindOf(full);
    if (kind === undefined) return;
    if (want === "file" && kind !== "file") return;
    if (want === "directory" && kind !== "directory") return;
    const slashed = fromRoot.split(sep).join("/");
    found.set(`${slashed}\n${kind}`, { path: slashed, kind, namedIn: repoPath(root, namedIn) });
  };

  // The program of the YAML runtime: the project file, or Main.yaml, in the
  // directory `main` names.
  if (runtimeName(project.runtime) === "yaml") {
    const programDir =
      typeof project.main === "string" ? join(projectDir, project.main) : projectDir;
    const programs =
      programDir === projectDir
        ? [projectPath, join(projectDir, "Main.yaml")]
        : [join(programDir, "Main.yaml"), join(programDir, "Pulumi.yaml")];
    for (const file of programs.filter(isFile)) {
      const program = file === projectPath ? project : read(file);
      walk(program, (key, value) => {
        const want = PROGRAM_FUNCTIONS[key];
        if (want === undefined || typeof value !== "string") return;
        keep(value.replaceAll("${pulumi.cwd}", "."), programDir, file, want);
      });
    }
  }

  // Config values, which a program reads from its project's directory.
  const pathLike = (value: string) => value.includes("/") || value.startsWith(".");
  if (isRecord(project.config)) {
    for (const declared of Object.values(project.config)) {
      if (typeof declared === "string" && pathLike(declared)) {
        keep(declared, projectDir, projectPath, "any");
      }
      if (!isRecord(declared) || declared.secret === true) continue;
      for (const value of [declared.default, declared.value]) {
        if (typeof value === "string" && pathLike(value))
          keep(value, projectDir, projectPath, "any");
      }
    }
  }
  if (stack.name !== undefined) {
    const stackDir =
      typeof project.stackConfigDir === "string"
        ? join(projectDir, project.stackConfigDir)
        : projectDir;
    const stackPath = join(stackDir, `Pulumi.${stack.name}${extension}`);
    const stackFile = read(stackPath);
    if (isRecord(stackFile) && isRecord(stackFile.config)) {
      plainStrings(stackFile.config, (value) => {
        if (pathLike(value)) keep(value, projectDir, stackPath, "any");
      });
    }
  }

  return [...found.values()].sort((a, b) => compare(a.path, b.path));
}

function runtimeName(runtime: unknown): unknown {
  return isRecord(runtime) ? runtime.name : runtime;
}

// Calls back with every key and value in a parsed document.
function walk(value: unknown, visit: (key: string, value: unknown) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
  } else if (isRecord(value)) {
    for (const [key, inner] of Object.entries(value)) {
      visit(key, inner);
      walk(inner, visit);
    }
  }
}

// Every string of a config block, never one under a `secure` key.
function plainStrings(value: unknown, visit: (value: string) => void): void {
  if (typeof value === "string") visit(value);
  else if (Array.isArray(value)) for (const item of value) plainStrings(item, visit);
  else if (isRecord(value) && !("secure" in value)) {
    for (const inner of Object.values(value)) plainStrings(inner, visit);
  }
}

// A file that is not there or does not parse names nothing.
function read(path: string): unknown {
  try {
    return parse(readFileSync(path, "utf8"), { uniqueKeys: false });
  } catch {
    return undefined;
  }
}

function kindOf(path: string): FileReference["kind"] | undefined {
  try {
    const stat = statSync(path);
    return stat.isDirectory() ? "directory" : stat.isFile() ? "file" : undefined;
  } catch {
    return undefined;
  }
}

function isFile(path: string): boolean {
  return kindOf(path) === "file";
}

function repoPath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
