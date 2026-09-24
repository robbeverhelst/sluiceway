// The bulk box and its confirm box (record 0083). A tick on the bulk box
// deploys nothing: the next writer replaces it with a confirm box that names
// the stacks of the section at their diff hashes, and a tick on that is what
// deploys them, each as its own tick. This is the rule of which line a
// section gets. Every writer asks it, from the rows it is about to write and
// the line the live body holds, and nothing in it deploys.

import type { BulkLine } from "../render/bulk-box.ts";
import type { BulkNote, BulkSection, BulkStack, ParsedBulk, ParsedRow } from "../render/marker.ts";

// What a walk through the edit history looks for (record 0025): the ticked
// bulk box of a section, or its ticked confirm box at exactly these stacks
// and hashes.
export type BulkTick =
  | { kind: "bulk"; section: BulkSection }
  | { kind: "confirm"; section: BulkSection; stacks: BulkStack[] };

// One row per section is enough: one row already has its own box.
export const BULK_MIN_ROWS = 2;

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// The rows a bulk line of the section is about: the known rows of the
// section's state that show a diff hash, the first block of each stack, in
// stack id order. A row a policy stopped has no box (record 0106), so no
// bulk box counts it and no confirm box names it.
export function bulkRows(rows: readonly ParsedRow[], section: BulkSection): BulkStack[] {
  const seen = new Set<string>();
  const found: BulkStack[] = [];
  for (const row of rows) {
    if (seen.has(row.stackId)) continue;
    seen.add(row.stackId);
    if (row.known && row.state === section && row.hash !== undefined && !row.policyFailed) {
      found.push({ stackId: row.stackId, hash: row.hash });
    }
  }
  return found.sort((a, b) => byCodeUnit(a.stackId, b.stackId));
}

// What changed between the stacks a confirm box names and the rows of its
// section now, or nothing when they are the same stacks at the same hashes.
export function sectionChanges(
  named: readonly BulkStack[],
  now: readonly BulkStack[],
): { added: string[]; gone: string[]; moved: string[] } | undefined {
  const before = new Map(named.map(({ stackId, hash }) => [stackId, hash]));
  const after = new Map(now.map(({ stackId, hash }) => [stackId, hash]));
  const added = [...after.keys()].filter((id) => !before.has(id)).sort(byCodeUnit);
  const gone = [...before.keys()].filter((id) => !after.has(id)).sort(byCodeUnit);
  const moved = [...after]
    .filter(([id, hash]) => before.has(id) && before.get(id) !== hash)
    .map(([id]) => id)
    .sort(byCodeUnit);
  return added.length + gone.length + moved.length === 0 ? undefined : { added, gone, moved };
}

// Whether a live line holds a tick. Markers only (record 0009).
export function holdsBulkTick(live: ParsedBulk | undefined, tick: BulkTick): boolean {
  if (!live?.ticked || live.section !== tick.section) return false;
  if (tick.kind === "bulk") return live.kind === "box";
  return live.kind === "confirm" && sectionChanges(live.stacks, tick.stacks) === undefined;
}

// What a `resolve` run did with the tick of a section. It is applied only
// while the live line still holds that tick: a newer edit belongs to the next
// run, as for a row's box (record 0025).
// - "confirm": the bulk tick was allowed. The confirm box names the rows as
//   they are, and the scan run of the body it is drawn into.
// - "consumed": the confirm tick was handed on as one tick per stack.
// - "clear": the tick started nothing and the box is cleared, with a note
//   when nobody is told otherwise.
export type BulkAct = { tick: BulkTick } & (
  | { outcome: "confirm"; by: string; scanRun: string }
  | { outcome: "consumed" }
  | { outcome: "clear"; note?: BulkNote | undefined }
);

export interface BulkInput {
  section: BulkSection;
  // The rows of the section in the body being written, as `bulkRows` gives
  // them.
  rows: readonly BulkStack[];
  // Deploys are on and the dashboard is not read only.
  on: boolean;
  // The first line of the section in the live body.
  live: ParsedBulk | undefined;
  act?: BulkAct | undefined;
  // Only a scan sweeps: the scan run of the live body, and whether a run that
  // an issue edit started is queued or in progress (record 0025).
  scan?: { liveScanRun: string | undefined; resolveOnItsWay: boolean } | undefined;
}

// The line a section gets, or none.
export function drawBulk(input: BulkInput): BulkLine | undefined {
  const { section, rows, live, act, scan } = input;
  if (!input.on || rows.length < BULK_MIN_ROWS) return undefined;
  const box = (ticked: boolean, note?: BulkNote): BulkLine => ({
    kind: "box",
    section,
    count: rows.length,
    ticked,
    ...(note ? { note } : {}),
  });

  if (act && holdsBulkTick(live, act.tick)) {
    if (act.outcome === "confirm") {
      return {
        kind: "confirm",
        section,
        by: act.by,
        stacks: [...rows],
        scanRun: act.scanRun,
        ticked: false,
      };
    }
    return box(false, act.outcome === "clear" ? act.note : undefined);
  }

  if (live?.kind === "confirm") {
    // The rows changed under it: what the person would confirm is not what
    // the box names any more.
    const changes = sectionChanges(live.stacks, rows);
    if (changes) return box(false, { kind: "changed", ...changes });
    const { text: _, ...facts } = live;
    if (scan) {
      // A tick is handed off while a `resolve` run is on its way, and is an
      // orphan otherwise (record 0025).
      if (live.ticked) return scan.resolveOnItsWay ? facts : box(false, { kind: "orphan" });
      // A confirm box lives through one scan and not two.
      if (live.scanRun !== scan.liveScanRun) return box(false, { kind: "expired" });
    }
    return facts;
  }

  if (live?.kind === "box") {
    if (scan) {
      if (!live.ticked) return box(false);
      return scan.resolveOnItsWay ? box(true) : box(false, { kind: "orphan" });
    }
    return box(live.ticked, live.note);
  }
  return box(false);
}

// What a writer hands the body about the bulk lines: the switch, the live
// lines, what a `resolve` run did, and for a scan what it sweeps by.
export interface BulkState {
  on: boolean;
  live: readonly ParsedBulk[];
  acts?: readonly BulkAct[] | undefined;
  scan?: BulkInput["scan"];
}

// The line of one section of a body, from every row block it holds.
export function sectionBulk(
  state: BulkState,
  rows: readonly ParsedRow[],
  section: BulkSection,
): BulkLine | undefined {
  return drawBulk({
    section,
    rows: bulkRows(rows, section),
    on: state.on,
    live: state.live.find((line) => line.section === section),
    act: state.acts?.find(({ tick }) => tick.section === section),
    scan: state.scan,
  });
}
