// The bulk box and its confirm box (record 0083): one box under the pending
// rows and one under the drifted rows that deploys the whole section, each
// behind a confirm box that names what it would deploy. The one renderer of
// both. Plain words: the voice has no place here (record 0032).

import { escapeText } from "./escape.ts";
import { type BulkFacts, type BulkNote, type BulkSection, bulkMarker } from "./marker.ts";

// A bulk line as a writer draws it: its facts, the tick, and for a bulk box
// how many stacks its section holds.
export type BulkLine = BulkFacts & { ticked: boolean } & (
    | { kind: "box"; count: number }
    | { kind: "confirm" }
  );

// A confirm box and a note name this many stacks, then count the rest, so a
// long section does not make a long line.
export const NAMES_IN_A_BULK_LINE = 10;

const WORDS: Record<BulkSection, { verb: string; rows: string; left: string }> = {
  pending: { verb: "deploy", rows: "pending", left: "is not pending any more" },
  drift: { verb: "repair", rows: "drifted", left: "is not drifted any more" },
};

function stacks(count: number): string {
  return count === 1 ? "1 stack" : `${count} stacks`;
}

function named(ids: readonly string[]): string {
  const shown = ids.slice(0, NAMES_IN_A_BULK_LINE).map((id) => `**${escapeText(id)}**`);
  const rest = ids.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
}

// "are" for more than one stack or a counted rest, "is" for one.
function clause(ids: readonly string[], one: string, many: string): string {
  return `${named(ids)} ${ids.length === 1 ? one : many}`;
}

function noteText(section: BulkSection, note: BulkNote): string {
  if (note.kind === "orphan") {
    return ":information_source: a tick on this box was not picked up. Tick again to ask once more.";
  }
  if (note.kind === "expired") {
    return ":information_source: the confirm box was not ticked before the next scan, so it was taken back. Tick again for a fresh one.";
  }
  const left = WORDS[section].left;
  const parts = [
    ...(note.added.length > 0 ? [clause(note.added, "is new", "are new")] : []),
    ...(note.gone.length > 0 ? [clause(note.gone, left, left.replace(/^is/, "are"))] : []),
    ...(note.moved.length > 0 ? [clause(note.moved, "has a new diff", "have a new diff")] : []),
  ];
  const what = parts.length > 0 ? `: ${parts.join(", ")}` : "";
  return `:information_source: the rows changed before the confirm box was ticked${what}. Tick again to confirm the stacks as they are now.`;
}

const CONFIRM_HINT =
  "Ticking this deploys each stack as its row shows it, in dependency order. A change to these rows first takes it back.";

export function renderBulkLine(line: BulkLine): string {
  const box = line.ticked ? "- [x] " : "- [ ] ";
  const words = WORDS[line.section];
  if (line.kind === "box") {
    const first = `${box}${words.verb === "deploy" ? "Deploy" : "Repair"} all ${stacks(line.count).replace(/stacks?$/, `${words.rows} $&`)} ${bulkMarker(line)}`;
    return line.note ? `${first}\n  ${noteText(line.section, line.note)}` : first;
  }
  const ids = line.stacks.map(({ stackId }) => stackId);
  const count = stacks(ids.length).replace(/stacks?$/, `${words.rows} $&`);
  return [
    `${box}**Confirm:** ${words.verb} all ${count}: ${named(ids)} · asked by ${escapeText(line.by)} ${bulkMarker(line)}`,
    `  ${CONFIRM_HINT}`,
  ].join("\n");
}
