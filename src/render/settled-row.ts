// The row `settle` writes for a deploy it ended (record 0113). `settle` runs no
// tool (record 0014), so it has no diff to render a row from. It takes the
// live block of the deploy, the one `resolve` or `apply` wrote, and writes its
// first line and marker again from facts: the stack id and the failure line of
// the record it ended. The failure line goes right under the first line, as a
// writer without a diff puts every line of its own (record 0025), and every
// other line of the block is carried as it is. The text of the old block is
// never read.

import { escapeText } from "./escape.ts";
import { type ParsedRow, parseDashboard, rowMarker } from "./marker.ts";
import { type FailureLine, failureLine, INDENT } from "./row.ts";

export const SETTLED_ROW_WORDS = "no preview since its deploy ended, the next scan previews it";

// The state is `preview-failed`: no box, no diff, and every scan previews the
// stack, a narrowed one too (record 0010), so no scan carries the row for long.
export function settledRow(
  live: ParsedRow,
  failure: FailureLine,
  options: { timeZone?: string | undefined } = {},
): ParsedRow {
  const [, ...rest] = live.text.split("\n");
  const first = `- **${escapeText(live.stackId)}** · ${SETTLED_ROW_WORDS} ${rowMarker({
    stackId: live.stackId,
    state: "preview-failed",
    failed: true,
  })}`;
  const text = [first, INDENT + failureLine(failure, options.timeZone), ...rest].join("\n");
  const [row] = parseDashboard(text).rows;
  if (!row) throw new Error("A row block did not read back as a row block.");
  return row;
}
