import { describe, expect, test } from "bun:test";
import type { MatrixEntry } from "../../src/core/resolve.ts";
import { apply } from "../../src/modes/apply.ts";
import { settle } from "../../src/modes/settle.ts";
import { ACTION_REF, change, pending, SHA } from "./harness.ts";
import {
  ALICE,
  matrix,
  RESOLVE_RUN,
  type ResolveHarness,
  rowsOf,
  scanned,
  tick,
  WORKFLOW,
  wake,
} from "./resolve-harness.ts";

// Three stacks in a chain, ticked in one edit, go round the whole loop on the
// fake (record 0056): each run's `resolve` hands on one layer, `apply` deploys
// it, `settle` starts the workflow again, and the `resolve` of that run takes
// the next stack on. A dependent stack never deploys before its dependency.

const TABLE = {
  "app:prod": pending("app:prod", change("web")),
  "network:prod": pending("network:prod", change("vpc")),
  "site:prod": pending("site:prod", change("cdn")),
};

const CHAIN =
  "stacks:\n  - path: app\n    dependsOn: [network:prod]\n  - path: site\n    dependsOn: [app:prod]\n";

// One run of the workflow after `resolve`: every `apply` of its matrix, then
// `settle`. The run is over afterwards.
async function applyAndSettle(h: ResolveHarness, runId: string): Promise<string[]> {
  const entries = matrix(h) as MatrixEntry[];
  for (const entry of entries) {
    await apply({
      root: h.context.root,
      env: { PATH: "/usr/bin" },
      adapter: h.adapter,
      run: async () => {
        throw new Error("The table adapter starts no process.");
      },
      github: h.github,
      log: h.log,
      previewTimeoutMinutes: 10,
      repoUrl: h.context.repoUrl,
      runId,
      runAttempt: "1",
      jobId: "1",
      sha: SHA,
      actionRef: ACTION_REF,
      deploymentId: entry.deployment,
      event: h.context.event,
    });
  }
  const before = h.github.dispatches.length;
  await settle({
    root: h.context.root,
    adapter: h.adapter,
    github: h.github,
    log: h.log,
    repoUrl: h.context.repoUrl,
    runId,
    event: h.context.event,
    workflow: WORKFLOW,
  });
  h.github.seedRun(runId, { completed: true });
  return h.github.dispatches.length > before ? ["dispatched"] : [];
}

// The run a dispatch started: its `resolve` job.
async function dispatchedRun(h: ResolveHarness, runId: string): Promise<void> {
  h.github.seedRun(runId, { completed: false });
  h.context.runId = runId;
  await wake(h, { ref: WORKFLOW.ref });
}

describe("three ticked stacks in a chain", () => {
  test("deploy in order, one layer per run, and the dashboard ends with nothing queued", async () => {
    const h = await scanned(TABLE, { config: CHAIN });
    tick(h, ALICE, ["site:prod", "app:prod", "network:prod"]);
    await wake(h);

    expect(await applyAndSettle(h, RESOLVE_RUN)).toEqual(["dispatched"]);
    expect(h.adapter.applied).toEqual(["network:prod"]);

    await dispatchedRun(h, "6161");
    expect((matrix(h) as MatrixEntry[]).map(({ stack }) => stack)).toEqual(["app:prod"]);
    expect(await applyAndSettle(h, "6161")).toEqual(["dispatched"]);
    expect(h.adapter.applied).toEqual(["network:prod", "app:prod"]);

    await dispatchedRun(h, "7171");
    expect((matrix(h) as MatrixEntry[]).map(({ stack }) => stack)).toEqual(["site:prod"]);
    expect(await applyAndSettle(h, "7171")).toEqual([]);
    expect(h.adapter.applied).toEqual(["network:prod", "app:prod", "site:prod"]);

    // Each deploy went out with the hash its tick approved, under alice.
    const ends = h.github
      .deploymentsOf("sluiceway")
      .filter(({ status }) => status?.state === "success")
      .map(({ task, payload }) => ({ task, ticker: (payload as { ticker: string }).ticker }));
    expect(ends).toEqual([
      { task: "sluiceway:network:prod", ticker: "alice" },
      { task: "sluiceway:app:prod", ticker: "alice" },
      { task: "sluiceway:site:prod", ticker: "alice" },
    ]);
    expect(Object.values(rowsOf(h)).some((row) => row.includes('state="queued"'))).toBe(false);

    // A dispatch with nothing queued starts nothing.
    await dispatchedRun(h, "8181");
    expect(matrix(h)).toEqual([]);
  });
});
