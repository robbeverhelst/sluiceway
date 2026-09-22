import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDashboard } from "../../src/render/marker.ts";
import { renderMergeRow } from "../../src/render/merge-row.ts";
import { BOT } from "../fake-github/fake-github.ts";
import { change, inSync, pending } from "./harness.ts";
import {
  ALICE,
  BOB,
  matrix,
  RESOLVE_RUN,
  RESOLVE_RUN_URL,
  type ResolveHarness,
  rowsOf,
  scanned,
  WORKFLOW,
  WRITE,
  wake,
} from "./resolve-harness.ts";

// Slice 4.2 (record 0054): a tick on an update waiting to merge merges the
// pull request, opens a record that deploys after the merge, and starts the
// scan that hands the fresh diff to `apply`.

const HEAD = "4444444444444444444444444444444444444444";
const TABLE = {
  "a:prod": inSync("a:prod"),
  "b:prod": pending("b:prod", change("logs")),
};
const CONFIG = "mergeAndDeploy:\n  authors:\n    - renovate[bot]\n";

function update(stackId = "a:prod", pr = 418) {
  return {
    pr,
    stackId,
    head: HEAD,
    title: "Update Helm release odoo to v17.0.4",
    author: "renovate[bot]",
  };
}

// The scan wrote the row, then a person ticked it.
function tickMerge(h: ResolveHarness, who = ALICE, row = update()): void {
  const body = h.github.issue(h.number).body;
  const line = renderMergeRow(row);
  const at = body.indexOf("## Pending");
  const written = `${body.slice(0, at)}## Updates waiting to merge\n\n${line}\n\n${body.slice(at)}`;
  h.github.editBody(h.number, written, BOT);
  h.github.editBody(h.number, written.replace(line, line.replace("- [ ] ", "- [x] ")), who);
}

async function ready(config = CONFIG): Promise<ResolveHarness> {
  const h = await scanned(TABLE, { config });
  h.github.seedOpenPullRequest({ number: 418, head: HEAD, files: ["a/values.yaml"] });
  return h;
}

function merges(h: ResolveHarness) {
  return parseDashboard(h.github.issue(h.number).body).merges;
}

describe("a tick on an update waiting to merge", () => {
  test("merges the pull request at the ticked head commit, by squash when nothing says otherwise", async () => {
    const h = await ready();
    tickMerge(h);

    await wake(h);

    expect(h.github.merges).toMatchObject([{ number: 418, head: HEAD, method: "squash" }]);
  });

  test("opens a record that deploys after the merge, on the merge commit, and hands nothing to apply", async () => {
    const h = await ready();
    tickMerge(h);

    await wake(h);

    const [merged] = h.github.merges;
    const records = h.github.requests.filter((request) => request === "createDeployment");
    expect(records).toHaveLength(1);
    const record = h.github.deployment(1);
    expect(record).toMatchObject({
      task: "sluiceway:a:prod",
      environment: "sluiceway",
      sha: merged?.sha,
      payload: { v: 1, ticker: "alice", run: RESOLVE_RUN, merge: 418 },
      status: { state: "queued" },
    });
    expect(matrix(h)).toEqual([]);
  });

  test("starts a full scan, because a merge made with the workflow token starts no push run", async () => {
    const h = await ready();
    tickMerge(h);

    await wake(h);

    expect(h.github.dispatches).toEqual([{ workflow: WORKFLOW.file, ref: WORKFLOW.ref }]);
  });

  test("takes the row of the pull request away and shows the stack as deploying", async () => {
    const h = await ready();
    tickMerge(h);

    await wake(h);

    expect(merges(h)).toEqual([]);
    expect(h.github.issue(h.number).body).not.toContain("Updates waiting to merge");
    expect(rowsOf(h)["a:prod"]?.split("\n")[0]).toBe(
      `- **a:prod** · waiting to start · ticked by alice · [run](${RESOLVE_RUN_URL}) <!-- sluiceway:row stack="a:prod" state="deploying" -->`,
    );
    expect(h.github.comments(h.number)).toEqual([]);
  });

  test("uses the merge method Renovate is set to use", async () => {
    const h = await ready();
    writeFileSync(join(h.context.root, "renovate.json"), '{ "automergeStrategy": "rebase" }');
    tickMerge(h);

    await wake(h);

    expect(h.github.merges).toMatchObject([{ method: "rebase" }]);
  });

  test("uses an allowed method when Renovate's is not allowed", async () => {
    const h = await ready();
    h.github.setAllowedMergeMethods({ squash: false, rebase: false, merge: true });
    tickMerge(h);

    await wake(h);

    expect(h.github.merges).toMatchObject([{ method: "merge" }]);
  });
});

describe("a merge that does not happen", () => {
  test("refused by branch protection: nothing is opened, the box is cleared and the ticker is told", async () => {
    const h = await ready();
    h.github.refuseMerge(418, 405, "At least 1 approving review is required.");
    tickMerge(h);

    await wake(h);

    expect(h.github.merges).toEqual([]);
    expect(h.github.requests).not.toContain("createDeployment");
    expect(h.github.dispatches).toEqual([]);
    expect(merges(h).map(({ pr, ticked }) => [pr, ticked])).toEqual([[418, false]]);
    expect(h.github.comments(h.number)).toEqual([
      "@alice ticked the merge of #418 for **a:prod**. GitHub refused the merge: At least 1 approving review is required. Nothing was started and the box is cleared.",
    ]);
  });

  test("a pull request whose head moved since the tick is not merged", async () => {
    const h = await ready();
    h.github.seedOpenPullRequest({ number: 418, head: "5".repeat(40), files: ["a/values.yaml"] });
    tickMerge(h);

    await wake(h);

    expect(h.github.merges).toEqual([]);
    expect(h.github.comments(h.number)).toEqual([
      "@alice ticked the merge of #418 for **a:prod**. The pull request changed since the tick, so it was not merged. Nothing was started and the box is cleared.",
    ]);
  });

  test("a pull request that no longer qualifies is not merged", async () => {
    const h = await ready();
    h.github.seedOpenPullRequest({
      number: 418,
      head: HEAD,
      files: ["a/values.yaml"],
      checks: "failure",
    });
    tickMerge(h);

    await wake(h);

    expect(h.github.requests).not.toContain("mergePullRequest");
    expect(h.github.comments(h.number)).toEqual([
      "@alice ticked the merge of #418 for **a:prod**. The pull request no longer qualifies: its checks are not all green. Nothing was started and the box is cleared.",
    ]);
  });

  test("a marker that names a stack the pull request does not belong to is not merged", async () => {
    const h = await ready();
    tickMerge(h, ALICE, update("b:prod"));

    await wake(h);

    expect(h.github.requests).not.toContain("mergePullRequest");
    expect(h.github.comments(h.number)[0]).toContain(
      "The pull request no longer qualifies: its files belong to another stack.",
    );
  });

  test("a person the stack's tick rule does not allow is refused before anything is asked of the pull request", async () => {
    const h = await ready(`${CONFIG}stacks:\n  - path: a\n    tickers: admin\n`);
    tickMerge(h);

    await wake(h);

    expect(h.github.requests).not.toContain("listOpenPullRequests");
    expect(h.github.merges).toEqual([]);
    expect(h.github.comments(h.number)).toEqual([
      "@alice ticked the merge of #418 for **a:prod**. The tick was refused: the tick rule of this stack is `admin`, which takes admin access to this repository. Nothing was started and the box is cleared.",
    ]);
  });

  test("with deploys turned off nothing is merged and the box is cleared", async () => {
    const h = await ready(`${CONFIG}deploys: false\n`);
    tickMerge(h);

    await wake(h);

    expect(h.github.merges).toEqual([]);
    expect(merges(h).map(({ ticked }) => ticked)).toEqual([false]);
    expect(h.github.comments(h.number)).toEqual([]);
  });

  test("a stack that is deploying drops the tick and clears the box", async () => {
    const h = await ready();
    h.github.seedDeployment({
      task: "sluiceway:a:prod",
      payload: { v: 1, hash: "2b44350653e84a11", ticker: "bob", run: "9999" },
      status: { state: "in_progress" },
    });
    h.github.seedRun("9999", { completed: false });
    tickMerge(h);

    await wake(h);

    expect(h.github.merges).toEqual([]);
    expect(merges(h).map(({ ticked }) => ticked)).toEqual([false]);
  });

  test("without contents: write the job goes red, says which permission, and leaves the box ticked", async () => {
    const h = await ready();
    h.github.withoutContentsWrite();
    tickMerge(h);

    await expect(wake(h)).rejects.toThrow("`contents: write`");
    expect(h.github.requests).not.toContain("createDeployment");
    expect(merges(h).map(({ ticked }) => ticked)).toEqual([true]);
  });
});

describe("merge ticks next to row ticks", () => {
  test("a row tick is handed to apply and a merge tick in the same edit merges", async () => {
    const h = await ready();
    h.github.seedPermission(BOB.login, WRITE);
    tickMerge(h);
    const body = h.github.issue(h.number).body;
    h.github.editBody(h.number, body.replace(/- \[ \] (\*\*b:prod\*\*)/, "- [x] $1"), ALICE);

    await wake(h);

    expect((matrix(h) as { stack: string }[]).map(({ stack }) => stack)).toEqual(["b:prod"]);
    expect(h.github.merges).toHaveLength(1);
  });
});
