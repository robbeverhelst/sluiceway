import { segment } from "../opentofu/paths.ts";

// Who holds a field of a live object (record 0070). The API server keeps, in
// `metadata.managedFields`, one entry per field manager and operation with
// the fields it set (the FieldsV1 form of structured-merge-diff). A change
// made outside the code with `kubectl edit`, `patch`, `scale` or another
// tool's apply moves the field to that entry, so the drift check reads them
// to tell such a change from one the code makes.
//
// The fields are read as the property paths a row writes (record 0046), and
// they are only ever compared with the paths of a change. Nothing of a value
// leaves here, and neither do the keys of a Secret's data, which the paths of
// a change never go below (record 0060).

// The paths a field set holds, in the order it lists them. `f:<name>` is a
// field, `k:<json>` the item of a list with those keys, `v:<json>` the item
// with that value, `i:<n>` the item at an index, and `.` the node itself. An
// empty set holds the node and all below it. An item the object no longer
// holds is no path.
export function ownedPaths(object: unknown, fields: unknown): string[] {
  const paths: string[] = [];
  const walk = (node: unknown, set: unknown, path: string): void => {
    if (!isObject(set)) return;
    for (const [key, below] of Object.entries(set)) {
      if (key === ".") {
        if (path !== "") paths.push(path);
        continue;
      }
      const step = stepOf(node, key, path);
      if (step === undefined) continue;
      if (isObject(below) && Object.keys(below).length === 0) paths.push(step.path);
      else walk(step.node, below, step.path);
    }
  };
  walk(object, fields, "");
  return paths;
}

function stepOf(
  node: unknown,
  key: string,
  path: string,
): { node: unknown; path: string } | undefined {
  const colon = key.indexOf(":");
  const kind = key.slice(0, colon);
  const rest = key.slice(colon + 1);
  if (kind === "f") {
    return {
      node: isObject(node) ? node[rest] : undefined,
      path: path + segment(rest, path === ""),
    };
  }
  if (!Array.isArray(node)) return undefined;
  let index = -1;
  if (kind === "i") index = Number(rest);
  else {
    let wanted: unknown;
    try {
      wanted = JSON.parse(rest);
    } catch {
      return undefined;
    }
    if (kind === "k" && isObject(wanted)) {
      index = node.findIndex(
        (item) =>
          isObject(item) &&
          Object.entries(wanted).every(([name, value]) => same(item[name], value)),
      );
    } else if (kind === "v") {
      index = node.findIndex((item) => same(item, wanted));
    }
  }
  if (!Number.isInteger(index) || index < 0 || index >= node.length) return undefined;
  return { node: node[index], path: `${path}[${index}]` };
}

// The paths of a change that the stack's own apply does not hold and another
// entry does: a field someone or something else set since the stack last
// deployed. The stack's own apply is the Apply of its field manager; an
// Update by a manager of the same name, such as `kubectl scale`, is another.
// A path cut short, such as a Secret's `data`, counts when a field below it
// is held.
export function heldByOthers(
  object: Record<string, unknown>,
  paths: readonly string[],
  manager: string,
): string[] {
  const metadata = isObject(object.metadata) ? object.metadata : {};
  const entries = (Array.isArray(metadata.managedFields) ? metadata.managedFields : []).filter(
    isObject,
  );
  const ours: string[] = [];
  const others: string[] = [];
  for (const entry of entries) {
    const held = ownedPaths(object, entry.fieldsV1);
    if (entry.manager === manager && entry.operation === "Apply") ours.push(...held);
    else others.push(...held);
  }
  return paths.filter(
    (path) =>
      !ours.some((held) => within(path, held)) &&
      others.some((held) => within(path, held) || within(held, path)),
  );
}

// Whether path is held path itself or lies below it.
function within(path: string, held: string): boolean {
  if (path === held) return true;
  if (!path.startsWith(held)) return false;
  const next = path[held.length];
  return next === "." || next === "[";
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isObject(node: unknown): node is Record<string, unknown> {
  return typeof node === "object" && node !== null && !Array.isArray(node);
}
