import type { ShownValue } from "../../core/diff.ts";
import { isListedPath, shortValue } from "../../core/show-values.ts";

// The values at the paths that `dashboard.showValues` lists (record 0052).
// This is the one place that reads a value from the tool's document, and it
// runs inside the schema, so what leaves the schema is display text for the
// listed paths and nothing else of the document.

// What the tool prints for a value it holds as secret, when it is not asked to
// show secrets. A value, or a parent of it, that reads so is never shown.
const SECRET = "[secret]";

// What the tool prints for a value that is known only once the deploy runs.
const UNKNOWN = "04da6b54-80e4-46f7-96ec-b56ff0331ba9";

export interface ValueSources {
  // The paths of detailedDiff, with the flag that says whether the tool
  // compared the old inputs (true) or the old state's outputs (false).
  paths: { path: string; inputDiff: boolean }[];
  oldInputs: unknown;
  oldOutputs: unknown;
  newInputs: unknown;
}

export function listedValues(list: readonly string[], sources: ValueSources): ShownValue[] {
  const shown: ShownValue[] = [];
  for (const { path, inputDiff } of sources.paths) {
    if (!isListedPath(list, path)) continue;
    const old = side(valueAt(inputDiff ? sources.oldInputs : sources.oldOutputs, path));
    const next = side(valueAt(sources.newInputs, path));
    if (old === "refused" || next === "refused") continue;
    if (old === undefined && next === undefined) continue;
    shown.push({
      path,
      ...(old === undefined ? {} : { old }),
      ...(next === undefined ? {} : { new: next }),
    });
  }
  return shown.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

type Found = { kind: "absent" } | { kind: "found"; value: unknown } | { kind: "refused" };

// A scalar as display text. An object or a list can hold a secret next to a
// harmless leaf, a value of several lines does not fit on a row, and an
// unknown value is not a value yet, so none of them is shown.
function side(found: Found): string | "refused" | undefined {
  if (found.kind === "refused") return "refused";
  if (found.kind === "absent" || found.value === null) return undefined;
  const { value } = found;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value !== "string") return "refused";
  if (value === SECRET || value === UNKNOWN) return "refused";
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value)) return "refused";
  return shortValue(value);
}

// The value at a path. A path is the tool's text and is never parsed (record
// 0046): the walk writes the path of every property it passes the way the
// tool writes one, and follows only those that the path starts with. Two
// properties that both write the path, or a secret on the way, show nothing.
export function valueAt(root: unknown, path: string): Found {
  const found: Found[] = [];
  const walk = (node: unknown, prefix: string): void => {
    if (node === SECRET) {
      found.push({ kind: "refused" });
      return;
    }
    for (const [segment, child] of children(node, prefix === "")) {
      const at = prefix + segment;
      if (at === path) found.push({ kind: "found", value: child });
      else if (path.startsWith(at) && (path[at.length] === "." || path[at.length] === "["))
        walk(child, at);
    }
  };
  walk(root, "");
  const [only] = found;
  if (found.length > 1) return { kind: "refused" };
  return only ?? { kind: "absent" };
}

function children(node: unknown, top: boolean): [string, unknown][] {
  if (Array.isArray(node)) return node.map((child, index) => [`[${index}]`, child]);
  if (typeof node !== "object" || node === null) return [];
  return Object.entries(node).map(([key, child]) => [segmentOf(key, top), child]);
}

// A name of letters, digits and underscores is written plainly, after a dot
// unless it comes first. Any other key is quoted, with a quote inside it
// written \" and a backslash left as it is (record 0046).
function segmentOf(key: string, top: boolean): string {
  if (/^[\p{L}_][\p{L}\p{Nd}_]*$/u.test(key)) return top ? key : `.${key}`;
  return `["${key.replaceAll('"', '\\"')}"]`;
}
