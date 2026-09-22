// The destroy alert (record 0062): one alert block above the pending list
// that names the pending stacks with a delete or replace. A pure function of
// the row markers, like the destroy sign, so every writer can draw it for
// rows it only carries through. It decides nothing. The delete and replace
// lines stay open under each row (record 0027): the alert only makes sure
// nobody scrolls past them.

import { escapeText } from "./escape.ts";
import type { ParsedRow } from "./marker.ts";

// Pending rows only, as the destroy warning on the counts line counts them: a
// deploying row has nothing left to tick. A row of a state this version does
// not know does not count. The rows come in the order the body lists them.
export function destroyAlert(rows: readonly ParsedRow[]): string | undefined {
  const ids = rows
    .filter((row) => row.known && row.state === "pending" && row.destroys > 0)
    .map((row) => `**${escapeText(row.stackId)}**`);
  if (ids.length === 0) return undefined;
  const words =
    ids.length === 1
      ? "1 pending stack deletes or replaces resources"
      : `${ids.length} pending stacks delete or replace resources`;
  return `> [!CAUTION]\n> ${words}: ${ids.join(", ")}`;
}
