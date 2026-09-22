import { describe, expect, test } from "bun:test";
import { parseConfig } from "../../src/core/config.ts";
import {
  type DashboardWriter,
  type Rows,
  swapRows,
  writeScan,
} from "../../src/github/dashboard-write.ts";
import { renderBody } from "../../src/render/body.ts";
import { renderBulkLine } from "../../src/render/bulk-box.ts";
import {
  type ParsedRow,
  parseDashboard,
  ROW_CLOSE_MARKER,
  type RootFacts,
  type RowFacts,
  rowMarker,
} from "../../src/render/marker.ts";
import type { DeployingRow } from "../../src/render/row.ts";
import { FakeGitHub } from "../fake-github/fake-github.ts";

// Slice 5.18, record 0083: every writer draws the bulk lines again from the
// rows it writes, the live lines, and what it did.

const REPO = "https://github.com/acme/infra";
const ROOT: RootFacts = {
  scanSha: "294bbc0e6f1d8a6c5b3c1f1f0d6b0a7e9c2d4e10",
  scanRun: "41",
  scanAt: "2026-09-20T06:00:12.000Z",
};
const H = (c: string) => c.repeat(16);

function writerFor(github: FakeGitHub, deploys = true): DashboardWriter {
  return {
    github,
    log: { info: () => {} },
    repoUrl: REPO,
    actionRef: "v1.0.0",
    dashboard: parseConfig(undefined).dashboard,
    deploys,
    ignored: [],
  };
}

const pending = (stackId: string, hash = H(stackId)): ParsedRow => {
  const facts: RowFacts = { stackId, state: "pending", hash };
  const [row] = parseDashboard(
    `- [ ] **${stackId}** ${rowMarker(facts)}\n  ${ROW_CLOSE_MARKER}`,
  ).rows;
  if (!row) throw new Error("no row");
  return row;
};

const deploying = (stackId: string): DeployingRow => ({
  state: "deploying",
  stackId,
  ticker: "octocat",
  runUrl: `${REPO}/actions/runs/42`,
  waiting: true,
});

function seed(github: FakeGitHub, rows: ParsedRow[], bulk: string[]): number {
  const body = [
    renderBody({
      root: ROOT,
      rows,
      recentlyDeployed: [],
      repoUrl: REPO,
      actionRef: "v1.0.0",
      personality: false,
    }),
    ...bulk,
  ].join("\n\n");
  return github.seedIssue({ labels: ["sluiceway"], body }).number;
}

const swap =
  (entries: DeployingRow[], more: Partial<Rows> = {}) =>
  async (): Promise<Rows> => ({
    facts: { trail: [] },
    rows: new Map(entries.map((row) => [row.stackId, row])),
    ...more,
  });

const confirmLine = (stacks: string[], ticked = false, scanRun = "41") =>
  renderBulkLine({
    kind: "confirm",
    section: "pending",
    by: "alice",
    stacks: stacks.map((stackId) => ({ stackId, hash: H(stackId) })),
    scanRun,
    ticked,
  });

describe("the bulk lines a row swap writes", () => {
  test("the bulk box counts the pending rows of the body it writes", async () => {
    const github = new FakeGitHub();
    const number = seed(github, [pending("a"), pending("b"), pending("c")], []);

    await swapRows(writerFor(github), number, swap([deploying("c")]));

    const { bulk } = parseDashboard(github.issue(number).body);
    expect(bulk).toMatchObject([{ kind: "box", section: "pending", ticked: false }]);
    expect(bulk[0]?.text).toStartWith("- [ ] Deploy all 2 pending stacks");
  });

  test("a confirm box is carried with its tick while its rows stay", async () => {
    const github = new FakeGitHub();
    const line = confirmLine(["a", "b", "c"], true);
    const number = seed(github, [pending("a"), pending("b"), pending("c")], [line]);

    await swapRows(writerFor(github), number, swap([]));

    expect(parseDashboard(github.issue(number).body).bulk[0]?.text).toBe(line);
  });

  test("a confirm box whose rows a writer changes goes stale, and the bulk box says what changed", async () => {
    const github = new FakeGitHub();
    const number = seed(
      github,
      [pending("a"), pending("b"), pending("c")],
      [confirmLine(["a", "b", "c"])],
    );

    await swapRows(writerFor(github), number, swap([deploying("c")]));

    expect(parseDashboard(github.issue(number).body).bulk).toMatchObject([
      {
        kind: "box",
        note: { kind: "changed", added: [], gone: ["c"], moved: [] },
      },
    ]);
  });

  test("the writer's act on a tick is drawn", async () => {
    const github = new FakeGitHub();
    const box = renderBulkLine({ kind: "box", section: "pending", count: 2, ticked: true });
    const number = seed(github, [pending("a"), pending("b")], [box]);

    await swapRows(
      writerFor(github),
      number,
      swap([], {
        bulk: {
          acts: [
            {
              tick: { kind: "bulk", section: "pending" },
              outcome: "confirm",
              by: "alice",
              scanRun: "41",
            },
          ],
        },
      }),
    );

    expect(parseDashboard(github.issue(number).body).bulk).toMatchObject([
      { kind: "confirm", by: "alice", ticked: false },
    ]);
  });

  test("no bulk line while deploys are off", async () => {
    const github = new FakeGitHub();
    const number = seed(github, [pending("a"), pending("b")], [confirmLine(["a", "b"], true)]);

    await swapRows(writerFor(github, false), number, swap([]));

    expect(parseDashboard(github.issue(number).body).bulk).toEqual([]);
  });
});

describe("the bulk lines a scan writes", () => {
  test("it sweeps by the scan facts it hands over", async () => {
    const github = new FakeGitHub();
    const writer = writerFor(github);
    const live = parseDashboard(confirmLine(["a", "b"], false, "40")).bulk;

    const answer = await writeScan(writer, true, async () => ({
      root: { ...ROOT, scanRun: "42" },
      facts: { trail: [] },
      rows: new Map(),
      carried: new Map([
        ["a", pending("a")],
        ["b", pending("b")],
      ]),
      merges: [],
      waiting: [],
      outside: [],
      bulk: { live, scan: { liveScanRun: "41", resolveOnItsWay: false } },
    }));

    expect(answer.fits).toBe(true);
    expect(parseDashboard(answer.fits ? answer.body : "").bulk).toMatchObject([
      { kind: "box", note: { kind: "expired" } },
    ]);
  });
});
