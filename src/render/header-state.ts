// Which of the five header states the header shows (records 0031 and 0043). A
// pure function of the row markers, so every writer can compute it for rows
// it only carries through. It decides nothing.

import type { ParsedRow } from "./marker.ts";

// In the order in which they win: bad news first. A destroy is not a state of
// its own: it adds the destroy sign to the picture (record 0043).
export const HEADER_STATES = ["failing", "deploying", "pending", "first-run", "in-sync"] as const;
export type HeaderState = (typeof HEADER_STATES)[number];

// Every scan ends with one row for every stack (record 0011), so a body with
// no row at all is a scan that found no stacks. A row of a state this version
// does not know takes no part in any other rule.
export function headerState(rows: readonly ParsedRow[]): HeaderState {
  if (rows.length === 0) return "first-run";
  const known = rows.filter((row) => row.known);
  const is = (state: string) => known.some((row) => row.state === state);

  if (is("preview-failed") || known.some((row) => row.failed)) return "failing";
  if (is("deploying")) return "deploying";
  if (is("pending")) return "pending";
  return "in-sync";
}
