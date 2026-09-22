// The row of an update waiting to merge (record 0054): one line per pull
// request, with a box, the stack its files belong to, the bump as the title
// says it, and the pull request with its author. The one renderer of it.

import { escapeText } from "./escape.ts";
import { type MergeFacts, mergeMarker, type ParsedMerge, parseDashboard } from "./marker.ts";

export interface MergeRow extends MergeFacts {
  // The title of the pull request, as its author wrote it.
  title: string;
  // As the site writes it, "renovate[bot]". Plain text, so nobody is
  // notified (record 0026).
  author: string | undefined;
}

export interface MergeRowOptions {
  // `dashboard.redact` (record 0023): a title names what is updated, so it
  // stays out. The stack id and the pull request stay.
  redact?: boolean | undefined;
}

// A title is free text of any length (record 0026). Shortened, it still says
// which dependency moves to which version, which is what the row is for.
export const TITLE_LENGTH = 80;

function shorten(title: string): string {
  const chars = [...title];
  return chars.length <= TITLE_LENGTH ? title : `${chars.slice(0, TITLE_LENGTH - 3).join("")}...`;
}

export function renderMergeRow(row: MergeRow, options: MergeRowOptions = {}): string {
  const by = row.author === undefined ? "" : ` by ${escapeText(row.author)}`;
  const parts = [
    `**${escapeText(row.stackId)}**`,
    ...(options.redact ? [] : [escapeText(shorten(row.title))]),
    `#${row.pr}${by}`,
  ];
  return `- [ ] ${parts.join(" · ")} ${mergeMarker(row)}`;
}

// A freshly rendered merge row, read back from its own marker.
export function mergeBlock(row: MergeRow, options: MergeRowOptions = {}): ParsedMerge {
  const [block] = parseDashboard(renderMergeRow(row, options)).merges;
  if (!block) throw new Error("A rendered merge row did not read back as one.");
  return block;
}

// The notes on a merge row whose tick was cleared without a comment (record
// 0064): nobody could be named for it, or a scan found it with no run on its
// way (the orphan note), the stack has a deploy in progress, or deploys are
// turned off. Fixed words of Sluiceway's own, like the notes on a stack's row.
export const MERGE_ORPHAN_NOTE =
  ":information_source: a tick on this row was not picked up. Tick again to merge.";
export const MERGE_DEPLOYING_NOTE =
  ":information_source: this tick merged nothing: the stack has a deploy in progress. Tick again once it is over.";
export const MERGE_DEPLOYS_OFF_NOTE =
  ":information_source: deploys are turned off in `sluiceway.yaml`, so this tick merged nothing.";

export type MergeNote = "orphan" | "deploying" | "deploys-off";

const NOTES: Record<MergeNote, string> = {
  orphan: MERGE_ORPHAN_NOTE,
  deploying: MERGE_DEPLOYING_NOTE,
  "deploys-off": MERGE_DEPLOYS_OFF_NOTE,
};

// The body lists this many updates in the open and folds the rest (record
// 0064), so the section stays short to read.
export const MERGE_FOLD_AFTER = 10;

function readBack(text: string): ParsedMerge {
  const [row] = parseDashboard(text).merges;
  if (!row) throw new Error("A merge row did not read back as one.");
  return row;
}

// `resolve` has no title to render the row again from, so it clears the box
// and carries every other byte of the line, as it does for a stack's row
// (record 0025). With a note, the note stands under the line in place of any
// note it had.
export function clearMergeTick(
  row: ParsedMerge,
  options: { note?: MergeNote | undefined } = {},
): ParsedMerge {
  if (!row.ticked) return row;
  const [first = "", ...notes] = row.text.split("\n");
  const cleared = first.replace(/^- \[[xX]\] /, "- [ ] ");
  const lines = options.note === undefined ? notes : [`  ${NOTES[options.note]}`];
  return readBack([cleared, ...lines].join("\n"));
}

// With a box that is ticked, for a scan that carries a tick a `resolve` run is
// on its way for (record 0025).
export function tickedMergeBlock(row: ParsedMerge): ParsedMerge {
  return readBack(row.text.replace(/^- \[ \] /, "- [x] "));
}
