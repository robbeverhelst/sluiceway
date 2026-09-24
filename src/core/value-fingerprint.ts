import { createHash } from "node:crypto";
import type { Change, Diff } from "./diff.ts";

// The value fingerprint (record 0102): a hash of the values of a diff that the
// row does not show, so a tick covers them without any of them being shown.
// The diff hash covers what the row shows (0008); this covers what it leaves
// out, and the two are compared one after the other. Every adapter hashes
// through this file, so the document is the same for every tool and a
// reviewer can check it from the tool's own output and the record.

// What an adapter puts in place of a subtree the tool marks secret, when the
// tool marks it beside the value and not in it (OpenTofu's sensitive maps, a
// Kubernetes Secret). A tool that prints a mark in place of the value, as
// Pulumi does, names it through `isSecret` instead.
export const SECRET_MARK: unique symbol = Symbol("sluiceway:secret");

// One leaf of the hidden values of a change. A side that is absent or null
// is left out. `secret` stands for a value the tool marks secret on either
// side: the path enters, the value never does.
export type HiddenValue =
  | { path: string; old?: unknown; new?: unknown }
  | { path: string; secret: true };

// Plain code unit order, with no locale (record 0008).
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// JSON with sorted object keys and no whitespace. Values are the tool's own
// JSON, so they can be anything JSON holds.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const members = Object.keys(value)
      .sort(byCodeUnit)
      .flatMap((key) => {
        const member = (value as Record<string, unknown>)[key];
        return member === undefined ? [] : [`${JSON.stringify(key)}:${canonicalJson(member)}`];
      });
    return `{${members.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null;
}

// The document of the hidden values of one change: the entries, each in one
// of the four shapes of record 0102, sorted by path and then by text.
export function hiddenDocument(values: readonly HiddenValue[]): string {
  const entries = values.flatMap((value) => {
    if ("secret" in value)
      return [{ path: value.path, text: canonicalJson({ path: value.path, secret: true }) }];
    const old = isAbsent(value.old) ? {} : { old: value.old };
    const next = isAbsent(value.new) ? {} : { new: value.new };
    if (isAbsent(value.old) && isAbsent(value.new)) return [];
    return [{ path: value.path, text: canonicalJson({ path: value.path, ...old, ...next }) }];
  });
  entries.sort((a, b) => byCodeUnit(a.path, b.path) || byCodeUnit(a.text, b.text));
  return `[${entries.map((entry) => entry.text).join(",")}]`;
}

function first16(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

// The fingerprint of one change, or nothing when it has no hidden value.
export function changeFingerprint(values: readonly HiddenValue[]): string | undefined {
  const document = hiddenDocument(values);
  return document === "[]" ? undefined : first16(document);
}

export interface LeafOptions {
  // The property path both sides sit under, in the notation of record 0046.
  prefix?: string | undefined;
  // A node the tool prints in place of a secret. `SECRET_MARK` always is one.
  isSecret?: ((node: unknown) => boolean) | undefined;
}

// A name of letters, digits and underscores is written plainly, after a dot
// unless it comes first. Any other key is quoted, with a quote inside it
// written \" (record 0046), the way every adapter writes a path.
function segment(key: string, top: boolean): string {
  if (/^[\p{L}_][\p{L}\p{Nd}_]*$/u.test(key)) return top ? key : `.${key}`;
  return `["${key.replaceAll('"', '\\"')}"]`;
}

function isContainer(node: unknown): node is Record<string, unknown> | unknown[] {
  return typeof node === "object" && node !== null;
}

function keysOf(node: unknown): (string | number)[] {
  if (Array.isArray(node)) return node.map((_, index) => index);
  if (isContainer(node)) return Object.keys(node);
  return [];
}

function childOf(node: unknown, key: string | number): unknown {
  if (typeof key === "number") return Array.isArray(node) ? node[key] : undefined;
  return isContainer(node) && !Array.isArray(node) ? node[key] : undefined;
}

// The leaves that differ between two sides, walked together over the union
// of their keys (record 0102). A create is `differingLeaves(undefined, new)`.
// Where one side is a container and the other a scalar, the scalar enters at
// the path and the leaves of the container under it. A secret on either side
// is one entry at the mark and nothing under it.
export function differingLeaves(
  before: unknown,
  after: unknown,
  options: LeafOptions = {},
): HiddenValue[] {
  const found: HiddenValue[] = [];
  const secret = (node: unknown): boolean =>
    node === SECRET_MARK || (options.isSecret?.(node) ?? false);
  const walk = (old: unknown, next: unknown, path: string): void => {
    if (secret(old) || secret(next)) {
      found.push({ path, secret: true });
      return;
    }
    const oldIn = isContainer(old);
    const nextIn = isContainer(next);
    if (oldIn || nextIn) {
      if (!oldIn && !isAbsent(old)) found.push({ path, old });
      if (!nextIn && !isAbsent(next)) found.push({ path, new: next });
      const keys = new Map<string, string | number>();
      for (const key of [
        ...keysOf(oldIn ? old : undefined),
        ...keysOf(nextIn ? next : undefined),
      ]) {
        keys.set(typeof key === "number" ? `[${key}]` : segment(key, path === ""), key);
      }
      for (const [written, key] of keys) {
        walk(
          childOf(oldIn ? old : undefined, key),
          childOf(nextIn ? next : undefined, key),
          path + written,
        );
      }
      return;
    }
    if (isAbsent(old) && isAbsent(next)) return;
    if (old === next) return;
    found.push({
      path,
      ...(isAbsent(old) ? {} : { old }),
      ...(isAbsent(next) ? {} : { new: next }),
    });
  };
  walk(before, after, options.prefix ?? "");
  return found;
}

// The fingerprint of a row: every change that has one, sorted by address,
// the drift changes that have one under `drift`, and the stack id. Nothing
// when no change has one, and then the row's marker has no key.
export function valueFingerprint(diff: Diff): string | undefined {
  const list = (changes: readonly Change[] | undefined): string[] =>
    (changes ?? [])
      .flatMap((change) =>
        change.fingerprint === undefined
          ? []
          : [{ address: change.address, fingerprint: change.fingerprint }],
      )
      .sort((a, b) => byCodeUnit(a.address, b.address) || byCodeUnit(a.fingerprint, b.fingerprint))
      .map((entry) => canonicalJson(entry));
  const changes = list(diff.changes);
  const drift = list(diff.drift);
  if (changes.length === 0 && drift.length === 0) return undefined;
  const driftText = drift.length === 0 ? "" : `"drift":[${drift.join(",")}],`;
  return first16(
    `{"changes":[${changes.join(",")}],${driftText}"stackId":${JSON.stringify(diff.stackId)}}`,
  );
}

export interface HashAndFingerprint {
  hash: string;
  fingerprint?: string | undefined;
}

// A value that differs on every run (record 0102, the way the pending-again
// line of hurdle 21 is found): two previews of the same code give the same
// diff hash and another value fingerprint. `sameCommit` is whether the
// dashboard's last scan was of the commit the fresh preview is of. It
// explains a row and a refusal, and decides nothing else.
export function differsEveryRun(
  approved: HashAndFingerprint,
  fresh: HashAndFingerprint,
  sameCommit: boolean,
): boolean {
  return (
    sameCommit &&
    approved.hash === fresh.hash &&
    approved.fingerprint !== undefined &&
    fresh.fingerprint !== undefined &&
    approved.fingerprint !== fresh.fingerprint
  );
}
