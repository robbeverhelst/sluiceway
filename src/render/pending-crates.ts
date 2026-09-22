// How many crates float upstream of Penny (records 0047, 0066 and 0075): one
// per pending stack, in the pending, failing, deploying and queued pictures
// alike. A pure
// function of the row markers, like the header state, so every writer can
// compute it for rows it only carries through.

import type { ParsedRow } from "./marker.ts";

// One crate per pending stack up to this many (record 0075 raised it from 12).
// Beyond it the picture shows the row running on past the left edge, which
// reads as "and more".
export const MAX_CRATES = 20;
export type Crates = number | "more";

// A row of a state this version does not know does not count. With nothing
// pending there are no crates, and the header state is not `pending` either.
export function pendingCrates(rows: readonly ParsedRow[]): Crates {
  const pending = rows.filter((row) => row.known && row.state === "pending").length;
  return pending > MAX_CRATES ? "more" : pending;
}
