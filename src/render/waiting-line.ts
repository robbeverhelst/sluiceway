// The line of an update waiting on its checks (record 0081): a pull request
// that qualifies to merge in every way but its checks, which have not all
// finished. No box, because nothing can be merged yet. The one renderer of it.

import { escapeText } from "./escape.ts";
import { type ParsedWaiting, parseDashboard, type WaitingFacts, waitingMarker } from "./marker.ts";
import type { MergeRowOptions } from "./merge-row.ts";
import { shortenTitle } from "./merge-row.ts";

export interface WaitingLine extends WaitingFacts {
  // The title of the pull request, as its author wrote it.
  title: string;
  // As the site writes it. Plain text, so nobody is notified (record 0026).
  author: string | undefined;
}

// The title is escaped, kept on one line, shortened and left out with
// `dashboard.redact`, as on a merge row (record 0054).
export function renderWaitingLine(line: WaitingLine, options: MergeRowOptions = {}): string {
  const by = line.author === undefined ? "" : ` by ${escapeText(line.author)}`;
  const parts = [
    line.stackIds.map((id) => `**${escapeText(id)}**`).join(", "),
    ...(options.redact ? [] : [escapeText(shortenTitle(line.title))]),
    `#${line.pr}${by}`,
    "waits on its checks",
  ];
  return `- ${parts.join(" · ")} ${waitingMarker(line)}`;
}

// A freshly rendered waiting line, read back from its own marker.
export function waitingBlock(line: WaitingLine, options: MergeRowOptions = {}): ParsedWaiting {
  const [block] = parseDashboard(renderWaitingLine(line, options)).waiting;
  if (!block) throw new Error("A rendered waiting line did not read back as one.");
  return block;
}
