// The marker format of record 0009: HTML comments in one namespace,
// `sluiceway:<kind>`, with key="value" pairs.

import type { OutsideDeploy } from "../core/outside-deploy.ts";

// Percent-encodes what could close the quote or the comment, and nothing else,
// so an id such as `apps/grafana:prod` reads as itself in the raw body. Every
// character in the set is one UTF-8 byte.
export function encodeMarkerValue(value: string): string {
  return value.replace(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: the control characters are the point
    /[%"<>\u0000- \u007f]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}

const utf8 = new TextDecoder();

// Reads any run of percent-encoded bytes as UTF-8, because another writer may
// encode more than this one does. A percent sign that starts no byte stays.
export function decodeMarkerValue(value: string): string {
  return value.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    const bytes = run
      .split("%")
      .slice(1)
      .map((hex) => Number.parseInt(hex, 16));
    return utf8.decode(new Uint8Array(bytes));
  });
}

// It changes only when an older parser would misread the body, never for a
// new key, state or kind.
export const MARKER_VERSION = 1;

// The row states. A row whose state is not one of these is carried through
// byte for byte and never acted on. `queued` is a deploying row whose record
// waits behind the stacks it depends on (records 0009 and 0056). `drift`
// arrived with record 0055: nothing to deploy from the code, and drift found
// in real infrastructure.
export const ROW_STATES = [
  "pending",
  "deploying",
  "in-sync",
  "preview-failed",
  "queued",
  "drift",
] as const;
export type RowState = (typeof ROW_STATES)[number];

// A queued stack is taken like a deploying one (record 0003), so it is placed
// and counted with them. Only the header state tells it apart (record 0075),
// in `dashboard-facts.ts`.
export function isDeployingState(state: string): boolean {
  return state === "deploying" || state === "queued";
}

// The scan facts the header shows. Writers other than `scan` have no scan of
// their own to take them from, so they ride on the root marker.
export interface RootFacts {
  scanSha: string;
  scanRun: string;
  // ISO 8601, UTC.
  scanAt: string;
  // The last full scan (record 0011). A full scan writes both, every other
  // writer carries them through.
  fullScanAt?: string | undefined;
  fullScanRun?: string | undefined;
  // A run of the workflow that has waited long for a runner (record 0086).
  // Only a scan finds one, and every other writer carries it.
  waitingRun?: WaitingRunFacts | undefined;
}

// The run that waited longest, when it started waiting (ISO 8601, UTC), and
// how many more runs waited as long.
export interface WaitingRunFacts {
  run: string;
  since: string;
  more: number;
}

export interface RowFacts {
  stackId: string;
  state: RowState;
  // The diff hash. Only a row that was rendered from a diff has one.
  hash?: string | undefined;
  // Display caches (record 0027): the number of deletes and replaces in the
  // diff, and whether the row carries a failure line.
  destroys?: number | undefined;
  // How many of those are deletes (record 0075), so the header can tell a
  // delete from a replace. Written whenever there are destroys.
  deletes?: number | undefined;
  failed?: boolean | undefined;
  // A display cache too (record 0028): the level a shortened row is at. The
  // note under the scan line counts these, and a writer that carries a row
  // through cannot read its text.
  shortened?: number | undefined;
  // The diff hash covers drift (records 0009 and 0055), so `apply` checks
  // drift again before it compares, and a deploy puts the drift back.
  drift?: boolean | undefined;
  // How many resources a drifted row's drift check found gone outside the
  // code (record 0075), for the destroy alert.
  gone?: number | undefined;
  // The stacks this stack's preview read from its program's stack references,
  // for a stack with `dependsOn: auto` (record 0059). `resolve` never
  // previews, so the row is where it finds them.
  dependsOn?: readonly string[] | undefined;
  // The value fingerprint of the row (record 0102): a hash of the values its
  // diff holds that the row does not show. `resolve` copies it onto the
  // record, and `apply` compares it after the hash.
  fingerprint?: string | undefined;
}

// A list of stack ids in one marker value, split on commas. An id is
// escaped for the comma and the percent sign first, so any id reads back as
// itself.
function encodeIds(ids: readonly string[]): string {
  return ids.map((id) => id.replace(/[%,]/g, (char) => (char === "%" ? "%25" : "%2C"))).join(",");
}

function decodeIds(value: string): string[] {
  return value.split(",").map(decodeMarkerValue);
}

// A pull request the dashboard offers to merge and deploy (record 0054). One
// line, outside the row blocks: it belongs to no stack's row, and a parser of
// an older version does not see it at all.
export interface MergeFacts {
  pr: number;
  // The stacks its files are claimed by, in code unit order: one, or since
  // record 0071 several, with one deploy each. A tick is judged by the rule
  // of every one of them.
  stackIds: string[];
  // The commit at the head of the pull request. A tick approves merging
  // exactly that commit.
  head: string;
}

// A pull request that waits on its checks (record 0081): its number and the
// stacks it would deploy. There is no head commit, because nothing is ticked
// on such a line.
export interface WaitingFacts {
  pr: number;
  stackIds: string[];
}

// The two sections whose rows a bulk box deploys at once (record 0083).
export type BulkSection = "pending" | "drift";
export const BULK_SECTIONS: readonly BulkSection[] = ["pending", "drift"];

// A stack of a confirm box, with the diff hash its row had when the box was
// drawn. Ticking the confirm box approves exactly these (record 0083).
export interface BulkStack {
  stackId: string;
  hash: string;
}

// Why a bulk box stands under its section again with a note (record 0083):
// a tick on it or on its confirm box that nothing picked up, a confirm box
// that no one ticked before the next scan, or the rows that changed under a
// confirm box.
export type BulkNote =
  | { kind: "orphan" }
  | { kind: "expired" }
  | { kind: "changed"; added: string[]; gone: string[]; moved: string[] };

// The facts of a bulk line (record 0083). It sits outside the row blocks, like
// a merge row, and every writer draws it again from these facts and the rows
// of its section.
export type BulkFacts =
  | { kind: "box"; section: BulkSection; note?: BulkNote }
  | {
      kind: "confirm";
      section: BulkSection;
      // The ticker of the bulk box it replaced. Plain text, so nobody is
      // notified.
      by: string;
      stacks: BulkStack[];
      // The scan run of the body it was drawn into. A scan after that one
      // takes it back (record 0083).
      scanRun: string;
    };

export const ROW_CLOSE_MARKER = "<!-- /sluiceway:row -->";
export const RESCAN_MARKER = "<!-- sluiceway:rescan -->";

function marker(kind: string, pairs: [key: string, value: string][]): string {
  const payload = pairs.map(([key, value]) => ` ${key}="${encodeMarkerValue(value)}"`).join("");
  return `<!-- sluiceway:${kind}${payload} -->`;
}

// Key order is fixed so output stays byte-identical. Parsers do not depend on it.
export function rootMarker(facts: RootFacts): string {
  const pairs: [string, string][] = [
    ["v", String(MARKER_VERSION)],
    ["scan-sha", facts.scanSha],
    ["scan-run", facts.scanRun],
    ["scan-at", facts.scanAt],
  ];
  if (facts.fullScanAt !== undefined) pairs.push(["full-scan-at", facts.fullScanAt]);
  if (facts.fullScanRun !== undefined) pairs.push(["full-scan-run", facts.fullScanRun]);
  if (facts.waitingRun !== undefined) {
    pairs.push(
      ["run-waiting", facts.waitingRun.run],
      ["run-waiting-since", facts.waitingRun.since],
    );
    if (facts.waitingRun.more > 0) pairs.push(["run-waiting-more", String(facts.waitingRun.more)]);
  }
  return marker("dashboard", pairs);
}

export function rowMarker(facts: RowFacts): string {
  const pairs: [string, string][] = [
    ["stack", facts.stackId],
    ["state", facts.state],
  ];
  if (facts.hash !== undefined) pairs.push(["hash", facts.hash]);
  if (facts.destroys) pairs.push(["destroys", String(facts.destroys)]);
  if (facts.destroys && facts.deletes !== undefined) pairs.push(["deletes", String(facts.deletes)]);
  if (facts.failed) pairs.push(["failed", "true"]);
  if (facts.shortened) pairs.push(["shortened", String(facts.shortened)]);
  if (facts.drift) pairs.push(["drift", "true"]);
  if (facts.gone) pairs.push(["gone", String(facts.gone)]);
  if (facts.dependsOn && facts.dependsOn.length > 0) {
    pairs.push(["depends-on", encodeIds(facts.dependsOn)]);
  }
  if (facts.fingerprint !== undefined) pairs.push(["fingerprint", facts.fingerprint]);
  return marker("row", pairs);
}

export function mergeMarker(facts: MergeFacts): string {
  return marker("merge", [
    ["pr", String(facts.pr)],
    // One id reads as itself. Several are a list, which an older parser reads
    // as one id that no stack has, so it merges nothing (record 0071).
    ["stack", encodeIds(facts.stackIds)],
    ["head", facts.head],
  ]);
}

// A line of an update waiting on its checks (record 0081). A marker of its own
// kind, so no reader of merge rows ever takes it for one that can be ticked.
export function waitingMarker(facts: WaitingFacts): string {
  return marker("waiting", [
    ["pr", String(facts.pr)],
    ["stack", encodeIds(facts.stackIds)],
  ]);
}

// A bulk box or a confirm box (record 0083). A marker kind of its own, so no
// reader of rows or merge rows ever takes it for one of theirs.
export function bulkMarker(facts: BulkFacts): string {
  const pairs: [string, string][] = [["section", facts.section]];
  if (facts.kind === "confirm") {
    pairs.push(
      ["confirm", facts.by],
      ["stacks", encodeIds(facts.stacks.map(({ stackId }) => stackId))],
      ["hashes", facts.stacks.map(({ hash }) => hash).join(",")],
      ["scan-run", facts.scanRun],
    );
  } else if (facts.note) {
    pairs.push(["note", facts.note.kind]);
    if (facts.note.kind === "changed") {
      const { added, gone, moved } = facts.note;
      if (added.length > 0) pairs.push(["added", encodeIds(added)]);
      if (gone.length > 0) pairs.push(["gone", encodeIds(gone)]);
      if (moved.length > 0) pairs.push(["moved", encodeIds(moved)]);
    }
  }
  return marker("bulk", pairs);
}

// A deploy made outside the dashboard, at the end of its line of the trail
// (record 0073). Only a full scan reads the tool's history, so every other
// writer takes these facts from the live body.
export function outsideMarker(deploy: OutsideDeploy): string {
  const pairs: [string, string][] = [
    ["stack", deploy.stackId],
    ["kind", deploy.kind],
    ["at", deploy.at.toISOString()],
  ];
  if (deploy.commit !== undefined) pairs.push(["commit", deploy.commit]);
  if (deploy.dirty) pairs.push(["dirty", "true"]);
  return marker("outside", pairs);
}

export interface ParsedRoot {
  // A writer that meets a version other than its own does not touch the body.
  version: number;
  scanSha: string | undefined;
  scanRun: string | undefined;
  scanAt: string | undefined;
  fullScanAt?: string | undefined;
  fullScanRun?: string | undefined;
  waitingRun?: WaitingRunFacts | undefined;
}

// A row block: every line from the one that ends in the open marker through
// the one that holds the closing marker. `text` is the block as it stands in
// the body, so a writer can carry it through without reading what is inside.
export type ParsedRow =
  | {
      known: true;
      stackId: string;
      state: RowState;
      hash: string | undefined;
      destroys: number;
      // How many of the destroys are deletes (record 0075). Absent on a
      // marker an older version wrote, which did not tell them apart.
      deletes?: number;
      failed: boolean;
      // The level of a shortened row, 0 for a row in full.
      shortened: number;
      // The hash covers drift (record 0055).
      drift: boolean;
      // Resources gone outside the code, on a drifted row (record 0075).
      // Absent when there are none.
      gone?: number;
      // Read from the program's stack references (record 0059). Absent when
      // the marker names none.
      dependsOn?: string[];
      // The value fingerprint (record 0102). Absent when the marker has none.
      fingerprint?: string;
      ticked: boolean;
      text: string;
    }
  // A state this version does not know. There is no tick to read on purpose:
  // such a row is carried through and never acted on.
  | { known: false; stackId: string; state: string; text: string };

// A merge row as it stands in the body. `text` is its line, and the note under
// it when it has one (record 0064).
export interface ParsedMerge extends MergeFacts {
  ticked: boolean;
  text: string;
}

// A bulk line as it stands in the body: its line and the lines under it.
export type ParsedBulk = BulkFacts & { ticked: boolean; text: string };

// A line of an update waiting on its checks as it stands in the body.
export interface ParsedWaiting extends WaitingFacts {
  text: string;
}

export interface ParsedDashboard {
  // Absent when the first line of the body is not a root marker.
  root: ParsedRoot | undefined;
  rows: ParsedRow[];
  // In body order. Of two lines for one pull request both are here: the
  // readers take the first.
  merges: ParsedMerge[];
  // The updates waiting on their checks, in body order (record 0081).
  waiting: ParsedWaiting[];
  // The outside deploys on the trail, in body order (record 0073).
  outside: OutsideDeploy[];
  // The bulk boxes and confirm boxes, in body order (record 0083). Of two
  // lines for one section the readers take the first.
  bulk: ParsedBulk[];
  rescanTicked: boolean;
}

const PAIRS = '((?: [^\\s="]+="[^"]*")*)';
const ROOT_LINE = new RegExp(`^<!-- sluiceway:dashboard${PAIRS} -->[ \\t]*$`);
// The tick: one regex on one line, anchored on the box at the start and the
// marker at the end. The visible text between them is never parsed.
const ROW_LINE = new RegExp(`^- (?:\\[([ xX])\\] )?.*<!-- sluiceway:row${PAIRS} -->[ \\t]*$`);
const MERGE_LINE = new RegExp(`^- (?:\\[([ xX])\\] )?.*<!-- sluiceway:merge${PAIRS} -->[ \\t]*$`);
const WAITING_LINE = new RegExp(`^- .*<!-- sluiceway:waiting${PAIRS} -->[ \\t]*$`);
const OUTSIDE_LINE = new RegExp(`^- .*<!-- sluiceway:outside${PAIRS} -->[ \\t]*$`);
const BULK_LINE = new RegExp(`^- \\[([ xX])\\] .*<!-- sluiceway:bulk${PAIRS} -->[ \\t]*$`);
const RESCAN_LINE = /^- \[[xX]\] .*<!-- sluiceway:rescan -->[ \t]*$/;

function readPairs(payload: string): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const [, key, value] of payload.matchAll(/ ([^\s="]+)="([^"]*)"/g)) {
    if (key !== undefined && value !== undefined) pairs.set(key, decodeMarkerValue(value));
  }
  return pairs;
}

function readRoot(line: string): ParsedRoot | undefined {
  const pairs = readPairs(ROOT_LINE.exec(line)?.[1] ?? "");
  const version = pairs.get("v");
  if (version === undefined || !/^\d+$/.test(version)) return undefined;
  return {
    version: Number(version),
    scanSha: pairs.get("scan-sha"),
    scanRun: pairs.get("scan-run"),
    scanAt: pairs.get("scan-at"),
    fullScanAt: pairs.get("full-scan-at"),
    fullScanRun: pairs.get("full-scan-run"),
    waitingRun: readWaitingRun(pairs),
  };
}

// Both the run and the time, or no waiting run. A count that is not a whole
// number reads as no more runs.
function readWaitingRun(pairs: Map<string, string>): WaitingRunFacts | undefined {
  const run = pairs.get("run-waiting");
  const since = pairs.get("run-waiting-since");
  if (run === undefined || since === undefined) return undefined;
  const more = pairs.get("run-waiting-more") ?? "0";
  return { run, since, more: /^\d+$/.test(more) ? Number(more) : 0 };
}

function isRowState(state: string): state is RowState {
  return (ROW_STATES as readonly string[]).includes(state);
}

// Reads what every writer needs from a body: the root marker, the row blocks
// and the rescan box. Marker kinds and keys it does not know are ignored.
export function parseDashboard(body: string): ParsedDashboard {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const rows: ParsedRow[] = [];
  const merges: ParsedMerge[] = [];
  const waiting: ParsedWaiting[] = [];
  const outside: OutsideDeploy[] = [];
  const bulk: ParsedBulk[] = [];
  let rescanTicked = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (RESCAN_LINE.test(line)) rescanTicked = true;
    const deploy = readOutside(line);
    if (deploy) {
      outside.push(deploy);
      continue;
    }
    const box = readBulk(line);
    if (box) {
      // Its line and the indented lines under it. Only Sluiceway writes
      // such a line there.
      let end = index;
      while (/^ {2}\S/.test(lines[end + 1] ?? "")) end++;
      bulk.push({ ...box, text: lines.slice(index, end + 1).join("\n") });
      index = end;
      continue;
    }
    const waits = readWaiting(line);
    if (waits) {
      waiting.push(waits);
      continue;
    }
    const merge = readMerge(line);
    if (merge) {
      // A merge row is its line and the indented note lines under it (record
      // 0064). Only Sluiceway writes such a line there.
      let end = index;
      while (/^ {2}\S/.test(lines[end + 1] ?? "")) end++;
      merges.push({ ...merge, text: lines.slice(index, end + 1).join("\n") });
      index = end;
      continue;
    }

    const match = ROW_LINE.exec(line);
    if (!match) continue;
    const pairs = readPairs(match[2] ?? "");
    const stackId = pairs.get("stack");
    if (stackId === undefined) continue;

    // The block ends at its closing marker. When the next row starts first,
    // or the body ends, the block is its first line alone.
    let end = index;
    for (let next = index + 1; next < lines.length; next++) {
      const candidate = lines[next] ?? "";
      if (candidate.trim() === ROW_CLOSE_MARKER) end = next;
      if (end === next || ROW_LINE.test(candidate)) break;
    }
    const text = lines.slice(index, end + 1).join("\n");
    index = end;

    const state = pairs.get("state") ?? "";
    if (!isRowState(state)) {
      rows.push({ known: false, stackId, state, text });
      continue;
    }
    const count = (key: string) => {
      const value = pairs.get(key) ?? "";
      return /^\d+$/.test(value) ? Number(value) : 0;
    };
    const dependsOn = pairs.get("depends-on") ?? "";
    const deletes = pairs.get("deletes") ?? "";
    const fingerprint = pairs.get("fingerprint");
    rows.push({
      known: true,
      stackId,
      state,
      hash: pairs.get("hash"),
      destroys: count("destroys"),
      ...(/^\d+$/.test(deletes) ? { deletes: Number(deletes) } : {}),
      failed: pairs.get("failed") === "true",
      shortened: count("shortened"),
      drift: pairs.get("drift") === "true",
      ...(count("gone") > 0 ? { gone: count("gone") } : {}),
      ...(dependsOn === "" ? {} : { dependsOn: decodeIds(dependsOn) }),
      ...(fingerprint === undefined ? {} : { fingerprint }),
      ticked: match[1] === "x" || match[1] === "X",
      text,
    });
  }

  return { root: readRoot(lines[0] ?? ""), rows, merges, waiting, outside, bulk, rescanTicked };
}

// A merge line whose marker lacks a number, a stack or a whole commit id is
// not one: nothing could be merged from it.
function readMerge(line: string): ParsedMerge | undefined {
  const match = MERGE_LINE.exec(line);
  if (!match) return undefined;
  const pairs = readPairs(match[2] ?? "");
  const pr = pairs.get("pr") ?? "";
  const stack = pairs.get("stack");
  const head = pairs.get("head") ?? "";
  if (
    !/^[1-9]\d*$/.test(pr) ||
    stack === undefined ||
    !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(head)
  ) {
    return undefined;
  }
  return {
    pr: Number(pr),
    stackIds: decodeIds(stack),
    head,
    ticked: match[1] === "x" || match[1] === "X",
    text: line,
  };
}

function isBulkSection(section: string | undefined): section is BulkSection {
  return (BULK_SECTIONS as readonly (string | undefined)[]).includes(section);
}

function readIds(pairs: Map<string, string>, key: string): string[] {
  const value = pairs.get(key) ?? "";
  return value === "" ? [] : decodeIds(value);
}

// A bulk line of a section this version does not know is not one. A confirm
// box without a login, without stacks, with a hash missing for one of them,
// or without its scan run is not one either: nothing could be deployed from
// it.
function readBulk(line: string): (BulkFacts & { ticked: boolean }) | undefined {
  const match = BULK_LINE.exec(line);
  if (!match) return undefined;
  const pairs = readPairs(match[2] ?? "");
  const section = pairs.get("section");
  if (!isBulkSection(section)) return undefined;
  const ticked = match[1] === "x" || match[1] === "X";
  const by = pairs.get("confirm");
  if (by === undefined) {
    const note = pairs.get("note");
    if (note === "orphan" || note === "expired") {
      return { kind: "box", section, note: { kind: note }, ticked };
    }
    if (note === "changed") {
      const [added = [], gone = [], moved = []] = ["added", "gone", "moved"].map((key) =>
        readIds(pairs, key),
      );
      return { kind: "box", section, note: { kind: "changed", added, gone, moved }, ticked };
    }
    return { kind: "box", section, ticked };
  }
  const ids = readIds(pairs, "stacks");
  const hashes = (pairs.get("hashes") ?? "").split(",");
  const scanRun = pairs.get("scan-run") ?? "";
  if (
    by === "" ||
    scanRun === "" ||
    ids.length === 0 ||
    hashes.length !== ids.length ||
    hashes.some((hash) => hash === "")
  ) {
    return undefined;
  }
  return {
    kind: "confirm",
    section,
    by,
    stacks: ids.map((stackId, index) => ({ stackId, hash: hashes[index] ?? "" })),
    scanRun,
    ticked,
  };
}

// A waiting line whose marker lacks a number or a stack is not one.
function readWaiting(line: string): ParsedWaiting | undefined {
  const match = WAITING_LINE.exec(line);
  if (!match) return undefined;
  const pairs = readPairs(match[1] ?? "");
  const pr = pairs.get("pr") ?? "";
  const stack = pairs.get("stack");
  if (!/^[1-9]\d*$/.test(pr) || stack === undefined) return undefined;
  return { pr: Number(pr), stackIds: decodeIds(stack), text: line };
}

// A line whose marker lacks a stack, a kind this version knows or a time, or
// names something that is not a whole commit id, is not one. A person can
// edit the body, so nothing else of the line is read.
function readOutside(line: string): OutsideDeploy | undefined {
  const match = OUTSIDE_LINE.exec(line);
  if (!match) return undefined;
  const pairs = readPairs(match[1] ?? "");
  const stackId = pairs.get("stack");
  const kind = pairs.get("kind");
  const at = new Date(pairs.get("at") ?? "");
  const commit = pairs.get("commit");
  if (
    stackId === undefined ||
    (kind !== "deploy" && kind !== "destroy") ||
    Number.isNaN(at.getTime()) ||
    (commit !== undefined && !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(commit))
  ) {
    return undefined;
  }
  return {
    stackId,
    kind,
    at,
    ...(commit === undefined ? {} : { commit }),
    ...(pairs.get("dirty") === "true" ? { dirty: true } : {}),
  };
}
