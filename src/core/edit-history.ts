// The walk through the dashboard's edit history that names the ticker of a
// tick (record 0025). The event that woke the job names nobody: its payload
// holds the newest body at delivery time, not the body of its own edit (issue
// 28). The history holds one entry per edit, with the editor and the full body
// right after that edit.

import { type ParsedDashboard, parseDashboard } from "../render/marker.ts";

// Who made an edit, as the history names them. The type is "User" for a
// person and "Bot" for the bot, whose login the history writes without
// "[bot]". An account GitHub no longer knows has the login "" and the type "".
// Whether an editor may tick is the tick rule's to say (record 0018), not the
// walk's.
export interface Editor {
  login: string;
  type: string;
}

export interface HistoryEntry {
  editor: Editor;
  // As GitHub writes it, "2026-09-21T07:11:52Z".
  editedAt: string;
  // The whole body right after the edit, or null when the entry's content was
  // deleted.
  body: string | null;
}

// One page of the history, newest entry first.
export interface HistoryPage {
  entries: HistoryEntry[];
  // How many entries GitHub keeps for the issue, over all pages.
  total: number;
  // What to hand to the reader for the page after this one. Absent on the
  // last page.
  next: string | undefined;
}

// What a walk looks for: a row ticked at one diff hash, an update waiting to
// merge ticked at one head commit (record 0054), or the ticked rescan box.
export type Tick =
  | { kind: "row"; stackId: string; hash: string }
  | { kind: "merge"; pr: number; stackId: string; head: string }
  | { kind: "rescan" };

// Why the history names nobody for a tick.
// - "entry-without-body": an entry inside the stretch has no body. It always
//   breaks the stretch: skipping over it would let a person tick, wait for
//   someone else's edit, delete their own entry and be replaced by that
//   someone. A dashboard body is never empty, so an empty body counts as none.
// - "end-of-history": the stretch reaches the end of the kept history, or the
//   gap in it, without an entry in which the tick was not there.
// - "not-in-newest-entry": the newest entry does not hold the tick, so the
//   body the tick was read from is not the body the history ends with. The
//   caller reads again.
export type NobodyReason = "entry-without-body" | "end-of-history" | "not-in-newest-entry";

// The ticker of one tick: the editor of the oldest entry in the unbroken
// stretch of entries that hold the tick, and when that edit was made. When the
// history names nobody, nothing deploys.
export type Ticker =
  | { named: true; editor: Editor; editedAt: string }
  | { named: false; reason: NobodyReason };

// GitHub keeps this many entries for an issue: the original body and the
// newest 99 edits (issue 28). A history this long has a gap in front of its
// oldest entry, and nothing says how many edits fell into it.
export const HISTORY_CAP = 100;

// How many entries a reader asks for at once. Every entry holds a whole body,
// so a page is small. The normal walk needs two entries, the tick and the
// write before it, and a few more when scans or row swaps carried the tick
// through, so one page is the normal case (record 0025).
export const HISTORY_PAGE_SIZE = 10;

// Whether a body holds a tick. Markers only (record 0009): whole bodies are
// never compared, so line endings and edits elsewhere do not matter. Of two
// blocks for one stack the first counts, as it does for every writer.
function holds(dashboard: ParsedDashboard, tick: Tick): boolean {
  if (tick.kind === "rescan") return dashboard.rescanTicked;
  if (tick.kind === "merge") {
    const merge = dashboard.merges.find((candidate) => candidate.pr === tick.pr);
    return merge?.ticked === true && merge.head === tick.head && merge.stackId === tick.stackId;
  }
  const row = dashboard.rows.find((candidate) => candidate.stackId === tick.stackId);
  return row?.known === true && row.ticked && row.hash === tick.hash;
}

// Every tick in a body, read the way the walk reads an entry: the ticked rows
// in body order, then the ticked updates waiting to merge, then the rescan box. A row of a state this version does not
// know holds no tick, and neither does a row without a hash, which shows
// nothing a tick could approve.
export function ticksIn(body: string): Tick[] {
  const dashboard = parseDashboard(body);
  const ticks: Tick[] = [];
  const seen = new Set<string>();
  for (const row of dashboard.rows) {
    if (seen.has(row.stackId)) continue;
    seen.add(row.stackId);
    // A queued row is taken like a deploying one and never holds a tick
    // (record 0056).
    if (row.known && row.ticked && row.hash !== undefined && row.state !== "queued") {
      ticks.push({ kind: "row", stackId: row.stackId, hash: row.hash });
    }
  }
  const merged = new Set<number>();
  for (const { pr, stackId, head, ticked } of dashboard.merges) {
    if (merged.has(pr)) continue;
    merged.add(pr);
    if (ticked) ticks.push({ kind: "merge", pr, stackId, head });
  }
  if (dashboard.rescanTicked) ticks.push({ kind: "rescan" });
  return ticks;
}

// The ticker of every tick, in the order of the ticks. The history is read
// page by page, newest first, through `readPage`, and no page is read once
// every tick has its answer. One page is the normal case.
export async function nameTickers(
  ticks: readonly Tick[],
  readPage: (after: string | undefined) => Promise<HistoryPage>,
): Promise<Ticker[]> {
  const answers = new Array<Ticker | undefined>(ticks.length).fill(undefined);
  // The oldest entry so far in each tick's stretch.
  const oldest = new Array<HistoryEntry | undefined>(ticks.length).fill(undefined);
  const open = () => answers.some((answer) => answer === undefined);

  let after: string | undefined;
  let capped = false;
  while (open()) {
    const page = await readPage(after);
    capped ||= page.total >= HISTORY_CAP;
    for (const [position, entry] of page.entries.entries()) {
      if (!open()) break;
      // The last entry of a capped history is the original body, on the far
      // side of the gap. It says nothing about the entry before it.
      const last = page.next === undefined && position === page.entries.length - 1;
      if (capped && last) break;
      const dashboard = entry.body ? parseDashboard(entry.body) : undefined;
      ticks.forEach((tick, index) => {
        if (answers[index] !== undefined) return;
        if (dashboard === undefined) {
          answers[index] = { named: false, reason: "entry-without-body" };
        } else if (holds(dashboard, tick)) {
          oldest[index] = entry;
        } else {
          const made = oldest[index];
          answers[index] = made
            ? { named: true, editor: made.editor, editedAt: made.editedAt }
            : { named: false, reason: "not-in-newest-entry" };
        }
      });
    }
    if (page.next === undefined) break;
    after = page.next;
  }

  return answers.map(
    (answer, index): Ticker =>
      answer ?? {
        named: false,
        reason: oldest[index] ? "end-of-history" : "not-in-newest-entry",
      },
  );
}
