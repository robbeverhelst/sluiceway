import { describe, expect, test } from "bun:test";
import { diffHash } from "../../src/core/diff-hash.ts";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { renderMergeRow } from "../../src/render/merge-row.ts";
import { BOT } from "../fake-github/fake-github.ts";
import {
  change,
  dashboardBody,
  failing,
  harness,
  inSync,
  pending,
  RUN_ID,
  RUN_URL,
  SHA,
  tableAdapter,
} from "./harness.ts";
import { rememberingOutputs } from "./outputs-harness.ts";

// Slice 4.2 (record 0054): the scan lists the updates waiting to merge, and
// the scan after a merge hands the fresh diff of the stack to `apply`.

const CONFIG = "mergeAndDeploy:\n  authors:\n    - renovate[bot]\n";
const HEAD = "4444444444444444444444444444444444444444";
const MERGED = "5555555555555555555555555555555555555555";

const TABLE = {
  "a:prod": inSync("a:prod"),
  "b:prod": inSync("b:prod"),
  "c:prod": pending("c:prod", change("logs")),
};

function section(body: string, heading: string): string {
  const from = body.indexOf(`## ${heading}`);
  if (from < 0) return "";
  const rest = body.slice(from + heading.length + 3);
  const to = rest.search(/\n(## |---)/);
  return (to < 0 ? rest : rest.slice(0, to)).trim();
}

function rows(body: string): Record<string, { state: string; text: string }> {
  return Object.fromEntries(
    parseDashboard(body).rows.map((row) => [row.stackId, { state: row.state, text: row.text }]),
  );
}

describe("the updates waiting to merge", () => {
  test("lists a qualifying pull request above Pending, with its bump and a box", async () => {
    const { context, github } = harness(tableAdapter(TABLE), { config: CONFIG });
    github.seedOpenPullRequest({
      number: 418,
      head: HEAD,
      title: "Update Helm release odoo to v17.0.4",
      files: ["a/values.yaml"],
    });

    await scan(context);

    const body = dashboardBody(github);
    expect(body.indexOf("## Updates waiting to merge")).toBeLessThan(body.indexOf("## Pending"));
    expect(section(body, "Updates waiting to merge")).toBe(
      [
        "Tick a box to merge that pull request. Its stack is then previewed again and deployed as that preview shows it.",
        "",
        `- [ ] **a:prod** · Update Helm release odoo to v17.0.4 · #418 by renovate&#91;bot&#93; <!-- sluiceway:merge pr="418" stack="a:prod" head="${HEAD}" -->`,
      ].join("\n"),
    );
  });

  test("leaves out what does not qualify, and the job log says why", async () => {
    const { context, github, log } = harness(tableAdapter(TABLE), { config: CONFIG });
    github.seedOpenPullRequest({ number: 1, files: ["a/x.ts"], checks: "failure" });
    github.seedOpenPullRequest({ number: 2, files: ["a/x.ts", "b/x.ts"] });
    github.seedOpenPullRequest({ number: 3, files: ["a/x.ts"], author: "alice" });
    github.seedOpenPullRequest({ number: 4, files: ["package.json"] });

    await scan(context);

    expect(parseDashboard(dashboardBody(github)).merges).toEqual([]);
    expect(dashboardBody(github)).not.toContain("Updates waiting to merge");
    expect(log.lines).toContain("#1 is not listed to merge: its checks are not all green.");
    expect(log.lines).toContain("#2 is not listed to merge: more than one stack claims its files.");
    expect(log.lines).toContain("#4 is not listed to merge: no stack claims some of its files.");
    // A pull request by someone who is not on the list is not worth a line.
    expect(log.lines.filter((line) => line.startsWith("#3 "))).toEqual([]);
  });

  test("costs no request when mergeAndDeploy names no authors", async () => {
    const { context, github } = harness(tableAdapter(TABLE));
    github.seedOpenPullRequest({ number: 418, files: ["a/values.yaml"] });

    await scan(context);

    expect(github.requests).not.toContain("listOpenPullRequests");
    expect(dashboardBody(github)).not.toContain("Updates waiting to merge");
  });

  test("is not listed on a read-only dashboard or while deploys are off", async () => {
    for (const extra of ["dashboard:\n  readOnly: true\n", "deploys: false\n"]) {
      const { context, github } = harness(tableAdapter(TABLE), { config: `${CONFIG}${extra}` });
      github.seedOpenPullRequest({ number: 418, files: ["a/values.yaml"] });

      await scan(context);

      expect(github.requests).not.toContain("listOpenPullRequests");
      expect(dashboardBody(github)).not.toContain("Updates waiting to merge");
    }
  });

  test("leaves the title out on a redacted dashboard", async () => {
    const { context, github } = harness(tableAdapter(TABLE), {
      config: `${CONFIG}dashboard:\n  redact: true\n`,
    });
    github.seedOpenPullRequest({ number: 418, head: HEAD, files: ["a/values.yaml"] });

    await scan(context);

    expect(parseDashboard(dashboardBody(github)).merges[0]?.text).toBe(
      `- [ ] **a:prod** · #418 by renovate&#91;bot&#93; <!-- sluiceway:merge pr="418" stack="a:prod" head="${HEAD}" -->`,
    );
  });

  test("a list that cannot be read keeps the live rows and never fails the scan", async () => {
    const { context, github, log } = harness(tableAdapter(TABLE), { config: CONFIG });
    github.seedOpenPullRequest({ number: 418, head: HEAD, files: ["a/values.yaml"] });
    await scan(context);
    const before = parseDashboard(dashboardBody(github)).merges;
    github.listOpenPullRequests = async () => {
      throw new Error("Resource not accessible by integration");
    };

    await scan(context);

    expect(parseDashboard(dashboardBody(github)).merges).toEqual(before);
    expect(log.lines).toContain(
      "The open pull requests could not be read: Resource not accessible by integration. The updates waiting to merge are kept as they were. The scan job needs the permission `pull-requests: read` (record 0054).",
    );
  });

  test("a ticked row keeps its tick while a resolve run is on its way, and is cleared when none is", async () => {
    for (const waits of [true, false]) {
      const { context, github } = harness(tableAdapter(TABLE), { config: CONFIG });
      github.seedOpenPullRequest({ number: 418, head: HEAD, files: ["a/values.yaml"] });
      await scan(context);
      const body = dashboardBody(github);
      github.editBody(1, body.replace(/^- \[ \] (.*sluiceway:merge)/m, "- [x] $1"));
      if (waits) github.seedIssuesRun("sluiceway.yml", { id: "99", completed: false });

      await scan(context);

      expect(parseDashboard(dashboardBody(github)).merges.map(({ ticked }) => ticked)).toEqual([
        waits,
      ]);
    }
  });
});

// The record `resolve` opened when it merged #418 (record 0054).
function seedMergeRecord(github: ReturnType<typeof harness>["github"], sha = MERGED) {
  github.seedRun("5151", { completed: true });
  // The scan's own run, which a record it opens lives as long as.
  github.seedRun(RUN_ID, { completed: false });
  return github.seedDeployment({
    task: "sluiceway:a:prod",
    sha,
    payload: { v: 1, ticker: "alice", run: "5151", merge: 418 },
    status: { state: "queued" },
  });
}

describe("the scan after a merge", () => {
  test("opens a record for the fresh diff, ends the merge record and hands the new one to apply", async () => {
    const diff = pending("a:prod", change("release"));
    const outputs = rememberingOutputs();
    const { context, github } = harness(tableAdapter({ ...TABLE, "a:prod": diff }), {
      config: CONFIG,
      outputs,
    });
    github.seedComparison(MERGED, SHA, { status: "ahead", files: [] });
    const merge = seedMergeRecord(github);

    await scan(context);

    expect(github.deployment(merge.id).status).toMatchObject({
      state: "inactive",
      description: "merged, the deploy follows in a record of its own",
    });
    const handedOn = github.deployment(merge.id + 1);
    expect(handedOn).toMatchObject({
      task: "sluiceway:a:prod",
      environment: "sluiceway",
      sha: SHA,
      payload: {
        v: 1,
        hash: diff.ok ? diffHash(diff.diff) : "",
        ticker: "alice",
        run: RUN_ID,
      },
      status: { state: "queued" },
    });
    expect(JSON.parse(outputs.values.matrix ?? "")).toEqual([
      { stack: "a:prod", environment: "sluiceway", deployment: handedOn.id },
    ]);
    expect(rows(dashboardBody(github))["a:prod"]?.text.split("\n")[0]).toBe(
      `- **a:prod** · waiting to start · ticked by alice · [run](${RUN_URL}) <!-- sluiceway:row stack="a:prod" state="deploying" -->`,
    );
  });

  test("the matrix is set before the dashboard is written, and is [] on a scan with nothing to hand on", async () => {
    const outputs = rememberingOutputs();
    const { context } = harness(tableAdapter(TABLE), { config: CONFIG, outputs });

    await scan(context);

    expect(outputs.values.matrix).toBe("[]");
  });

  test("with nothing to deploy after the merge, the merge record ends as in sync", async () => {
    const { context, github } = harness(tableAdapter(TABLE), { config: CONFIG });
    github.seedComparison(MERGED, SHA, { status: "ahead", files: [] });
    const merge = seedMergeRecord(github);

    await scan(context);

    expect(github.deployment(merge.id).status).toMatchObject({
      state: "success",
      description: "nothing to deploy, already in sync",
    });
    expect(github.requests.filter((request) => request === "createDeployment")).toEqual([]);
    expect(rows(dashboardBody(github))["a:prod"]?.state).toBe("in-sync");
  });

  test("a preview that fails after the merge ends the merge record as failed, with the reason", async () => {
    const { context, github } = harness(tableAdapter({ ...TABLE, "a:prod": failing() }), {
      config: CONFIG,
    });
    github.seedComparison(MERGED, SHA, { status: "ahead", files: [] });
    const merge = seedMergeRecord(github);

    await scan(context);

    expect(github.deployment(merge.id).status).toMatchObject({
      state: "failure",
      description:
        "the preview before the deploy failed: the tool exited with an error (exit code 255)",
    });
    expect(rows(dashboardBody(github))["a:prod"]?.state).toBe("preview-failed");
  });

  test("while deploys are off, the merge record ends as failed and nothing is handed on", async () => {
    const { context, github } = harness(
      tableAdapter({ ...TABLE, "a:prod": pending("a:prod", change("x")) }),
      {
        config: `${CONFIG}deploys: false\n`,
      },
    );
    github.seedComparison(MERGED, SHA, { status: "ahead", files: [] });
    const merge = seedMergeRecord(github);

    await scan(context);

    expect(github.deployment(merge.id).status).toMatchObject({
      state: "failure",
      description: "deploys are turned off in sluiceway.yaml",
    });
    expect(rows(dashboardBody(github))["a:prod"]?.state).toBe("pending");
  });

  test("a scan of a commit that does not hold the merge leaves the record open and the stack deploying", async () => {
    const { context, github, log } = harness(
      tableAdapter({ ...TABLE, "a:prod": pending("a:prod", change("x")) }),
      { config: CONFIG },
    );
    github.seedComparison(MERGED, SHA, { status: "behind", files: [] });
    const merge = seedMergeRecord(github);

    await scan(context);

    expect(github.deployment(merge.id).status?.state).toBe("queued");
    expect(rows(dashboardBody(github))["a:prod"]?.state).toBe("deploying");
    expect(log.lines).toContain(
      `a:prod waits for the scan of #418: this scan checked out ${SHA.slice(0, 7)}, which does not hold the merge ${MERGED.slice(0, 7)} yet.`,
    );
  });

  test("the scan of the merge commit itself needs no comparison", async () => {
    const { context, github } = harness(
      tableAdapter({ ...TABLE, "a:prod": pending("a:prod", change("x")) }),
      { config: CONFIG },
    );
    const merge = seedMergeRecord(github, SHA);

    await scan(context);

    expect(github.requests).not.toContain("compareCommits");
    expect(github.deployment(merge.id).status?.state).toBe("inactive");
  });

  test("a narrowed scan previews the stack of a merge record, also when it claims no changed file", async () => {
    const adapter = tableAdapter({ ...TABLE, "a:prod": pending("a:prod", change("x")) });
    const { context, github } = harness(adapter, { config: CONFIG });
    await scan(context);
    const scanned = parseDashboard(dashboardBody(github)).root?.scanSha ?? "";
    const next = "6666666666666666666666666666666666666666";
    github.seedComparison(scanned, next, { status: "ahead", files: [{ path: "c/index.ts" }] });
    github.seedComparison(MERGED, next, { status: "ahead", files: [] });
    const merge = seedMergeRecord(github);
    adapter.previewed.length = 0;

    await scan({ ...context, event: "push", sha: next });

    expect(adapter.previewed.sort()).toEqual(["a:prod", "c:prod"]);
    expect(github.deployment(merge.id).status?.state).toBe("inactive");
  });

  test("ends every merge record once: a second scan finds nothing to hand on", async () => {
    const { context, github } = harness(
      tableAdapter({ ...TABLE, "a:prod": pending("a:prod", change("x")) }),
      { config: CONFIG },
    );
    github.seedComparison(MERGED, SHA, { status: "ahead", files: [] });
    seedMergeRecord(github);

    await scan(context);
    await scan(context);

    expect(github.requests.filter((request) => request === "createDeployment")).toHaveLength(1);
  });

  test("is not held to mergeAndDeploy: a record left from before it was turned off is still handed on", async () => {
    const { context, github } = harness(
      tableAdapter({ ...TABLE, "a:prod": pending("a:prod", change("x")) }),
    );
    github.seedComparison(MERGED, SHA, { status: "ahead", files: [] });
    const merge = seedMergeRecord(github);

    await scan(context);

    expect(github.deployment(merge.id).status?.state).toBe("inactive");
  });
});

// The one ticked merge row that the rest of the tests leave out: a bot edit
// with a tick is no person's tick (record 0018).
test("a merge row the bot ticked is carried like any other while a run is on its way", async () => {
  const { context, github } = harness(tableAdapter(TABLE), { config: CONFIG });
  github.seedOpenPullRequest({ number: 418, head: HEAD, files: ["a/values.yaml"] });
  await scan(context);
  const line = renderMergeRow({
    pr: 418,
    stackId: "a:prod",
    head: HEAD,
    title: "Update something (#418)",
    author: "renovate[bot]",
  });
  expect(dashboardBody(github)).toContain(line);
  github.editBody(1, dashboardBody(github).replace(line, line.replace("- [ ] ", "- [x] ")), BOT);
  github.seedIssuesRun("sluiceway.yml", { id: "99", completed: false });

  await scan(context);

  expect(parseDashboard(dashboardBody(github)).merges[0]?.ticked).toBe(true);
});
