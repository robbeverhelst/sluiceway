import type { Change, Op, ShownValue } from "../../core/diff.ts";
import { isListedPath, shortValue } from "../../core/show-values.ts";
import { changeFingerprint, type HiddenValue } from "../../core/value-fingerprint.ts";
import type { Folded } from "../folded.ts";
import { segment } from "../opentofu/paths.ts";
import type { Entry, FieldChange } from "./schema.ts";

// From the plugin's change types to what a change says (records 0007 and
// 0058), settled from the recordings of both helm versions. Kubernetes has no
// replace that helm makes without `--force`, and no tracking change without
// `--take-ownership`, which Sluiceway never passes. A change type that is not
// here fails the preview, and is never shown as in sync: OWNERSHIP, which the
// plugin gives only with `--take-ownership`, and MODIFY_SUPPRESSED, only with
// `--suppress-output-line-regex`.
const OPS: Record<string, Op> = {
  ADD: "create",
  MODIFY: "update",
  REMOVE: "delete",
};

// `namespace` is the release's own: an object there reads by its name alone,
// and an object the chart puts in another namespace reads with it in front.
export function foldEntries(
  entries: Entry[],
  namespace: string,
  showValues: readonly string[],
  // Put the value fingerprint on each update (record 0102). The plugin prints
  // no manifest for an object it adds, so a create carries none.
  fingerprint = false,
): Folded {
  const changes: Change[] = [];
  const unknown: string[] = [];
  const unreadable: string[] = [];
  const firstAt = new Map<string, number>();

  entries.forEach((entry, index) => {
    const at = `The tool's output, at [${index}]`;
    const op = Object.hasOwn(OPS, entry.changeType) ? OPS[entry.changeType] : undefined;
    if (op === undefined) {
      unknown.push(`${at}.changeType: expected ADD, MODIFY or REMOVE.`);
      return;
    }
    if (entry.changesSuppressed === true) {
      unreadable.push(`${at}.changesSuppressed: expected every change to be shown.`);
      return;
    }
    const type = typeOf(entry);
    const where = entry.namespace ?? "";
    const address = addressOf(entry);
    const earlier = firstAt.get(address);
    if (earlier !== undefined) {
      unreadable.push(
        `${at}: expected an object that no earlier entry has, and [${earlier}] has it.`,
      );
      return;
    }
    firstAt.set(address, index);

    const found = op === "update" ? keys(entry, showValues, fingerprint) : { changedKeys: [] };
    if (found === undefined) {
      unreadable.push(`${at}.changes: expected the paths that change on a MODIFY.`);
      return;
    }
    changes.push({
      address,
      type,
      name: where === "" || where === namespace ? entry.name : `${where}/${entry.name}`,
      op,
      replaceKeys: [],
      ...found,
    });
  });

  if (unreadable.length > 0) return { ok: false, reason: "unreadable-output", detail: unreadable };
  if (unknown.length > 0) return { ok: false, reason: "unknown-step", detail: unknown };
  changes.sort((a, b) => byCodeUnit(a.address, b.address));
  return { ok: true, changes };
}

// The plugin keys an object by its namespace, name, kind and API group, never
// the API version, so the address does too.
export function addressOf(entry: Entry): string {
  return `${typeOf(entry)}/${entry.namespace ?? ""}/${entry.name}`;
}

// The kind, with the API group behind it the way kubectl writes a resource,
// such as Deployment.apps. A kind of the core group stands alone.
function typeOf(entry: Entry): string {
  const slash = entry.apiVersion.lastIndexOf("/");
  return slash < 0 ? entry.kind : `${entry.kind}.${entry.apiVersion.slice(0, slash)}`;
}

// An update lists the paths that change. The plugin writes a path with a dot
// between names and gives the last name or index on its own, as it is, so a
// key with a dot in it, such as a label, is kept whole there.
function keys(
  entry: Entry,
  showValues: readonly string[],
  fingerprint: boolean,
): Pick<Change, "changedKeys" | "values" | "fingerprint"> | undefined {
  const found = entry.changes ?? [];
  if (found.length === 0) return undefined;
  const secret = entry.kind === "Secret" && !entry.apiVersion.includes("/");
  const values: ShownValue[] = [];
  const paths = found.map((change) => {
    const path = propertyPath(change);
    // Nothing of a Secret ever shows: its data is what Kubernetes keeps
    // secret, and the plugin's stand-in still tells its length.
    if (!secret && isListedPath(showValues, path)) {
      const value = shownValue(path, change);
      if (value !== undefined) values.push(value);
    }
    return path;
  });
  const changedKeys = [...new Set(paths.filter((path) => path !== ""))].sort(byCodeUnit);
  const shown = values
    .filter((value, index) => values.findIndex((one) => one.path === value.path) === index)
    .sort((a, b) => byCodeUnit(a.path, b.path));
  // The fingerprint of every changed field the row does not show (record
  // 0102): its old and new value as the plugin printed them, and every
  // field of a Secret as its mark, because the plugin's stand-in tells the
  // length of the data.
  const shownPaths = new Set(shown.map((value) => value.path));
  const hidden: HiddenValue[] = found.flatMap((change): HiddenValue[] => {
    const path = propertyPath(change);
    if (path === "" || shownPaths.has(path)) return [];
    if (secret) return [{ path, secret: true as const }];
    return [{ path, old: change.oldValue, new: change.newValue }];
  });
  const hiddenFingerprint = fingerprint ? changeFingerprint(hidden) : undefined;
  return {
    changedKeys,
    ...(shown.length === 0 ? {} : { values: shown }),
    ...(hiddenFingerprint === undefined ? {} : { fingerprint: hiddenFingerprint }),
  };
}

// A path in the notation every adapter uses (record 0046): a name, `.name`
// after the first, `[0]` for a list index and `["key"]` for a key that is not
// letters, digits and underscores.
export function propertyPath(change: FieldChange): string {
  let path = "";
  for (const part of (change.path ?? "").split(".")) {
    if (part === "") continue;
    const [, name = "", indexes = ""] = /^(.*?)((?:\[\d+\])*)$/.exec(part) ?? [];
    if (name !== "") path += segment(name, path === "");
    path += indexes;
  }
  const { field } = change;
  return path + (/^\d+$/.test(field) ? `[${field}]` : segment(field, path === ""));
}

function shownValue(path: string, change: FieldChange): ShownValue | undefined {
  const old = shown(change.oldValue);
  const next = shown(change.newValue);
  if (old === "refused" || next === "refused") return undefined;
  if (old === undefined && next === undefined) return undefined;
  return {
    path,
    ...(old === undefined ? {} : { old }),
    ...(next === undefined ? {} : { new: next }),
  };
}

// A scalar as display text (record 0052). An object or a list can hold a
// secret leaf next to a harmless one, and a value of several lines does not
// fit on a row, so neither shows.
function shown(value: unknown): string | "refused" | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value !== "string") return "refused";
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value)) return "refused";
  return shortValue(value);
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
