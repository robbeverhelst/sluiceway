// What the row markers of a dashboard say about the dashboard as a whole: the
// rows of each section, the counts line in numbers, the header state, the
// crate count, the destroy signs and the destroy alert. A pure function of
// the row blocks, so every writer can compute it for rows it only carries
// through. It decides nothing. Every renderer reads these facts and none
// counts rows for itself, so two of them cannot drift apart.

import { escapeText } from "./escape.ts";
import { isDeployingState, type ParsedRow } from "./marker.ts";
import { byCodeUnit } from "./row.ts";

type KnownRow = Extract<ParsedRow, { known: true }>;

// The seven header states (records 0031, 0043, 0055 and 0075), in the order
// in which they win: bad news first. A destroy is not a state of its own: it
// adds a sign to the picture (records 0043 and 0075). Queued is a stack that
// waits behind its dependencies while nothing deploys (record 0075). Drift is
// water seeping through the closed gate, a picture of nothing waiting, so a
// pending row wins over it (record 0055).
export const HEADER_STATES = [
  "failing",
  "deploying",
  "queued",
  "pending",
  "drift",
  "first-run",
  "in-sync",
] as const;
export type HeaderState = (typeof HEADER_STATES)[number];

// One crate per pending stack up to this many (records 0047, 0066 and 0075,
// which raised it from 12). Beyond it the picture shows the row running on
// past the left edge, which reads as "and more".
export const MAX_CRATES = 20;
export type Crates = number | "more";

// Which signs stand on the pole (records 0043 and 0075): the replace sign,
// the amber triangle, and the delete sign, an amber diamond with a cross.
export interface DestroySigns {
  deletes: boolean;
  replaces: boolean;
}

// The counts line in numbers. The result file shows five of them (record
// 0041).
export interface CountsLineNumbers {
  pending: number;
  drifted: number;
  // Queued rows included (record 0056).
  deploying: number;
  previewFailed: number;
  inSync: number;
  // Pending rows with a delete or replace: the destroy warning.
  destroying: number;
  // Rows of any state with a failure line.
  failedDeploys: number;
}

export interface DashboardFacts {
  // The known rows of each section of the body, in stack id order. Deploying
  // holds the queued rows too: they are placed with the deploying ones
  // (record 0056).
  pending: readonly KnownRow[];
  deploying: readonly KnownRow[];
  drift: readonly KnownRow[];
  previewFailed: readonly KnownRow[];
  inSync: readonly KnownRow[];
  // Rows of a state this version does not know (record 0009), in stack id
  // order. They take no part in any other fact.
  unknown: readonly ParsedRow[];
  counts: CountsLineNumbers;
  // The shortened rows of each section the size budget shortens (records
  // 0028 and 0055), for the note under the scan line (record 0084).
  shortened: { pending: number; drift: number };
  headerState: HeaderState;
  crates: Crates;
  signs: DestroySigns;
  // The destroy alert block (records 0062 and 0075), absent when it names
  // nothing.
  alert: string | undefined;
}

// Every scan ends with one row for every stack (record 0011), so a body with
// no row at all is a scan that found no stacks. Rows of unknown states alone
// are stacks that were found, so they are in sync, not a first run.
//
// Queued has two places, and both are meant. The counts line, the result
// file and the Deploying section place a queued row with the deploying ones
// (record 0056), because it is taken like one (record 0003). The header tells
// it apart while nothing deploys (record 0075), because the closed gate is
// what the person sees then. A deploying row still wins.
function headerStateOf(
  total: number,
  known: readonly KnownRow[],
  facts: Pick<DashboardFacts, "pending" | "deploying" | "drift" | "previewFailed">,
  failed: number,
): HeaderState {
  if (total === 0) return "first-run";
  if (facts.previewFailed.length > 0 || failed > 0) return "failing";
  if (known.some((row) => row.state === "deploying")) return "deploying";
  if (facts.deploying.length > 0) return "queued";
  if (facts.pending.length > 0) return "pending";
  if (facts.drift.length > 0) return "drift";
  return "in-sync";
}

// The two destroy rules differ on purpose, and both are kept here side by
// side.
//
// The signs look at pending, deploying and queued rows (record 0043, the rule
// the plain header state had in record 0031, split in record 0075): the
// picture warns while a destroy waits or is going out. A marker an older
// version wrote does not say how many of its destroys are deletes, so they
// all count as deletes: the delete sign asks for the more care of the two.
function signsOf(rows: readonly KnownRow[]): DestroySigns {
  const signs: DestroySigns = { deletes: false, replaces: false };
  for (const row of rows) {
    const deletes = Math.min(row.deletes ?? row.destroys, row.destroys);
    if (deletes > 0) signs.deletes = true;
    if (row.destroys - deletes > 0) signs.replaces = true;
  }
  return signs;
}

const ids = (rows: readonly KnownRow[]) =>
  rows.map((row) => `**${escapeText(row.stackId)}**`).join(", ");

// The destroy warning on the counts line and the alert look at pending rows
// only (record 0062): a deploying row has nothing left to tick, and both are
// there so nobody ticks past a destroy. The alert also names drifted rows
// whose drift check found a resource gone (record 0075): a drifted row
// deletes and replaces nothing, since nothing waits from its code, and a
// resource gone is the loss a person may not know of yet. The delete and
// replace lines stay open under each row (record 0027): the alert only makes
// sure nobody scrolls past them.
function alertOf(destroying: readonly KnownRow[], gone: readonly KnownRow[]): string | undefined {
  const paragraphs: string[] = [];
  if (destroying.length > 0) {
    const words =
      destroying.length === 1
        ? "1 pending stack deletes or replaces resources"
        : `${destroying.length} pending stacks delete or replace resources`;
    paragraphs.push(`> ${words}: ${ids(destroying)}`);
  }
  if (gone.length > 0) {
    const words =
      gone.length === 1
        ? "1 drifted stack has resources gone outside the code"
        : `${gone.length} drifted stacks have resources gone outside the code`;
    paragraphs.push(`> ${words}: ${ids(gone)}`);
  }
  if (paragraphs.length === 0) return undefined;
  return `> [!CAUTION]\n${paragraphs.join("\n>\n")}`;
}

const queuedLast = (row: KnownRow) => (row.state === "queued" ? 1 : 0);

export function dashboardFacts(rows: readonly ParsedRow[]): DashboardFacts {
  const sorted = [...rows].sort((a, b) => byCodeUnit(a.stackId, b.stackId));
  const known = sorted.filter((row) => row.known);
  const of = (state: KnownRow["state"]) => known.filter((row) => row.state === state);

  const pending = of("pending");
  // Of two rows for one stack, a deploying one is listed before a queued one.
  const deploying = known
    .filter((row) => isDeployingState(row.state))
    .sort((a, b) => byCodeUnit(a.stackId, b.stackId) || queuedLast(a) - queuedLast(b));
  const drift = of("drift");
  const previewFailed = of("preview-failed");
  const inSync = of("in-sync");
  const failed = known.filter((row) => row.failed).length;
  const destroying = pending.filter((row) => row.destroys > 0);
  const gone = drift.filter((row) => (row.gone ?? 0) > 0);
  const sections = { pending, deploying, drift, previewFailed, inSync };

  return {
    ...sections,
    unknown: sorted.filter((row) => !row.known),
    counts: {
      pending: pending.length,
      drifted: drift.length,
      deploying: deploying.length,
      previewFailed: previewFailed.length,
      inSync: inSync.length,
      destroying: destroying.length,
      failedDeploys: failed,
    },
    shortened: {
      pending: pending.filter((row) => row.shortened > 0).length,
      drift: drift.filter((row) => row.shortened > 0).length,
    },
    headerState: headerStateOf(rows.length, known, sections, failed),
    // In the pending, failing, deploying and queued pictures alike (records
    // 0047, 0066 and 0075). With nothing pending there are no crates.
    crates: pending.length > MAX_CRATES ? "more" : pending.length,
    signs: signsOf([...pending, ...deploying]),
    alert: alertOf(destroying, gone),
  };
}
