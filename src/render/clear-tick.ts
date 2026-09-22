// Clearing a ticked box without a diff (records 0018 and 0025). `resolve`
// clears the box of a refused tick, and of a tick nobody can be named for, and
// it never has a diff to render the row again from (record 0014). So it
// changes the one thing the tick regex reads at the start of the first line,
// the box, and carries every other byte of the block through. The text between
// the box and the marker is never read.

import type { PhaseGroup } from "../core/phases.ts";
import { type ParsedRow, parseDashboard } from "./marker.ts";
import { DEPLOYS_OFF_NOTE, dependencyNote, INDENT, ORPHAN_TICK_NOTE } from "./row.ts";

export interface ClearTickOptions {
  // Adds the note that asks for a fresh tick, or with "deploys-off" the note
  // that deploys are turned off (record 0051). A writer without a diff cannot
  // tell the lines of a block apart, so the note goes right under the first
  // line. The next scan renders the row in the order of record 0027. With
  // `dependsOn` the note names the stacks the tick waits on (record 0056),
  // and with `phases` the phases it waits on (record 0067).
  note?:
    | boolean
    | "deploys-off"
    | { dependsOn: readonly string[]; phases?: readonly PhaseGroup[] }
    | undefined;
  // The tick came from the confirm box of the row's section (record 0083), so
  // the row has no tick of its own. It still gets the note.
  unticked?: boolean | undefined;
}

const TICKED_BOX = /^- \[[xX]\] /;

// A row that holds no tick comes back as it is: one without a box, one that is
// not ticked, and one of a state this version does not know.
export function clearTick(row: ParsedRow, options: ClearTickOptions = {}): ParsedRow {
  if (!row.known || (!row.ticked && !(options.unticked && options.note))) return row;
  const [first = "", ...rest] = row.text.split("\n");
  const note =
    INDENT +
    (options.note === "deploys-off"
      ? DEPLOYS_OFF_NOTE
      : typeof options.note === "object"
        ? dependencyNote(options.note.dependsOn, options.note.phases)
        : ORPHAN_TICK_NOTE);
  // The note is a fixed line of Sluiceway's own, so finding it again is a
  // comparison with a constant and not a reading of the row.
  const lines = options.note && !rest.includes(note) ? [note, ...rest] : rest;
  const [cleared] = parseDashboard([first.replace(TICKED_BOX, "- [ ] "), ...lines].join("\n")).rows;
  if (!cleared) throw new Error("A row block did not read back as a row block.");
  return cleared;
}
