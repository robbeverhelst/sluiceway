import { describe, expect, test } from "bun:test";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { change, dashboardBody, harness, inSync, pending, tableAdapter } from "./harness.ts";

// Slice 5.17 (record 0081, issue 170): a pull request that qualifies in every
// way but its checks, which have not all finished, gets a line with no box
// under the merge section. One whose checks failed, or that would never
// qualify, keeps only its line in the job log.

const CONFIG = "mergeAndDeploy:\n  authors:\n    - renovate[bot]\n";
const HEAD = "4444444444444444444444444444444444444444";

const TABLE = {
  "a:prod": inSync("a:prod"),
  "b:prod": inSync("b:prod"),
  "c:prod": pending("c:prod", change("logs")),
};

function section(body: string): string {
  const heading = "## Updates waiting to merge";
  const from = body.indexOf(heading);
  if (from < 0) return "";
  const rest = body.slice(from + heading.length);
  return rest.slice(0, rest.indexOf("\n## ")).trim();
}

const WAITING_LINE =
  '- **a:prod** · Update Helm release odoo to v17.0.4 · #1137 by renovate&#91;bot&#93; · waits on its checks <!-- sluiceway:waiting pr="1137" stack="a:prod" -->';

describe("an update waiting on its checks", () => {
  test("gets a line with no box under the merge section, and no merge row", async () => {
    const { context, github, log } = harness(tableAdapter(TABLE), { config: CONFIG });
    github.seedOpenPullRequest({
      number: 1137,
      head: HEAD,
      title: "Update Helm release odoo to v17.0.4",
      files: ["a/values.yaml"],
      checks: "pending",
    });

    await scan(context);

    const body = dashboardBody(github);
    expect(section(body)).toBe(
      [
        "These wait on their own checks. Each gets a box here once its checks are green.",
        "",
        WAITING_LINE,
      ].join("\n"),
    );
    expect(parseDashboard(body).merges).toEqual([]);
    expect(log.lines).toContain(
      "#1137 is not listed to merge yet: its checks have not all finished. Its line has no box until they are green.",
    );
    expect(log.lines).toContain("No pull request waits to merge.");
  });

  test("becomes a merge row with a box once its checks are green", async () => {
    const { context, github } = harness(tableAdapter(TABLE), { config: CONFIG });
    const seed = { number: 1137, head: HEAD, files: ["a/values.yaml"] };
    github.seedOpenPullRequest({ ...seed, checks: "pending" });
    await scan(context);

    github.seedOpenPullRequest({ ...seed, checks: "success" });
    await scan(context);

    const live = parseDashboard(dashboardBody(github));
    expect(live.waiting).toEqual([]);
    expect(live.merges.map(({ pr, ticked }) => [pr, ticked])).toEqual([[1137, false]]);
    expect(dashboardBody(github)).not.toContain("These wait on their own checks");
  });

  test("goes when its checks fail, and the job log keeps its line", async () => {
    const { context, github, log } = harness(tableAdapter(TABLE), { config: CONFIG });
    const seed = { number: 1137, head: HEAD, files: ["a/values.yaml"] };
    github.seedOpenPullRequest({ ...seed, checks: "pending" });
    await scan(context);

    github.seedOpenPullRequest({ ...seed, checks: "failure" });
    await scan(context);

    expect(dashboardBody(github)).not.toContain("## Updates waiting to merge");
    expect(log.lines).toContain("#1137 is not listed to merge: its checks are not all green.");
  });

  test("goes when it stops qualifying while it waits", async () => {
    const { context, github } = harness(tableAdapter(TABLE), { config: CONFIG });
    const seed = { number: 1137, head: HEAD, files: ["a/values.yaml"], checks: "pending" as const };
    github.seedOpenPullRequest(seed);
    await scan(context);
    expect(parseDashboard(dashboardBody(github)).waiting).toHaveLength(1);

    // A new commit on its branch touches a file no stack claims.
    github.seedOpenPullRequest({ ...seed, files: ["a/values.yaml", "package.json"] });
    await scan(context);

    expect(dashboardBody(github)).not.toContain("## Updates waiting to merge");
  });

  test("names every stack of a pull request that two stacks claim, as a merge row would", async () => {
    const { context, github } = harness(tableAdapter(TABLE), { config: CONFIG });
    github.seedOpenPullRequest({ number: 7, files: ["a/x.ts", "b/x.ts"], checks: "pending" });

    await scan(context);

    expect(parseDashboard(dashboardBody(github)).waiting.map(({ stackIds }) => stackIds)).toEqual([
      ["a:prod", "b:prod"],
    ]);
  });

  test("is not shown for one whose checks failed or that would never qualify", async () => {
    const { context, github, log } = harness(tableAdapter(TABLE), { config: CONFIG });
    github.seedOpenPullRequest({ number: 1, files: ["a/x.ts"], checks: "failure" });
    github.seedOpenPullRequest({
      number: 2,
      files: ["a/x.ts"],
      checks: "pending",
      author: "alice",
    });
    github.seedOpenPullRequest({ number: 3, files: ["package.json"], checks: "pending" });
    github.seedOpenPullRequest({ number: 4, files: ["README.md"], checks: "pending" });
    github.seedOpenPullRequest({ number: 5, files: ["a/x.ts"], checks: "none" });

    await scan(context);

    // The section stays quiet when nothing at all waits.
    expect(dashboardBody(github)).not.toContain("## Updates waiting to merge");
    expect(log.lines).toContain("#1 is not listed to merge: its checks are not all green.");
    expect(log.lines).toContain("#3 is not listed to merge: no stack claims some of its files.");
    expect(log.lines).toContain("#5 is not listed to merge: its checks are not all green.");
    expect(log.lines.filter((line) => line.startsWith("#2 "))).toEqual([]);
  });

  test("counts toward none of the section's numbers: not the fold, not the updates waiting to merge", async () => {
    const { context, github, log } = harness(tableAdapter(TABLE), { config: CONFIG });
    for (let number = 401; number <= 410; number++) {
      github.seedOpenPullRequest({ number, files: ["a/values.yaml"] });
    }
    github.seedOpenPullRequest({ number: 411, files: ["a/values.yaml"], checks: "pending" });

    await scan(context);

    const body = dashboardBody(github);
    expect(body).not.toContain("more update");
    expect(parseDashboard(body).merges).toHaveLength(10);
    expect(parseDashboard(body).waiting.map(({ pr }) => pr)).toEqual([411]);
    expect(log.lines).toContain(
      "10 pull requests wait to merge: #401, #402, #403, #404, #405, #406, #407, #408, #409, #410.",
    );
    expect(log.lines).toContain("1 pull request waits on its checks: #411.");
  });

  test("lists the oldest ten, and the job log names the rest", async () => {
    const { context, github, log } = harness(tableAdapter(TABLE), { config: CONFIG });
    for (let number = 501; number <= 512; number++) {
      github.seedOpenPullRequest({ number, files: ["a/values.yaml"], checks: "pending" });
    }

    await scan(context);

    expect(parseDashboard(dashboardBody(github)).waiting.map(({ pr }) => pr)).toEqual([
      501, 502, 503, 504, 505, 506, 507, 508, 509, 510,
    ]);
    expect(log.lines).toContain(
      "2 more pull requests wait on their checks and are not listed: #511, #512.",
    );
  });

  test("leaves the title out on a redacted dashboard", async () => {
    const { context, github } = harness(tableAdapter(TABLE), {
      config: `${CONFIG}dashboard:\n  redact: true\n`,
    });
    github.seedOpenPullRequest({ number: 1137, files: ["a/values.yaml"], checks: "pending" });

    await scan(context);

    expect(parseDashboard(dashboardBody(github)).waiting[0]?.text).toBe(
      '- **a:prod** · #1137 by renovate&#91;bot&#93; · waits on its checks <!-- sluiceway:waiting pr="1137" stack="a:prod" -->',
    );
  });

  test("is not shown on a read-only dashboard or while deploys are off", async () => {
    for (const extra of ["dashboard:\n  readOnly: true\n", "deploys: false\n"]) {
      const { context, github } = harness(tableAdapter(TABLE), { config: `${CONFIG}${extra}` });
      github.seedOpenPullRequest({ number: 1137, files: ["a/values.yaml"], checks: "pending" });

      await scan(context);

      expect(dashboardBody(github)).not.toContain("## Updates waiting to merge");
    }
  });

  test("a list that cannot be read keeps the live lines", async () => {
    const { context, github } = harness(tableAdapter(TABLE), { config: CONFIG });
    github.seedOpenPullRequest({ number: 1137, files: ["a/values.yaml"], checks: "pending" });
    await scan(context);
    const before = parseDashboard(dashboardBody(github)).waiting;
    github.listOpenPullRequests = async () => {
      throw new Error("Resource not accessible by integration");
    };

    await scan(context);

    expect(parseDashboard(dashboardBody(github)).waiting).toEqual(before);
  });
});
