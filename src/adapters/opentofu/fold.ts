import type { Change, Op, Tracking } from "../../core/diff.ts";
import { changedPaths, replacePath } from "./paths.ts";
import type { ResourceChange } from "./schema.ts";

// From the plan's actions to what a change says (records 0007 and 0053),
// settled from the recordings of both OpenTofu versions. "drop" changes
// nothing. An action list that is not here fails the preview, and is never
// shown as in sync.
const ACTIONS: Record<string, { op: Op; tracking?: Tracking } | "drop"> = {
  // Every resource of the configuration is in the plan, most of them as a
  // no-op. A no-op with a previous address or an import is a tracking change,
  // see below.
  "no-op": "drop",
  // A data source read during the deploy. It changes no real object.
  read: "drop",
  create: { op: "create" },
  update: { op: "update" },
  // Both orders are a replace. The order is how, not what.
  "delete,create": { op: "replace" },
  "create,delete": { op: "replace" },
  delete: { op: "delete" },
  // A removed block that keeps the object: the record goes, the object stays.
  forget: { op: "none", tracking: "forget" },
  // In the tool's source and not yet in its docs, and in no recording: the
  // record of the old object goes and a new object is made (record 0007).
  "forget,create": { op: "create", tracking: "forget" },
};

export type Folded =
  | { ok: true; changes: Change[] }
  // The detail names a place in the tool's output and what was expected
  // there, never what was found (record 0021).
  | { ok: false; reason: "unreadable-output" | "unknown-step"; detail: string[] };

export function foldChanges(found: ResourceChange[], showValues: readonly string[]): Folded {
  const changes: Change[] = [];
  const unknown: string[] = [];
  const unreadable: string[] = [];
  const firstAt = new Map<string, number>();

  found.forEach((resource, index) => {
    const at = `The tool's output, at resource_changes[${index}]`;
    const key = resource.change.actions.join(",");
    const known = Object.hasOwn(ACTIONS, key) ? ACTIONS[key] : undefined;
    if (known === undefined) {
      unknown.push(`${at}.change.actions: expected actions that Sluiceway knows.`);
      return;
    }
    const moved = resource.previous_address !== undefined;
    const imported = resource.change.importing;
    if (moved && imported) {
      unreadable.push(`${at}: expected a move or an import, not both.`);
      return;
    }
    // A data source never changes a real object.
    if (resource.mode === "data") {
      if (known !== "drop") unknown.push(`${at}.change.actions: expected a read of a data source.`);
      return;
    }
    const flagged: Tracking | undefined = moved ? "move" : imported ? "import" : undefined;
    if (flagged !== undefined && known !== "drop" && known.tracking !== undefined) {
      unreadable.push(`${at}: expected one tracking change, found two.`);
      return;
    }
    const folded = withTracking(known, flagged);
    if (folded === undefined) return;

    // "address and deposed together form a unique key" (the docs).
    const address =
      resource.deposed === undefined
        ? resource.address
        : `${resource.address} deposed ${resource.deposed}`;
    const earlier = firstAt.get(address);
    if (earlier !== undefined) {
      unreadable.push(
        `${at}.address: expected an address that no earlier change has, and resource_changes[${earlier}] has it.`,
      );
      return;
    }
    firstAt.set(address, index);

    changes.push({
      address,
      type: resource.type,
      name: displayName(resource),
      ...folded,
      ...(moved && resource.previous_address !== undefined
        ? { previousAddress: resource.previous_address }
        : {}),
      ...keys(resource, folded.op, showValues),
    });
  });

  if (unreadable.length > 0) return { ok: false, reason: "unreadable-output", detail: unreadable };
  if (unknown.length > 0) return { ok: false, reason: "unknown-step", detail: unknown };
  // The tool sorts by address, and the core sorts anyway (record 0008).
  changes.sort((a, b) => byCodeUnit(a.address, b.address));
  return { ok: true, changes };
}

// A no-op that moves or imports is a tracking change on its own, and an
// update that does is an update with it. A plain no-op is dropped.
function withTracking(
  known: { op: Op; tracking?: Tracking } | "drop",
  tracking: Tracking | undefined,
): { op: Op; tracking?: Tracking } | undefined {
  if (known === "drop") return tracking === undefined ? undefined : { op: "none", tracking };
  if (tracking === undefined) return known;
  return { ...known, tracking };
}

// What a person sees next to the type: the address without the type, so a
// module and a count or for_each key stay in it. `name` alone would read the
// same for every instance (the adapter research).
function displayName(resource: ResourceChange): string {
  const module = resource.module_address === undefined ? "" : `${resource.module_address}.`;
  const prefix = `${module}${resource.type}.`;
  const rest = resource.address.startsWith(prefix)
    ? resource.address.slice(prefix.length)
    : resource.name;
  const name = `${module}${rest}`;
  return resource.deposed === undefined ? name : `${name} (deposed ${resource.deposed})`;
}

// Creates, deletes and tracking changes alone list no keys (record 0007). An
// update or a replace lists the paths that change, and a replace also what
// forced it, which is a changed key too.
function keys(
  resource: ResourceChange,
  op: Op,
  showValues: readonly string[],
): Pick<Change, "changedKeys" | "replaceKeys" | "values"> {
  if (op !== "update" && op !== "replace") return { changedKeys: [], replaceKeys: [] };
  const { change } = resource;
  const { paths, values } = changedPaths(
    {
      before: change.before,
      after: change.after,
      afterUnknown: change.after_unknown,
      beforeSensitive: change.before_sensitive,
      afterSensitive: change.after_sensitive,
    },
    showValues,
  );
  const replaceKeys =
    op === "replace"
      ? sortedSet(
          (change.replace_paths ?? []).map((steps) =>
            replacePath(steps, change.before_sensitive, change.after_sensitive),
          ),
        )
      : [];
  const changedKeys = sortedSet([...paths, ...replaceKeys]);
  const shown = values
    .filter((value) => changedKeys.includes(value.path))
    .sort((a, b) => byCodeUnit(a.path, b.path));
  return { changedKeys, replaceKeys, ...(shown.length === 0 ? {} : { values: shown }) };
}

function sortedSet(names: string[]): string[] {
  return [...new Set(names.filter((name) => name !== ""))].sort(byCodeUnit);
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
