import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

// What a stack's directory holds, the way kubectl reads it (record 0060).

// The names kustomize reads a kustomization from.
const KUSTOMIZATION = new Set(["kustomization.yaml", "kustomization.yml", "Kustomization"]);

// The files `kubectl apply -f <dir>` reads (kubectl's own list of extensions).
const MANIFEST = /\.(yaml|yml|json)$/;

export function isKustomization(file: string): boolean {
  return KUSTOMIZATION.has(file);
}

export function isManifestFile(file: string): boolean {
  return MANIFEST.test(file) && !isKustomization(file);
}

export type Source = "kustomization" | "manifests";

// A directory with a kustomization is rendered by kustomize. Any other
// directory is its manifests. What the directory holds now decides, not what
// it held when discovery ran.
export function sourceOf(dir: string): Source {
  return (filesIn(dir) ?? []).some(isKustomization) ? "kustomization" : "manifests";
}

// The manifests of a directory as one YAML stream: the files
// `kubectl apply -f <dir>` reads, one level deep, in code unit order, each
// byte for byte, with a document separator between two files. JSON is YAML,
// so a JSON manifest joins the stream as it is. The text holds every value of
// the manifests (record 0021): only a rendered set in a directory of its own
// ever holds it. With `recursive` it is the files `kubectl apply -R -f <dir>`
// reads, in the order it reads them (record 0070).
export function bundleManifests(dir: string, recursive = false): string {
  return manifestFiles(dir, recursive)
    .map((file) => {
      const text = readFileSync(join(dir, file), "utf8");
      return text.endsWith("\n") ? text : `${text}\n`;
    })
    .join("---\n");
}

// The manifest files of a directory, relative to it. With `recursive`, every
// subdirectory too, walked the way kubectl walks one (Go's filepath.Walk in
// cli-runtime's ExpandPathsToFileVisitors): the names of one directory in
// byte order, a subdirectory where its name falls, a link never followed.
export function manifestFiles(dir: string, recursive = false): string[] {
  return walk(dir, recursive).filter((file) => isManifestFile(basename(file)));
}

// The subdirectories below dir that hold a kustomization, relative to it.
// kubectl -R reads a kustomization file as a manifest, and it is none.
export function nestedKustomizations(dir: string): string[] {
  return [
    ...new Set(
      walk(dir, true)
        .filter((file) => file.includes("/") && isKustomization(basename(file)))
        .map((file) => file.slice(0, file.lastIndexOf("/"))),
    ),
  ];
}

function walk(dir: string, recursive: boolean, prefix = ""): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(join(dir, prefix), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .sort((a, b) => byCodeUnit(a.name, b.name))
    .flatMap((entry) => {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) return recursive ? walk(dir, true, path) : [];
      return entry.isFile() ? [path] : [];
    });
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// The files of the directory itself, as `kubectl apply -f <dir>` reads it
// without --recursive.
export function filesIn(dir: string): string[] | undefined {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return undefined;
  }
}
