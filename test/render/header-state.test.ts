import { describe, expect, test } from "bun:test";
import { HEADER_STATES, type HeaderState, headerState } from "../../src/render/header-state.ts";
import type { ParsedRow } from "../../src/render/marker.ts";

type Known = Extract<ParsedRow, { known: true }>;

function row(state: Known["state"], facts: { destroys?: number; failed?: boolean } = {}): Known {
  return {
    known: true,
    stackId: `stack-${state}`,
    state,
    hash: undefined,
    destroys: facts.destroys ?? 0,
    failed: facts.failed ?? false,
    shortened: 0,
    ticked: false,
    text: "",
  };
}

const unknown: ParsedRow = { known: false, stackId: "later", state: "drift", text: "" };

describe("the six header states of record 0031", () => {
  test("they are listed in the order in which they win", () => {
    expect(HEADER_STATES).toEqual([
      "plain",
      "failing",
      "deploying",
      "pending",
      "first-run",
      "in-sync",
    ]);
  });

  test("no rows at all is the first run", () => {
    expect(headerState([])).toBe("first-run");
  });

  test("only in sync rows is in sync", () => {
    expect(headerState([row("in-sync"), row("in-sync")])).toBe("in-sync");
  });

  test("a pending row is pending", () => {
    expect(headerState([row("in-sync"), row("pending")])).toBe("pending");
  });

  test("a deploying row is deploying", () => {
    expect(headerState([row("deploying")])).toBe("deploying");
  });

  test("a preview failure is failing", () => {
    expect(headerState([row("preview-failed")])).toBe("failing");
  });

  test("a failure line is failing, on a row of any state", () => {
    expect(headerState([row("in-sync", { failed: true })])).toBe("failing");
    expect(headerState([row("pending", { failed: true })])).toBe("failing");
  });

  test("a delete or replace on a pending row is plain", () => {
    expect(headerState([row("pending", { destroys: 1 })])).toBe("plain");
  });

  // This widens 0029: a stack that is deleting something right now must not
  // run under a grinning gate.
  test("a delete or replace on a deploying row is plain", () => {
    expect(headerState([row("deploying", { destroys: 2 })])).toBe("plain");
  });
});

// The first row of the table that matches wins, top to bottom. Each case
// holds everything below its winner as well.
describe("precedence: bad news wins", () => {
  const cases: [HeaderState, ParsedRow[]][] = [
    [
      "plain",
      [
        row("pending", { destroys: 1 }),
        row("preview-failed"),
        row("in-sync", { failed: true }),
        row("deploying"),
        row("pending"),
        row("in-sync"),
      ],
    ],
    ["failing", [row("preview-failed"), row("deploying"), row("pending"), row("in-sync")]],
    [
      "failing",
      [row("in-sync", { failed: true }), row("deploying"), row("pending"), row("in-sync")],
    ],
    ["deploying", [row("deploying"), row("pending"), row("in-sync")]],
    ["pending", [row("pending"), row("in-sync")]],
    ["in-sync", [row("in-sync")]],
  ];

  test.each(cases)("%s", (expected, rows) => {
    expect(headerState(rows)).toBe(expected);
    expect(headerState([...rows].reverse())).toBe(expected);
  });
});

describe("what the header state does not look at", () => {
  test("a row of a state this version does not know takes no part", () => {
    expect(headerState([unknown, row("in-sync")])).toBe("in-sync");
    expect(headerState([unknown, row("pending")])).toBe("pending");
  });

  // Stacks were found, so this is not a first run.
  test("rows of unknown states alone are not a first run", () => {
    expect(headerState([unknown])).toBe("in-sync");
  });

  test("whether a box is ticked", () => {
    expect(headerState([{ ...row("pending"), ticked: true }])).toBe("pending");
  });
});
