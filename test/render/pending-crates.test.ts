import { describe, expect, test } from "bun:test";
import type { ParsedRow } from "../../src/render/marker.ts";
import { MAX_CRATES, pendingCrates } from "../../src/render/pending-crates.ts";

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
    drift: false,
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

// Record 0047: one crate per pending stack up to the maximum, and past it
// the row runs on off the edge.
describe("the crates of record 0047", () => {
  test("the maximum is 12", () => {
    expect(MAX_CRATES).toBe(12);
  });

  test.each<[number, number | "more"]>([
    [1, 1],
    [2, 2],
    [7, 7],
    [11, 11],
    [12, 12],
    [13, "more"],
    [14, "more"],
    [58, "more"],
  ])("%i pending rows show %p", (count, crates) => {
    expect(pendingCrates(pending(count))).toBe(crates);
  });

  // The header state is not `pending` then, so no picture asks for crates.
  test("0 pending rows has no crates", () => {
    expect(pendingCrates([])).toBeUndefined();
    expect(
      pendingCrates([row("in-sync"), row("deploying"), row("preview-failed")]),
    ).toBeUndefined();
  });

  test("only rows of state pending count", () => {
    const others = [row("in-sync"), row("deploying"), row("preview-failed")];
    expect(pendingCrates([...pending(2), ...others, ...others, ...others])).toBe(2);
    expect(pendingCrates([...pending(12), ...others])).toBe(12);
  });

  test("rows of an unknown state do not count", () => {
    const later = Array.from({ length: 20 }, (_, index) => unknown(index));
    expect(pendingCrates(later)).toBeUndefined();
    expect(pendingCrates([...pending(2), ...later])).toBe(2);
    expect(pendingCrates([...pending(12), ...later])).toBe(12);
  });

  test("the order of the rows does not matter", () => {
    const rows = [...pending(3), row("in-sync"), unknown(0)];
    expect(pendingCrates([...rows].reverse())).toBe(pendingCrates(rows));
  });
});
