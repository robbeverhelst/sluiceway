import { describe, expect, test } from "bun:test";
import { DashboardWriteError } from "../../src/github/write-loop.ts";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { BOT, FakeGitHub } from "../fake-github/fake-github.ts";
import {
  change,
  dashboardBody,
  harness,
  inSync,
  pending,
  REPO_URL,
  SHA,
  tableAdapter,
} from "./harness.ts";

// The scan and attribution (record 0026): a row says which merges made it
// pending, and never blocks.

const DEPLOYED = "1111111111111111111111111111111111111111";
const BETWEEN = "2222222222222222222222222222222222222222";
const COMPARE = `[compare](${REPO_URL}/compare/111111111111...0123456789ab)`;

// The lines of a stack's row block under its first line, without the indent.
function under(github: FakeGitHub, stackId: string): string[] {
  const row = parseDashboard(dashboardBody(github)).rows.find((one) => one.stackId === stackId);
  return (row?.text.split("\n") ?? []).slice(1).map((line) => line.trim());
}

function succeeded(github: FakeGitHub, stackId: string, sha = DEPLOYED, createdAt?: string): void {
  github.seedDeployment({
    task: `sluiceway:${stackId}`,
    sha,
    status: { state: "success" },
    ...(createdAt === undefined ? {} : { createdAt }),
  });
}

// main: the deployed commit, then pull request 3 squashed onto it, which is
// the commit the scan checked out.
function merged(github: FakeGitHub, files: string[], author = "alice"): void {
  github.seedCommit({ sha: DEPLOYED });
  github.seedCommit({ sha: SHA, parents: [DEPLOYED] });
  github.seedPullRequest({ number: 3, title: "Grafana alerts", author, files, commits: [SHA] });
}

describe("a pending row", () => {
  test("names the pull request its stack claims since its last successful deploy, on the line under the first", async () => {
    const adapter = tableAdapter({
      "a:prod": pending("a:prod", change("logs")),
      "b:prod": pending("b:prod", change("logs")),
    });
    const { context, github } = harness(adapter);
    merged(github, ["a/index.ts"]);
    succeeded(github, "a:prod");
    succeeded(github, "b:prod");

    await scan(context);

    expect(under(github, "a:prod")[0]).toBe(`from #3 by alice · ${COMPARE}`);
    // Pull request 3 cannot reach b:prod under the claim rule.
    expect(under(github, "b:prod")[0]).toBe(
      `nothing this stack claims has changed since its last deploy · ${COMPARE}`,
    );
  });

  test("of a stack with no successful deployment record says so, and costs no request", async () => {
    const { context, github } = harness(tableAdapter({ "a:prod": pending("a:prod", change("x")) }));
    merged(github, ["a/index.ts"]);

    await scan(context);

    expect(under(github, "a:prod")[0]).toBe("not deployed from this dashboard yet");
    expect(github.requests).not.toContain("walkCommits");
  });

  test("starts at the last success, also when a newer deploy failed", async () => {
    const { context, github } = harness(tableAdapter({ "a:prod": pending("a:prod", change("x")) }));
    merged(github, ["a/index.ts"]);
    succeeded(github, "a:prod", DEPLOYED, "2026-09-20T08:00:00Z");
    github.seedDeployment({
      task: "sluiceway:a:prod",
      sha: SHA,
      createdAt: "2026-09-20T09:00:00Z",
      status: { state: "failure", description: "the deploy failed" },
    });

    await scan(context);

    const [attribution, failure] = under(github, "a:prod");
    expect(attribution).toBe(`from #3 by alice · ${COMPARE}`);
    expect(failure).toStartWith(":x: last deploy failed: the deploy failed · ticked by alice");
  });

  test("counts a change to a file no stack claims, and uses the stack's inputs like the narrowed scan does", async () => {
    const adapter = tableAdapter({
      "a:prod": pending("a:prod", change("x")),
      "b:prod": pending("b:prod", change("x")),
    });
    const { context, github } = harness(adapter, {
      config: "stacks:\n  - path: b\n    inputs: ['shared/**']\n",
    });
    github.seedCommit({ sha: DEPLOYED });
    github.seedCommit({ sha: BETWEEN, parents: [DEPLOYED] });
    github.seedCommit({ sha: SHA, parents: [BETWEEN] });
    github.seedPullRequest({ number: 4, author: "carol", files: ["bun.lock"], commits: [BETWEEN] });
    github.seedPullRequest({
      number: 5,
      author: "renovate[bot]",
      files: ["shared/labels.ts"],
      commits: [SHA],
    });
    succeeded(github, "a:prod");
    succeeded(github, "b:prod");

    await scan(context);

    expect(under(github, "a:prod")[0]).toBe(`from 1 change outside this stack · ${COMPARE}`);
    expect(under(github, "b:prod")[0]).toBe(
      `from #5 by renovate&#91;bot&#93;, and 1 change outside this stack · ${COMPARE}`,
    );
  });
});

describe("a direct push", () => {
  test("costs one request for its files, and only when it is in the range of a row", async () => {
    const adapter = tableAdapter({
      "a:prod": pending("a:prod", change("x")),
      "b:prod": inSync("b:prod"),
    });
    const { context, github } = harness(adapter);
    github.seedCommit({ sha: "0".repeat(40), files: ["a/ancient.ts"] });
    github.seedCommit({ sha: DEPLOYED, parents: ["0".repeat(40)], files: ["a/old.ts"] });
    github.seedCommit({ sha: SHA, parents: [DEPLOYED], author: "bob", files: ["a/hotfix.ts"] });
    succeeded(github, "a:prod");

    await scan(context);

    expect(under(github, "a:prod")[0]).toBe(
      `from [0123456](${REPO_URL}/commit/${SHA}) by bob · ${COMPARE}`,
    );
    expect(github.requests.filter((request) => request === "listCommitFiles")).toHaveLength(1);
  });
});

describe("the walk", () => {
  test("is made once per job, however many stacks and however many tries the write takes", async () => {
    const adapter = tableAdapter({
      "a:prod": pending("a:prod", change("x")),
      "b:prod": pending("b:prod", change("x")),
    });
    // No update sticks, so the write loop builds the body three times.
    const github = new FakeGitHub({ updateLimitBytes: 10 });
    github.seedIssue({
      author: BOT,
      labels: ["sluiceway"],
      body: '<!-- sluiceway:dashboard v="1" -->\n',
    });
    const { context } = harness(adapter, { github });
    github.seedCommit({ sha: DEPLOYED });
    github.seedCommit({ sha: SHA, parents: [DEPLOYED], files: ["a/hotfix.ts"] });
    succeeded(github, "a:prod");
    succeeded(github, "b:prod");

    await expect(scan(context)).rejects.toBeInstanceOf(DashboardWriteError);

    expect(github.requests.filter((request) => request === "updateIssueBody")).toHaveLength(3);
    expect(github.requests.filter((request) => request === "walkCommits")).toHaveLength(1);
    expect(github.requests.filter((request) => request === "listCommitFiles")).toHaveLength(1);
  });

  test("is not made when no row needs it", async () => {
    const { context, github } = harness(tableAdapter({ "a:prod": inSync("a:prod") }));
    merged(github, ["a/index.ts"]);
    succeeded(github, "a:prod");
    await scan(context);
    expect(github.requests).not.toContain("walkCommits");
  });
});

describe("attribution never blocks", () => {
  test("a failed walk leaves the line out, the dashboard is written and the job log says why", async () => {
    const { context, github, log } = harness(
      tableAdapter({ "a:prod": pending("a:prod", change("x")) }),
    );
    // The fake repo has no commits, so the walk fails.
    succeeded(github, "a:prod");

    await scan(context);

    expect(under(github, "a:prod")[0]).toStartWith("<details>");
    expect(dashboardBody(github)).not.toContain("compare");
    expect(log.lines.join("\n")).toContain("Attribution was left off the rows");
    expect(log.warnings).toEqual([]);
  });

  test("a failed read of a direct push's files does the same", async () => {
    const { context, github, log } = harness(
      tableAdapter({ "a:prod": pending("a:prod", change("x")) }),
    );
    github.seedCommit({ sha: DEPLOYED });
    github.seedCommit({ sha: SHA, parents: [DEPLOYED], files: ["a/hotfix.ts"] });
    succeeded(github, "a:prod");
    github.onRequest = (request) => {
      if (request === "listCommitFiles") throw new Error("Server Error");
    };

    await scan(context);

    expect(under(github, "a:prod")[0]).toStartWith("<details>");
    expect(log.lines.join("\n")).toContain("Attribution was left off the rows: Server Error");
    expect(github.requests.filter((request) => request === "walkCommits")).toHaveLength(1);
  });

  test("a failed read is not tried again in the same job, and the log says it once", async () => {
    // No update sticks, so the write loop builds the body three times.
    const github = new FakeGitHub({ updateLimitBytes: 10 });
    github.seedIssue({
      author: BOT,
      labels: ["sluiceway"],
      body: '<!-- sluiceway:dashboard v="1" -->\n',
    });
    const { context, log } = harness(tableAdapter({ "a:prod": pending("a:prod", change("x")) }), {
      github,
    });
    succeeded(github, "a:prod");

    await expect(scan(context)).rejects.toBeInstanceOf(DashboardWriteError);

    expect(github.requests.filter((request) => request === "updateIssueBody")).toHaveLength(3);
    expect(github.requests.filter((request) => request === "walkCommits")).toHaveLength(1);
    expect(log.lines.filter((line) => line.startsWith("Attribution was left off"))).toHaveLength(1);
  });
});

describe("the size budget", () => {
  test("at level 1 the row counts its pull requests and keeps the link", async () => {
    const { context, github } = harness(
      tableAdapter({ "a:prod": pending("a:prod", change("x")) }),
      // Any body is over this target, so every row is cut as far as it helps.
      { limits: { body: { target: 1 } } },
    );
    github.seedCommit({ sha: DEPLOYED });
    github.seedCommit({ sha: BETWEEN, parents: [DEPLOYED] });
    github.seedCommit({ sha: SHA, parents: [BETWEEN] });
    github.seedPullRequest({ number: 3, author: "alice", files: ["a/x.ts"], commits: [BETWEEN] });
    github.seedPullRequest({ number: 4, author: "alice", files: ["a/y.ts"], commits: [SHA] });
    succeeded(github, "a:prod");

    await scan(context);

    expect(under(github, "a:prod")[0]).toBe(`from 2 pull requests · ${COMPARE}`);
  });
});

describe("the summary", () => {
  test("lists the pull requests of a pending stack with their titles", async () => {
    const { context, github, log } = harness(
      tableAdapter({ "a:prod": pending("a:prod", change("x")) }),
    );
    merged(github, ["a/index.ts"]);
    succeeded(github, "a:prod");

    await scan(context);

    expect(log.summaries.at(-1)).toContain(
      `From 1 pull request:\n\n- [#3 Grafana alerts](${REPO_URL}/pull/3) by alice`,
    );
  });
});

describe("a deploying row the scan makes from the record", () => {
  test("has the line too, so a reader sees what is going out", async () => {
    // The deploy is far enough that the preview finds nothing left to change.
    const { context, github } = harness(tableAdapter({ "a:prod": inSync("a:prod") }));
    merged(github, ["a/index.ts"]);
    succeeded(github, "a:prod", DEPLOYED, "2026-09-20T08:00:00Z");
    github.seedDeployment({
      task: "sluiceway:a:prod",
      sha: SHA,
      createdAt: "2026-09-20T09:00:00Z",
      status: { state: "in_progress" },
    });
    github.seedRun("4242", { completed: false });

    await scan(context);

    expect(under(github, "a:prod")).toEqual([
      `from #3 by alice · ${COMPARE}`,
      "<!-- /sluiceway:row -->",
    ]);
  });
});
