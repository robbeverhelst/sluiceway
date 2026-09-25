// The freeze line (record 0115): a deploy freeze named once on the
// dashboard, right under the scan line and the lines about runs, while it
// holds and for the week before it starts, so nobody ticks and wonders why
// nothing goes. Every writer draws it from the config and its own clock. It
// is no marker and decides nothing: the rows that wait say so themselves.

import type { ShownFreeze } from "../core/deploy-window.ts";
import { escapeText } from "./escape.ts";
import { minuteAt } from "./time.ts";

// Each time stands alone, so it says its offset (record 0089). The reason is
// the repo's own text, and plain text on the page.
export function freezeLine(freeze: ShownFreeze, timeZone?: string): string {
  const reason = freeze.reason === undefined ? "" : ` (${escapeText(freeze.reason)})`;
  const ends = minuteAt(freeze.ends, timeZone);
  return freeze.holds
    ? `Deploy freeze until ${ends}${reason}: every deploy waits for it to end.`
    : `Deploy freeze from ${minuteAt(freeze.starts, timeZone)} until ${ends}${reason}: every deploy waits while it holds.`;
}
