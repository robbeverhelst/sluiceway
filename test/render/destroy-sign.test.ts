import { describe, expect, test } from "bun:test";
import { destroySigns } from "../../src/render/destroy-sign.ts";
import type { ParsedRow } from "../../src/render/marker.ts";

type Known = Extract<ParsedRow, { known: true }>;

function row(state: Known["state"], destroys = 0, failed = false, deletes?: number): Known {
  return {
    ...(deletes === undefined ? {} : { deletes }),
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

// Whether any sign is up, as the rule of record 0043 had it.
const destroySign = (rows: ParsedRow[]) => {
  const signs = destroySigns(rows);
  return signs.deletes || signs.replaces;
};

// Record 0075: a sign for a replace and a sign of its own for a delete.
describe("the delete sign and the replace sign of record 0075", () => {
  const NONE = { deletes: false, replaces: false };

  test("a row with only replaces puts up the replace sign", () => {
    expect(destroySigns([row("pending", 2, false, 0)])).toEqual({ deletes: false, replaces: true });
  });

  test("a row with only deletes puts up the delete sign", () => {
    expect(destroySigns([row("pending", 2, false, 2)])).toEqual({ deletes: true, replaces: false });
  });

  test("a row with both puts up both", () => {
    expect(destroySigns([row("deploying", 3, false, 1)])).toEqual({
      deletes: true,
      replaces: true,
    });
  });

  test("two rows, one of each, put up both", () => {
    expect(destroySigns([row("pending", 1, false, 1), row("queued", 1, false, 0)])).toEqual({
      deletes: true,
      replaces: true,
    });
  });

  // An older version counted them together and did not say which. The delete
  // sign asks for the more care of the two.
  test("a marker that does not say how many are deletes counts them all as deletes", () => {
    expect(destroySigns([row("pending", 2)])).toEqual({ deletes: true, replaces: false });
  });

  test("no destroy puts up neither", () => {
    expect(destroySigns([row("pending"), row("in-sync", 1, false, 1)])).toEqual(NONE);
  });
});

// The rule of record 0043: the one plain had in record 0031, moved.
describe("the destroy sign of record 0043", () => {
  test("a destroy on a pending row turns it on", () => {
    expect(destroySign([row("pending", 1), row("in-sync")])).toBe(true);
  });

  test("a destroy on a queued row turns it on", () => {
    expect(destroySign([row("queued", 1)])).toBe(true);
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
