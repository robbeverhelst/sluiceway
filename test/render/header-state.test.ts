import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
    drift: false,
    ticked: false,
    text: "",
  };
}

const unknown: ParsedRow = { known: false, stackId: "later", state: "someday", text: "" };

describe("the seven header states of records 0031, 0043, 0055 and 0075", () => {
  test("they are listed in the order in which they win, and plain is gone", () => {
    expect(HEADER_STATES).toEqual([
      "failing",
      "deploying",
      "queued",
      "pending",
      "drift",
      "first-run",
      "in-sync",
    ]);
  });

  // Record 0055: the gate is closed and water seeps through. Pending wins,
  // because the picture of drift is a picture of nothing waiting.
  test("a drift row is drift, and a pending row wins over it", () => {
    expect(headerState([row("in-sync"), row("drift")])).toBe("drift");
    expect(headerState([row("drift"), row("pending")])).toBe("pending");
  });

  test("a pending row that also shows drift is pending", () => {
    expect(headerState([{ ...row("pending"), drift: true }])).toBe("pending");
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

  // Record 0075: a stack queued behind its dependencies while nothing
  // deploys has a state of its own. Deploying wins over it.
  test("a queued row is queued, and a deploying row wins over it", () => {
    expect(headerState([row("queued"), row("in-sync")])).toBe("queued");
    expect(headerState([row("queued"), row("deploying")])).toBe("deploying");
  });

  test("a queued row wins over a pending row", () => {
    expect(headerState([row("pending"), row("queued")])).toBe("queued");
  });

  test("a preview failure is failing", () => {
    expect(headerState([row("preview-failed")])).toBe("failing");
  });

  test("a failure line is failing, on a row of any state", () => {
    expect(headerState([row("in-sync", { failed: true })])).toBe("failing");
    expect(headerState([row("pending", { failed: true })])).toBe("failing");
  });

  // Record 0043: the header always shows the real state. A destroy adds the
  // destroy sign to the picture and leaves the state alone.
  test("a delete or replace on a pending row is still pending", () => {
    expect(headerState([row("pending", { destroys: 1 })])).toBe("pending");
  });

  test("a delete or replace on a deploying row is still deploying", () => {
    expect(headerState([row("deploying", { destroys: 2 }), row("pending")])).toBe("deploying");
  });

  test("a delete or replace does not hide a failure", () => {
    expect(headerState([row("pending", { destroys: 1 }), row("preview-failed")])).toBe("failing");
  });
});

// The first row of the table that matches wins, top to bottom. Each case
// holds everything below its winner as well.
describe("precedence: bad news wins", () => {
  const cases: [HeaderState, ParsedRow[]][] = [
    [
      "failing",
      [
        row("pending", { destroys: 1 }),
        row("preview-failed"),
        row("in-sync", { failed: true }),
        row("deploying", { destroys: 1 }),
        row("pending"),
        row("in-sync"),
      ],
    ],
    ["failing", [row("preview-failed"), row("deploying"), row("pending"), row("in-sync")]],
    [
      "failing",
      [row("in-sync", { failed: true }), row("deploying"), row("pending"), row("in-sync")],
    ],
    ["failing", [row("preview-failed"), row("queued"), row("pending")]],
    ["deploying", [row("deploying"), row("queued"), row("pending"), row("in-sync")]],
    ["deploying", [row("deploying"), row("pending"), row("in-sync")]],
    ["queued", [row("queued"), row("pending"), row("drift"), row("in-sync")]],
    ["queued", [row("queued", { destroys: 1 }), row("pending", { destroys: 1 })]],
    ["deploying", [row("deploying", { destroys: 1 }), row("pending", { destroys: 1 })]],
    ["pending", [row("pending"), row("in-sync")]],
    ["pending", [row("pending", { destroys: 3 }), row("in-sync")]],
    ["pending", [row("pending"), row("drift"), row("in-sync")]],
    ["deploying", [row("deploying"), row("drift")]],
    ["failing", [row("drift", { failed: true }), row("in-sync")]],
    ["drift", [row("drift"), row("in-sync")]],
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

// Record 0043: the plain state is gone, and nothing in the code still names it
// as a state. A comment may still tell where the destroy sign's rule came from.
test("no code in src/ names plain as a header state", () => {
  const SRC = resolve(import.meta.dir, "../../src");
  const files = [...new Bun.Glob("**/*.ts").scanSync(SRC)];
  expect(files.length).toBeGreaterThan(0);
  const naming = files.filter((file) =>
    /["'`]plain["'`]|plain-(?:light|dark|\$\{)/.test(readFileSync(join(SRC, file), "utf8")),
  );
  expect(naming).toEqual([]);
});
