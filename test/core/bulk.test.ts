import { describe, expect, test } from "bun:test";
import { bulkRows, drawBulk, holdsBulkTick, sectionChanges } from "../../src/core/bulk.ts";
import { renderBulkLine } from "../../src/render/bulk-box.ts";
import {
  type ParsedBulk,
  parseDashboard,
  ROW_CLOSE_MARKER,
  type RowFacts,
  rowMarker,
} from "../../src/render/marker.ts";

// Slice 5.18, record 0083: which bulk line a section gets, from its rows and
// the line the live body holds.

const A = { stackId: "a", hash: "aaaaaaaaaaaaaaaa" };
const B = { stackId: "b", hash: "bbbbbbbbbbbbbbbb" };
const C = { stackId: "c", hash: "cccccccccccccccc" };

function live(line: Parameters<typeof renderBulkLine>[0]): ParsedBulk {
  const [parsed] = parseDashboard(renderBulkLine(line)).bulk;
  if (!parsed) throw new Error("no bulk line");
  return parsed;
}

const box = (ticked = false) => live({ kind: "box", section: "pending", count: 2, ticked });
const confirm = (ticked = false, stacks = [A, B], scanRun = "10") =>
  live({ kind: "confirm", section: "pending", by: "alice", stacks, scanRun, ticked });

describe("the rows of a section", () => {
  test("are its known rows with a hash, one per stack, in stack id order", () => {
    const row = (facts: RowFacts) => `- [ ] x ${rowMarker(facts)}\n  ${ROW_CLOSE_MARKER}`;
    const body = [
      row({ state: "pending", stackId: "b", hash: B.hash }),
      row({ state: "pending", stackId: "a", hash: A.hash }),
      row({ state: "pending", stackId: "a", hash: C.hash }),
      row({ state: "pending", stackId: "e" }),
      row({ state: "drift", stackId: "c", hash: C.hash, drift: true }),
      row({ state: "in-sync", stackId: "d" }),
    ].join("\n");
    const { rows } = parseDashboard(body);
    expect(bulkRows(rows, "pending")).toEqual([A, B]);
    expect(bulkRows(rows, "drift")).toEqual([C]);
  });
});

describe("what changed under a confirm box", () => {
  test("a new stack, a stack that left the section, and a stack whose diff moved", () => {
    expect(sectionChanges([A, B], [{ ...B, hash: "0000000000000000" }, C])).toEqual({
      added: ["c"],
      gone: ["a"],
      moved: ["b"],
    });
  });

  test("nothing, when the rows are the ones the box names", () => {
    expect(sectionChanges([A, B], [A, B])).toBeUndefined();
  });
});

describe("which bulk line a section gets", () => {
  const base = { section: "pending" as const, rows: [A, B], on: true };

  test("a bulk box that counts the rows, with two rows or more", () => {
    expect(drawBulk({ ...base, rows: [A, B, C], live: undefined })).toEqual({
      kind: "box",
      section: "pending",
      count: 3,
      ticked: false,
    });
  });

  test("none with fewer than two rows: one row already has its own box", () => {
    expect(drawBulk({ ...base, rows: [A], live: undefined })).toBeUndefined();
    expect(drawBulk({ ...base, rows: [], live: confirm() })).toBeUndefined();
  });

  test("none when deploys are off or the dashboard is read only", () => {
    expect(drawBulk({ ...base, on: false, live: box(true) })).toBeUndefined();
  });

  test("resolve turns an allowed tick on the bulk box into a confirm box of the rows as they are", () => {
    expect(
      drawBulk({
        ...base,
        rows: [A, B, C],
        live: box(true),
        act: {
          tick: { kind: "bulk", section: "pending" },
          outcome: "confirm",
          by: "alice",
          scanRun: "10",
        },
      }),
    ).toEqual({
      kind: "confirm",
      section: "pending",
      by: "alice",
      stacks: [A, B, C],
      scanRun: "10",
      ticked: false,
    });
  });

  test("an act on a tick the live body no longer holds is not applied", () => {
    const act = {
      tick: { kind: "bulk" as const, section: "pending" as const },
      outcome: "confirm" as const,
      by: "alice",
      scanRun: "10",
    };
    expect(drawBulk({ ...base, live: box(false), act })).toMatchObject({ kind: "box" });
    const consumed = {
      tick: { kind: "confirm" as const, section: "pending" as const, stacks: [A, C] },
      outcome: "consumed" as const,
    };
    expect(drawBulk({ ...base, live: confirm(true), act: consumed })).toMatchObject({
      kind: "confirm",
      ticked: true,
    });
  });

  test("a confirm box that resolve acted on gives the section its bulk box back, without a note", () => {
    expect(
      drawBulk({
        ...base,
        rows: [A, C],
        live: confirm(true),
        act: {
          tick: { kind: "confirm", section: "pending", stacks: [A, B] },
          outcome: "consumed",
        },
      }),
    ).toEqual({ kind: "box", section: "pending", count: 2, ticked: false });
  });

  test("resolve clears a tick with the note it gives", () => {
    expect(
      drawBulk({
        ...base,
        live: confirm(true),
        act: {
          tick: { kind: "confirm", section: "pending", stacks: [A, B] },
          outcome: "clear",
          note: { kind: "orphan" },
        },
      }),
    ).toEqual({
      kind: "box",
      section: "pending",
      count: 2,
      ticked: false,
      note: { kind: "orphan" },
    });
    expect(
      drawBulk({
        ...base,
        live: box(true),
        act: { tick: { kind: "bulk", section: "pending" }, outcome: "clear" },
      }),
    ).toEqual({ kind: "box", section: "pending", count: 2, ticked: false });
  });

  test("a confirm box goes stale when the rows change under it, with a note that says what changed", () => {
    expect(drawBulk({ ...base, rows: [A, C], live: confirm(true) })).toEqual({
      kind: "box",
      section: "pending",
      count: 2,
      ticked: false,
      note: { kind: "changed", added: ["c"], gone: ["b"], moved: [] },
    });
  });

  test("a writer that is not a scan carries a confirm box and a bulk box as they are", () => {
    expect(drawBulk({ ...base, live: confirm(true) })).toEqual({
      kind: "confirm",
      section: "pending",
      by: "alice",
      stacks: [A, B],
      scanRun: "10",
      ticked: true,
    });
    const noted = live({
      kind: "box",
      section: "pending",
      count: 5,
      ticked: true,
      note: { kind: "orphan" },
    });
    expect(drawBulk({ ...base, live: noted })).toEqual({
      kind: "box",
      section: "pending",
      count: 2,
      ticked: true,
      note: { kind: "orphan" },
    });
  });

  describe("at a scan", () => {
    const scan = (liveScanRun: string, resolveOnItsWay = false) => ({
      liveScanRun,
      resolveOnItsWay,
    });

    test("the first scan after the confirm box keeps it", () => {
      expect(drawBulk({ ...base, live: confirm(), scan: scan("10") })).toMatchObject({
        kind: "confirm",
        ticked: false,
      });
    });

    test("a confirm box older than one scan is taken back with a note", () => {
      expect(drawBulk({ ...base, live: confirm(), scan: scan("11") })).toEqual({
        kind: "box",
        section: "pending",
        count: 2,
        ticked: false,
        note: { kind: "expired" },
      });
    });

    test("a ticked box is carried while a resolve run is on its way, and swept as an orphan otherwise", () => {
      expect(drawBulk({ ...base, live: confirm(true), scan: scan("11", true) })).toMatchObject({
        kind: "confirm",
        ticked: true,
      });
      expect(drawBulk({ ...base, live: confirm(true), scan: scan("10") })).toEqual({
        kind: "box",
        section: "pending",
        count: 2,
        ticked: false,
        note: { kind: "orphan" },
      });
      expect(drawBulk({ ...base, live: box(true), scan: scan("10", true) })).toEqual({
        kind: "box",
        section: "pending",
        count: 2,
        ticked: true,
      });
      expect(drawBulk({ ...base, live: box(true), scan: scan("10") })).toEqual({
        kind: "box",
        section: "pending",
        count: 2,
        ticked: false,
        note: { kind: "orphan" },
      });
    });

    test("drops a note, as a scan drops the notes of rows", () => {
      const noted = live({
        kind: "box",
        section: "pending",
        count: 2,
        ticked: false,
        note: { kind: "expired" },
      });
      expect(drawBulk({ ...base, live: noted, scan: scan("10") })).toEqual({
        kind: "box",
        section: "pending",
        count: 2,
        ticked: false,
      });
    });

    test("stale wins over carrying a tick", () => {
      expect(
        drawBulk({ ...base, rows: [A, C], live: confirm(true), scan: scan("10", true) }),
      ).toMatchObject({ kind: "box", note: { kind: "changed" } });
    });
  });
});

describe("whether a live line holds a tick", () => {
  test("a ticked bulk box of the section", () => {
    expect(holdsBulkTick(box(true), { kind: "bulk", section: "pending" })).toBe(true);
    expect(holdsBulkTick(box(false), { kind: "bulk", section: "pending" })).toBe(false);
    expect(holdsBulkTick(box(true), { kind: "bulk", section: "drift" })).toBe(false);
  });

  test("a ticked confirm box of the same stacks at the same hashes", () => {
    const tick = { kind: "confirm" as const, section: "pending" as const, stacks: [A, B] };
    expect(holdsBulkTick(confirm(true), tick)).toBe(true);
    expect(holdsBulkTick(confirm(false), tick)).toBe(false);
    expect(holdsBulkTick(confirm(true, [A, { ...B, hash: "0000000000000000" }]), tick)).toBe(false);
    expect(holdsBulkTick(box(true), tick)).toBe(false);
  });
});

// Record 0106: a row whose change fails a policy has no box, so no bulk box
// counts it and no confirm box names it.
describe("a row a policy stopped", () => {
  test("is not among the rows of its section", () => {
    const row = (facts: RowFacts) => `- **x** ${rowMarker(facts)}\n  ${ROW_CLOSE_MARKER}`;
    const body = [
      row({ state: "pending", stackId: "a", hash: A.hash, policyFailed: true }),
      row({ state: "pending", stackId: "b", hash: B.hash }),
      row({ state: "drift", stackId: "c", hash: C.hash, drift: true, policyFailed: true }),
    ].join("\n");
    const { rows } = parseDashboard(body);
    expect(bulkRows(rows, "pending")).toEqual([B]);
    expect(bulkRows(rows, "drift")).toEqual([]);
  });
});
