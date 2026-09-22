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

// `resolve` has no title to render the row again from, so it clears the box
// and carries every other byte, as it does for a stack's row (record 0025).
export function clearMergeTick(row: ParsedMerge): ParsedMerge {
  if (!row.ticked) return row;
  const [cleared] = parseDashboard(row.text.replace(/^- \[[xX]\] /, "- [ ] ")).merges;
  if (!cleared) throw new Error("A merge row did not read back as one.");
  return cleared;
}

// With a box that is ticked, for a scan that carries a tick a `resolve` run is
// on its way for (record 0025).
export function tickedMergeBlock(row: ParsedMerge): ParsedMerge {
  const [ticked] = parseDashboard(row.text.replace(/^- \[ \] /, "- [x] ")).merges;
  if (!ticked) throw new Error("A merge row did not read back as one.");
  return ticked;
}
