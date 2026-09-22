import { describe, expect, test } from "bun:test";
import { renderBody, rowBlock } from "../../src/render/body.ts";
import { BODY_LIMIT, BODY_TARGET, type BudgetInput, fitBody } from "../../src/render/budget.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import type { PendingRow, Row, RowLevel } from "../../src/render/row.ts";
import { rows58, rows100, stackIdOf } from "./fixtures.ts";

const FRAME = {
  root: {
    scanSha: "8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c",
    scanRun: "17034455121",
    scanAt: "2026-09-21T10:02:41Z",
    fullScanAt: "2026-09-21T10:02:41Z",
    fullScanRun: "17034455121",
  },
  recentlyDeployed: [],
  repoUrl: "https://github.com/example-org/infra",
  actionRef: "v0.1.0",
  personality: true,
};

const input = (rows: Row[], redact = false): BudgetInput => ({
  ...FRAME,
  rows,
  carried: [],
  redact,
});

const isPending = (row: Row): row is PendingRow => row.state === "pending";
const destroysOf = (row: PendingRow) =>
  row.diff.changes.filter((change) => change.op === "delete" || change.op === "replace").length;

// Record 0028: the 58 stack fixture with two very large rows uses 57 percent
// of the hard limit, so a dashboard of that size shows every row in full.
describe("the 58 stack fixture", () => {
  const fitted = fitBody(input(rows58()));

  test("fits with every row in full", () => {
    expect(fitted).toMatchObject({ fits: true, shortened: 0 });
    // Its two deploying rows keep their spinner (record 0063).
    expect(fitted.body).toBe(
      renderBody({
        ...FRAME,
        rows: rows58().map((row) => rowBlock(row, { actionRef: FRAME.actionRef })),
      }),
    );
  });

  test("uses between half and two thirds of the hard limit", () => {
    expect(fitted.size / BODY_LIMIT).toBeGreaterThan(0.5);
    expect(fitted.size / BODY_LIMIT).toBeLessThan(0.67);
  });

  test("redacted it fits too, and nothing is shortened", () => {
    expect(fitBody(input(rows58(), true))).toMatchObject({ fits: true, shortened: 0 });
  });
});

// 53 pending stacks, three of them with 450 deletes: 439,001 characters of
// rows in full (slice 1.6), which is far over the limit.
describe("the 100 stack fixture", () => {
  const rows = rows100();
  const fitted = fitBody(input(rows));
  const parsed = parseDashboard(fitted.body);
  const levels = new Map(parsed.rows.map((row) => [row.stackId, row.known ? row.shortened : -1]));

  test("is far over the limit in full, and fits under the target", () => {
    const full = renderBody({ ...FRAME, rows: rows.map((row) => rowBlock(row)) });
    expect(full.length).toBeGreaterThan(400_000);
    expect(fitted.fits).toBe(true);
    expect(fitted.size).toBe(fitted.body.length);
    expect(fitted.size).toBeLessThanOrEqual(BODY_TARGET);
  });

  // Checked row by row since slice 4.11: the destroy alert (record 0062) takes
  // room above the rows, so the room left is no longer a fixed amount.
  test("uses the room it has: giving one more row its details back would not fit", () => {
    const levelOf = (row: Row) => (levels.get(stackIdOf(row)) ?? 0) as RowLevel;
    const shortened = rows.filter((row) => levelOf(row) > 0);
    expect(shortened.length).toBeGreaterThan(0);
    for (const row of shortened) {
      const blocks = rows.map((each) =>
        rowBlock(each, { level: (levelOf(each) - (each === row ? 1 : 0)) as RowLevel }),
      );
      expect(renderBody({ ...FRAME, rows: blocks }).length).toBeGreaterThan(BODY_TARGET);
    }
  });

  test("every stack has exactly one row, with its checkbox and its hash", () => {
    expect(parsed.rows.map((row) => row.stackId).sort()).toEqual(rows.map(stackIdOf).sort());
    for (const row of rows.filter(isPending)) {
      const block = parsed.rows.find((found) => found.stackId === row.diff.stackId);
      expect(block).toMatchObject({ state: "pending", hash: row.hash, ticked: false });
      expect(block).toMatchObject({ destroys: destroysOf(row) });
    }
  });

  test("the delete and replace lines of a row are all there or none are", () => {
    for (const row of rows.filter(isPending)) {
      const text = parsed.rows.find((found) => found.stackId === row.diff.stackId)?.text ?? "";
      const listed = text.split("\n").filter((line) => /^ {2}:warning: <kbd>/.test(line)).length;
      const level = levels.get(row.diff.stackId);
      expect(listed).toBe(level === 3 ? 0 : destroysOf(row));
      if (level === 3 && destroysOf(row) > 0) expect(text).toContain("too many to list here.**");
    }
  });

  test("destroys are cut last: a row loses them only when its fold is gone too", () => {
    // The three rows with 450 deletes and a destroy or two more cannot be
    // listed. No other row with a delete or replace has to give them up.
    const cut = rows
      .filter(isPending)
      .filter((row) => destroysOf(row) > 0 && levels.get(row.diff.stackId) === 3)
      .map((row) => destroysOf(row));
    expect(cut).toEqual([451, 451, 452]);
    const kept = rows
      .filter(isPending)
      .filter((row) => destroysOf(row) > 0 && levels.get(row.diff.stackId) !== 3);
    expect(kept.length).toBe(10);
  });

  test("the note counts the shortened rows", () => {
    const pending = rows.filter(isPending).length;
    expect(pending).toBe(53);
    expect(fitted.shortened).toBeGreaterThan(0);
    expect(fitted.body).toContain(
      `so ${fitted.shortened} of 53 pending rows are shortened. The summary`,
    );
  });

  test("small rows keep their details while large rows give way", () => {
    const sizes = rows.filter(isPending).map((row) => ({
      full: rowBlock(row).text.length,
      level: levels.get(row.diff.stackId) ?? -1,
    }));
    const inFull = sizes.filter((row) => row.level === 0);
    const shortened = sizes.filter((row) => row.level >= 2);
    expect(inFull.length).toBeGreaterThan(0);
    expect(Math.max(...inFull.map((row) => row.full))).toBeLessThan(
      Math.min(...shortened.map((row) => row.full)),
    );
  });

  test("the same rows in any order give the same bytes", () => {
    expect(fitBody(input([...rows].reverse())).body).toBe(fitted.body);
  });

  test("reading the body and rendering it again changes nothing", () => {
    expect(renderBody({ ...FRAME, rows: parsed.rows })).toBe(fitted.body);
  });

  test("the body", () => {
    expect(fitted.body).toMatchSnapshot();
  });
});
