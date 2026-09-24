import { describe, expect, test } from "bun:test";
import { parseDashboard } from "../../src/render/marker.ts";
import { type Row, type RowLevel, renderRow } from "../../src/render/row.ts";
import { rows58, rows100, stackIdOf } from "./fixtures.ts";

const LEVELS: RowLevel[] = [0, 1, 2, 3];

function byState(rows: Row[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.state] = (counts[row.state] ?? 0) + 1;
  return counts;
}

function destroysOf(row: Row): number {
  if (row.state !== "pending") return 0;
  return row.diff.changes.filter((change) => change.op === "delete" || change.op === "replace")
    .length;
}

// Record 0075: how many of the destroys are deletes, on a row that has any.
function deletesOf(row: Row): { deletes?: number } {
  if (row.state !== "pending" || destroysOf(row) === 0) return {};
  return { deletes: row.diff.changes.filter((change) => change.op === "delete").length };
}

describe("the fixtures", () => {
  test("58 stacks: 11 pending, 2 deploying, 2 preview failures, 43 in sync", () => {
    expect(byState(rows58())).toEqual({
      pending: 11,
      deploying: 2,
      "preview-failed": 2,
      "in-sync": 43,
    });
  });

  test("100 stacks: the same dashboard with 42 more pending stacks", () => {
    expect(byState(rows100())).toEqual({
      pending: 53,
      deploying: 2,
      "preview-failed": 2,
      "in-sync": 43,
    });
    expect(new Set(rows100().map(stackIdOf)).size).toBe(100);
  });

  test("the same input gives the same bytes", () => {
    const render = () =>
      rows100()
        .map((row) => renderRow(row))
        .join("\n");
    expect(render()).toBe(render());
  });
});

describe("snapshots", () => {
  const blocks = (rows: Row[], options: Parameters<typeof renderRow>[1]) =>
    `${rows.map((row) => renderRow(row, options)).join("\n")}\n`;

  test("every row of the 58 stack fixture, in full", () => {
    expect(blocks(rows58(), {})).toMatchSnapshot();
  });

  test("every row of the 58 stack fixture, redacted", () => {
    expect(blocks(rows58(), { redact: true })).toMatchSnapshot();
  });

  test("every row of the 100 stack fixture at level 3", () => {
    expect(blocks(rows100(), { level: 3 })).toMatchSnapshot();
  });

  // One large row at every level: a replace, 45 other changes, five named
  // pull requests and two more.
  test("one large row at levels 1 and 2", () => {
    const ingress = rows58().filter((row) => stackIdOf(row) === "platform/ingress:prod");
    expect(blocks(ingress, { level: 1 })).toMatchSnapshot();
    expect(blocks(ingress, { level: 2 })).toMatchSnapshot();
  });
});

// What must hold for every row a writer ever renders, whatever is in it.
describe("every rendered block", () => {
  const cases = rows100().flatMap((row) =>
    [false, true].flatMap((redact) => LEVELS.map((level) => ({ row, redact, level }))),
  );

  test("is tight: the first line is a list item, every other line is indented, none is blank", () => {
    for (const { row, redact, level } of cases) {
      const [first = "", ...rest] = renderRow(row, { redact, level }).split("\n");
      expect(first).toStartWith("- ");
      for (const line of rest) expect(line).toMatch(/^ {2}\S/);
      expect(rest.at(-1)).toBe("  <!-- /sluiceway:row -->");
    }
  });

  test("reads back as one row block with the facts it was rendered from", () => {
    for (const { row, redact, level } of cases) {
      const block = renderRow(row, { redact, level });
      expect(parseDashboard(block).rows).toEqual([
        {
          known: true,
          stackId: stackIdOf(row),
          state: row.state,
          hash: row.state === "pending" ? row.hash : undefined,
          destroys: destroysOf(row),
          ...deletesOf(row),
          failed: "failure" in row && row.failure !== undefined,
          shortened: row.state === "pending" ? level : 0,
          drift: false,
          policyFailed: false,
          ticked: false,
          text: block,
        },
      ]);
    }
  });

  test("only a pending row has a box, and ticking it is read as a tick", () => {
    for (const { row, redact, level } of cases) {
      const block = renderRow(row, { redact, level });
      expect(block.startsWith("- [ ] ")).toBe(row.state === "pending");
      const ticked = block.replace("- [ ] ", "- [x] ");
      expect(parseDashboard(ticked).rows[0]).toMatchObject({ ticked: row.state === "pending" });
    }
  });

  test("no bare issue or pull request reference sits on the first line", () => {
    for (const { row, redact, level } of cases) {
      const first = renderRow(row, { redact, level }).split("\n")[0] ?? "";
      expect(first.replace(/<!-- .* -->$/, "")).not.toMatch(/#\d/);
    }
  });

  test("a whole body of blocks reads back in order", () => {
    const body = rows100()
      .map((row) => renderRow(row))
      .join("\n");
    expect(parseDashboard(body).rows.map((row) => row.stackId)).toEqual(rows100().map(stackIdOf));
  });
});

describe("the fixtures under redact", () => {
  test("no resource type, resource name or property name is left", () => {
    const body = rows100()
      .map((row) => renderRow(row, { redact: true }))
      .join("\n");
    expect(body).not.toMatch(/<code>|<b>|<kbd>|<details>/);
    for (const row of rows100()) {
      if (row.state !== "pending") continue;
      for (const change of row.diff.changes) expect(body).not.toContain(change.type);
    }
  });

  test("every row with a delete or replace still carries the warning and its counts", () => {
    for (const row of rows100()) {
      const block = renderRow(row, { redact: true });
      expect(block.includes(":warning:")).toBe(destroysOf(row) > 0);
      if (destroysOf(row) > 0)
        expect(block.split("\n")[0]).toMatch(/\*\*\d+ (delete|replace)s?\*\*/);
    }
  });
});

// The numbers the records give, so the size budget (slice 1.8) starts from
// rows of the size it was designed for.
describe("sizes", () => {
  const size = (rows: Row[], level: RowLevel) =>
    rows.map((row) => renderRow(row, { level })).join("\n").length;

  test("the rows of the 58 stack fixture fit the target in full (0027: 37,607 for the body)", () => {
    expect(size(rows58(), 0)).toBeGreaterThan(30_000);
    expect(size(rows58(), 0)).toBeLessThan(45_000);
  });

  test("the rows of the 100 stack fixture are far over the hard limit in full", () => {
    expect(size(rows100(), 0)).toBeGreaterThan(300_000);
  });

  test("a level 3 row is about 550 characters (0028), whatever its diff holds", () => {
    const pending = rows100().filter((row) => row.state === "pending");
    for (const row of pending) expect(renderRow(row, { level: 3 }).length).toBeLessThan(700);
    expect(size(rows100(), 3)).toBeLessThan(58_000);
  });

  test("levels 2 and 3 are never larger than the level before", () => {
    for (const row of rows100()) {
      const [, one = 0, two = 0, three = 0] = LEVELS.map(
        (level) => renderRow(row, { level }).length,
      );
      expect(two).toBeLessThanOrEqual(one);
      expect(three).toBeLessThanOrEqual(two);
    }
  });

  // `#418 by carol` is one character shorter than `1 pull request`, and the
  // marker of a shortened row says so in 14 more: ` shortened="1"`. The size
  // budget has to know that level 1 is not a saving on every row.
  test("level 1 saves nothing on a row that names a single pull request", () => {
    const web = rows58().find((row) => stackIdOf(row) === "apps/web:prod");
    if (!web) throw new Error("the fixture lost apps/web:prod");
    expect(renderRow(web, { level: 1 }).length - renderRow(web).length).toBe(1 + 14);
  });
});
