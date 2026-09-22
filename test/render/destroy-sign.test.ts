import { describe, expect, test } from "bun:test";
import { destroySign } from "../../src/render/destroy-sign.ts";
import type { ParsedRow } from "../../src/render/marker.ts";

type Known = Extract<ParsedRow, { known: true }>;

function row(state: Known["state"], destroys = 0, failed = false): Known {
  return {
    known: true,
    stackId: `stack-${state}-${destroys}`,
    state,
    hash: undefined,
    destroys,
    failed,
    shortened: 0,
    drift: false,
    ticked: false,
    text: "",
  };
}

// A row of a state this version does not know. Its marker could carry a
// `destroys` key, but the parser keeps no facts for it, so it has none.
const unknown: ParsedRow = { known: false, stackId: "later", state: "drift", text: "" };

// The rule of record 0043: the one plain had in record 0031, moved.
describe("the destroy sign of record 0043", () => {
  test("a destroy on a pending row turns it on", () => {
    expect(destroySign([row("pending", 1), row("in-sync")])).toBe(true);
  });

  test("a destroy on a deploying row turns it on", () => {
    expect(destroySign([row("deploying", 2), row("pending")])).toBe(true);
  });

  test("no destroy leaves it off", () => {
    expect(destroySign([])).toBe(false);
    expect(
      destroySign([row("pending"), row("deploying"), row("in-sync"), row("preview-failed")]),
    ).toBe(false);
  });

  // An in sync row that still says `destroys` is a marker edited by hand, or
  // a writer's mistake. Only rows that are about to deploy or deploying count.
  test("an in sync or preview failed row with destroys does not", () => {
    expect(destroySign([row("in-sync", 1), row("preview-failed", 4)])).toBe(false);
  });

  test("a row of an unknown state does not", () => {
    expect(destroySign([unknown, row("pending")])).toBe(false);
  });

  test("a failure line on the row makes no difference", () => {
    expect(destroySign([row("pending", 1, true)])).toBe(true);
    expect(destroySign([row("in-sync", 0, true)])).toBe(false);
  });

  test("the order of the rows does not matter", () => {
    const rows = [row("in-sync"), row("pending"), row("deploying", 1), unknown];
    expect(destroySign([...rows].reverse())).toBe(destroySign(rows));
  });
});
