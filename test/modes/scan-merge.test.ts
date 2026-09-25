import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffHash } from "../../src/core/diff-hash.ts";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { MERGE_ORPHAN_NOTE, renderMergeRow } from "../../src/render/merge-row.ts";
import { BOT } from "../fake-github/fake-github.ts";
import {
  change,
  dashboardBody,
  drifted,
  failing,
  harness,
  inSync,
  pending,
  QUEUED_SPINNER,
  RUN_ID,
  RUN_URL,
  SHA,
  SPINNER,
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

    // #2 qualifies since slice 5.4, with both stacks.
    expect(
      parseDashboard(dashboardBody(github)).merges.map(({ pr, stackIds }) => [pr, stackIds]),
    ).toEqual([[2, ["a:prod", "b:prod"]]]);
    expect(log.lines).toContain("#1 is not listed to merge: its checks are not all green.");
    expect(log.lines).toContain("#4 is not listed to merge: no stack claims some of its files.");
    // A pull request by someone who is not on the list is not worth a line.
    expect(log.lines.filter((line) => line.startsWith("#3 "))).toEqual([]);
  });

  test("folds the updates after the first ten, at 11 updates (slice 4.13)", async () => {
    const { context, github } = harness(tableAdapter(TABLE), { config: CONFIG });
    for (let number = 401; number <= 411; number++) {
      github.seedOpenPullRequest({ number, files: ["a/values.yaml"] });
    }

    await scan(context);

    const listed = section(dashboardBody(github), "Updates waiting to merge");
    const [open = "", folded = ""] = listed.split(
      "<details><summary>1 more update waiting to merge</summary>",
    );
    expect(parseDashboard(open).merges.map(({ pr }) => pr)).toEqual([
      401, 402, 403, 404, 405, 406, 407, 408, 409, 410,
    ]);
    expect(parseDashboard(folded).merges.map(({ pr }) => pr)).toEqual([411]);
    expect(folded.trim().endsWith("</details>")).toBe(true);
  });

  test("lists every update past thirty while the body has room (slice 5.4)", async () => {
    const { context, github } = harness(tableAdapter(TABLE), { config: CONFIG });
    for (let number = 401; number <= 445; number++) {
      github.seedOpenPullRequest({ number, files: ["a/values.yaml"] });
    }

    await scan(context);

    const merges = parseDashboard(dashboardBody(github)).merges;
    expect(merges).toHaveLength(45);
    expect(dashboardBody(github)).toContain(
      "<details><summary>35 more updates waiting to merge</summary>",
    );
  });

  test("leaves the newest out when the body has no room, and the job log counts them (slice 5.4)", async () => {
    const { context, github, log } = harness(tableAdapter(TABLE), { config: CONFIG });
    for (let number = 401; number <= 460; number++) {
      github.seedOpenPullRequest({ number, files: ["a/values.yaml"] });
    }
    context.limits = { body: { target: 9_000 } };

    await scan(context);

    const merges = parseDashboard(dashboardBody(github)).merges;
    expect(merges.length).toBeGreaterThanOrEqual(30);
    expect(merges.length).toBeLessThan(60);
    expect(merges.at(-1)?.pr).toBe(400 + merges.length);
    const left = 60 - merges.length;
    expect(log.lines).toContain(
      `${left} more pull requests qualify and are not listed: the dashboard has no room for them. They are listed as the older ones merge.`,
    );
  });

  test("pages past the oldest 100 open pull requests, one request per page (slice 4.13)", async () => {
    const { context, github } = harness(tableAdapter(TABLE), { config: CONFIG });
    for (let number = 1; number <= 150; number++) {
      github.seedOpenPullRequest({
        number,
        files: ["a/values.yaml"],
        ...(number === 150 ? {} : { author: "alice" }),
      });
    }

    await scan(context);

    expect(parseDashboard(dashboardBody(github)).merges.map(({ pr }) => pr)).toEqual([150]);
    expect(github.requests.filter((request) => request === "listOpenPullRequests")).toHaveLength(2);
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

      const [merge] = parseDashboard(dashboardBody(github)).merges;
      expect(merge?.ticked).toBe(waits);
      // A cleared orphan tick says so under the row (slice 4.13).
      expect(merge?.text.split("\n")[1]).toBe(waits ? undefined : `  ${MERGE_ORPHAN_NOTE}`);
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
        // Slice 5.9: the attempt of the scan's run.
        attempt: "1",
      },
      status: { state: "queued" },
    });
    expect(JSON.parse(outputs.values.matrix ?? "")).toEqual([
      { stack: "a:prod", environment: "sluiceway", deployment: handedOn.id },
    ]);
    expect(rows(dashboardBody(github))["a:prod"]?.text.split("\n")[0]).toBe(
      `- ${SPINNER}**a:prod** · waiting to start · ticked by alice · [run](${RUN_URL}/attempts/1) <!-- sluiceway:row stack="a:prod" state="deploying" -->`,
    );
  });

  // Deploy windows (record 0104): the deploy after a merge from the dashboard
  // is the ticker's, and it waits for the window as the tick would have.
  test("outside the deploy window the record it opens waits for the window, and nothing is handed on", async () => {
    const diff = pending("a:prod", change("release"));
    const outputs = rememberingOutputs();
    const { context, github } = harness(tableAdapter({ ...TABLE, "a:prod": diff }), {
      config: `${CONFIG}dashboard:
  timeZone: Europe/Brussels
deployWindows:
  - days: [monday, tuesday, wednesday, thursday]
    from: "09:00"
    to: "17:00"
`,
      outputs,
    });
    github.seedComparison(MERGED, SHA, { status: "ahead", files: [] });
    const merge = seedMergeRecord(github);

    await scan(context);

    expect(github.deployment(merge.id).status).toMatchObject({ state: "inactive" });
    expect(github.deployment(merge.id + 1).payload).toMatchObject({
      ticker: "alice",
      run: RUN_ID,
      window: true,
    });
    expect(JSON.parse(outputs.values.matrix ?? "")).toEqual([]);
    expect(rows(dashboardBody(github))["a:prod"]?.text.split("\n")[0]).toBe(
      `- ${QUEUED_SPINNER}**a:prod** · queued for the deploy window, which opens 2026-09-21 09:00 UTC+2 · ticked by alice · [run](${RUN_URL}/attempts/1) <!-- sluiceway:row stack="a:prod" state="queued" -->`,
    );
  });

  // Deploy freezes (record 0115): merge and deploy follows the same rule, so
  // the deploy after the merge waits for the end of the freeze.
  test("during a deploy freeze the record it opens waits for the end, and nothing is handed on", async () => {
    const diff = pending("a:prod", change("release"));
    const outputs = rememberingOutputs();
    const { context, github } = harness(tableAdapter({ ...TABLE, "a:prod": diff }), {
      config: `${CONFIG}freezes:
  - from: 2026-09-20T00:00
    to: 2026-09-23T00:00
`,
      outputs,
    });
    github.seedComparison(MERGED, SHA, { status: "ahead", files: [] });
    const merge = seedMergeRecord(github);

    await scan(context);

    expect(github.deployment(merge.id + 1).payload).toMatchObject({
      ticker: "alice",
      window: true,
    });
    expect(JSON.parse(outputs.values.matrix ?? "")).toEqual([]);
    expect(rows(dashboardBody(github))["a:prod"]?.text.split("\n")[0]).toContain(
      "· queued for the end of the deploy freeze at 2026-09-23 00:00 UTC · ticked by alice ·",
    );
  });

  // Record 0055: the hash covers drift when this scan found some, so the
  // record says so and `apply` checks drift again before it compares.
  test("a record whose fresh diff holds drift says so", async () => {
    const diff = pending("a:prod", change("release"));
    const gone = change("notes", "delete");
    const { context, github } = harness(
      tableAdapter({ ...TABLE, "a:prod": diff }, {}, {}, { "a:prod": drifted("a:prod", gone) }),
      { config: `${CONFIG}drift:\n  enabled: true\n`, event: "schedule" },
    );
    github.seedComparison(MERGED, SHA, { status: "ahead", files: [] });
    const merge = seedMergeRecord(github);

    await scan(context);

    expect(github.deployment(merge.id + 1).payload).toEqual({
      v: 1,
      hash: diff.ok ? diffHash({ ...diff.diff, drift: [gone] }) : "",
      ticker: "alice",
      run: RUN_ID,
      attempt: "1",
      drift: true,
    });
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

  test("the scan resolve dispatches after a merge is narrowed to the merged files (slice 4.13)", async () => {
    const adapter = tableAdapter({ ...TABLE, "a:prod": pending("a:prod", change("release")) });
    const { context, github, log } = harness(adapter, { config: CONFIG });
    await scan(context);
    const scanned = parseDashboard(dashboardBody(github)).root?.scanSha ?? "";
    github.seedComparison(scanned, MERGED, { status: "ahead", files: [{ path: "a/values.yaml" }] });
    const merge = seedMergeRecord(github);
    adapter.previewed.length = 0;
    log.lines.length = 0;

    await scan({ ...context, event: "workflow_dispatch", sha: MERGED, afterMerge: [418] });

    expect(adapter.previewed).toEqual(["a:prod"]);
    expect(log.lines).toContain("This scan follows the merge of #418 from the dashboard.");
    expect(log.lines).toContain(
      "This is a narrowed scan: it previews 1 of 3 stacks and keeps the rows of the other 2 as they are.",
    );
    expect(github.deployment(merge.id).status?.state).toBe("inactive");
    expect(github.deployment(merge.id + 1)).toMatchObject({
      sha: MERGED,
      payload: { ticker: "alice", run: RUN_ID },
    });
  });

  test("the scan after a merge falls back to a full scan the way a push does", async () => {
    const adapter = tableAdapter(TABLE);
    const { context, github, log } = harness(adapter, { config: CONFIG });
    await scan(context);
    const scanned = parseDashboard(dashboardBody(github)).root?.scanSha ?? "";
    github.seedComparison(scanned, MERGED, { status: "diverged", files: [] });
    adapter.previewed.length = 0;
    log.lines.length = 0;

    await scan({ ...context, event: "workflow_dispatch", sha: MERGED, afterMerge: [418] });

    expect(adapter.previewed.sort()).toEqual(["a:prod", "b:prod", "c:prod"]);
    expect(
      log.lines.some((line) =>
        line.startsWith(
          "This is a full scan. The scan after a merge gives a narrowed scan, and this one fell back to a full scan: the checked-out commit does not follow",
        ),
      ),
    ).toBe(true);
  });

  test("a dispatch without the merge, such as the rescan box, stays a full scan", async () => {
    const adapter = tableAdapter(TABLE);
    const { context, github } = harness(adapter, { config: CONFIG });
    await scan(context);
    adapter.previewed.length = 0;
    github.requests.length = 0;

    await scan({ ...context, event: "workflow_dispatch", sha: MERGED, afterMerge: [] });

    expect(adapter.previewed.sort()).toEqual(["a:prod", "b:prod", "c:prod"]);
    expect(github.requests).not.toContain("compareCommits");
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
    stackIds: ["a:prod"],
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

// Slice 5.4 (record 0071): with mergeAndDeploy.preview the scan previews each
// listed update as it would be after the merge: the checkout with the files of
// the pull request's head commit in place, in a copy the scan throws away.
describe("the preview of an update's branch", () => {
  const PREVIEW = `${CONFIG}  preview: true\n`;
  const FILE = { owner: "acme", repo: "infra", path: "a/values.yaml", ref: HEAD };

  // The stack is pending when its values file holds v2, as on the branch.
  function readsValues(root: string): Record<string, unknown> {
    mkdirSync(join(root, "a"), { recursive: true });
    writeFileSync(join(root, "a/values.yaml"), "version: v1\n");
    return {
      ...TABLE,
      "a:prod": async ({ root: at }: { root: string }) =>
        existsSync(join(at, "a/values.yaml")) &&
        readFileSync(join(at, "a/values.yaml"), "utf8").includes("v2")
          ? pending("a:prod", change("chart"))
          : inSync("a:prod"),
    };
  }

  function withPreview(config = PREVIEW) {
    const runnerTemp = mkdtempSync(join(tmpdir(), "sluiceway-runner-temp-"));
    const { context, github, log } = harness(tableAdapter({}), { config });
    context.env = { ...context.env, RUNNER_TEMP: runnerTemp };
    context.adapter = tableAdapter(readsValues(context.root) as typeof TABLE);
    return { context, github, log, runnerTemp };
  }

  test("shows what the merge would change on the row, and leaves the stack's own row alone", async () => {
    const { context, github, runnerTemp } = withPreview();
    github.seedOpenPullRequest({ number: 418, head: HEAD, files: ["a/values.yaml"] });
    github.seedRepositoryFile(FILE, "version: v2\n");

    await scan(context);

    const [merge] = parseDashboard(dashboardBody(github)).merges;
    expect(merge?.text).toContain(" · preview after the merge: 1 update <!--");
    expect(rows(dashboardBody(github))["a:prod"]?.state).toBe("in-sync");
    expect(readFileSync(join(context.root, "a/values.yaml"), "utf8")).toBe("version: v1\n");
    // The copy is gone once the preview is over.
    expect(readdirSync(runnerTemp)).toEqual([]);
  });

  test("a file the pull request deletes is gone in the copy", async () => {
    const { context, github } = withPreview();
    writeFileSync(join(context.root, "a/values.yaml"), "version: v2\n");
    github.seedOpenPullRequest({ number: 418, head: HEAD, files: ["a/values.yaml"] });

    await scan(context);

    const [merge] = parseDashboard(dashboardBody(github)).merges;
    expect(merge?.text).toContain(" · preview after the merge: no changes <!--");
    expect(rows(dashboardBody(github))["a:prod"]?.state).toBe("pending");
  });

  test("a failed preview says so on the row and never fails the scan", async () => {
    const { context, github } = withPreview();
    github.seedOpenPullRequest({ number: 418, head: HEAD, files: ["a/values.yaml"] });
    github.seedRepositoryFile(FILE, "version: v2\n");
    const table = readsValues(context.root);
    context.adapter = tableAdapter({
      ...(table as typeof TABLE),
      "a:prod": async ({ root }) => (root === context.root ? inSync("a:prod") : failing()),
    });

    await scan(context);

    const [merge] = parseDashboard(dashboardBody(github)).merges;
    expect(merge?.text).toContain(" · preview after the merge: failed, the job log says why <!--");
  });

  test("is off by default: no extra preview and no file read", async () => {
    const { context, github } = withPreview(CONFIG);
    github.seedOpenPullRequest({ number: 418, head: HEAD, files: ["a/values.yaml"] });

    await scan(context);

    expect(github.requests).not.toContain("readRepositoryFile");
    expect((context.adapter as ReturnType<typeof tableAdapter>).previewed).toEqual([
      "a:prod",
      "b:prod",
      "c:prod",
    ]);
    expect(parseDashboard(dashboardBody(github)).merges[0]?.text).not.toContain("preview after");
  });

  test("never previews the branch of a fork, whose code would run with the scan's credentials", async () => {
    const { context, github, log } = withPreview();
    github.seedOpenPullRequest({
      number: 418,
      head: HEAD,
      files: ["a/values.yaml"],
      fromFork: true,
    });

    await scan(context);

    expect(github.requests).not.toContain("readRepositoryFile");
    expect(parseDashboard(dashboardBody(github)).merges[0]?.text).not.toContain("preview after");
    expect(log.lines).toContain(
      "#418 is not previewed: its branch lives in a fork, and its code would run with the credentials of this job.",
    );
  });

  test("previews each stack of an update that two stacks claim", async () => {
    const { context, github } = withPreview();
    github.seedOpenPullRequest({ number: 418, head: HEAD, files: ["a/values.yaml", "b/x.yaml"] });
    github.seedRepositoryFile(FILE, "version: v2\n");
    github.seedRepositoryFile({ ...FILE, path: "b/x.yaml" }, "x\n");

    await scan(context);

    expect(parseDashboard(dashboardBody(github)).merges[0]?.text).toContain(
      " · preview after the merge: a:prod 1 update; b:prod no changes <!--",
    );
  });

  test("previews the oldest thirty updates and no more", async () => {
    const { context, github } = withPreview();
    for (let number = 401; number <= 432; number++) {
      github.seedOpenPullRequest({ number, head: HEAD, files: ["a/values.yaml"] });
    }
    github.seedRepositoryFile(FILE, "version: v2\n");

    await scan(context);

    const merges = parseDashboard(dashboardBody(github)).merges;
    expect(merges.filter(({ text }) => text.includes("preview after"))).toHaveLength(30);
    expect(merges.at(-1)?.text).not.toContain("preview after");
  });
});
