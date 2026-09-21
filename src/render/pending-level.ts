// Which of the three pending pictures the header shows (record 0039). A pure
// function of the row markers, like the header state, so every writer can
// compute it for rows it only carries through.

import type { ParsedRow } from "./marker.ts";

export const PENDING_LEVELS = [1, 2, 3] as const;
export type PendingLevel = (typeof PENDING_LEVELS)[number];

// Each level starts at or above the number of crates drawn in its picture, so
// the picture never shows more crates than there are stacks waiting. A row of
// a state this version does not know does not count. With nothing pending
// there is no level, and the header state is not `pending` either.
export function pendingLevel(rows: readonly ParsedRow[]): PendingLevel | undefined {
  const pending = rows.filter((row) => row.known && row.state === "pending").length;
  if (pending === 0) return undefined;
  if (pending <= 2) return 1;
  return pending <= 9 ? 2 : 3;
}
