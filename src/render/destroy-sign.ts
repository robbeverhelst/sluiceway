// Whether the header picture carries the destroy sign (record 0043). A pure
// function of the row markers, next to the header state and the pending
// level, so every writer can compute it for rows it only carries through. It
// decides nothing.

import { isDeployingState, type ParsedRow } from "./marker.ts";

// On when any known row that is pending or deploying deletes or replaces
// something. This is the rule the plain header state had (record 0031), moved.
// A row of a state this version does not know does not count.
export function destroySign(rows: readonly ParsedRow[]): boolean {
  return rows.some(
    (row) =>
      row.known && (row.state === "pending" || isDeployingState(row.state)) && row.destroys > 0,
  );
}
