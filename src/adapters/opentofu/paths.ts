import type { ShownValue } from "../../core/diff.ts";
import { isListedPath, shortValue } from "../../core/show-values.ts";
import { changeFingerprint, differingLeaves, SECRET_MARK } from "../../core/value-fingerprint.ts";

// The property paths that change on an update or a replace, found by
// comparing `before` and `after` in memory (records 0021 and 0046). The plan
// JSON gives no list of changed paths, so this is the one way to know. What
// leaves here is the paths, and the values a repo listed in
// `dashboard.showValues` (record 0052), and nothing else of either side.
//
// A path is written the way the Pulumi adapter writes one, so a person reads
// one notation on every row: a name, `.name` after the first, `[0]` for a list
// index and `["key"]` for a key that is not letters, digits and underscores,
// with a quote inside it written `\"`.
//
// The rules, settled from the recordings of both OpenTofu versions:
// - A leaf whose value differs is a changed path.
// - A value known only after the deploy (`after_unknown` says true) is a
//   changed path, and shows no value: it is not a value yet.
// - A value the tool marks sensitive on either side is compared whole and is a
//   changed path at the place of the mark, never below it, so not even the
//   keys inside a sensitive map reach a row. It never shows a value.

export interface Sides {
  before: unknown;
  after: unknown;
  afterUnknown: unknown;
  beforeSensitive: unknown;
  afterSensitive: unknown;
}

export function changedPaths(
  sides: Sides,
  showValues: readonly string[],
): { paths: string[]; values: ShownValue[] } {
  const paths: string[] = [];
  const values: ShownValue[] = [];

  const changed = (path: string, value?: { old: unknown; new: unknown }): void => {
    if (path === "") return;
    paths.push(path);
    if (value === undefined || !isListedPath(showValues, path)) return;
    const old = shown(value.old);
    const next = shown(value.new);
    if (old === "refused" || next === "refused") return;
    if (old === undefined && next === undefined) return;
    values.push({
      path,
      ...(old === undefined ? {} : { old }),
      ...(next === undefined ? {} : { new: next }),
    });
  };

  const walk = (
    before: unknown,
    after: unknown,
    unknown: unknown,
    beforeSensitive: unknown,
    afterSensitive: unknown,
    path: string,
  ): void => {
    if (beforeSensitive === true || afterSensitive === true) {
      if (!equal(before, after) || holdsUnknown(unknown)) changed(path);
      return;
    }
    if (unknown === true) {
      changed(path);
      return;
    }
    if (isObject(before) && isObject(after)) {
      const keys = new Set([
        ...Object.keys(before),
        ...Object.keys(after),
        ...(isObject(unknown) ? Object.keys(unknown) : []),
      ]);
      for (const key of keys) {
        walk(
          before[key],
          after[key],
          child(unknown, key),
          child(beforeSensitive, key),
          child(afterSensitive, key),
          path + segment(key, path === ""),
        );
      }
      return;
    }
    if (Array.isArray(before) && Array.isArray(after)) {
      const length = Math.max(before.length, after.length, arrayLength(unknown));
      for (let index = 0; index < length; index++) {
        walk(
          before[index],
          after[index],
          child(unknown, index),
          child(beforeSensitive, index),
          child(afterSensitive, index),
          `${path}[${index}]`,
        );
      }
      return;
    }
    if (holdsUnknown(unknown) || !equal(before, after)) {
      changed(path, holdsUnknown(unknown) ? undefined : { old: before, new: after });
    }
  };

  walk(
    sides.before,
    sides.after,
    sides.afterUnknown,
    sides.beforeSensitive,
    sides.afterSensitive,
    "",
  );
  return { paths, values };
}

// A side of the plan with every subtree the tool marks sensitive replaced by
// the mark, so a fingerprint enters a sensitive value as its mark and never
// in the clear (record 0102). The marks are walked with the value: a mark
// for a key the value does not hold marks nothing.
export function maskSensitive(value: unknown, sensitive: unknown): unknown {
  if (sensitive === true) return SECRET_MARK;
  if (Array.isArray(value)) {
    return value.map((item, index) => maskSensitive(item, child(sensitive, index)));
  }
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, maskSensitive(item, child(sensitive, key))]),
    );
  }
  return value;
}

// The value fingerprint of a resource (record 0102): the leaves that differ
// between the two sides, sensitive ones as their mark, minus the paths the
// row shows a value for. A create is the new side against nothing.
export function hiddenFingerprint(
  sides: Pick<Sides, "before" | "after" | "beforeSensitive" | "afterSensitive">,
  shown: readonly string[],
): string | undefined {
  const leaves = differingLeaves(
    maskSensitive(sides.before, sides.beforeSensitive),
    maskSensitive(sides.after, sides.afterSensitive),
  );
  return changeFingerprint(leaves.filter((leaf) => !shown.includes(leaf.path)));
}

// A path as a replace_paths entry gives it: property names, map keys and list
// indexes. It is cut at the first sensitive mark, as above.
export function replacePath(
  steps: (string | number)[],
  beforeSensitive: unknown,
  afterSensitive: unknown,
): string {
  let path = "";
  let before = beforeSensitive;
  let after = afterSensitive;
  for (const step of steps) {
    path += typeof step === "number" ? `[${step}]` : segment(step, path === "");
    before = child(before, step);
    after = child(after, step);
    if (before === true || after === true) break;
  }
  return path;
}

// Letters, digits and underscores are written plainly, after a dot unless the
// segment comes first. Any other key is quoted (record 0046).
export function segment(key: string, top: boolean): string {
  if (/^[\p{L}_][\p{L}\p{Nd}_]*$/u.test(key)) return top ? key : `.${key}`;
  return `["${key.replaceAll('"', '\\"')}"]`;
}

function child(node: unknown, key: string | number): unknown {
  if (typeof key === "number") return Array.isArray(node) ? node[key] : undefined;
  return isObject(node) ? node[key] : undefined;
}

function arrayLength(node: unknown): number {
  return Array.isArray(node) ? node.length : 0;
}

function holdsUnknown(node: unknown): boolean {
  if (node === true) return true;
  if (Array.isArray(node)) return node.some(holdsUnknown);
  if (isObject(node)) return Object.values(node).some(holdsUnknown);
  return false;
}

function isObject(node: unknown): node is Record<string, unknown> {
  return typeof node === "object" && node !== null && !Array.isArray(node);
}

// A missing value and null are the same: the plan writes an attribute that is
// not set as null on one side and may leave it out on the other.
function equal(a: unknown, b: unknown): boolean {
  if (a === undefined || a === null) return b === undefined || b === null;
  if (Array.isArray(a)) {
    return (
      Array.isArray(b) && a.length === b.length && a.every((item, index) => equal(item, b[index]))
    );
  }
  if (isObject(a)) {
    if (!isObject(b)) return false;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((key) => equal(a[key], b[key]));
  }
  return a === b;
}

// A scalar as display text (record 0052). An object or a list can hold a
// sensitive leaf next to a harmless one, and a value of several lines does
// not fit on a row, so neither shows.
function shown(value: unknown): string | "refused" | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value !== "string") return "refused";
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value)) return "refused";
  return shortValue(value);
}
