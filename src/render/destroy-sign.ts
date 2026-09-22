// Which signs stand on the pole in the header picture (records 0043 and
// 0075): the replace sign, the amber triangle, and the delete sign, an amber
// diamond with a cross. A pure function of the row markers, next to the
// header state and the crate count, so every writer can compute it for rows
// it only carries through. It decides nothing.

import { isDeployingState, type ParsedRow } from "./marker.ts";

export interface DestroySigns {
  deletes: boolean;
  replaces: boolean;
}

// Only rows that are pending, deploying or queued count. This is the rule the
// plain header state had (record 0031), moved. A row of a state this version
// does not know does not count. A marker an older version wrote does not say
// how many of its destroys are deletes, so they all count as deletes: the
// delete sign asks for the more care of the two.
export function destroySigns(rows: readonly ParsedRow[]): DestroySigns {
  const signs: DestroySigns = { deletes: false, replaces: false };
  for (const row of rows) {
    if (!row.known || !(row.state === "pending" || isDeployingState(row.state))) continue;
    const deletes = Math.min(row.deletes ?? row.destroys, row.destroys);
    if (deletes > 0) signs.deletes = true;
    if (row.destroys - deletes > 0) signs.replaces = true;
  }
  return signs;
}
