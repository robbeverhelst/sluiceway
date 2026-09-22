import { describe, expect, test } from "bun:test";
import { renderBody, rowBlock } from "../../src/render/body.ts";
import {
  BODY_LIMIT,
  BODY_TARGET,
  type BudgetInput,
  bodyDoesNotFitMessage,
  fitBody,
} from "../../src/render/budget.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import type { DriftRow, PendingRow, Row, RowLevel } from "../../src/render/row.ts";

const REPO_URL = "https://github.com/example-org/infra";
const RUN_URL = `${REPO_URL}/actions/runs/17034455121`;

const FRAME = {
  root: {
    scanSha: "8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c",
    scanRun: "17034455121",
    scanAt: "2026-09-21T10:02:41Z",
  },
  recentlyDeployed: [],
  repoUrl: REPO_URL,
  actionRef: "v0.1.0",
  personality: true,
};

interface Shape {
  creates?: number;
  deletes?: number;
  // How many pull requests the attribution line names. The default is many,
  // so that level 1 saves more than the note about shortened rows costs.
  pullRequests?: number;
}

// A pending row of a chosen size. Every name has a fixed width, so two rows of
// the same shape are exactly as large as each other.
function pending(stackId: string, shape: Shape = {}): PendingRow {
  const { creates = 1, deletes = 0, pullRequests = 30 } = shape;
  const change = (op: "create" | "delete", index: number) => ({
    address: `${op}-${String(index).padStart(4, "0")}`,
    type: "random:index/randomPet:RandomPet",
    name: `pet-${String(index).padStart(4, "0")}`,
    op,
    changedKeys: [],
    replaceKeys: [],
  });
  const names = Array.from({ length: pullRequests }, (_, index) => `#${400 + index} by alice`);
  return {
    state: "pending",
    diff: {
      stackId,
      changes: [
        ...Array.from({ length: deletes }, (_, index) => change("delete", index)),
        ...Array.from({ length: creates }, (_, index) => change("create", index)),
      ],
    },
    hash: "3fa9c1e2aabbccdd",
    runUrl: RUN_URL,
    attribution:
      pullRequests === 0
        ? undefined
        : {
            full: `from ${names.join(", ")} · [compare](${REPO_URL}/compare/a...b)`,
            counted: `from ${pullRequests} pull request${pullRequests === 1 ? "" : "s"} · [compare](${REPO_URL}/compare/a...b)`,
          },
  };
}

const input = (rows: Row[], overrides: Partial<BudgetInput> = {}): BudgetInput => ({
  ...FRAME,
  rows,
  carried: [],
  ...overrides,
});

// The body with every row at a level written down by hand. It is put together
// without the budget, so it is what the steps of record 0028 have to arrive at
// and never what the code happened to give.
function bodyAt(rows: PendingRow[], levels: Record<string, RowLevel>): string {
  return renderBody({
    ...FRAME,
    rows: rows.map((row) => rowBlock(row, { level: levels[row.diff.stackId] ?? 0 })),
  });
}

function levelsOf(body: string): Record<string, number> {
  return Object.fromEntries(
    parseDashboard(body).rows.map((row) => [row.stackId, row.known ? row.shortened : -1]),
  );
}

describe("a body that fits", () => {
  test("shows every row in full and has no note", () => {
    const rows = [pending("a"), pending("b", { creates: 5 })];
    const fitted = fitBody(input(rows));
    expect(fitted.body).toBe(bodyAt(rows, {}));
    expect(fitted).toMatchObject({ fits: true, shortened: 0, size: fitted.body.length });
    expect(fitted.body).not.toContain("[!NOTE]");
  });
});

// Record 0028: level by level, and within a level the biggest rows first,
// until the body fits.
describe("a body over the target", () => {
  test("the biggest row gives way first, and no more rows than it takes", () => {
    // Both rows save the same at level 1, so the target alone cannot tell
    // which of them was picked.
    const rows = [pending("small"), pending("large", { creates: 9 })];
    const expected = bodyAt(rows, { large: 1 });
    expect(bodyAt(rows, { small: 1 }).length).toBe(expected.length);
    expect(bodyAt(rows, {}).length).toBeGreaterThan(expected.length);

    const fitted = fitBody(input(rows), { target: expected.length });
    expect(fitted.body).toBe(expected);
    expect(fitted).toMatchObject({ fits: true, shortened: 1 });
  });

  test("two rows of one size: the lower stack id gives way first, whatever the order of the input", () => {
    const rows = [pending("b:prod"), pending("a:prod"), pending("c:prod")];
    const expected = bodyAt(rows, { "a:prod": 1 });
    for (const order of [rows, [...rows].reverse()]) {
      expect(fitBody(input(order), { target: expected.length }).body).toBe(expected);
    }
  });

  test("every row reaches a level before any row goes to the next one", () => {
    const rows = [pending("big", { creates: 40 }), pending("s1"), pending("s2")];
    const expected = bodyAt(rows, { big: 2, s1: 1, s2: 1 });
    expect(fitBody(input(rows), { target: expected.length }).body).toBe(expected);
  });
});

// Record 0024: creates, updates and tracking changes go first. Delete and
// replace lines are cut only when the body cannot fit otherwise.
describe("destroys are cut last", () => {
  test("every fold goes before any delete line does, also when one row's deletes alone would do", () => {
    const rows = [pending("d", { deletes: 100, creates: 100 }), pending("c", { creates: 80 })];
    const expected = bodyAt(rows, { d: 2, c: 2 });
    // Taking the 100 delete lines away instead would fit as well, and would
    // leave the 80 creates of the other row listed.
    expect(bodyAt(rows, { d: 3 }).length).toBeLessThan(expected.length);

    const fitted = fitBody(input(rows), { target: expected.length });
    expect(fitted.body).toBe(expected);
    expect(fitted.body.match(/<kbd>DELETE<\/kbd>/g)?.length).toBe(100);
  });

  test("when the folds are not enough the deletes go all at once, and the warning carries the count", () => {
    const rows = [pending("d", { deletes: 100, creates: 100 }), pending("c", { creates: 80 })];
    const expected = bodyAt(rows, { d: 3, c: 2 });
    const fitted = fitBody(input(rows), { target: expected.length });
    expect(fitted.body).toBe(expected);
    expect(fitted.body).not.toContain("<kbd>DELETE</kbd>");
    expect(fitted.body).toContain(":warning: **deletes 100, too many to list here.**");
  });
});

// Record 0028: then the rows from smallest full size to biggest each get the
// lowest level at which the body still fits.
describe("giving back", () => {
  const small = [pending("s1"), pending("s2", { creates: 2 }), pending("s3", { creates: 3 })];

  test("cutting one huge row gives the small rows their details back", () => {
    const rows = [pending("huge", { creates: 200 }), ...small];
    const expected = bodyAt(rows, { huge: 2 });
    const fitted = fitBody(input(rows), { target: expected.length });
    expect(fitted.body).toBe(expected);
    expect(fitted.shortened).toBe(1);
  });

  test("the smallest row comes first when there is not room for all", () => {
    const rows = [pending("huge", { creates: 200 }), ...small];
    // Every small row saves the same at level 1, so the target alone cannot
    // tell which of them stayed shortened.
    const expected = bodyAt(rows, { huge: 2, s3: 1 });
    expect(bodyAt(rows, { huge: 2, s1: 1 }).length).toBe(expected.length);
    expect(fitBody(input(rows), { target: expected.length }).body).toBe(expected);
  });

  test("a row gets the lowest level that fits, not only all or nothing", () => {
    const rows = [pending("big", { deletes: 100, creates: 100 }), pending("mid", { creates: 30 })];
    const expected = bodyAt(rows, { big: 3, mid: 1 });
    expect(fitBody(input(rows), { target: expected.length }).body).toBe(expected);
  });

  test("rows of one full size: the lower stack id gets its details back first", () => {
    const rows = [pending("huge", { creates: 200 }), pending("b"), pending("a"), pending("c")];
    const expected = bodyAt(rows, { huge: 2, c: 1 });
    for (const order of [rows, [...rows].reverse()]) {
      expect(fitBody(input(order), { target: expected.length }).body).toBe(expected);
    }
  });
});

// Slice 1.6 found that a higher level is not always smaller. The budget
// measures, and never shortens a row for nothing.
describe("a level that saves nothing", () => {
  test("a row stays as it is when no level makes it smaller, however far over the body is", () => {
    // No attribution line, no fold, and one delete line that is shorter than
    // the warning that would replace it.
    const rows = [pending("x", { creates: 0, deletes: 1, pullRequests: 0 })];
    const fitted = fitBody(input(rows), { target: 0 });
    expect(fitted.body).toBe(bodyAt(rows, {}));
    expect(fitted.shortened).toBe(0);
  });

  test("a row that names one pull request skips level 1 and still takes level 2", () => {
    const rows = [pending("y", { creates: 40, pullRequests: 1 })];
    const at = (level: RowLevel) => rowBlock(rows[0] as PendingRow, { level }).text.length;
    expect(at(1)).toBeGreaterThan(at(0));

    const over = bodyAt(rows, {}).length - 1;
    expect(levelsOf(fitBody(input(rows), { target: over }).body)).toEqual({ y: 2 });
  });
});

// Record 0028: a body over 65,536 characters is never written. The target is
// where the budget aims, the hard limit is where it gives up.
describe("the hard limit", () => {
  test("a body over the target with every row cut as far as it goes still fits under the limit", () => {
    const rows = [pending("a", { creates: 50 }), pending("b", { creates: 50 })];
    const expected = bodyAt(rows, { a: 3, b: 3 });
    const fitted = fitBody(input(rows), { target: 0, limit: expected.length });
    expect(fitted.body).toBe(expected);
    expect(fitted).toMatchObject({ fits: true, shortened: 2, size: expected.length });
  });

  test("one character over the limit does not fit", () => {
    const rows = [pending("a", { creates: 50 }), pending("b", { creates: 50 })];
    const smallest = bodyAt(rows, { a: 3, b: 3 });
    const fitted = fitBody(input(rows), { target: 0, limit: smallest.length - 1 });
    expect(fitted).toMatchObject({ fits: false, size: smallest.length });
  });

  test("the numbers are the ones of record 0028", () => {
    expect([BODY_TARGET, BODY_LIMIT]).toEqual([58_000, 65_536]);
  });

  // About 100 stacks that are all pending at once (record 0028).
  test("150 pending stacks do not fit in one issue, and 90 do", () => {
    const stacks = (count: number) =>
      Array.from({ length: count }, (_, index) => pending(`apps/service-${index}:prod`));
    expect(fitBody(input(stacks(150))).fits).toBe(false);
    const ninety = fitBody(input(stacks(90)));
    expect(ninety.fits).toBe(true);
    expect(ninety.size).toBeLessThanOrEqual(58_000);
  });

  test("the message for a scan that fails says what happened, in plain numbers", () => {
    expect(bodyDoesNotFitMessage(70_123)).toBe(
      "The dashboard does not fit in one issue. With every pending row shortened as far as it goes the body is 70,123 characters, and GitHub drops a body over 65,536 without an error. Nothing was written and the dashboard stays as it was. It fits again with fewer stacks pending at once: deploy some, or take stacks off the dashboard with `ignore` in `sluiceway.yaml`.",
    );
  });
});

// Record 0028: a writer that swaps rows has a diff only for its own rows. It
// shortens those and never touches a row it carries through.
describe("a writer that carries rows through", () => {
  const huge = rowBlock(pending("carried:huge", { creates: 200 }));
  const short = rowBlock(pending("carried:short", { creates: 200 }), { level: 3 });

  test("a carried row is never shortened, however big it is", () => {
    const own = [pending("own:a", { creates: 20 }), pending("own:b")];
    const expected = renderBody({
      ...FRAME,
      rows: [huge, rowBlock(own[0] as PendingRow, { level: 2 }), rowBlock(own[1] as PendingRow)],
    });
    const fitted = fitBody(input(own, { carried: [huge] }), { target: expected.length });
    expect(fitted.body).toBe(expected);
    expect(fitted.body).toContain(huge.text);
    expect(fitted).toMatchObject({ fits: true, shortened: 1 });
  });

  test("when its own rows are not enough the body does not fit, and the carried row is still whole", () => {
    const own = [pending("own:a", { creates: 20 })];
    const smallest = renderBody({
      ...FRAME,
      rows: [huge, rowBlock(own[0] as PendingRow, { level: 3 })],
    });
    const fitted = fitBody(input(own, { carried: [huge] }), {
      target: smallest.length - 1,
      limit: smallest.length - 1,
    });
    expect(fitted.fits).toBe(false);
    expect(fitted.body).toBe(smallest);
  });

  test("a carried row that is already shortened stays in the note, and is not counted as the writer's", () => {
    const fitted = fitBody(input([pending("own:a")], { carried: [short] }));
    expect(fitted.shortened).toBe(0);
    expect(fitted.body).toContain("so 1 of 2 pending rows is shortened.");
    expect(fitted.body).toContain(short.text);
  });

  test("rows that are not pending are placed as they are", () => {
    const rows: Row[] = [
      { state: "in-sync", stackId: "calm" },
      { state: "deploying", stackId: "busy", ticker: "carol", runUrl: RUN_URL },
      pending("waiting", { creates: 40 }),
    ];
    const fitted = fitBody(input(rows), { target: 0 });
    expect(levelsOf(fitted.body)).toEqual({ waiting: 3, busy: 0, calm: 0 });
    expect(fitted.shortened).toBe(1);
  });
});

// Record 0028: a redacted dashboard has nothing to shorten. Its rows are
// already about the size of level 3. Only the attribution line can still give.
describe("a redacted dashboard", () => {
  test("no name reaches the body, and a row goes no further than level 1", () => {
    const rows = [pending("a", { creates: 40, deletes: 2 }), pending("b", { creates: 3 })];
    const fitted = fitBody(input(rows, { redact: true }), { target: 0 });
    expect(fitted.body).not.toContain("pet-");
    expect(fitted.body).not.toContain("RandomPet");
    expect(levelsOf(fitted.body)).toEqual({ a: 1, b: 1 });
    expect(fitted.body).toBe(
      renderBody({
        ...FRAME,
        rows: rows.map((row) => rowBlock(row, { redact: true, level: 1 })),
      }),
    );
  });
});

// Slice 2.17: a read-only dashboard shortens rows like any other, and no row
// has a box at any level.
describe("a read-only dashboard", () => {
  test("no row has a box at any level, and the rows are shortened as usual", () => {
    const rows = [pending("a", { creates: 40, deletes: 2 }), pending("b", { creates: 3 })];
    const fitted = fitBody(input(rows, { readOnly: true }), { target: 0 });
    expect(levelsOf(fitted.body)).toEqual(levelsOf(fitBody(input(rows), { target: 0 }).body));
    expect(fitted.body).not.toContain("- [ ]");
    expect(fitted.body).toBe(
      renderBody({
        ...FRAME,
        readOnly: true,
        rows: rows.map((row) => rowBlock(row, { readOnly: true, level: 3 })),
      }),
    );
  });
});

describe("the target and the limit together", () => {
  test("a writer that aims at the hard limit shortens nothing under it", () => {
    const rows = [pending("a", { creates: 50 })];
    const full = bodyAt(rows, {});
    expect(fitBody(input(rows), { target: full.length, limit: full.length }).shortened).toBe(0);
  });

  test("a target over the limit aims at the limit", () => {
    const rows = [pending("a", { creates: 50 })];
    const expected = bodyAt(rows, { a: 2 });
    const fitted = fitBody(input(rows), { target: 1_000_000, limit: expected.length });
    expect(fitted.body).toBe(expected);
    expect(fitted.fits).toBe(true);
  });
});

// Record 0046: one change can hold hundreds of paths, such as every key of a
// Helm release's values. A row lists ten of them, each at most 80 characters,
// so such a row stays small and the budget has no reason to cut it.
describe("many paths on one change", () => {
  const helm = (stackId: string, paths: number): PendingRow => ({
    ...pending(stackId, { creates: 0, pullRequests: 1 }),
    diff: {
      stackId,
      changes: [
        {
          address: `${stackId}::release`,
          type: "kubernetes:helm.sh/v3:Release",
          name: "release",
          op: "update",
          changedKeys: Array.from(
            { length: paths },
            (_, index) =>
              `values.controller.runnerScaleSets[${index}].template.spec.containers[0].resources.limits.memory`,
          ),
          replaceKeys: [],
        },
      ],
    },
  });

  test("a row with 400 paths costs no more than one with ten", () => {
    const ten = rowBlock(helm("apps/a:prod", 10)).text.length;
    expect(rowBlock(helm("apps/a:prod", 400)).text.length).toBeLessThanOrEqual(ten + 40);
  });

  test("30 such rows fit in full, where their paths in full would take 1.3 million characters", () => {
    const rows = Array.from({ length: 30 }, (_, index) =>
      helm(`apps/s${String(index).padStart(2, "0")}:prod`, 400),
    );
    const fitted = fitBody(input(rows));
    expect(fitted).toMatchObject({ fits: true, shortened: 0 });
    expect(fitted.body.length).toBeLessThanOrEqual(BODY_TARGET);
  });
});

// Record 0055: a drifted row can be as long as a pending one, so the budget
// shortens it the same way, down to one line that points at the summary.
describe("a drifted row", () => {
  const drifted = (stackId: string, count: number): DriftRow => ({
    state: "drift",
    diff: {
      stackId,
      changes: [],
      drift: Array.from({ length: count }, (_, index) => ({
        address: `gone-${String(index).padStart(4, "0")}`,
        type: "local:index/file:File",
        name: `file-${String(index).padStart(4, "0")}`,
        op: "delete" as const,
        changedKeys: [],
        replaceKeys: [],
      })),
    },
    hash: "4be1a0c93d7e5f20",
    runUrl: RUN_URL,
  });

  test("is shortened when the body is over its target, and keeps its box and its marker", () => {
    const fitted = fitBody(
      { ...FRAME, rows: [drifted("a:drift", 400)], carried: [] },
      { target: 20_000 },
    );
    expect(fitted).toMatchObject({ fits: true, shortened: 1 });
    const [row] = parseDashboard(fitted.body).rows;
    expect(row).toMatchObject({ state: "drift", shortened: 2, drift: true });
    expect(fitted.body).toContain("400 changes outside the code not listed here");
  });
});
