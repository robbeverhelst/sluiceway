import { describe, expect, test } from "bun:test";
import type { ParsedRow } from "../../src/render/marker.ts";
import { PENDING_LEVELS, type PendingLevel, pendingLevel } from "../../src/render/pending-level.ts";

type Known = Extract<ParsedRow, { known: true }>;

function row(state: Known["state"], index = 0): Known {
  return {
    known: true,
    stackId: `stack-${state}-${index}`,
    state,
    hash: undefined,
    destroys: 0,
    failed: false,
    shortened: 0,
    ticked: false,
    text: "",
  };
}

const pending = (count: number) =>
  Array.from({ length: count }, (_, index) => row("pending", index));

// A row of a state this version does not know, even one whose state starts
// with the word pending.
const unknown = (index: number): ParsedRow => ({
  known: false,
  stackId: `later-${index}`,
  state: "pending-approval",
  text: "",
});

// The table of record 0039.
describe("the pending level of record 0039", () => {
  test("there are three", () => {
    expect(PENDING_LEVELS).toEqual([1, 2, 3]);
  });

  test.each<[number, number]>([
    [1, 1],
    [2, 1],
    [3, 2],
    [9, 2],
    [10, 3],
    [58, 3],
  ])("%i pending rows is level %i", (count, level) => {
    expect(pendingLevel(pending(count))).toBe(level as PendingLevel);
  });

  // The header state is not `pending` then, so no picture asks for a level.
  test("0 pending rows has no level", () => {
    expect(pendingLevel([])).toBeUndefined();
    expect(pendingLevel([row("in-sync"), row("deploying"), row("preview-failed")])).toBeUndefined();
  });

  test("only rows of state pending count", () => {
    const others = [row("in-sync"), row("deploying"), row("preview-failed")];
    expect(pendingLevel([...pending(2), ...others, ...others, ...others])).toBe(1);
    expect(pendingLevel([...pending(9), ...others])).toBe(2);
  });

  test("rows of an unknown state do not count", () => {
    const later = Array.from({ length: 20 }, (_, index) => unknown(index));
    expect(pendingLevel(later)).toBeUndefined();
    expect(pendingLevel([...pending(2), ...later])).toBe(1);
    expect(pendingLevel([...pending(9), ...later])).toBe(2);
  });

  test("the order of the rows does not matter", () => {
    const rows = [...pending(3), row("in-sync"), unknown(0)];
    expect(pendingLevel([...rows].reverse())).toBe(pendingLevel(rows));
  });
});
