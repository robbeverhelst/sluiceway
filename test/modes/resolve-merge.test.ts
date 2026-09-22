import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDashboard } from "../../src/render/marker.ts";
import {
  MERGE_DEPLOYING_NOTE,
  MERGE_DEPLOYS_OFF_NOTE,
  MERGE_ORPHAN_NOTE,
  renderMergeRow,
} from "../../src/render/merge-row.ts";
import { BOT } from "../fake-github/fake-github.ts";
import { change, inSync, pending, SPINNER } from "./harness.ts";
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
    expect(h.log.lines).toContain(
      "Started a full scan, which previews the merged change and hands it to apply. It is narrowed to the merged change when sluiceway.yml declares the workflow_dispatch input sluiceway-merged (record 0064).",
    );
  });

  test("names the merged pull request to the scan when the workflow declares the input, so it narrows (slice 4.13)", async () => {
    const h = await ready();
    mkdirSync(join(h.context.root, ".github/workflows"), { recursive: true });
    writeFileSync(
      join(h.context.root, ".github/workflows", WORKFLOW.file),
      "on:\n  workflow_dispatch:\n    inputs:\n      sluiceway-merged:\n        required: false\njobs: {}\n",
    );
    tickMerge(h);

    await wake(h);

    expect(h.github.dispatches).toEqual([
      { workflow: WORKFLOW.file, ref: WORKFLOW.ref, inputs: { "sluiceway-merged": "418" } },
    ]);
    expect(h.log.lines).toContain(
      "Started the scan after the merge of #418. It previews what changed since the last scan and hands the merged change to apply.",
    );
  });

  test("takes the row of the pull request away and shows the stack as deploying", async () => {
    const h = await ready();
    tickMerge(h);

    await wake(h);

    expect(merges(h)).toEqual([]);
    expect(h.github.issue(h.number).body).not.toContain("Updates waiting to merge");
    expect(rowsOf(h)["a:prod"]?.split("\n")[0]).toBe(
      `- ${SPINNER}**a:prod** · waiting to start · ticked by alice · [run](${RESOLVE_RUN_URL}) <!-- sluiceway:row stack="a:prod" state="deploying" -->`,
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

  test("reads Renovate's JSON5 config and its preset in this repo (slice 4.13)", async () => {
    const h = await ready();
    mkdirSync(join(h.context.root, ".github"), { recursive: true });
    mkdirSync(join(h.context.root, "renovate"), { recursive: true });
    writeFileSync(
      join(h.context.root, ".github/renovate.json5"),
      "{\n  // merged the way this repo merges\n  extends: ['config:recommended', 'local>acme/infra//renovate/merging', 'github>acme/shared'],\n}\n",
    );
    writeFileSync(
      join(h.context.root, "renovate/merging.json"),
      '{ "automergeStrategy": "merge-commit" }',
    );
    tickMerge(h);

    await wake(h);

    expect(h.github.merges).toMatchObject([{ method: "merge" }]);
    expect(h.log.lines).toContain(
      "Renovate's config is .github/renovate.json5, and it sets automergeStrategy to merge-commit. The preset github>acme/shared was not read: only a preset in a file of this repo is.",
    );
  });

  test("uses the repo's method in Renovate's order when Renovate says nothing", async () => {
    const h = await ready();
    h.github.setAllowedMergeMethods({ squash: false, rebase: true, merge: true });
    tickMerge(h);

    await wake(h);

    expect(h.github.merges).toMatchObject([{ method: "merge" }]);
    expect(h.log.lines).toContain(
      "No Renovate config sets automergeStrategy, so the method is the first the repo allows of squash, merge and rebase, as Renovate picks it.",
    );
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
    expect(merges(h)[0]?.text.split("\n")[1]).toBe(`  ${MERGE_DEPLOYS_OFF_NOTE}`);
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
    expect(merges(h)[0]?.text.split("\n")[1]).toBe(`  ${MERGE_DEPLOYING_NOTE}`);
  });

  test("a tick the edit history names nobody for merges nothing and gets the note (slice 4.13)", async () => {
    const h = await ready();
    tickMerge(h, BOB);
    h.github.editBody(h.number, `${h.github.issue(h.number).body}\nA note.`, ALICE);
    // Bob deletes the content of his own entry (record 0025).
    h.github.deleteHistoryEntry(h.number, 2);

    await wake(h);

    expect(h.github.merges).toEqual([]);
    expect(h.github.comments(h.number)).toEqual([]);
    expect(merges(h).map(({ ticked }) => ticked)).toEqual([false]);
    expect(merges(h)[0]?.text.split("\n")[1]).toBe(`  ${MERGE_ORPHAN_NOTE}`);
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

// Slice 4.2 next to record 0056: the merged change deploys on its own, so a
// stack whose dependency has a change waiting is not merged for.
describe("a merge for a stack with dependencies", () => {
  test("is not merged while a stack it depends on has a change waiting, and the ticker is told", async () => {
    const h = await ready(`${CONFIG}stacks:\n  - path: a\n    dependsOn:\n      - b:prod\n`);
    tickMerge(h);

    await wake(h);

    expect(h.github.merges).toEqual([]);
    expect(merges(h).map(({ ticked }) => ticked)).toEqual([false]);
    expect(h.github.comments(h.number)).toEqual([
      "@alice ticked the merge of #418 for **a:prod**. It was not merged: the stack depends on **b:prod**, which has a change waiting. Deploy that first, then tick this again. Nothing was started and the box is cleared.",
    ]);
  });

  test("is merged when what it depends on is in sync", async () => {
    const h = await scanned(
      { "a:prod": inSync("a:prod"), "b:prod": inSync("b:prod") },
      { config: `${CONFIG}stacks:\n  - path: a\n    dependsOn:\n      - b:prod\n` },
    );
    h.github.seedOpenPullRequest({ number: 418, head: HEAD, files: ["a/values.yaml"] });
    tickMerge(h);

    await wake(h);

    expect(h.github.merges).toHaveLength(1);
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
