import { describe, expect, test } from "bun:test";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import type { FakeGitHub } from "../fake-github/fake-github.ts";
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

// Attribution part 2 on the fake with recorded commit graphs (record 0072):
// a row and the trail say where every change came from.

const FIRST = "1111111111111111111111111111111111111111";
const SECOND = "2222222222222222222222222222222222222222";

function under(github: FakeGitHub, stackId: string): string[] {
  const row = parseDashboard(dashboardBody(github)).rows.find((one) => one.stackId === stackId);
  return (row?.text.split("\n") ?? []).slice(1).map((line) => line.trim());
}

function trail(github: FakeGitHub): string[] {
  const all = dashboardBody(github).split("\n\n");
  const at = all.indexOf("## Recently deployed");
  return at === -1 ? [] : (all[at + 1]?.split("\n") ?? []);
}

function succeeded(github: FakeGitHub, stackId: string, sha: string, createdAt: string): void {
  github.seedDeployment({
    task: `sluiceway:${stackId}`,
    sha,
    status: { state: "success" },
    createdAt,
  });
}

// main: FIRST deployed a:prod, then pull request 5 to a and the lockfile bump
// of pull request 6, then SECOND deployed a:prod again, then pull request 7 to
// a, which is the scanned commit.
function history(github: FakeGitHub): void {
  github.seedCommit({ sha: FIRST });
  github.seedCommit({ sha: "a5".padEnd(40, "0"), parents: [FIRST] });
  github.seedCommit({ sha: SECOND, parents: ["a5".padEnd(40, "0")] });
  github.seedCommit({ sha: SHA, parents: [SECOND] });
  github.seedPullRequest({
    number: 5,
    author: "carol",
    files: ["a/x.ts"],
    commits: ["a5".padEnd(40, "0")],
  });
  github.seedPullRequest({
    number: 6,
    author: "renovate[bot]",
    files: ["bun.lock"],
    commits: [SECOND],
  });
  github.seedPullRequest({ number: 7, author: "alice", files: ["a/y.ts"], commits: [SHA] });
  succeeded(github, "a:prod", FIRST, "2026-09-21T08:00:00Z");
  succeeded(github, "a:prod", SECOND, "2026-09-21T09:00:00Z");
}

describe("the trail", () => {
  test("a deploy says what it shipped, from the success before it to its own commit", async () => {
    const { context, github } = harness(
      tableAdapter({ "a:prod": pending("a:prod", change("x")) }),
      {
        config: "dashboard:\n  personality: false\n",
      },
    );
    history(github);

    await scan(context);

    const lines = trail(github);
    expect(lines[0]).toStartWith("- a:prod · ticked by");
    expect(lines[1]).toBe(
      `  shipped #5 by carol, and 1 change outside this stack · [compare](${REPO_URL}/compare/111111111111...222222222222)`,
    );
    // The first success in the records read has nothing before it to count from.
    expect(lines[2]).toStartWith("- a:prod · ticked by");
    expect(lines).toHaveLength(3);
  });

  test("is walked also when no row is pending, once for the job", async () => {
    const { context, github } = harness(tableAdapter({ "a:prod": inSync("a:prod") }));
    history(github);

    await scan(context);

    expect(trail(github)[1]).toContain("shipped #5 by carol");
    expect(github.requests.filter((name) => name === "walkCommits")).toHaveLength(1);
  });
});

describe("a row", () => {
  test("names its changes outside the stack behind a fold", async () => {
    const { context, github } = harness(tableAdapter({ "a:prod": pending("a:prod", change("x")) }));
    history(github);

    await scan(context);

    const lines = under(github, "a:prod");
    expect(lines[0]).toBe(
      `from #7 by alice · [compare](${REPO_URL}/compare/222222222222...0123456789ab)`,
    );
    expect(lines).not.toContain("<details><summary>changes outside this stack</summary>");
  });

  test("the fold holds the lockfile bump when the range has one", async () => {
    const { context, github } = harness(tableAdapter({ "a:prod": pending("a:prod", change("x")) }));
    github.seedCommit({ sha: FIRST });
    github.seedCommit({ sha: SHA, parents: [FIRST] });
    github.seedPullRequest({
      number: 6,
      author: "renovate[bot]",
      files: ["bun.lock"],
      commits: [SHA],
    });
    succeeded(github, "a:prod", FIRST, "2026-09-21T08:00:00Z");

    await scan(context);

    const lines = under(github, "a:prod");
    expect(lines[0]).toBe(
      `from 1 change outside this stack · [compare](${REPO_URL}/compare/111111111111...0123456789ab)`,
    );
    // Last on the row, after the fold of changes.
    expect(lines.slice(-4, -1)).toEqual([
      "<details><summary>changes outside this stack</summary>",
      `<a href="${REPO_URL}/pull/6">#6</a> by renovate&#91;bot&#93;<br>`,
      "</details>",
    ]);
  });

  test("attribution.names and attribution.lookback come from sluiceway.yaml", async () => {
    const { context, github } = harness(
      tableAdapter({ "a:prod": pending("a:prod", change("x")) }),
      {
        config: "attribution:\n  names: 0\n  lookback: 2\n",
      },
    );
    history(github);

    await scan(context);

    // Two commits back from the scanned one: FIRST is out of the lookback, so
    // the row of a stack last deployed at SECOND is exact, and names nothing.
    expect(under(github, "a:prod")[0]).toBe(
      `from 1 pull request · [compare](${REPO_URL}/compare/222222222222...0123456789ab)`,
    );
    // The deploy at SECOND started at FIRST, which the lookback no longer holds.
    expect(trail(github).find((line) => line.includes("shipped"))).toContain(
      "shipped 1 change outside this stack, and earlier changes",
    );
  });

  test("a pull request that moved a file out of the stack is named on its row", async () => {
    const { context, github } = harness(
      tableAdapter({
        "a:prod": pending("a:prod", change("x")),
        "b:prod": pending("b:prod", change("y")),
      }),
    );
    github.seedCommit({ sha: FIRST });
    github.seedCommit({ sha: SHA, parents: [FIRST] });
    github.seedPullRequest({
      number: 8,
      author: "dave",
      files: [{ path: "b/rules.ts", previousPath: "a/rules.ts" }],
      commits: [SHA],
    });
    succeeded(github, "a:prod", FIRST, "2026-09-21T08:00:00Z");
    succeeded(github, "b:prod", FIRST, "2026-09-21T08:00:01Z");

    await scan(context);

    expect(under(github, "a:prod")[0]).toStartWith("from #8 by dave");
    expect(under(github, "b:prod")[0]).toStartWith("from #8 by dave");
    expect(github.requests.filter((name) => name === "listPullRequestFiles")).toHaveLength(1);
  });
});
