import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { PreviewResult } from "../../src/adapters/adapter.ts";
import type { ProcessRunner } from "../../src/adapters/process.ts";
import { pulumi } from "../../src/adapters/pulumi/index.ts";
import { LOOKBACK } from "../../src/core/attribution.ts";
import type { Change } from "../../src/core/diff.ts";
import { scan } from "../../src/modes/scan.ts";
import { BODY_LIMIT, BODY_TARGET } from "../../src/render/budget.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { FIXTURES, readRecording, unrecordedHistory } from "../adapters/pulumi/replay.ts";
import type { FakeGitHub } from "../fake-github/fake-github.ts";
import { rows100, stackIdOf } from "../render/fixtures.ts";
import { change, dashboardBody, failing, harness, pending, SHA, tableAdapter } from "./harness.ts";

// Build plan slice 3.1, the 100 stack run: the numbers in the records hold in
// code. The body of a 100 stack scan stays inside the size budget (record
// 0028), a scan's requests are counted against the API budget (record 0017),
// and a scan of 100 stacks with a replayed tool takes the time of its
// previews and little more (record 0012).

const BYTE_LIMIT = 262_144;

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

// The 100 stack fixture of the renderer (53 pending, three of them with 450
// deletes, 2 deploying, 2 preview failures, 43 in sync), answered by the scan
// mode's own previews.
function hundredStackTable(): Record<string, PreviewResult> {
  const table: Record<string, PreviewResult> = {};
  for (const row of rows100()) {
    const id = stackIdOf(row);
    if (row.state === "pending") table[id] = pending(id, ...row.diff.changes);
    else if (row.state === "preview-failed") table[id] = failing();
    else table[id] = pending(id);
  }
  return table;
}

// The two deploying stacks of the fixture have an open deployment, whose run
// is still going.
function seedDeploying(github: FakeGitHub): void {
  for (const row of rows100()) {
    if (row.state !== "deploying") continue;
    github.seedDeployment({ task: `sluiceway:${row.stackId}`, status: { state: "in_progress" } });
  }
  github.seedRun("4242", { completed: false });
}

describe("the body of a 100 stack scan (record 0028)", () => {
  test("a full scan of the 100 stack fixture writes a body inside the target, and every destroy is listed or counted", async () => {
    const { context, github, log } = harness(tableAdapter(hundredStackTable()));
    seedDeploying(github);

    await scan(context);

    const body = dashboardBody(github);
    expect(body.length).toBeLessThanOrEqual(BODY_TARGET);
    expect(byteLength(body)).toBeLessThanOrEqual(BYTE_LIMIT);
    const rows = parseDashboard(body).rows;
    expect(rows).toHaveLength(100);
    const counted = (state: string) => rows.filter((row) => row.state === state).length;
    expect([
      counted("pending"),
      counted("deploying"),
      counted("preview-failed"),
      counted("in-sync"),
    ]).toEqual([53, 2, 2, 43]);

    // Every pending row keeps its box and its hash, and its deletes and
    // replaces are all there or none are (records 0024 and 0028).
    const destroys = new Map(
      rows100().flatMap((row) =>
        row.state === "pending"
          ? [[row.diff.stackId, row.diff.changes.filter(isDestroy).length] as const]
          : [],
      ),
    );
    for (const row of rows) {
      if (!row.known || row.state !== "pending") continue;
      expect(row.text).toStartWith("- [ ] ");
      expect(row.hash).toMatch(/^[0-9a-f]{16}$/);
      const want = destroys.get(row.stackId) ?? 0;
      expect(row.destroys).toBe(want);
      const listed = row.text
        .split("\n")
        .filter((line) => /^\s+- :(boom|recycle):|^\s+- \*\*(delete|replace)\*\*/.test(line));
      if (row.shortened === 3 && want > 0) {
        expect(row.text).toContain("too many to list here.**");
      } else if (want > 0 && listed.length > 0) {
        expect(listed.length).toBe(want);
      }
    }

    // The three rows with 450 deletes are the ones cut to level 3.
    const levelThree = rows.filter((row) => row.known && row.shortened === 3);
    expect(levelThree.map((row) => row.stackId).sort()).toEqual(
      [...destroys]
        .filter(([, count]) => count >= 450)
        .map(([id]) => id)
        .sort(),
    );
    expect(log.lines).toContain(
      `🔴 Created the dashboard: https://github.com/acme/infra/issues/1 (${body.length.toLocaleString("en-US")} of 65,536 characters).`,
    );
  });
});

function isDestroy(change: Change): boolean {
  return change.op === "delete" || change.op === "replace";
}

// A repo of `count` stacks, each pending with deletes and updates, each last
// deployed from the dashboard at DEPLOYED, with every change since a direct
// push to one stack. The first stack was deployed 100 times since, so it
// fills the page of the environment and every other stack takes the REST fall
// back of record 0003. It is the most a scan of these stacks can cost.
const DEPLOYED = "d".repeat(40);

function stackIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `apps/service-${String(i).padStart(3, "0")}:prod`);
}

function worstCase(count: number) {
  const ids = stackIds(count);
  const table: Record<string, PreviewResult> = {};
  for (const id of ids) {
    const changes = Array.from({ length: 30 }, (_, i) =>
      change(`resource-${i}`, i % 2 === 0 ? "delete" : "update"),
    );
    table[id] = pending(id, ...changes);
  }
  const scanned = harness(tableAdapter(table));
  const { github } = scanned;

  // The history: DEPLOYED, then one direct push per commit up to the scanned
  // commit, as many as the lookback walks.
  github.seedCommit({ sha: DEPLOYED });
  let parent = DEPLOYED;
  for (let i = 1; i < LOOKBACK; i++) {
    const sha = i.toString(16).padStart(40, "a");
    github.seedCommit({
      sha,
      parents: [parent],
      files: [`${ids[i % count]?.split(":")[0]}/index.ts`],
    });
    parent = sha;
  }
  github.seedCommit({ sha: SHA, parents: [parent], files: ["apps/service-000/index.ts"] });

  const deployed = (id: string, createdAt: string) =>
    github.seedDeployment({
      task: `sluiceway:${id}`,
      sha: DEPLOYED,
      createdAt,
      status: { state: "success" },
    });
  for (const id of ids) deployed(id, "2026-09-19T08:00:00Z");
  for (let i = 0; i < 100; i++) deployed(ids[0] ?? "", "2026-09-20T08:00:00Z");
  return scanned;
}

// The first try of the write loop: find, read, the late read of the
// deployment records with its fall back, the walk and the files of direct
// pushes, write, read back. A later try starts from that read back, and the
// walk and the files are kept for the job, so it pays only for the records,
// the write and the read back. After the loop, one read of the pinned issues
// (slice 5.9).
const FIRST_TRY = 2 + 1 + 2 * 99 + 1 + LOOKBACK + 2 + 1;
const EVERY_OTHER_TRY = 1 + 2 * 99 + 2;
// The preview pages, once per scan and before the write loop (record 0050):
// one list of the commit's check runs, which holds 100 here, and one update
// per pending stack.
const PAGES = 1 + 100;

function isPageRequest(request: string): boolean {
  return request.includes("CheckRun");
}

describe("the requests of a scan, counted against the API budget (record 0017)", () => {
  test("a full scan costs the same few requests for 3 stacks as for 100, and one more per pending stack for its preview page: previews cost none", async () => {
    const counts: string[][] = [];
    for (const count of [3, 100]) {
      const table = Object.fromEntries(
        stackIds(count).map((id, i) => [id, i % 2 ? pending(id, change("x")) : pending(id)]),
      );
      const { context, github } = harness(tableAdapter(table));
      await scan(context);
      const first = [...github.requests];
      github.requests.length = 0;
      await scan(context);
      const later = [...github.requests];
      // Record 0050: one list and one write per pending stack, first a create
      // and on the same commit after that an update.
      const pendingCount = Math.floor(count / 2);
      expect(first.filter(isPageRequest)).toEqual([
        "listCheckRuns",
        ...Array(pendingCount).fill("createCheckRun"),
      ]);
      expect(later.filter(isPageRequest)).toEqual([
        "listCheckRuns",
        ...Array(pendingCount).fill("updateCheckRun"),
      ]);
      counts.push(
        first.filter((request) => !isPageRequest(request)),
        later.filter((request) => !isPageRequest(request)),
      );
    }
    const [firstOf3, laterOf3, firstOf100, laterOf100] = counts;
    expect(firstOf100).toEqual(firstOf3 ?? []);
    expect(laterOf100).toEqual(laterOf3 ?? []);
    // The first scan finds no dashboard, creates and pins it. The builder of
    // the body runs once for the create and once for the check, and each run
    // reads the deployment records (record 0004).
    expect(firstOf100).toEqual([
      "listIssues",
      "listRecentlyClosedIssues",
      "listNewestDeployments",
      "createIssue",
      "pinIssue",
      "getIssue",
      "listNewestDeployments",
    ]);
    // Every scan after it: find, read, one page of records, write, read back,
    // and the read of the pinned issues (slice 5.9).
    expect(laterOf100).toEqual([
      "listIssues",
      "getIssue",
      "listNewestDeployments",
      "updateIssueBody",
      "getIssue",
      "listPinnedIssues",
    ]);
  });

  test("the most a scan of 100 stacks can cost: two requests per pending stack off the page, one per direct push and one per preview page, below the budget", async () => {
    const { context, github } = worstCase(100);
    await scan(context);
    github.requests.length = 0;

    await scan({ ...context, sha: SHA });

    const made = (request: string) => github.requests.filter((one) => one === request).length;
    // Record 0003: one page per environment name, then two requests for a
    // pending stack that is not on it and has a record.
    expect(made("listNewestDeployments")).toBe(1);
    expect(made("newestDeploymentOfTask")).toBe(99);
    expect(made("latestDeploymentStatus")).toBe(99);
    // Record 0026: the walk once per job, and one request for each direct
    // push in range, at most the lookback.
    expect(made("walkCommits")).toBe(1);
    expect(made("listCommitFiles")).toBe(LOOKBACK);
    expect(github.requests.filter(isPageRequest)).toHaveLength(PAGES);
    expect(github.requests).toHaveLength(FIRST_TRY + PAGES);
    // Room for the two tries more that the write loop may take.
    expect(github.requests.length).toBeLessThan(1_000 - 2 * EVERY_OTHER_TRY);
  });

  for (const edits of [1, 2]) {
    test(`a write that has to be tried ${edits === 1 ? "a second time" : "a third time"} reads the deployment records again, and walks only once`, async () => {
      const { context, github } = worstCase(100);
      await scan(context);
      github.requests.length = 0;
      // Another writer edits the body between the scan's write and its read
      // back, so the write loop tries again from the read (record 0004).
      let wrote = false;
      let edited = 0;
      github.onRequest = (request) => {
        if (request === "updateIssueBody") wrote = true;
        else if (request === "getIssue" && wrote && edited < edits) {
          edited++;
          wrote = false;
          github.editBody(1, `${github.issue(1).body}\n`);
        }
      };

      await scan(context);

      const made = (request: string) => github.requests.filter((one) => one === request).length;
      expect(made("updateIssueBody")).toBe(1 + edits);
      expect(made("listNewestDeployments")).toBe(1 + edits);
      expect(made("walkCommits")).toBe(1);
      expect(made("listCommitFiles")).toBe(LOOKBACK);
      // The preview pages are written once, before the write loop.
      expect(github.requests.filter(isPageRequest)).toHaveLength(PAGES);
      expect(github.requests).toHaveLength(FIRST_TRY + PAGES + edits * EVERY_OTHER_TRY);
      // 807 at three tries, the most one scan of these stacks can cost.
      expect(github.requests.length).toBeLessThan(1_000);
    });
  }
});

describe("the point where a body of pending rows no longer fits (record 0028)", () => {
  test("100 stacks that are all pending at once, each with deletes and an attribution line, fit", async () => {
    const { context, github } = worstCase(100);
    await scan(context);
    const body = dashboardBody(github);
    expect(body.length).toBeLessThanOrEqual(BODY_LIMIT);
    const rows = parseDashboard(body).rows;
    expect(rows.filter((row) => row.state === "pending")).toHaveLength(100);
    // A level 3 row with its attribution line is about the 550 characters
    // the record counts with.
    const levelThree = rows.filter((row) => row.known && row.shortened === 3);
    expect(levelThree.length).toBeGreaterThan(0);
    const average = levelThree.reduce((sum, row) => sum + row.text.length, 0) / levelThree.length;
    expect(average).toBeGreaterThan(450);
    expect(average).toBeLessThan(650);
  });

  test("150 do not, and the scan fails before it writes, so the old body stays", async () => {
    const { context, github } = worstCase(150);
    const before = github.seedIssue({ labels: ["sluiceway"], body: "the old body" });
    await expect(scan(context)).rejects.toThrow("The dashboard does not fit in one issue.");
    expect(github.issue(before.number).body).toBe("the old body");
    expect(github.requests).not.toContain("updateIssueBody");
  });
});

// The real adapter on 100 stacks that discovery finds on disk, each answering
// with what the real CLI printed in one recorded scenario.
const VERSION = "v3.263.0";
const SCENARIOS = ["mixed", "no-changes", "update", "replace", "delete", "program-error"];

function hundredStackRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "sluiceway-hundred-"));
  for (let i = 0; i < 100; i++) {
    const dir = join(root, "stacks", `s${String(i).padStart(3, "0")}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "Pulumi.yaml"), `name: s${i}\nruntime: yaml\n`);
    writeFileSync(join(dir, "Pulumi.prod.yaml"), "config: {}\n");
  }
  return root;
}

function answer(scenario: string) {
  const [command] = readRecording(VERSION, scenario).commands;
  if (command === undefined) throw new Error(`${scenario} holds no command.`);
  const file = (name: string) => readFileSync(join(FIXTURES, VERSION, scenario, name), "utf8");
  return {
    status: "exited" as const,
    exitCode: command.exitCode,
    stdout: file(command.stdout),
    stderr: file(command.stderr),
  };
}

// Every tenth stack replays the preview of 300 resources. Each preview takes
// `milliseconds` before it answers, as a tool would.
function replayedTool(milliseconds = 0): ProcessRunner {
  const answers = new Map(
    [...SCENARIOS, "many-resources", "version"].map((name) => [name, answer(name)]),
  );
  return async (run) => {
    if (run.argv.join(" ") === "pulumi version") return answers.get("version") as never;
    const history = unrecordedHistory(VERSION, run);
    if (history) return history;
    const index = Number(basename(run.cwd).slice(1));
    const scenario =
      index % 10 === 9 ? "many-resources" : (SCENARIOS[index % SCENARIOS.length] ?? "");
    if (milliseconds > 0) await Bun.sleep(milliseconds);
    return answers.get(scenario) as never;
  };
}

describe("the time of a 100 stack scan with a replayed tool (record 0012)", () => {
  const root = hundredStackRepo();

  test("with previews that answer at once, Sluiceway's own work on 100 stacks takes a few seconds at most", async () => {
    const { context, github, log } = harness(pulumi, {
      root,
      run: replayedTool(),
      now: () => new Date(),
    });
    const started = performance.now();
    await scan(context);
    const seconds = (performance.now() - started) / 1000;

    expect(parseDashboard(dashboardBody(github)).rows).toHaveLength(100);
    expect(log.lines).toContain("Found 100 stacks.");
    // Measured at about 0.2 s on a laptop. The bound leaves room for a slow
    // runner and still catches work that grows with the square of the rows.
    expect(seconds).toBeLessThan(10);
  }, 30_000);

  test("the pool previews four at a time, so 100 previews of 40 ms take 25 rounds and not 100", async () => {
    const { context, log } = harness(pulumi, {
      root,
      run: replayedTool(40),
      now: () => new Date(),
    });
    const started = performance.now();
    await scan(context);
    const seconds = (performance.now() - started) / 1000;

    const total = log.lines.find((line) => line.startsWith("Previewed 100 stacks in "));
    expect(total).toMatch(/^Previewed 100 stacks in \d+\.\d s with a pool of 4\. Added up/);
    const pool = Number(/in (\d+\.\d) s/.exec(total ?? "")?.[1]);
    // 100 stacks divided by the pool size, times the time of one preview.
    expect(pool).toBeGreaterThanOrEqual(1.0);
    expect(pool).toBeLessThan(2.0);
    expect(seconds).toBeLessThan(100 * 0.04);
  }, 30_000);
});
