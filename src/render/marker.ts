// The marker format of record 0009: HTML comments in one namespace,
// `sluiceway:<kind>`, with key="value" pairs.

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
// and counted with them.
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
}

export interface RowFacts {
  stackId: string;
  state: RowState;
  // The diff hash. Only a row that was rendered from a diff has one.
  hash?: string | undefined;
  // Display caches (record 0027): the number of deletes and replaces in the
  // diff, and whether the row carries a failure line.
  destroys?: number | undefined;
  failed?: boolean | undefined;
  // A display cache too (record 0028): the level a shortened row is at. The
  // note under the scan line counts these, and a writer that carries a row
  // through cannot read its text.
  shortened?: number | undefined;
  // The diff hash covers drift (records 0009 and 0055), so `apply` checks
  // drift again before it compares, and a deploy puts the drift back.
  drift?: boolean | undefined;
}

// A pull request the dashboard offers to merge and deploy (record 0054). One
// line, outside the row blocks: it belongs to no stack's row, and a parser of
// an older version does not see it at all.
export interface MergeFacts {
  pr: number;
  // The stack its files are claimed by. A tick is judged by that stack's rule.
  stackId: string;
  // The commit at the head of the pull request. A tick approves merging
  // exactly that commit.
  head: string;
}

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
  return marker("dashboard", pairs);
}

export function rowMarker(facts: RowFacts): string {
  const pairs: [string, string][] = [
    ["stack", facts.stackId],
    ["state", facts.state],
  ];
  if (facts.hash !== undefined) pairs.push(["hash", facts.hash]);
  if (facts.destroys) pairs.push(["destroys", String(facts.destroys)]);
  if (facts.failed) pairs.push(["failed", "true"]);
  if (facts.shortened) pairs.push(["shortened", String(facts.shortened)]);
  if (facts.drift) pairs.push(["drift", "true"]);
  return marker("row", pairs);
}

export function mergeMarker(facts: MergeFacts): string {
  return marker("merge", [
    ["pr", String(facts.pr)],
    ["stack", facts.stackId],
    ["head", facts.head],
  ]);
}

export interface ParsedRoot {
  // A writer that meets a version other than its own does not touch the body.
  version: number;
  scanSha: string | undefined;
  scanRun: string | undefined;
  scanAt: string | undefined;
  fullScanAt?: string | undefined;
  fullScanRun?: string | undefined;
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
      failed: boolean;
      // The level of a shortened row, 0 for a row in full.
      shortened: number;
      // The hash covers drift (record 0055).
      drift: boolean;
      ticked: boolean;
      text: string;
    }
  // A state this version does not know. There is no tick to read on purpose:
  // such a row is carried through and never acted on.
  | { known: false; stackId: string; state: string; text: string };

// A merge row as it stands in the body. `text` is its one line.
export interface ParsedMerge extends MergeFacts {
  ticked: boolean;
  text: string;
}

export interface ParsedDashboard {
  // Absent when the first line of the body is not a root marker.
  root: ParsedRoot | undefined;
  rows: ParsedRow[];
  // In body order. Of two lines for one pull request both are here: the
  // readers take the first.
  merges: ParsedMerge[];
  rescanTicked: boolean;
}

const PAIRS = '((?: [^\\s="]+="[^"]*")*)';
const ROOT_LINE = new RegExp(`^<!-- sluiceway:dashboard${PAIRS} -->[ \\t]*$`);
// The tick: one regex on one line, anchored on the box at the start and the
// marker at the end. The visible text between them is never parsed.
const ROW_LINE = new RegExp(`^- (?:\\[([ xX])\\] )?.*<!-- sluiceway:row${PAIRS} -->[ \\t]*$`);
const MERGE_LINE = new RegExp(`^- (?:\\[([ xX])\\] )?.*<!-- sluiceway:merge${PAIRS} -->[ \\t]*$`);
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
  };
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
  let rescanTicked = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (RESCAN_LINE.test(line)) rescanTicked = true;
    const merge = readMerge(line);
    if (merge) merges.push(merge);

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
    rows.push({
      known: true,
      stackId,
      state,
      hash: pairs.get("hash"),
      destroys: count("destroys"),
      failed: pairs.get("failed") === "true",
      shortened: count("shortened"),
      drift: pairs.get("drift") === "true",
      ticked: match[1] === "x" || match[1] === "X",
      text,
    });
  }

  return { root: readRoot(lines[0] ?? ""), rows, merges, rescanTicked };
}

// A merge line whose marker lacks a number, a stack or a whole commit id is
// not one: nothing could be merged from it.
function readMerge(line: string): ParsedMerge | undefined {
  const match = MERGE_LINE.exec(line);
  if (!match) return undefined;
  const pairs = readPairs(match[2] ?? "");
  const pr = pairs.get("pr") ?? "";
  const stackId = pairs.get("stack");
  const head = pairs.get("head") ?? "";
  if (
    !/^[1-9]\d*$/.test(pr) ||
    stackId === undefined ||
    !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(head)
  ) {
    return undefined;
  }
  return {
    pr: Number(pr),
    stackId,
    head,
    ticked: match[1] === "x" || match[1] === "X",
    text: line,
  };
}
