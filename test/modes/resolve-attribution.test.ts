import { describe, expect, test } from "bun:test";
import { change, pending, REPO_URL, SHA } from "./harness.ts";
import { ALICE, type ResolveHarness, rowsOf, scanned, tick, wake } from "./resolve-harness.ts";

// `resolve` and attribution (record 0026): the visible text of a row is never
// parsed, so the deploying row gets its line worked out again, with the
// workflow token only. It never blocks a deploy.

const DEPLOYED = "1111111111111111111111111111111111111111";
const COMPARE = `[compare](${REPO_URL}/compare/111111111111...0123456789ab)`;
const TABLE = { "a:prod": pending("a:prod", change("logs")) };

// The lines of the row block under its first line, without the indent.
function under(h: ResolveHarness, stackId: string): string[] {
  return (rowsOf(h)[stackId]?.split("\n") ?? []).slice(1).map((line) => line.trim());
}

// main: the deployed commit, then pull request 3 squashed onto it, which is
// the commit the scan checked out.
function merged(h: ResolveHarness): void {
  h.github.seedCommit({ sha: DEPLOYED });
  h.github.seedCommit({ sha: SHA, parents: [DEPLOYED] });
  h.github.seedPullRequest({ number: 3, author: "bob", files: ["a/index.ts"], commits: [SHA] });
}

function succeeded(h: ResolveHarness): void {
  h.github.seedDeployment({
    task: "sluiceway:a:prod",
    sha: DEPLOYED,
    status: { state: "success" },
  });
}

describe("the deploying row that `resolve` writes", () => {
  test("says what is going out: the pull requests since the last successful deploy, up to the scanned commit", async () => {
    const h = await scanned(TABLE);
    merged(h);
    succeeded(h);
    tick(h, ALICE, ["a:prod"]);

    await wake(h);

    expect(rowsOf(h)["a:prod"]).toContain("waiting to start · ticked by alice");
    expect(under(h, "a:prod")).toEqual([`from #3 by bob · ${COMPARE}`, "<!-- /sluiceway:row -->"]);
  });

  test("of a stack with no successful deployment record says so, and costs no request", async () => {
    const h = await scanned(TABLE);
    merged(h);
    tick(h, ALICE, ["a:prod"]);

    await wake(h);

    expect(under(h, "a:prod")[0]).toBe("not deployed from this dashboard yet");
    expect(h.github.requests).not.toContain("walkCommits");
  });

  test("has no such line when the lookup fails, and the deploy starts all the same", async () => {
    const h = await scanned(TABLE);
    // The fake repo has no commits, so the walk fails.
    succeeded(h);
    tick(h, ALICE, ["a:prod"]);

    await wake(h);

    expect(under(h, "a:prod")).toEqual(["<!-- /sluiceway:row -->"]);
    expect(h.outputs.findLast(({ name }) => name === "matrix")?.value).toContain('"a:prod"');
    expect(h.log.lines.join("\n")).toContain("Attribution was left off the rows");
  });

  test("the walk is made once, however many tries the write takes", async () => {
    const h = await scanned(TABLE);
    merged(h);
    succeeded(h);
    tick(h, ALICE, ["a:prod"]);
    // Another writer gets in after every write, three times over.
    let edits = 0;
    h.github.onRequest = (request) => {
      if (request === "getIssue" && h.github.requests.includes("updateIssueBody")) {
        h.github.editBody(h.number, `${h.github.issue(h.number).body}\nedit ${edits++}`, ALICE);
      }
    };

    await expect(wake(h)).rejects.toThrow("could not be written");

    expect(h.github.requests.filter((request) => request === "updateIssueBody")).toHaveLength(3);
    expect(h.github.requests.filter((request) => request === "walkCommits")).toHaveLength(1);
  });

  test("a `scan-sha` on the dashboard that is no commit id starts no request and no link", async () => {
    const h = await scanned(TABLE);
    merged(h);
    succeeded(h);
    const body = h.github.issue(h.number).body;
    expect(body).toContain(`scan-sha="${SHA}"`);
    h.github.editBody(h.number, body.replace(`scan-sha="${SHA}"`, 'scan-sha="main"'), ALICE);
    h.github.deliverEvent();
    tick(h, ALICE, ["a:prod"]);

    await wake(h);

    expect(rowsOf(h)["a:prod"]).toContain("waiting to start");
    expect(under(h, "a:prod")).toEqual(["<!-- /sluiceway:row -->"]);
    expect(h.github.requests).not.toContain("walkCommits");
  });
});
