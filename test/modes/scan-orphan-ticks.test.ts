import { describe, expect, test } from "bun:test";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import type { FakeGitHub } from "../fake-github/fake-github.ts";
import {
  change,
  dashboardBody,
  failing,
  harness,
  inSync,
  pending,
  RUN_ID,
  SHA,
  tableAdapter,
} from "./harness.ts";

// The orphan tick sweep of every scan (record 0025): a scan clears a tick
// that nothing picked up and never deploys it, and it keeps its hands off a
// tick while a run that an issue edit started is still on its way.

const OLD = "1111111111111111111111111111111111111111";
const WORKFLOW = "sluiceway.yml";
const NOTE = "  :information_source: a tick on this row was not picked up. Tick again to deploy.";

function row(github: FakeGitHub, id: string) {
  const found = parseDashboard(dashboardBody(github)).rows.find((one) => one.stackId === id);
  if (!found?.known) throw new Error(`The dashboard has no row for ${id}.`);
  return found;
}

// A person ticks the box of a row, as an edit of the issue.
function tick(github: FakeGitHub, id: string): void {
  const body = dashboardBody(github);
  const unticked = `- [ ] **${id}**`;
  if (!body.includes(unticked)) throw new Error(`The row of ${id} has no box to tick.`);
  github.editBody(1, body.replace(unticked, `- [x] **${id}**`), { login: "alice", type: "User" });
}

const TABLE = {
  "a:prod": pending("a:prod", change("logs")),
  "b:prod": inSync("b:prod"),
};

describe("a tick that nothing picked up", () => {
  test("is cleared by the next scan, which puts the note on the row and deploys nothing", async () => {
    const { context, github, log } = harness(tableAdapter(TABLE));
    await scan(context);
    tick(github, "a:prod");
    expect(row(github, "a:prod").ticked).toBe(true);

    await scan(context);

    const swept = row(github, "a:prod");
    expect(swept.ticked).toBe(false);
    expect(swept.state).toBe("pending");
    // The fixed order of record 0027: the attribution line, then the note.
    expect(swept.text.split("\n").slice(1, 3)).toEqual([
      "  not deployed from this dashboard yet",
      NOTE,
    ]);
    // A scan has no business starting a deploy.
    expect(github.requests).not.toContain("createDeployment");
    expect(github.requests).not.toContain("createDeploymentStatus");
    expect(log.lines).toContain(
      "Cleared an orphan tick on a:prod: no deployment of it is open, and no run that an issue edit started is queued or in progress. The row asks for a fresh tick.",
    );
  });

  test("the note is gone again with the scan after that", async () => {
    const { context, github } = harness(tableAdapter(TABLE));
    await scan(context);
    tick(github, "a:prod");
    await scan(context);
    await scan(context);

    expect(row(github, "a:prod").text).not.toContain("was not picked up");
    expect(row(github, "a:prod").ticked).toBe(false);
  });

  test("runs that are over, and the scan's own run, are not on their way", async () => {
    const { context, github } = harness(tableAdapter(TABLE));
    await scan(context);
    tick(github, "a:prod");
    github.seedIssuesRun(WORKFLOW, { id: "70", completed: true });
    github.seedIssuesRun(WORKFLOW, { id: RUN_ID, completed: false });
    github.seedIssuesRun("triage.yml", { id: "71", completed: false });

    await scan(context);

    expect(row(github, "a:prod").ticked).toBe(false);
    expect(row(github, "a:prod").text).toContain(NOTE);
  });

  test("a narrowed scan that had no reason to preview the stack previews it, because only a fresh row can carry the note", async () => {
    const first = harness(tableAdapter(TABLE), { sha: OLD });
    await scan(first.context);
    tick(first.github, "a:prod");
    first.github.seedComparison(OLD, SHA, { status: "ahead", files: [{ path: "b/index.ts" }] });

    const adapter = tableAdapter(TABLE);
    await scan({ ...first.context, adapter, sha: SHA, event: "push" });

    expect(adapter.previewed).toEqual(["b:prod", "a:prod"]);
    expect(row(first.github, "a:prod").ticked).toBe(false);
    expect(row(first.github, "a:prod").text).toContain(NOTE);
    expect(first.log.lines).toContain(
      "a:prod is previewed now: its row holds an orphan tick, and only a fresh row can ask for a fresh tick.",
    );
  });

  test("a fresh row without a box drops the tick with the box", async () => {
    const { context, github, log } = harness(tableAdapter(TABLE));
    await scan(context);
    tick(github, "a:prod");

    await scan({ ...context, adapter: tableAdapter({ ...TABLE, "a:prod": inSync("a:prod") }) });
    expect(row(github, "a:prod")).toMatchObject({ state: "in-sync", ticked: false });
    expect(row(github, "a:prod").text).not.toContain("was not picked up");
    expect(log.lines).toContain(
      "Cleared an orphan tick on a:prod: no deployment of it is open, and no run that an issue edit started is queued or in progress. The row has no box any more.",
    );
  });
});

describe("a waiting `resolve` run means hands off", () => {
  test("a full scan carries the tick through on its fresh row, at the same diff hash", async () => {
    const { context, github, log } = harness(tableAdapter(TABLE));
    // Without preview pages a fresh row links to its scan's summary, which is
    // how this test tells a fresh row from the old one (record 0050).
    github.withoutChecksWrite();
    await scan(context);
    tick(github, "a:prod");
    const ticked = row(github, "a:prod");
    github.seedIssuesRun(WORKFLOW, { id: "70", completed: true });
    github.seedIssuesRun(WORKFLOW, { id: "71", completed: false });

    await scan({ ...context, runId: "4300" });

    const after = row(github, "a:prod");
    expect(after.ticked).toBe(true);
    expect(after.hash).toBe(ticked.hash);
    expect(after.text).not.toContain("was not picked up");
    // The fresh row is this scan's: it links to this scan's run.
    expect(after.text).toContain("/actions/runs/4300");
    expect(log.lines).toContain(
      "Left the tick on a:prod alone: a run that an issue edit started is queued or in progress, and its `resolve` job handles every tick.",
    );
  });

  test("a narrowed scan carries the ticked row through byte for byte, and previews nothing for it", async () => {
    const first = harness(tableAdapter(TABLE), { sha: OLD });
    await scan(first.context);
    tick(first.github, "a:prod");
    const ticked = row(first.github, "a:prod").text;
    first.github.seedComparison(OLD, SHA, { status: "ahead", files: [{ path: "b/index.ts" }] });
    first.github.seedIssuesRun(WORKFLOW, { id: "71", completed: false });

    const adapter = tableAdapter(TABLE);
    await scan({ ...first.context, adapter, sha: SHA, event: "push" });

    expect(adapter.previewed).toEqual(["b:prod"]);
    expect(row(first.github, "a:prod").text).toBe(ticked);
  });

  test("a change that moved under the tick cannot carry it: the tick approved another diff hash", async () => {
    const { context, github, log } = harness(tableAdapter(TABLE));
    await scan(context);
    tick(github, "a:prod");
    const before = row(github, "a:prod").hash;
    github.seedIssuesRun(WORKFLOW, { id: "71", completed: false });

    await scan({
      ...context,
      adapter: tableAdapter({
        ...TABLE,
        "a:prod": pending("a:prod", change("logs"), change("new", "create")),
      }),
    });

    const after = row(github, "a:prod");
    expect(after.hash).not.toBe(before);
    expect(after.ticked).toBe(false);
    expect(after.text).toContain(NOTE);
    expect(log.lines).toContain(
      "Cleared the tick on a:prod: the row no longer shows what was ticked, so `resolve` has nothing to act on. The row asks for a fresh tick.",
    );
  });
});

describe("what the sweep costs and what it leaves alone", () => {
  test("a scan that meets no tick asks nothing", async () => {
    const { context, github } = harness(tableAdapter(TABLE));
    await scan(context);
    await scan(context);
    expect(github.requests).not.toContain("listIssuesRuns");
  });

  test("a scan that meets ticks asks once, however many", async () => {
    const table = { ...TABLE, "c:prod": pending("c:prod", change("cache")) };
    const { context, github } = harness(tableAdapter(table));
    await scan(context);
    tick(github, "a:prod");
    tick(github, "c:prod");
    const before = github.requests.length;

    await scan(context);

    const asked = github.requests.slice(before).filter((name) => name === "listIssuesRuns");
    expect(asked).toHaveLength(1);
    expect(row(github, "a:prod").text).toContain(NOTE);
    expect(row(github, "c:prod").text).toContain(NOTE);
  });

  test("a ticked row of a stack with an open deployment is no orphan: the row says deploying and nothing is asked", async () => {
    const { context, github } = harness(tableAdapter(TABLE));
    await scan(context);
    tick(github, "a:prod");
    github.seedDeployment({ task: "sluiceway:a:prod", status: { state: "queued" } });
    github.seedRun(RUN_ID, { completed: false });

    await scan({ ...context, runId: "4300" });

    expect(row(github, "a:prod").state).toBe("deploying");
    expect(github.requests).not.toContain("listIssuesRuns");
  });

  test("a preview failure under a tick leaves a row without a box", async () => {
    const { context, github } = harness(tableAdapter(TABLE));
    await scan(context);
    tick(github, "a:prod");

    await scan({ ...context, adapter: tableAdapter({ ...TABLE, "a:prod": failing() }) });

    expect(row(github, "a:prod")).toMatchObject({ state: "preview-failed", ticked: false });
  });

  test("when the runs cannot be read the scan fails and the body stays as it was", async () => {
    const { context, github } = harness(tableAdapter(TABLE));
    await scan(context);
    tick(github, "a:prod");
    const before = dashboardBody(github);
    github.onRequest = (request) => {
      if (request === "listIssuesRuns") throw new Error("Resource not accessible by integration");
    };

    await expect(scan(context)).rejects.toThrow(
      "The runs of sluiceway.yml that an issue edit started could not be read: Resource not accessible by integration.",
    );
    expect(dashboardBody(github)).toBe(before);
  });

  test("a body of another version is written again in this one, and its ticks are cleared with the note (record 0009)", async () => {
    const { context, github } = harness(tableAdapter(TABLE));
    await scan(context);
    tick(github, "a:prod");
    github.editBody(
      1,
      dashboardBody(github).replace('sluiceway:dashboard v="1"', 'sluiceway:dashboard v="2"'),
    );

    await scan(context);

    expect(dashboardBody(github)).toStartWith('<!-- sluiceway:dashboard v="1"');
    expect(row(github, "a:prod").ticked).toBe(false);
    expect(row(github, "a:prod").text).toContain(NOTE);
  });

  test("an orphan tick on a live row the scan keeps, because a deploy ended under its preview, waits for the next scan", async () => {
    const { context, github, log } = harness(tableAdapter(TABLE));
    await scan(context);
    // A failed deploy ended after this scan's preview started, `apply` wrote
    // the row, and a person ticked that row before the late read.
    tick(github, "a:prod");
    const kept = row(github, "a:prod").text;
    github.seedDeployment({
      task: "sluiceway:a:prod",
      createdAt: "2026-09-21T05:59:00Z",
      // The harness clock starts at 06:00:00, so this is after the preview.
      status: { state: "failure", createdAt: "2026-09-21T06:30:00Z" },
    });

    const adapter = tableAdapter(TABLE);
    await scan({ ...context, adapter });

    // Previewed once, not again for the tick: a clock that runs behind
    // GitHub's would otherwise ask for ever.
    expect(adapter.previewed).toEqual(["a:prod", "b:prod"]);
    expect(row(github, "a:prod").text).toBe(kept);
    expect(log.lines).toContain(
      "Left the orphan tick on a:prod for the next scan: the row is kept as it is, because a deploy of the stack ended after its preview started.",
    );
  });
});
