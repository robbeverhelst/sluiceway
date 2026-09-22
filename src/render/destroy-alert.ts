// The destroy alert (records 0062 and 0075): one alert block above the
// pending list that names the pending stacks with a delete or replace, and
// the drifted stacks with a resource gone outside the code. A pure function
// of the row markers, like the destroy signs, so every writer can draw it for
// rows it only carries through. It decides nothing. The delete and replace
// lines stay open under each row (record 0027): the alert only makes sure
// nobody scrolls past them.

import { escapeText } from "./escape.ts";
import type { ParsedRow } from "./marker.ts";

const ids = (rows: readonly ParsedRow[]) =>
  rows.map((row) => `**${escapeText(row.stackId)}**`).join(", ");

// Pending rows, as the destroy warning on the counts line counts them: a
// deploying row has nothing left to tick. Drifted rows, whose drift check
// found a resource gone: a drifted row deletes and replaces nothing, since
// nothing waits from its code, and a resource gone is the loss a person may
// not know of yet. A row of a state this version does not know does not
// count. The rows come in the order the body lists them.
export function destroyAlert(rows: readonly ParsedRow[]): string | undefined {
  const pending = rows.filter((row) => row.known && row.state === "pending" && row.destroys > 0);
  const drifted = rows.filter((row) => row.known && row.state === "drift" && (row.gone ?? 0) > 0);
  const paragraphs: string[] = [];
  if (pending.length > 0) {
    const words =
      pending.length === 1
        ? "1 pending stack deletes or replaces resources"
        : `${pending.length} pending stacks delete or replace resources`;
    paragraphs.push(`> ${words}: ${ids(pending)}`);
  }
  if (drifted.length > 0) {
    const words =
      drifted.length === 1
        ? "1 drifted stack has resources gone outside the code"
        : `${drifted.length} drifted stacks have resources gone outside the code`;
    paragraphs.push(`> ${words}: ${ids(drifted)}`);
  }
  if (paragraphs.length === 0) return undefined;
  return `> [!CAUTION]\n${paragraphs.join("\n>\n")}`;
}
