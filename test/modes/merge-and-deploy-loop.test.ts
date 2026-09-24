import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PreviewResult } from "../../src/adapters/adapter.ts";
import { mergedBeforeDispatch } from "../../src/github/event.ts";
import { type ApplyContext, apply } from "../../src/modes/apply.ts";
import { type ResolveContext, resolve } from "../../src/modes/resolve.ts";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import {
  ACTION_REF,
  change,
  dashboardBody,
  harness,
  inSync,
  pending,
  REPO_URL,
  steppingClock,
  tableAdapter,
} from "./harness.ts";
import { rememberingOutputs } from "./outputs-harness.ts";
import { ALICE, WORKFLOW, WRITE } from "./resolve-harness.ts";

// Slice 4.2 (record 0054), the whole loop on the fake GitHub: a scan lists a
// Renovate pull request, a person ticks it, `resolve` merges it, the scan it
// starts hands the fresh diff to `apply`, and `apply` deploys it or finds
// that it moved.

const CONFIG = "mergeAndDeploy:\n  authors:\n    - renovate[bot]\n";
const HEAD = "4444444444444444444444444444444444444444";
const FIRST_SCAN = { runId: "100", sha: "1000000000000000000000000000000000000001" };
const RESOLVE = "200";
const SECOND_SCAN = "300";

async function loop(
  options: {
    moveBeforeApply?: boolean;
    declaresInput?: boolean;
    bothStacks?: boolean;
    waitingOnChecks?: boolean;
  } = {},
) {
  const table: Record<string, PreviewResult> = {
    "a:prod": inSync("a:prod"),
    "b:prod": inSync("b:prod"),
  };
  const adapter = tableAdapter(table);
  const first = harness(adapter, { config: CONFIG, ...FIRST_SCAN });
  const { github, log } = first;
  github.seedOpenPullRequest({
    number: 418,
    head: HEAD,
    title: "Update Helm release odoo to v17.0.4",
    // Two stacks claim it since slice 5.4 (record 0071).
    files: options.bothStacks ? ["a/values.yaml", "b/values.yaml"] : ["a/values.yaml"],
  });
  github.seedOpenPullRequest({
    number: 419,
    title: "Update dependency b to v2",
    files: ["b/package.json"],
  });
  if (options.waitingOnChecks) {
    // Slice 5.17: an update whose checks have not finished (record 0081).
    github.seedOpenPullRequest({
      number: 1137,
      title: "Update dependency b to v3",
      files: ["b/values.yaml"],
      checks: "pending",
    });
  }
  await scan(first.context);
  if (options.declaresInput) {
    // The workflow declares the input of the scan after a merge (record 0064).
    mkdirSync(join(first.context.root, ".github/workflows"), { recursive: true });
    writeFileSync(
      join(first.context.root, ".github/workflows", WORKFLOW.file),
      "on:\n  workflow_dispatch:\n    inputs:\n      sluiceway-merged:\n        required: false\njobs: {}\n",
    );
  }

  // Alice ticks the update of a:prod.
  const body = dashboardBody(github);
  github.editBody(1, body.replace(/^- \[ \] (.*pr="418")/m, "- [x] $1"), ALICE);
  github.seedPermission(ALICE.login, WRITE);
  github.seedRun(RESOLVE, { completed: false });
  const resolveContext: ResolveContext = {
    root: first.context.root,
    adapter,
    github,
    log,
    repoUrl: REPO_URL,
    runId: RESOLVE,
    sha: FIRST_SCAN.sha,
    actionRef: ACTION_REF,
    event: github.deliverEvent(),
    workflow: WORKFLOW,
    setOutput: () => {},
  };
  await resolve(resolveContext);
  const afterResolve = dashboardBody(github);
  github.seedRun(RESOLVE, { completed: true });
  const [merged] = github.merges;
  if (!merged) throw new Error("resolve merged nothing");

  // The merge changed what a:prod deploys. The scan that resolve started runs
  // on the merge commit.
  table["a:prod"] = pending("a:prod", change("release"));
  if (options.bothStacks) table["b:prod"] = pending("b:prod", change("release"));
  github.seedComparison(FIRST_SCAN.sha, merged.sha, {
    status: "ahead",
    files: [{ path: "a/values.yaml" }, ...(options.bothStacks ? [{ path: "b/values.yaml" }] : [])],
  });
  github.seedRun(SECOND_SCAN, { completed: false });
  const outputs = rememberingOutputs();
  adapter.previewed.length = 0;
  // The dispatched run reads the input from its payload, as the glue does.
  const [dispatch] = github.dispatches;
  await scan({
    ...first.context,
    runId: SECOND_SCAN,
    sha: merged.sha,
    event: "workflow_dispatch",
    afterMerge: mergedBeforeDispatch({
      inputs: dispatch?.inputs,
      sender: { login: "github-actions[bot]", type: "Bot" },
    }),
    outputs,
  });
  const previewedAfterMerge = [...adapter.previewed];
  const matrix = JSON.parse(outputs.values.matrix ?? "[]") as {
    stack: string;
    deployment: number;
  }[];

  if (options.moveBeforeApply) table["a:prod"] = pending("a:prod", change("release"), change("x"));
  const applyOutputs = rememberingOutputs();
  const applyContext: ApplyContext = {
    root: first.context.root,
    env: { PATH: "/usr/bin" },
    mask: () => {},
    adapter,
    run: async () => {
      throw new Error("No process.");
    },
    github,
    log,
    previewTimeoutMinutes: 10,
    now: steppingClock(),
    repoUrl: REPO_URL,
    // The apply job runs in the run of the scan that handed it on.
    runId: SECOND_SCAN,
    runAttempt: "1",
    jobId: "1",
    sha: merged.sha,
    actionRef: ACTION_REF,
    deploymentId: matrix[0]?.deployment ?? 0,
    event: undefined,
    outputs: applyOutputs,
  };
  const applied = apply(applyContext).then(
    () => undefined,
    (error: unknown) => error,
  );
  return {
    github,
    adapter,
    matrix,
    error: await applied,
    applyOutputs,
    previewedAfterMerge,
    afterResolve,
  };
}

describe("merge and deploy on the fake GitHub", () => {
  test("one tick merges the update and deploys its stack with the fresh diff", async () => {
    const { github, adapter, matrix, error, applyOutputs } = await loop();

    expect(error).toBeUndefined();
    expect(matrix).toHaveLength(1);
    expect(adapter.applied).toEqual(["a:prod"]);
    expect(applyOutputs.values.outcome).toBe("deployed");
    const parsed = parseDashboard(dashboardBody(github));
    expect(parsed.rows.find((row) => row.stackId === "a:prod")?.state).toBe("in-sync");
    // The other update still waits: every writer carries the section.
    expect(parsed.merges.map(({ pr }) => pr)).toEqual([419]);
    expect(dashboardBody(github)).toMatch(
      /## Recently deployed\n\nTimes are in UTC\.\n\n- 🟢&nbsp;a:prod · alice · /,
    );
  });

  test("every writer carries the line of an update waiting on its checks (slice 5.17)", async () => {
    const { github, afterResolve, error } = await loop({ waitingOnChecks: true });

    expect(error).toBeUndefined();
    // resolve merged #418 and carried the line of #1137 as it stood.
    expect(parseDashboard(afterResolve).waiting.map(({ pr }) => pr)).toEqual([1137]);
    expect(parseDashboard(afterResolve).merges.map(({ pr }) => pr)).toEqual([419]);
    // apply carried the line the scan after the merge drew.
    const parsed = parseDashboard(dashboardBody(github));
    expect(parsed.waiting.map(({ pr }) => pr)).toEqual([1137]);
    expect(parsed.merges.map(({ pr }) => pr)).toEqual([419]);
  });

  test("the scan after the merge previews every stack when the workflow does not declare the input", async () => {
    const { previewedAfterMerge } = await loop();
    expect(previewedAfterMerge.sort()).toEqual(["a:prod", "b:prod"]);
  });

  test("the scan after the merge is narrowed to the merged files when it does (slice 4.13)", async () => {
    const { previewedAfterMerge, adapter, applyOutputs, github } = await loop({
      declaresInput: true,
    });
    expect(github.dispatches[0]?.inputs).toEqual({ "sluiceway-merged": "418" });
    expect(previewedAfterMerge).toEqual(["a:prod"]);
    expect(adapter.applied).toEqual(["a:prod"]);
    expect(applyOutputs.values.outcome).toBe("deployed");
  });

  test("a change that moved after the merge is refused, and the ticker gets the comment", async () => {
    const { github, adapter, error, applyOutputs } = await loop({ moveBeforeApply: true });

    expect(String(error)).toContain("the change moved since the tick");
    expect(adapter.applied).toEqual([]);
    expect(applyOutputs.values.outcome).toBe("refused");
    expect(github.comments(1)).toEqual([
      "@alice ticked **a:prod**, and the change moved since the tick, so nothing was deployed. The row on the dashboard shows the change as it is now. Tick it again to deploy that.",
    ]);
    expect(
      parseDashboard(dashboardBody(github)).rows.find((row) => row.stackId === "a:prod")?.state,
    ).toBe("pending");
  });

  test("an update that two stacks claim merges once and hands a deploy of each to apply (slice 5.4)", async () => {
    const { github, matrix, error, applyOutputs } = await loop({ bothStacks: true });

    expect(github.merges).toHaveLength(1);
    expect(matrix.map(({ stack }) => stack)).toEqual(["a:prod", "b:prod"]);
    expect(error).toBeUndefined();
    expect(applyOutputs.values.outcome).toBe("deployed");
    expect(
      parseDashboard(dashboardBody(github)).rows.find((row) => row.stackId === "b:prod")?.state,
    ).toBe("deploying");
  });
});
