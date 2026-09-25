import { describe, expect, test } from "bun:test";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { handedOn, runApply, states } from "./apply-harness.ts";
import { change, harness, pending, SHA } from "./harness.ts";
import { rememberingOutputs } from "./outputs-harness.ts";
import { WORKFLOW } from "./resolve-harness.ts";

// Slice 5.48 (record 0111): `apply` previews the commit its run checked out.
// A push to the branch after that never reaches the fresh preview, so before
// the preview `apply` compares that commit with the head of the branch. A
// newer commit that a scan would preview the stack for is a change that moved
// since the tick: nothing deploys, the tool never runs, and a full scan is
// started so the row comes back with the change as it is now.

const NEWER = "fedcba9876543210fedcba9876543210fedcba98";

const table = () => ({
  "a:prod": pending("a:prod", change("bucket")),
  "b:prod": pending("b:prod", change("other")),
});

// Alice ticked a:prod on SHA, and then a push moved main to NEWER with these
// files.
async function pushedAfterTheTick(files: string[], status = "ahead") {
  const h = await handedOn(table(), ["a:prod"]);
  h.github.seedBranch("main", NEWER);
  h.github.seedComparison(SHA, NEWER, { status, files: files.map((path) => ({ path })) });
  return h;
}

describe("a push to the branch between the tick and the deploy", () => {
  test("that changes a file the stack claims deploys nothing and never runs the tool", async () => {
    const h = await pushedAfterTheTick(["a/Pulumi.yaml"]);
    const outputs = rememberingOutputs();
    h.context.outputs = outputs;

    await expect(runApply(h)).rejects.toThrow(
      "a:prod was not deployed: the change moved since the tick. main moved on from 0123456, the commit this run checked out, to a commit that changes a file a:prod claims: a/Pulumi.yaml.",
    );

    expect(h.adapter.previewed).toEqual([]);
    expect(h.adapter.versionChecks).toBe(0);
    expect(h.adapter.applied).toEqual([]);
    expect(states(h)).toEqual(["queued", "in_progress", "error"]);
    expect(h.github.deploymentStatuses(h.deployment).at(-1)?.description).toBe(
      "the change moved since the tick",
    );
    expect(outputs.values.outcome).toBe("refused");
  });

  test("starts a full scan and tells the ticker, and the row keeps saying deploying until that scan", async () => {
    const h = await pushedAfterTheTick(["a/Pulumi.yaml"]);

    await expect(runApply(h)).rejects.toThrow();

    expect(h.github.dispatches).toEqual([{ workflow: WORKFLOW.file, ref: WORKFLOW.ref }]);
    expect(h.github.comments(h.number)).toEqual([
      "@alice ticked **a:prod**, and a newer commit reached the branch before the deploy started, so nothing was deployed. The next scan shows the change as it is now on its row. Tick it again to deploy that.",
    ]);
    expect(h.github.requests).not.toContain("updateIssueBody");
    const row = parseDashboard(h.github.issue(h.number).body).rows.find(
      ({ stackId }) => stackId === "a:prod",
    );
    expect(row?.state).toBe("deploying");
  });

  test("the scan it started brings the row back pending with the newer change and the failure line, never in sync", async () => {
    const h = await pushedAfterTheTick(["a/Pulumi.yaml"]);
    await expect(runApply(h)).rejects.toThrow();

    // The scan of the dispatch, on the newer commit.
    h.table["a:prod"] = pending("a:prod", change("bucket"), change("queue", "create"));
    const { context } = harness(h.adapter, { sha: NEWER, runId: "7777" });
    await scan({ ...context, root: h.context.root, github: h.github });

    const row = parseDashboard(h.github.issue(h.number).body).rows.find(
      ({ stackId }) => stackId === "a:prod",
    );
    expect(row?.state).toBe("pending");
    expect(row?.text).toContain("queue");
    expect(row?.text).toContain("last deploy failed: the change moved since the tick");
  });

  test("that changes a file no stack claims is refused too, because a scan of it previews every stack", async () => {
    const h = await pushedAfterTheTick(["package.json"]);
    await expect(runApply(h)).rejects.toThrow(
      "to a commit that changes a file no stack claims, so a scan of it previews every stack: package.json.",
    );
    expect(h.adapter.previewed).toEqual([]);
  });

  test("that is not a straight line on from the checked-out commit is refused", async () => {
    const h = await pushedAfterTheTick([], "diverged");
    await expect(runApply(h)).rejects.toThrow(
      "main is not a straight line on from 0123456, the commit this run checked out (GitHub says diverged), so what it holds is not what was previewed.",
    );
    expect(h.adapter.previewed).toEqual([]);
  });

  test("that changes only another stack, or a file no program reads, deploys", async () => {
    const h = await pushedAfterTheTick(["b/index.ts", "README.md"]);
    await runApply(h);
    expect(h.adapter.applied).toEqual(["a:prod"]);
    expect(h.github.dispatches).toEqual([]);
  });

  test("nothing newer on the branch deploys, after one comparison", async () => {
    const h = await handedOn(table(), ["a:prod"]);
    await runApply(h);
    expect(h.adapter.applied).toEqual(["a:prod"]);
    expect(h.github.requests.filter((name) => name === "compareCommits")).toHaveLength(1);
  });

  test("a rehearsal is refused the same way", async () => {
    const h = await pushedAfterTheTick(["a/Pulumi.yaml"]);
    h.context.dryRun = true;
    await expect(runApply(h)).rejects.toThrow("the change moved since the tick");
    expect(states(h).at(-1)).toBe("error");
  });

  test("a comparison that fails deploys nothing, fails closed and names the permission", async () => {
    const h = await handedOn(table(), ["a:prod"]);
    h.github.compareCommits = async () => {
      throw new Error("502 Bad Gateway");
    };
    const outputs = rememberingOutputs();
    h.context.outputs = outputs;

    await expect(runApply(h)).rejects.toThrow(
      "a:prod was not deployed: the deploy stopped before the tool ran. Comparing 0123456, the commit this run checked out, with main failed: 502 Bad Gateway. Without it nothing says the branch did not move since the tick. The job needs the permission `contents: read`.",
    );
    expect(h.adapter.previewed).toEqual([]);
    expect(states(h).at(-1)).toBe("failure");
    expect(outputs.values.outcome).toBe("failed");
    expect(h.github.comments(h.number)).toEqual([]);
  });

  test("a job that does not know its branch deploys nothing", async () => {
    const h = await handedOn(table(), ["a:prod"]);
    h.context.workflow = undefined;
    await expect(runApply(h)).rejects.toThrow(
      "GITHUB_WORKFLOW_REF is not set, so this job does not know which branch it runs on",
    );
    expect(h.adapter.previewed).toEqual([]);
  });

  test("a scan that cannot be started leaves the refusal as it is and names the permission", async () => {
    const h = await pushedAfterTheTick(["a/Pulumi.yaml"]);
    h.github.dispatchWorkflow = async () => {
      throw new Error("403 Resource not accessible by integration");
    };
    await expect(runApply(h)).rejects.toThrow(
      "A full scan could not be started: 403 Resource not accessible by integration. The apply job needs the permission `actions: write`",
    );
    expect(states(h).at(-1)).toBe("error");
    expect(h.github.comments(h.number)).toHaveLength(1);
  });
});
