import { describe, expect, test } from "bun:test";
import { parseConfig } from "../../src/core/config.ts";
import {
  type DashboardWriter,
  fitScan,
  type LiveDashboard,
  type Rows,
  type ScanRows,
  swapRows,
  writeScan,
} from "../../src/github/dashboard-write.ts";
import { renderBody, rowBlock } from "../../src/render/body.ts";
import { dashboardFacts } from "../../src/render/dashboard-facts.ts";
import { type ParsedRow, parseDashboard, type RootFacts } from "../../src/render/marker.ts";
import { dashboardCounts } from "../../src/render/result-file.ts";
import type { DeployingRow, InSyncRow } from "../../src/render/row.ts";
import { waitingBlock } from "../../src/render/waiting-line.ts";
import { FakeGitHub } from "../fake-github/fake-github.ts";

const REPO = "https://github.com/acme/infra";
const ROOT: RootFacts = {
  scanSha: "294bbc0e6f1d8a6c5b3c1f1f0d6b0a7e9c2d4e10",
  scanRun: "41",
  scanAt: "2026-09-20T06:00:12.000Z",
  fullScanAt: "2026-09-19T06:00:12.000Z",
  fullScanRun: "40",
};
const NO_TRAIL: Rows["facts"] = { trail: [] };

function writerFor(github: FakeGitHub, lines: string[] = [], runId = "43"): DashboardWriter {
  return {
    github,
    runId,
    log: { info: (line) => lines.push(line) },
    repoUrl: REPO,
    actionRef: "v1.0.0",
    dashboard: parseConfig(undefined).dashboard,
    deploys: true,
    ignored: [],
  };
}

const inSync = (stackId: string): InSyncRow => ({ state: "in-sync", stackId });
const deploying = (stackId: string, destroys = 0): DeployingRow => ({
  state: "deploying",
  stackId,
  ticker: "octocat",
  runUrl: `${REPO}/actions/runs/42`,
  waiting: true,
  destroys,
});

// A row of a state this version does not know, written by a later one.
const unknown = (stackId: string): ParsedRow =>
  parseDashboard(`- ${stackId} <!-- sluiceway:row stack="${stackId}" state="sunk" -->`)
    .rows[0] as ParsedRow;

function bodyOf(blocks: ParsedRow[], root: RootFacts = ROOT): string {
  return renderBody({
    root,
    rows: blocks,
    recentlyDeployed: [],
    repoUrl: REPO,
    actionRef: "v1.0.0",
    personality: true,
  });
}

function seed(github: FakeGitHub, body: string): number {
  return github.seedIssue({ labels: ["sluiceway"], body }).number;
}

function rows(
  entries: (InSyncRow | DeployingRow)[],
  more: Partial<Rows> = {},
): () => Promise<Rows> {
  return async () => ({
    facts: NO_TRAIL,
    rows: new Map(entries.map((row) => [row.stackId, row])),
    ...more,
  });
}

describe("a row swap", () => {
  // Record 0086: only a scan lists the runs, so a swap carries the line, and
  // drops it when the run it names is the swap's own, which has started.
  describe("the line about a run that waits for a runner", () => {
    const waitingRun = { run: "44", since: "2026-09-20T05:40:00.000Z", more: 1 };

    test("is carried by a writer in another run", async () => {
      const github = new FakeGitHub();
      const number = seed(github, bodyOf([rowBlock(inSync("app"))], { ...ROOT, waitingRun }));

      await swapRows(writerFor(github, [], "43"), number, rows([deploying("app")]));

      const body = github.issue(number).body;
      expect(parseDashboard(body).root?.waitingRun).toEqual(waitingRun);
      expect(body).toContain("has been waiting for a runner for 20 minutes");
    });

    test("goes when the writer is the run it names", async () => {
      const github = new FakeGitHub();
      const number = seed(github, bodyOf([rowBlock(inSync("app"))], { ...ROOT, waitingRun }));

      await swapRows(writerFor(github, [], "44"), number, rows([deploying("app")]));

      const body = github.issue(number).body;
      expect(parseDashboard(body).root?.waitingRun).toBeUndefined();
      expect(body).not.toContain("waiting for a runner");
      expect(parseDashboard(body).root).toMatchObject({ scanRun: "41", fullScanRun: "40" });
    });
  });

  // Record 0108: only the scan writes that it is running, and only its own
  // write at the end takes it away, so a swap carries it whatever run it is
  // part of.
  test("the line about a scan that is running is carried, in the run it names too", async () => {
    const scanRunning = { run: "43", since: "2026-09-20T06:10:00.000Z" };
    const github = new FakeGitHub();
    const number = seed(github, bodyOf([rowBlock(inSync("app"))], { ...ROOT, scanRunning }));

    await swapRows(writerFor(github, [], "43"), number, rows([deploying("app")]));

    const body = github.issue(number).body;
    expect(parseDashboard(body).root?.scanRunning).toEqual(scanRunning);
    expect(body).toContain("A scan is running since 2026-09-20 06:10 UTC");
  });

  test("the writer's row takes the place of its stack's block and every other block is carried byte for byte", async () => {
    const github = new FakeGitHub();
    const kept = rowBlock(inSync("app"));
    const number = seed(github, bodyOf([kept, rowBlock(inSync("db"))]));

    const answer = await swapRows(writerFor(github), number, rows([deploying("db")]));

    const written = parseDashboard(github.issue(number).body);
    expect(written.rows.map(({ stackId, state }) => [stackId, state])).toEqual([
      ["db", "deploying"],
      ["app", "in-sync"],
    ]);
    expect(written.rows.find((row) => row.stackId === "app")?.text).toBe(kept.text);
    expect(written.root).toMatchObject({ scanSha: ROOT.scanSha, fullScanRun: "40" });
    expect(answer).toMatchObject({ fits: true, written: true, tries: 1 });
  });

  test("the counts and the header state are those of the body it wrote", async () => {
    const github = new FakeGitHub();
    const number = seed(github, bodyOf([rowBlock(inSync("app")), rowBlock(inSync("db"))]));

    const answer = await swapRows(writerFor(github), number, rows([deploying("db", 2)]));

    const written = parseDashboard(github.issue(number).body).rows;
    expect(answer).toMatchObject({
      fits: true,
      counts: dashboardCounts(written),
      header: dashboardFacts(written).headerState,
    });
    expect(answer).toMatchObject({ header: "deploying", counts: { deploying: 1, inSync: 1 } });
  });

  test("of two blocks for one stack the first counts, and the second is carried", async () => {
    const github = new FakeGitHub();
    const second = rowBlock(inSync("app"));
    const number = seed(github, bodyOf([rowBlock(inSync("app")), second]));

    await swapRows(writerFor(github), number, rows([deploying("app")]));

    const written = parseDashboard(github.issue(number).body).rows;
    expect(written.map(({ state }) => state)).toEqual(["deploying", "in-sync"]);
    expect(written[1]?.text).toBe(second.text);
  });

  test("a first block of a state this version does not know is carried, and the writer's row is not added", async () => {
    const github = new FakeGitHub();
    const number = seed(github, bodyOf([unknown("app"), rowBlock(inSync("db"))]));

    await swapRows(writerFor(github), number, rows([deploying("app")]));

    const written = parseDashboard(github.issue(number).body).rows;
    expect(written.map(({ stackId, known }) => [stackId, known])).toEqual([
      ["db", true],
      ["app", false],
    ]);
  });

  test("a stack whose row was deleted by hand gets one", async () => {
    const github = new FakeGitHub();
    const number = seed(github, bodyOf([rowBlock(inSync("db"))]));

    await swapRows(writerFor(github), number, rows([deploying("app")]));

    const written = parseDashboard(github.issue(number).body).rows;
    expect(written.map(({ stackId }) => stackId).sort()).toEqual(["app", "db"]);
  });

  test("a carried block the writer hands back takes the place of the live one", async () => {
    const github = new FakeGitHub();
    const number = seed(github, bodyOf([rowBlock(inSync("app")), rowBlock(inSync("db"))]));
    const replaced = rowBlock({ ...inSync("db"), dependsOn: ["app"] });

    await swapRows(writerFor(github), number, rows([], { carried: new Map([["db", replaced]]) }));

    const written = parseDashboard(github.issue(number).body).rows;
    expect(written.find((row) => row.stackId === "db")?.text).toBe(replaced.text);
  });

  test("the rows are made again at the late read of every try", async () => {
    const github = new FakeGitHub();
    const number = seed(github, bodyOf([rowBlock(inSync("app"))]));
    // Another writer adds a row right after the first update, before the
    // read back.
    const bodies = [bodyOf([rowBlock(inSync("app")), rowBlock(inSync("db"))])];
    let armed = false;
    github.onRequest = (request) => {
      const body = armed ? bodies.shift() : undefined;
      if (body !== undefined) github.editBody(number, body);
      armed = request === "updateIssueBody";
    };
    const seen: string[][] = [];

    const answer = await swapRows(writerFor(github), number, async (live: LiveDashboard) => {
      seen.push([...live.first.keys()]);
      return { facts: NO_TRAIL, rows: new Map([["app", deploying("app")]]) };
    });

    expect(seen).toEqual([["app"], ["app", "db"]]);
    expect(answer).toMatchObject({ fits: true, tries: 2 });
    expect(parseDashboard(github.issue(number).body).rows.map(({ stackId }) => stackId)).toEqual([
      "app",
      "db",
    ]);
  });

  test("the trail is drawn from the deployment records it hands over", async () => {
    const github = new FakeGitHub();
    const number = seed(github, bodyOf([rowBlock(inSync("app"))]));

    await swapRows(
      writerFor(github),
      number,
      rows([], {
        facts: {
          trail: [
            {
              stackId: "app",
              ticker: "octocat",
              run: "39",
              at: new Date("2026-09-19T08:00:00Z"),
            },
          ],
        },
      }),
    );

    expect(github.issue(number).body).toContain(`[run](${REPO}/actions/runs/39)`);
  });

  test("a body of another marker version is left alone and the rows are never asked for", async () => {
    const github = new FakeGitHub();
    const old = bodyOf([rowBlock(inSync("app"))]).replace('v="1"', 'v="0"');
    const number = seed(github, old);
    const lines: string[] = [];
    let asked = false;

    const answer = await swapRows(writerFor(github, lines), number, async () => {
      asked = true;
      return { facts: NO_TRAIL, rows: new Map() };
    });

    expect(asked).toBe(false);
    expect(github.issue(number).body).toBe(old);
    expect(answer).toMatchObject({ fits: true, written: false });
    expect(lines).toEqual([
      "The live body is not one this version can write again. It is left alone.",
    ]);
  });

  // Slice 5.17 (record 0081): only a scan draws the lines of the updates
  // waiting on their checks, so a swap carries them as they stand.
  test("the lines of updates waiting on their checks are carried as they stand", async () => {
    const github = new FakeGitHub();
    const line = waitingBlock({
      pr: 1137,
      stackIds: ["app"],
      title: "Bump",
      author: "renovate[bot]",
    });
    const number = seed(
      github,
      renderBody({
        root: ROOT,
        rows: [rowBlock(inSync("app"))],
        recentlyDeployed: [],
        repoUrl: REPO,
        actionRef: "v1.0.0",
        personality: true,
        waiting: [line],
      }),
    );

    await swapRows(writerFor(github), number, rows([deploying("app")]));

    expect(parseDashboard(github.issue(number).body).waiting).toEqual([line]);
  });

  test("a body that does not fit is an answer, and nothing is written", async () => {
    const github = new FakeGitHub();
    const live = bodyOf([rowBlock(inSync("app"))]);
    const number = seed(github, live);
    const writer = { ...writerFor(github), budget: { limit: 100 } };

    const answer = await swapRows(writer, number, rows([deploying("app")]));

    expect(answer).toMatchObject({ fits: false });
    expect(answer.fits ? 0 : answer.size).toBeGreaterThan(100);
    expect(github.issue(number).body).toBe(live);
    expect(github.requests).toEqual(["getIssue"]);
  });
});

describe("the write of a scan", () => {
  const scanRows = (
    entries: (InSyncRow | DeployingRow)[],
    more: Partial<ScanRows> = {},
  ): ScanRows => ({
    root: ROOT,
    facts: NO_TRAIL,
    rows: new Map(entries.map((row) => [row.stackId, row])),
    merges: [],
    waiting: [],
    outside: [],
    ...more,
  });

  test("it creates the dashboard, and writes the rows it hands over and nothing else", async () => {
    const github = new FakeGitHub();
    const seen: string[] = [];

    const answer = await writeScan(writerFor(github), true, async (live) => {
      seen.push(live.body);
      return scanRows([inSync("app"), deploying("db")]);
    });

    expect(seen[0]).toBe("");
    expect(answer).toMatchObject({
      fits: true,
      found: "created",
      header: "deploying",
      counts: { deploying: 1, inSync: 1 },
    });
    if (!answer.fits) return;
    expect(
      parseDashboard(github.issue(answer.number).body).rows.map(({ stackId }) => stackId),
    ).toEqual(["db", "app"]);
  });

  test("a live row it does not hand over is dropped, and one it carries stays byte for byte", async () => {
    const github = new FakeGitHub();
    const carried = rowBlock(inSync("app"));
    const number = seed(github, bodyOf([carried, rowBlock(inSync("gone"))]));

    await writeScan(writerFor(github), false, async (live) =>
      scanRows([], { carried: new Map([["app", live.first.get("app") as ParsedRow]]) }),
    );

    const written = parseDashboard(github.issue(number).body).rows;
    expect(written.map(({ text }) => text)).toEqual([carried.text]);
  });

  test("it writes the lines of updates waiting on their checks it hands over, and no live ones", async () => {
    const github = new FakeGitHub();
    const line = (pr: number) =>
      waitingBlock({ pr, stackIds: ["app"], title: "Bump", author: "renovate[bot]" });
    const number = seed(
      github,
      renderBody({
        root: ROOT,
        rows: [rowBlock(inSync("app"))],
        recentlyDeployed: [],
        repoUrl: REPO,
        actionRef: "v1.0.0",
        personality: true,
        waiting: [line(1137)],
      }),
    );

    await writeScan(writerFor(github), true, async () =>
      scanRows([inSync("app")], { waiting: [line(1140)] }),
    );

    expect(parseDashboard(github.issue(number).body).waiting).toEqual([line(1140)]);
  });

  test("it knows whether the live body is of this version", async () => {
    const github = new FakeGitHub();
    seed(github, bodyOf([rowBlock(inSync("app"))]).replace('v="1"', 'v="0"'));
    const current: boolean[] = [];

    await writeScan(writerFor(github), true, async (live) => {
      current.push(live.current);
      return scanRows([inSync("app")]);
    });

    expect(current[0]).toBe(false);
  });

  test("a body that does not fit is an answer, and nothing is created", async () => {
    const github = new FakeGitHub();
    const writer = { ...writerFor(github), budget: { limit: 100 } };

    const answer = await writeScan(writer, true, async () => scanRows([inSync("app")]));

    expect(answer).toMatchObject({ fits: false });
    expect(github.requests).not.toContain("createIssue");
  });

  test("its body can be measured without a request", () => {
    const github = new FakeGitHub();

    const fitted = fitScan(writerFor(github), true, scanRows([inSync("app")]));

    expect(fitted.fits).toBe(true);
    expect(fitted.rows.map(({ stackId }) => stackId)).toEqual(["app"]);
    expect(github.requests).toEqual([]);
  });
});
