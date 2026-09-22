import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
// ever holds it.
export function bundleManifests(dir: string): string {
  const names = (filesIn(dir) ?? []).filter(isManifestFile).sort(byCodeUnit);
  return names
    .map((name) => {
      const text = readFileSync(join(dir, name), "utf8");
      return text.endsWith("\n") ? text : `${text}\n`;
    })
    .join("---\n");
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
