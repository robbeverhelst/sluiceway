import { createHash } from "node:crypto";
import type { Change, Diff } from "./diff.ts";

// Plain code unit order, with no locale (record 0008). This is what `<` does
// on two strings.
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedSet(keys: readonly string[]): string[] {
  return [...new Set(keys)].sort(byCodeUnit);
}

type Canonical = string | Canonical[] | { [key: string]: Canonical | undefined };

// JSON with sorted object keys, absent fields left out and no whitespace.
// Strings are escaped the way JSON.stringify escapes them.
function canonicalJson(value: Canonical): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const members = Object.keys(value)
    .sort(byCodeUnit)
    .flatMap((key) => {
      const member = value[key];
      return member === undefined ? [] : [`${JSON.stringify(key)}:${canonicalJson(member)}`];
    });
  return `{${members.join(",")}}`;
}

// Every field of a change (record 0007), named one by one, so nothing else
// that an object happens to carry can enter the hash.
function canonicalChange(change: Change): Canonical {
  return {
    address: change.address,
    type: change.type,
    name: change.name,
    op: change.op,
    tracking: change.tracking,
    previousAddress: change.previousAddress,
    changedKeys: sortedSet(change.changedKeys),
    replaceKeys: sortedSet(change.replaceKeys),
    values: canonicalValues(change.values),
  };
}

// The values a row shows at the paths `dashboard.showValues` lists, as the
// row shows them, so a tick approves them and a value that moved after the
// tick stops the deploy (records 0008 and 0052). Without any the field is
// left out, so a diff without a list hashes as it always did.
function canonicalValues(values: Change["values"]): Canonical | undefined {
  if (values === undefined || values.length === 0) return undefined;
  return [...values]
    .sort((a, b) => byCodeUnit(a.path, b.path))
    .map((value) => ({ path: value.path, old: value.old, new: value.new }));
}

// The canonical document of a diff: the exact text the diff hash is taken
// over (record 0008). The order in which an adapter hands over changes or keys
// never shows in it.
export function canonicalDiff(diff: Diff): string {
  const changes = diff.changes
    .map((change) => ({ address: change.address, text: canonicalJson(canonicalChange(change)) }))
    // An address is unique within a diff. Should an adapter break that, the
    // text settles the order, so the document still does not depend on it.
    .sort((a, b) => byCodeUnit(a.address, b.address) || byCodeUnit(a.text, b.text))
    .map((change) => change.text);
  return `{"changes":[${changes.join(",")}],"stackId":${JSON.stringify(diff.stackId)}}`;
}

// SHA-256 of the canonical document as UTF-8, first 16 hex characters, lower
// case. No salt and no version (record 0008).
export function diffHash(diff: Diff): string {
  return createHash("sha256").update(canonicalDiff(diff), "utf8").digest("hex").slice(0, 16);
}
