// The one row renderer every writer uses (records 0009 and 0027). A row block
// is a pure function of plain data: no clock, no environment, no GitHub.

import type { CostEstimate } from "../core/cost.ts";
import type { QueuedWindow } from "../core/deploy-window.ts";
import type { Change, Diff } from "../core/diff.ts";
import type { OnMergeWait } from "../core/on-merge.ts";
import type { PhaseGroup } from "../core/phases.ts";
import { type PolicyOutcome, policyRunFailureText } from "../core/policy.ts";
import { amount, costLine } from "./cost.ts";
import { escapeText } from "./escape.ts";
import { mascotUrl } from "./images.ts";
import { ROW_CLOSE_MARKER, rowMarker } from "./marker.ts";
import { minuteAt } from "./time.ts";

// The attribution line (record 0026), rendered by the core and placed here as
// it is. `counted` is the line with its named pull requests replaced by a
// count, which the size budget asks for from level 1 on (record 0028).
export interface AttributionLines {
  full: string;
  counted: string;
  // The fold under the line that names the changes outside the stack (record
  // 0072), at level 0 only. Absent when there are none.
  outside?: readonly string[] | undefined;
}

// The note that a stack's last deploy from the dashboard failed. A deploy fact
// from the deployment record (record 0003), never from the old row.
export interface FailureLine {
  // A failure reason from the fixed list (record 0022), as display text.
  reason: string;
  ticker: string;
  at: Date;
  runUrl: string;
  // The deploy went out on merge, and `ticker` is whoever merged (record
  // 0095).
  onMerge?: boolean | undefined;
}

export interface PendingRow {
  state: "pending";
  diff: Diff;
  // The diff hash of `diff`. It covers the whole diff whatever the row shows.
  hash: string;
  // The value fingerprint of `diff` (record 0102), for the marker. Absent when
  // the diff carries none.
  fingerprint?: string | undefined;
  // The attempt of the run whose summary shows this diff in full (record
  // 0044).
  runUrl: string;
  // Where the `preview` link lands when it is not the summary: the stack's
  // preview page (record 0050), or the job log that holds the tool's own diff
  // of the stack (record 0048).
  previewUrl?: string | undefined;
  // Absent when the lookup failed. Attribution never blocks.
  attribution?: AttributionLines | undefined;
  failure?: FailureLine | undefined;
  // A tick on the old row that nothing picked up (record 0025).
  orphanTick?: boolean | undefined;
  // A tick on the old row, at this same diff hash, that a scan carries
  // through because a `resolve` run is on its way (record 0025).
  ticked?: boolean | undefined;
  // The newest deploy of the stack went out with this same diff hash, and the
  // stack is pending again (onboarding log, hurdle 21). `logUrl` is the job
  // log that holds the tool's own diff of the stack, when it holds one (record
  // 0048).
  pendingAgain?: { logUrl?: string | undefined } | undefined;
  // A value the row does not show differed between two previews of the same
  // commit (record 0102), so a tick would be refused. The line says so and
  // names the switch.
  valueEveryRun?: boolean | undefined;
  // The stacks its preview read from the program's stack references (record
  // 0059). They go on the marker and nowhere else.
  dependsOn?: readonly string[] | undefined;
  // The stack is set to on-merge, and this change waits for a tick after all
  // (record 0095). The row says why.
  waitsOnMerge?: OnMergeWait | undefined;
  // What the policies of the repo made of the change (record 0106). A
  // failed policy takes the box off the row and is named on it; a run that
  // failed is a warning line; a pass draws nothing.
  policies?: PolicyOutcome | undefined;
  // What the change does to the monthly bill (record 0105), when the stack's
  // tool has an estimate and the repo asked for one. Never in the hash, and
  // never on the marker.
  cost?: CostEstimate | undefined;
}

// A stack with nothing to deploy from its code and drift in real
// infrastructure (record 0055). It has a box: a tick deploys the code as it
// is, which puts the drift back. Its diff has no changes and holds the drift.
export interface DriftRow {
  state: "drift";
  diff: Diff;
  // The diff hash of `diff`, which covers the drift.
  hash: string;
  // The value fingerprint of `diff` (record 0102), for the marker.
  fingerprint?: string | undefined;
  // As on a pending row (record 0102).
  valueEveryRun?: boolean | undefined;
  // The attempt of the run whose summary lists the drift (record 0044).
  runUrl: string;
  // The stack's preview page, which lists the drift (record 0059). The
  // `preview` link lands on the summary without one.
  previewUrl?: string | undefined;
  failure?: FailureLine | undefined;
  orphanTick?: boolean | undefined;
  ticked?: boolean | undefined;
  dependsOn?: readonly string[] | undefined;
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
  // Copied from the marker of the row this one replaces, with how many of
  // them are deletes (record 0075).
  destroys?: number | undefined;
  deletes?: number | undefined;
  attribution?: AttributionLines | undefined;
  // The record is queued behind these stacks (record 0056). The row then says
  // so, and its marker state is `queued`.
  behind?: readonly string[] | undefined;
  // The record was opened on merge, and `ticker` is whoever merged (record
  // 0095). The row says so, so it never reads as a tick.
  onMerge?: boolean | undefined;
  // The record waits for the stack's deploy window (record 0104) or the end
  // of a deploy freeze (record 0115), or waits behind a stack while either
  // holds it. The row says when it goes, in the dashboard zone, and its
  // marker state is `queued`.
  window?: QueuedWindow | undefined;
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
  dependsOn?: readonly string[] | undefined;
}

export type Row = PendingRow | DriftRow | DeployingRow | PreviewFailedRow | InSyncRow;

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
  // The action ref to serve the spinner from (record 0063). A deploying or
  // queued row then starts with it. Absent, as without personality, it has
  // none. The row is written by one version and carried by the next as it
  // is, so it keeps the spinner of the version that wrote it.
  actionRef?: string | undefined;
  // `dashboard.timeZone` (record 0089): the zone of the failure line's time,
  // which says its offset. UTC when absent. The marker stays the same.
  timeZone?: string | undefined;
  // `dashboard.pendingDetail` (record 0114): how much a pending row shows
  // under its first line. The marker is the same at every setting, and no
  // setting drops a failure line or a delete or replace line. Full when
  // absent.
  detail?: PendingDetail | undefined;
}

// full: every line, as before record 0114. compact: the first line, and only
// the lines no setting hides and the ones that say why a row has no box or a
// tick would not go. names: the stack id and its counts, without the preview
// link, and only the lines no setting hides.
export type PendingDetail = "full" | "compact" | "names";

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

// How many changes of each kind a diff holds: the numbers of the first line,
// and since record 0110 the counts on the marker too.
export interface ChangeCounts {
  creates: number;
  updates: number;
  replaces: number;
  deletes: number;
  // Changes that only touch the tool's record of a resource (record 0007).
  tracking: number;
}

export function changeCounts(changes: readonly Change[]): ChangeCounts {
  const of = (op: Change["op"]) => changes.filter((change) => change.op === op).length;
  return {
    creates: of("create"),
    updates: of("update"),
    replaces: of("replace"),
    deletes: of("delete"),
    tracking: changes.filter((change) => change.op === "none" && change.tracking).length,
  };
}

// Words with zeros left out, in a fixed order. Replaces and deletes are bold,
// so the first line alone says that a row destroys something.
export function counts(changes: Change[]): string {
  const { creates, updates, replaces, deletes, tracking } = changeCounts(changes);
  return [
    creates && plural(creates, "create"),
    updates && plural(updates, "update"),
    replaces && `**${plural(replaces, "replace")}**`,
    deletes && `**${plural(deletes, "delete")}**`,
    tracking && `${tracking} tracking only`,
  ]
    .filter(Boolean)
    .join(", ");
}

// The old and new value of a path that `dashboard.showValues` lists (record
// 0052), as ` old → new`, or nothing for any other path. A side that is not
// there reads "nothing", outside the code, so it cannot pass for a value.
export function valueSuffix(change: Change, path: string, show: (value: string) => string): string {
  const value = change.values?.find((one) => one.path === path);
  if (value === undefined) return "";
  const side = (text: string | undefined) => (text === undefined ? "nothing" : show(text));
  return ` ${side(value.old)} → ${side(value.new)}`;
}

function code(text: string): string {
  return `<code>${escapeText(text)}</code>`;
}

export function sortedKeys(keys: string[]): string[] {
  return [...new Set(keys)].sort(byCodeUnit);
}

// How a row shows property paths (record 0046). The summary and the job log
// show every path in full, so a row can keep to what a person scans.
export const ROW_PATH_LENGTH = 80;
export const ROW_PATHS_PER_CHANGE = 10;
const HEAD_LENGTH = 24;

// A path longer than the limit keeps its first segment, the property the
// provider defines, and as much of its end, where the leaf is, as fits. The
// end starts at a segment when it holds one. Counted in code points, so a cut
// never splits a character.
export function shortPath(path: string): string {
  const points = Array.from(path);
  if (points.length <= ROW_PATH_LENGTH) return path;
  const first = /^(?:\["(?:[^"\\]|\\.)*"\]|[^.[]+)/.exec(path)?.[0] ?? "";
  const head = Array.from(first).slice(0, HEAD_LENGTH);
  const tail = points.slice(points.length - (ROW_PATH_LENGTH - head.length - 1));
  const segment = tail.findIndex((point) => point === "." || point === "[");
  const start = segment < 0 ? 0 : tail[segment] === "." ? segment + 1 : segment;
  const end = start < tail.length ? tail.slice(start) : tail;
  return `${head.join("")}…${end.join("")}`;
}

// One change as one line of plain HTML: the op as a key cap, the type, the
// name in bold, then the paths of the changed properties. A value only at a
// path `dashboard.showValues` lists, as the adapter gave it (record 0052). On a
// row a long path is shortened, and a line in the fold lists at most ten
// paths. A delete or replace line lists every one, because it is shown whole
// or cut whole (record 0024).
export function changeLine(change: Change, options: { row?: boolean } = {}): string {
  const word = [change.op === "none" ? undefined : change.op, change.tracking]
    .filter((part) => part !== undefined)
    .join(" + ");
  const cap = isDestroy(change) ? word.toUpperCase() : word;
  const forcing = sortedKeys(change.replaceKeys);
  const others = sortedKeys(change.changedKeys).filter((key) => !forcing.includes(key));
  const capped = options.row === true && !isDestroy(change);
  const listed = capped ? others.slice(0, ROW_PATHS_PER_CHANGE) : others;
  const hidden = others.length - listed.length;
  const show = (keys: string[]) =>
    keys
      .map((key) => code(options.row ? shortPath(key) : key) + valueSuffix(change, key, code))
      .join(", ");
  const parts = [
    `<kbd>${cap}</kbd> <code>${escapeText(change.type)}</code> <b>${escapeText(change.name)}</b>`,
  ];
  if (forcing.length > 0) parts.push(`forced by ${show(forcing)}`);
  if (others.length > 0) {
    const more = hidden > 0 ? `, and ${hidden} more` : "";
    parts.push(`${forcing.length > 0 ? "also changes " : ""}${show(listed)}${more}`);
  }
  return parts.join(" · ");
}

export const ORPHAN_TICK_NOTE =
  ":information_source: a tick on this row was not picked up. Tick again to deploy.";

// The note on a row whose tick `resolve` cleared because `deploys: false`
// (record 0051). Fixed words of Sluiceway's own, like the orphan note.
export const DEPLOYS_OFF_NOTE =
  ":information_source: deploys are turned off in `sluiceway.yaml`, so this tick started nothing.";

// The note on a row whose tick `resolve` cleared because a policy failed on
// its change (record 0106). Such a row has no box, so the tick came from a
// hand-edited body.
export const POLICY_FAILED_NOTE =
  ":information_source: this tick started nothing: a policy failed on this change, so its row has no box.";

// The note on a row whose tick `resolve` cleared because a stack it depends on
// has a change waiting that nobody ticked (record 0056). It names them, so a
// refusal never stays silent.
// With phases (record 0067) it names each phase the tick waits on and the
// stacks in it that have a change waiting, at most five of them, not every
// stack of the phase.
export function dependencyNote(ids: readonly string[], phases: readonly PhaseGroup[] = []): string {
  return `:information_source: this tick started nothing: ${waitsOnWords(ids, phases)}`;
}

// The stacks and phases a stack waits on, and what a person can do about it:
// the words a refused tick and a stack set to on-merge that waits share.
function waitsOnWords(ids: readonly string[], phases: readonly PhaseGroup[]): string {
  const names = ids.map((id) => `**${escapeText(id)}**`).join(" and ");
  const one = ids.length === 1;
  if (phases.length === 0) {
    return `it depends on ${names}, which ${
      one ? "has a change" : "have changes"
    } waiting. Tick ${one ? "both" : "them all"} to deploy them in order, or deploy ${names} first.`;
  }
  const waiting = (count: number) => (count === 1 ? "has a change" : "have changes");
  const clauses = [
    ...(ids.length === 0 ? [] : [`it depends on ${names}, which ${waiting(ids.length)} waiting`]),
    ...phases.map(
      ({ phase, stackIds }) =>
        `it waits on the **${escapeText(phase)}** phase: ${shortList(stackIds)} ${waiting(stackIds.length)} waiting`,
    ),
  ];
  const count = ids.length + phases.reduce((sum, { stackIds }) => sum + stackIds.length, 0);
  const first = [
    ...ids.map((id) => `**${escapeText(id)}**`),
    ...phases.map(({ phase }) => `the **${escapeText(phase)}** phase`),
  ];
  return `${clauses.join(", and ")}. Tick ${
    count === 1 ? "both" : "them all"
  } to deploy them in order, or deploy ${listWords(first)} first.`;
}

// The note on a pending row of a stack set to on-merge whose change waits for
// a tick after all (record 0095). Fixed words of Sluiceway's own, so a person
// never has to guess why a stack that deploys on merge did not.
export function onMergeNote(wait: OnMergeWait): string {
  const lead = ":information_source: this stack deploys on merge";
  const waits = `${lead}, and this change waits for a tick:`;
  switch (wait.kind) {
    case "deploys-off":
      return `${lead}, and deploys are turned off in \`sluiceway.yaml\`.`;
    case "destroy":
      return `${waits} it deletes or replaces a resource.`;
    case "drift":
      return `${waits} the stack drifted, and a deploy would also put back what changed outside the code.`;
    case "not-merged":
      return `${waits} the scan that found it did not follow a merge.`;
    case "cost":
      return `${waits} it costs about **${amount(wait.monthly)} ${wait.currency}** more a month, above the threshold of ${amount(wait.threshold)} ${wait.currency}.`;
    case "cost-unknown":
      return `${waits} its cost could not be estimated, and \`cost.threshold\` is set to ${amount(wait.threshold)}.`;
    case "depends-on":
      return `${waits} ${waitsOnWords(wait.named, wait.phases)}`;
  }
}

// A phase is named by its stacks up to this many, and the rest are counted,
// as a row names at most five authors (record 0029).
const NAMES_PER_PHASE = 5;

function shortList(ids: readonly string[]): string {
  const shown = ids.slice(0, NAMES_PER_PHASE).map((id) => `**${escapeText(id)}**`);
  const more = ids.length - shown.length;
  return more > 0 ? `${shown.join(", ")} and ${more} more` : listWords(shown);
}

// "a", "a and b", "a, b and c".
function listWords(words: readonly string[]): string {
  return words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

// The note on a row that a deploy of this same change did not bring in sync
// (onboarding log, hurdle 21). Fixed words of Sluiceway's own: it guesses at
// the cause and names no value.
export const PENDING_AGAIN_NOTE =
  ":information_source: pending again right after a deploy of this same change, a value in the program may differ on every run.";

// The line on a row whose value fingerprint differed between two previews of
// the same commit (record 0102). Fixed words of Sluiceway's own: it names no
// value, and it names the switch a person needs.
export const VALUE_EVERY_RUN_NOTE =
  ":information_source: a value this row does not show differed between two previews of the same commit, so a tick would be refused: a value in the program may differ on every run. Turn the value fingerprint off for this stack with `valueFingerprint: false` on its `stacks` entry.";

function pendingAgainLine({ logUrl }: { logUrl?: string | undefined }): string {
  return logUrl === undefined
    ? PENDING_AGAIN_NOTE
    : `${PENDING_AGAIN_NOTE} Compare the tool's own diff in the [job log](${logUrl}).`;
}

// Also the line `settle` puts on the row of a deploy it ended (record 0113).
export function failureLine(failure: FailureLine, timeZone: string | undefined): string {
  return `:x: last deploy failed: ${escapeText(failure.reason)} · ${failure.onMerge ? "merged" : "ticked"} by ${escapeText(
    failure.ticker,
  )} · ${minuteAt(failure.at, timeZone)} · [run](${failure.runUrl})`;
}

// `deletes 1, replaces 1`, for the warning on a row that lists no destroys.
export function destroyWords(deletes: number, replaces: number): string {
  return [deletes && `deletes ${deletes}`, replaces && `replaces ${replaces}`]
    .filter(Boolean)
    .join(", ");
}

// Drift in Sluiceway's own words (record 0055). The op says what happened to
// the real object outside the code: a property changed, or it is gone.
const DRIFT_WORDS: Partial<Record<Change["op"], string>> = { update: "changed", delete: "gone" };

export function driftWord(change: Change): string {
  return DRIFT_WORDS[change.op] ?? change.op;
}

// `1 changed, 1 gone outside the code`, in a fixed order.
export function driftCounts(drift: Change[]): string {
  const of = (op: Change["op"]) => drift.filter((change) => change.op === op).length;
  const parts = [of("update") && `${of("update")} changed`, of("delete") && `${of("delete")} gone`];
  return `${parts.filter(Boolean).join(", ")} outside the code`;
}

// One drift change as one line: what happened as a key cap, the type, the
// name in bold, then the paths the tool names. Never a value (record 0055).
export function driftLine(change: Change, options: { row?: boolean } = {}): string {
  const keys = sortedKeys(change.changedKeys);
  const listed = options.row === true ? keys.slice(0, ROW_PATHS_PER_CHANGE) : keys;
  const hidden = keys.length - listed.length;
  const parts = [
    `<kbd>${driftWord(change)}</kbd> <code>${escapeText(change.type)}</code> <b>${escapeText(change.name)}</b>`,
  ];
  if (listed.length > 0) {
    const more = hidden > 0 ? `, and ${hidden} more` : "";
    parts.push(
      `${listed.map((key) => code(options.row ? shortPath(key) : key)).join(", ")}${more}`,
    );
  }
  return parts.join(" · ");
}

export function sortedDrift(diff: Diff): Change[] {
  return [...(diff.drift ?? [])].sort((a, b) => byCodeUnit(a.address, b.address));
}

// The drift of a row under its changes: a fold of every drift line, or one
// line that points at the summary when the row is redacted or shortened.
function driftLines(drift: Change[], summary: string, options: RowOptions): string[] {
  if (drift.length === 0) return [];
  const inside = plural(drift.length, "change");
  if (options.redact) return [`Changes outside the code are listed in the ${summary}`];
  if ((options.level ?? 0) >= 2) {
    return [`${inside} outside the code not listed here, see the ${summary}`];
  }
  return [
    `<details><summary>${inside} outside the code</summary>`,
    ...drift.map((change) => `${driftLine(change, { row: true })}<br>`),
    "</details>",
  ];
}

function driftRow(row: DriftRow, options: RowOptions): string[] {
  const level = options.level ?? 0;
  const drift = sortedDrift(row.diff);
  const summary = `[summary](${row.runUrl})`;
  const box = options.readOnly ? "" : `[${row.ticked ? "x" : " "}] `;
  const lines = [
    `- ${box}**${escapeText(row.diff.stackId)}** · ${driftCounts(drift)} · [preview](${row.previewUrl ?? row.runUrl}) ${rowMarker(
      {
        stackId: row.diff.stackId,
        state: "drift",
        hash: row.hash,
        failed: row.failure !== undefined,
        shortened: level >= 2 ? level : 0,
        drift: true,
        gone: drift.filter((change) => change.op === "delete").length,
        changed: drift.filter((change) => change.op === "update").length,
        dependsOn: row.dependsOn,
        fingerprint: row.fingerprint,
      },
    )}`,
  ];
  if (row.failure) lines.push(failureLine(row.failure, options.timeZone));
  if (row.valueEveryRun) lines.push(VALUE_EVERY_RUN_NOTE);
  if (row.orphanTick && !options.readOnly) lines.push(ORPHAN_TICK_NOTE);
  lines.push(...driftLines(drift, summary, options));
  return lines;
}

// A row names this many failed policies, then counts the rest, as it names
// at most five authors (record 0029). The page names them all.
export const FAILURES_ON_A_ROW = 5;

// A policy's message is cut here, in code points, so one policy cannot fill
// the dashboard. The page shows it whole.
export const POLICY_MESSAGE_LENGTH = 200;

function policyWords(count: number): string {
  return `${count} ${count === 1 ? "policy" : "policies"}`;
}

// One failure in the policy's own words, escaped as untrusted text (record
// 0106): the message comes from a file of the repo, and is never markup.
export function policyFailureLine(
  failure: { namespace: string; message: string },
  whole = false,
): string {
  const points = Array.from(failure.message);
  const message =
    whole || points.length <= POLICY_MESSAGE_LENGTH
      ? failure.message
      : `${points.slice(0, POLICY_MESSAGE_LENGTH).join("")}…`;
  return `:no_entry: <code>${escapeText(failure.namespace)}</code> · ${escapeText(message)}`;
}

// The line of a row whose policies could not run (record 0106): a warning,
// and the box stays. The reason is one of Sluiceway's own (record 0022).
export function policiesNotRunLine(
  outcome: Extract<PolicyOutcome, { kind: "not-run" }>,
  runUrl: string,
): string {
  return `:warning: the policies did not run: ${policyRunFailureText(outcome.reason)}. Nothing was checked, see the [run](${runUrl}).`;
}

// The lines a pending row carries for its policies (record 0106). A failed
// policy is never behind a click, like a destroy (record 0027): the lead line
// says the box is gone, and each failure has a line, up to the cap. A
// redacted or shortened row keeps the count and points at the page.
function policyLines(row: PendingRow, options: RowOptions): string[] {
  const { policies } = row;
  const short = (options.detail ?? "full") !== "full";
  if (policies === undefined || policies.kind === "passed") return [];
  // A warning that decides nothing, so a shorter row leaves it to the page.
  if (policies.kind === "not-run") return short ? [] : [policiesNotRunLine(policies, row.runUrl)];
  const { failures } = policies.report;
  const lead = `:no_entry: **${policyWords(failures.length)} failed**, so this change has no box until it passes`;
  const preview = `[preview](${row.previewUrl ?? row.runUrl})`;
  // A row with no box always says why, in one line at a shorter detail.
  if (options.redact || short || (options.level ?? 0) >= 2) {
    return [`${lead}. They are named on the ${preview}.`];
  }
  const named = failures.slice(0, FAILURES_ON_A_ROW);
  const rest = failures.length - named.length;
  return [
    `${lead}:`,
    ...named.map((failure) => policyFailureLine(failure)),
    ...(rest > 0 ? [`:no_entry: and ${rest} more on the ${preview}`] : []),
  ];
}

function pendingRow(row: PendingRow, options: RowOptions): string[] {
  const level = options.level ?? 0;
  const changes = [...row.diff.changes].sort((a, b) => byCodeUnit(a.address, b.address));
  const deletes = changes.filter((change) => change.op === "delete");
  const replaces = changes.filter((change) => change.op === "replace");
  const folded = changes.filter((change) => !isDestroy(change));
  const destroys = deletes.length + replaces.length;
  const summary = `[summary](${row.runUrl})`;
  // A change that fails a policy has no box (record 0106), like a read-only
  // dashboard: it holds no tick and asks for none.
  const policyFailed = row.policies?.kind === "failed";
  const box = options.readOnly || policyFailed ? "" : `[${row.ticked ? "x" : " "}] `;
  // Drift the row also shows (record 0055). A resource that is gone outside
  // the code is no destroy: a deploy creates it again.
  const drift = sortedDrift(row.diff);
  const driftCount = drift.length > 0 ? ` · ${driftCounts(drift)}` : "";
  // The counts of the first line, on the marker as well (record 0110).
  const { creates, updates, tracking } = changeCounts(changes);
  // How much the row shows under its first line (record 0114).
  const detail = options.detail ?? "full";
  const full = detail === "full";
  const preview = detail === "names" ? "" : ` · [preview](${row.previewUrl ?? row.runUrl})`;

  const lines = [
    `- ${box}**${escapeText(row.diff.stackId)}** · ${counts(changes)}${driftCount}${preview} ${rowMarker(
      {
        stackId: row.diff.stackId,
        state: "pending",
        hash: row.hash,
        destroys,
        deletes: deletes.length,
        failed: row.failure !== undefined,
        shortened: level,
        drift: drift.length > 0,
        dependsOn: row.dependsOn,
        fingerprint: row.fingerprint,
        policyFailed,
        creates,
        updates,
        replaces: replaces.length,
        tracking,
      },
    )}`,
  ];
  // The one number a person wants before ticking, right under the first line
  // (record 0105). It names nothing, so redact and the size budget keep it.
  if (row.cost && full) lines.push(costLine(row.cost));
  if (row.attribution && full)
    lines.push(level >= 1 ? row.attribution.counted : row.attribution.full);
  // No setting hides a failure line (record 0114).
  if (row.failure) lines.push(failureLine(row.failure, options.timeZone));
  lines.push(...policyLines(row, options));
  // The notes that say why a tick would not go, or did not, stay at compact.
  const notes = detail !== "names";
  if (row.waitsOnMerge && notes) lines.push(onMergeNote(row.waitsOnMerge));
  if (row.valueEveryRun && notes) lines.push(VALUE_EVERY_RUN_NOTE);
  if (row.pendingAgain && full) lines.push(pendingAgainLine(row.pendingAgain));
  if (row.orphanTick && notes && !options.readOnly && !policyFailed) lines.push(ORPHAN_TICK_NOTE);

  // A row that lists no delete or replace line still carries the warning, with
  // the counts that caused it. The lines are all there or none are.
  if (options.redact || level >= 3) {
    const words = destroyWords(deletes.length, replaces.length);
    if (destroys > 0) {
      const warning = options.redact ? `${words}.` : `${words}, too many to list here.`;
      const read = options.readOnly
        ? `Read the ${summary}.`
        : `Read the ${summary} before you tick.`;
      lines.push(`:warning: **${warning}** ${read}`);
    } else if (full) {
      lines.push(
        `Changes ${options.redact ? "are listed in the" : "not listed here, see the"} ${summary}`,
      );
    }
    if (full)
      lines.push(...driftLines(drift, summary, options), ...outsideFold(row.attribution, level));
    return lines;
  }

  // Every delete and replace line, at every detail (record 0024).
  for (const change of [...deletes, ...replaces])
    lines.push(`:warning: ${changeLine(change, { row: true })}`);
  if (!full) return lines;
  if (folded.length > 0) {
    const inside = plural(folded.length, destroys > 0 ? "other change" : "change");
    if (level >= 2) {
      lines.push(`${inside} not listed here, see the ${summary}`);
    } else {
      lines.push(`<details><summary>${inside}</summary>`);
      for (const change of folded) lines.push(`${changeLine(change, { row: true })}<br>`);
      lines.push("</details>");
    }
  }
  lines.push(...driftLines(drift, summary, options), ...outsideFold(row.attribution, level));
  return lines;
}

// The fold that names the changes outside the stack (record 0072). It comes
// last: an HTML block runs to the next blank line, so a Markdown line after it
// would not render. From level 1 on it goes with the names.
function outsideFold(attribution: AttributionLines | undefined, level: RowLevel): string[] {
  return level === 0 ? [...(attribution?.outside ?? [])] : [];
}

// A small animated picture at the start of a deploying row (record 0063): the
// thing a person just ticked is visibly moving. A queued row gets the same
// crate standing still (record 0098), as the queued header ties it up at the
// gate, so motion on a row always means that stack is deploying now. A light
// and a dark file through `<picture>`, which follows the reader's GitHub
// theme, as the header does (record 0033). The alt text is empty because the
// words right after it say deploying or queued.
export const SPINNER_WIDTH = 16;

function spinner(actionRef: string, queued: boolean): string {
  const name = queued ? "spinner-queued" : "spinner";
  const file = (theme: string) => mascotUrl(actionRef, `${name}-${theme}.svg`);
  return `<picture><source media="(prefers-color-scheme: dark)" srcset="${file("dark")}"><img alt="" width="${SPINNER_WIDTH}" height="${SPINNER_WIDTH}" src="${file("light")}"></picture> `;
}

// What a row says of the deploy window it waits for (record 0104): when it
// opens, in the dashboard zone with its offset as every time that stands
// alone (record 0089), or that it is open and the next run starts it. A
// deploy freeze that holds it (record 0115) comes first, with its reason as
// plain text and its end, and the window after it only when the stack goes
// later than the freeze ends.
export function windowWords(window: QueuedWindow, timeZone: string | undefined): string {
  const { freeze } = window;
  if (freeze !== undefined) {
    const reason = freeze.reason === undefined ? "" : ` (${escapeText(freeze.reason)})`;
    const ends = `the end of the deploy freeze${reason} at ${minuteAt(freeze.ends, timeZone)}`;
    return window.opens === undefined || window.opens.getTime() === freeze.ends.getTime()
      ? ends
      : `${ends}, and then for the deploy window, which opens ${minuteAt(window.opens, timeZone)}`;
  }
  if (window.opens === undefined) {
    return window.anyTime
      ? "the next scheduled run, which starts it: nothing holds it now"
      : "the deploy window, which is open: the next scheduled run starts it";
  }
  return `the deploy window, which opens ${minuteAt(window.opens, timeZone)}`;
}

function deployingRow(row: DeployingRow, options: RowOptions): string[] {
  const behind = row.behind ?? [];
  const onMerge = row.onMerge ? " on merge" : "";
  const word =
    behind.length > 0
      ? `queued behind ${behind.map((id) => `**${escapeText(id)}**`).join(" and ")}${
          row.window ? `, and for ${windowWords(row.window, options.timeZone)}` : ""
        }`
      : row.window
        ? `queued for ${windowWords(row.window, options.timeZone)}`
        : row.waiting
          ? `waiting to start${onMerge}`
          : `deploying${onMerge}`;
  const state = behind.length > 0 || row.window ? "queued" : "deploying";
  const lines = [
    `- ${options.actionRef === undefined ? "" : spinner(options.actionRef, state === "queued")}**${escapeText(row.stackId)}** · ${word} · ${row.onMerge ? "merged" : "ticked"} by ${escapeText(row.ticker)} · [run](${
      row.runUrl
    }) ${rowMarker({ stackId: row.stackId, state, destroys: row.destroys, deletes: row.deletes, behind })}`,
  ];
  if (row.attribution) lines.push(row.attribution.full, ...outsideFold(row.attribution, 0));
  return lines;
}

function previewFailedRow(row: PreviewFailedRow, options: RowOptions): string[] {
  const lines = [
    `- **${escapeText(row.stackId)}** · preview failed: ${escapeText(row.reason)} · [run](${
      row.runUrl
    }) ${rowMarker({
      stackId: row.stackId,
      state: "preview-failed",
      failed: row.failure !== undefined,
    })}`,
  ];
  if (row.failure) lines.push(failureLine(row.failure, options.timeZone));
  return lines;
}

function inSyncRow(row: InSyncRow, options: RowOptions): string[] {
  const lines = [
    `- ${escapeText(row.stackId)} ${rowMarker({
      stackId: row.stackId,
      state: "in-sync",
      failed: row.failure !== undefined,
      dependsOn: row.dependsOn,
    })}`,
  ];
  if (row.failure) lines.push(failureLine(row.failure, options.timeZone));
  return lines;
}

function rowLines(row: Row, options: RowOptions): string[] {
  switch (row.state) {
    case "pending":
      return pendingRow(row, options);
    case "drift":
      return driftRow(row, options);
    case "deploying":
      return deployingRow(row, options);
    case "preview-failed":
      return previewFailedRow(row, options);
    case "in-sync":
      return inSyncRow(row, options);
  }
}

// A row block: the first line, then every other line indented, ending in the
// closing marker. No line is blank, so every list on the dashboard stays tight.
export function renderRow(row: Row, options: RowOptions = {}): string {
  const [first = "", ...rest] = rowLines(row, options);
  return [first, ...[...rest, ROW_CLOSE_MARKER].map((line) => INDENT + line)].join("\n");
}
