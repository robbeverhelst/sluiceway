// The one row renderer every writer uses (records 0009 and 0027). A row block
// is a pure function of plain data: no clock, no environment, no GitHub.

import type { Change, Diff } from "../core/diff.ts";
import { escapeText } from "./escape.ts";
import { ROW_CLOSE_MARKER, rowMarker } from "./marker.ts";
import { utcMinute } from "./time.ts";

// The attribution line (record 0026), rendered by the core and placed here as
// it is. `counted` is the line with its named pull requests replaced by a
// count, which the size budget asks for from level 1 on (record 0028).
export interface AttributionLines {
  full: string;
  counted: string;
}

// The note that a stack's last deploy from the dashboard failed. A deploy fact
// from the deployment record (record 0003), never from the old row.
export interface FailureLine {
  // A failure reason from the fixed list (record 0022), as display text.
  reason: string;
  ticker: string;
  at: Date;
  runUrl: string;
}

export interface PendingRow {
  state: "pending";
  diff: Diff;
  // The diff hash of `diff`. It covers the whole diff whatever the row shows.
  hash: string;
  // The attempt of the run whose summary shows this diff in full (record
  // 0044).
  runUrl: string;
  // Absent when the lookup failed. Attribution never blocks.
  attribution?: AttributionLines | undefined;
  failure?: FailureLine | undefined;
  // A tick on the old row that nothing picked up (record 0025).
  orphanTick?: boolean | undefined;
  // A tick on the old row, at this same diff hash, that a scan carries
  // through because a `resolve` run is on its way (record 0025).
  ticked?: boolean | undefined;
}

// Written by `resolve` without a diff (record 0014), so it has no box, no
// counts and no hash.
export interface DeployingRow {
  state: "deploying";
  stackId: string;
  ticker: string;
  runUrl: string;
  // The deployment record is still `queued`. That cannot tell a wait for a
  // reviewer from a wait for a runner, so the row does not guess.
  waiting?: boolean | undefined;
  // Copied from the marker of the row this one replaces.
  destroys?: number | undefined;
  attribution?: AttributionLines | undefined;
}

export interface PreviewFailedRow {
  state: "preview-failed";
  stackId: string;
  // A failure reason from the fixed list (record 0022), as display text.
  reason: string;
  // The job whose log holds the tool's own words, or the run where that job
  // is not known (record 0044).
  runUrl: string;
  failure?: FailureLine | undefined;
}

export interface InSyncRow {
  state: "in-sync";
  stackId: string;
  failure?: FailureLine | undefined;
}

export type Row = PendingRow | DeployingRow | PreviewFailedRow | InSyncRow;

// How much of its diff a pending row shows (records 0024 and 0028). Which row
// gets which level is the size budget's decision.
//   0  in full
//   1  the named pull requests on the attribution line become a count
//   2  the fold becomes one line, every delete and replace line is still there
//   3  no change lines at all, and the warning carries the count of destroys
export type RowLevel = 0 | 1 | 2 | 3;

export interface RowOptions {
  // `dashboard.redact` (record 0023): no resource type, resource name or
  // property name reaches the issue. The marker and the hash stay the same.
  redact?: boolean | undefined;
  level?: RowLevel | undefined;
  // `dashboard.readOnly` (slice 2.17): a pending row has no box, so it holds
  // no tick and asks for none. The marker and the hash stay the same.
  readOnly?: boolean | undefined;
}

export const INDENT = "  ";

export function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isDestroy(change: Change): boolean {
  return change.op === "replace" || change.op === "delete";
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// Words with zeros left out, in a fixed order. Replaces and deletes are bold,
// so the first line alone says that a row destroys something.
export function counts(changes: Change[]): string {
  const of = (op: Change["op"]) => changes.filter((change) => change.op === op).length;
  const trackingOnly = changes.filter((change) => change.op === "none" && change.tracking).length;
  return [
    of("create") && plural(of("create"), "create"),
    of("update") && plural(of("update"), "update"),
    of("replace") && `**${plural(of("replace"), "replace")}**`,
    of("delete") && `**${plural(of("delete"), "delete")}**`,
    trackingOnly && `${trackingOnly} tracking only`,
  ]
    .filter(Boolean)
    .join(", ");
}

function codes(keys: string[]): string {
  return keys.map((key) => `<code>${escapeText(key)}</code>`).join(", ");
}

export function sortedKeys(keys: string[]): string[] {
  return [...new Set(keys)].sort(byCodeUnit);
}

// One change as one line of plain HTML: the op as a key cap, the type, the
// name in bold, then the names of the changed properties. Never a value.
export function changeLine(change: Change): string {
  const word = [change.op === "none" ? undefined : change.op, change.tracking]
    .filter((part) => part !== undefined)
    .join(" + ");
  const cap = isDestroy(change) ? word.toUpperCase() : word;
  const forcing = sortedKeys(change.replaceKeys);
  const others = sortedKeys(change.changedKeys).filter((key) => !forcing.includes(key));
  const parts = [
    `<kbd>${cap}</kbd> <code>${escapeText(change.type)}</code> <b>${escapeText(change.name)}</b>`,
  ];
  if (forcing.length > 0) parts.push(`forced by ${codes(forcing)}`);
  if (others.length > 0) parts.push(`${forcing.length > 0 ? "also changes " : ""}${codes(others)}`);
  return parts.join(" · ");
}

export const ORPHAN_TICK_NOTE =
  ":information_source: a tick on this row was not picked up. Tick again to deploy.";

function failureLine(failure: FailureLine): string {
  return `:x: last deploy failed: ${escapeText(failure.reason)} · ticked by ${escapeText(
    failure.ticker,
  )} · ${utcMinute(failure.at)} · [run](${failure.runUrl})`;
}

// `deletes 1, replaces 1`, for the warning on a row that lists no destroys.
export function destroyWords(deletes: number, replaces: number): string {
  return [deletes && `deletes ${deletes}`, replaces && `replaces ${replaces}`]
    .filter(Boolean)
    .join(", ");
}

function pendingRow(row: PendingRow, options: RowOptions): string[] {
  const level = options.level ?? 0;
  const changes = [...row.diff.changes].sort((a, b) => byCodeUnit(a.address, b.address));
  const deletes = changes.filter((change) => change.op === "delete");
  const replaces = changes.filter((change) => change.op === "replace");
  const folded = changes.filter((change) => !isDestroy(change));
  const destroys = deletes.length + replaces.length;
  const summary = `[summary](${row.runUrl})`;
  const box = options.readOnly ? "" : `[${row.ticked ? "x" : " "}] `;

  const lines = [
    `- ${box}**${escapeText(row.diff.stackId)}** · ${counts(changes)} · [preview](${row.runUrl}) ${rowMarker(
      {
        stackId: row.diff.stackId,
        state: "pending",
        hash: row.hash,
        destroys,
        failed: row.failure !== undefined,
        shortened: level,
      },
    )}`,
  ];
  if (row.attribution) lines.push(level >= 1 ? row.attribution.counted : row.attribution.full);
  if (row.failure) lines.push(failureLine(row.failure));
  if (row.orphanTick && !options.readOnly) lines.push(ORPHAN_TICK_NOTE);

  // A row that lists no delete or replace line still carries the warning, with
  // the counts that caused it. The lines are all there or none are.
  if (options.redact || level >= 3) {
    const words = destroyWords(deletes.length, replaces.length);
    if (destroys > 0) {
      const warning = options.redact ? `${words}.` : `${words}, too many to list here.`;
      const read = options.readOnly ? `Read the ${summary}.` : `Read the ${summary} before you tick.`;
      lines.push(`:warning: **${warning}** ${read}`);
    } else {
      lines.push(
        `Changes ${options.redact ? "are listed in the" : "not listed here, see the"} ${summary}`,
      );
    }
    return lines;
  }

  for (const change of [...deletes, ...replaces]) lines.push(`:warning: ${changeLine(change)}`);
  if (folded.length > 0) {
    const inside = plural(folded.length, destroys > 0 ? "other change" : "change");
    if (level >= 2) {
      lines.push(`${inside} not listed here, see the ${summary}`);
    } else {
      lines.push(`<details><summary>${inside}</summary>`);
      for (const change of folded) lines.push(`${changeLine(change)}<br>`);
      lines.push("</details>");
    }
  }
  return lines;
}

function deployingRow(row: DeployingRow): string[] {
  const word = row.waiting ? "waiting to start" : "deploying";
  const lines = [
    `- **${escapeText(row.stackId)}** · ${word} · ticked by ${escapeText(row.ticker)} · [run](${
      row.runUrl
    }) ${rowMarker({ stackId: row.stackId, state: "deploying", destroys: row.destroys })}`,
  ];
  if (row.attribution) lines.push(row.attribution.full);
  return lines;
}

function previewFailedRow(row: PreviewFailedRow): string[] {
  const lines = [
    `- **${escapeText(row.stackId)}** · preview failed: ${escapeText(row.reason)} · [run](${
      row.runUrl
    }) ${rowMarker({
      stackId: row.stackId,
      state: "preview-failed",
      failed: row.failure !== undefined,
    })}`,
  ];
  if (row.failure) lines.push(failureLine(row.failure));
  return lines;
}

function inSyncRow(row: InSyncRow): string[] {
  const lines = [
    `- ${escapeText(row.stackId)} ${rowMarker({
      stackId: row.stackId,
      state: "in-sync",
      failed: row.failure !== undefined,
    })}`,
  ];
  if (row.failure) lines.push(failureLine(row.failure));
  return lines;
}

function rowLines(row: Row, options: RowOptions): string[] {
  switch (row.state) {
    case "pending":
      return pendingRow(row, options);
    case "deploying":
      return deployingRow(row);
    case "preview-failed":
      return previewFailedRow(row);
    case "in-sync":
      return inSyncRow(row);
  }
}

// A row block: the first line, then every other line indented, ending in the
// closing marker. No line is blank, so every list on the dashboard stays tight.
export function renderRow(row: Row, options: RowOptions = {}): string {
  const [first = "", ...rest] = rowLines(row, options);
  return [first, ...[...rest, ROW_CLOSE_MARKER].map((line) => INDENT + line)].join("\n");
}
