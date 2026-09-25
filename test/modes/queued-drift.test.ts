import { describe, expect, test } from "bun:test";
import type { DriftResult } from "../../src/adapters/adapter.ts";
import { type ApplyContext, apply } from "../../src/modes/apply.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { APPLY_JOB_ID } from "./apply-harness.ts";
import { ACTION_REF, change, drifted, inSync, pending, SHA, steppingClock } from "./harness.ts";
import {
  ALICE,
  matrix,
  RESOLVE_RUN,
  type ResolveHarness,
  rowsOf,
  scanned,
  tick,
  wake,
} from "./resolve-harness.ts";

// Issue 209, record 0091: a drift repair that waits behind a stack it depends
// on (record 0056) is started by a later run under a record of that run. That
// record has to say the hash covers drift (record 0055), or `apply` compares
// without the drift check, finds nothing and deploys nothing.

const CONFIG = "drift:\n  enabled: true\nstacks:\n  - path: app\n    dependsOn: [network:prod]\n";
const NEXT_RUN = "6161";
const gone = change("notes", "delete");

function table() {
  return {
    "network:prod": pending("network:prod", change("vpc")),
    "app:prod": inSync("app:prod"),
  };
}

function recordsOf(h: ResolveHarness, stackId: string) {
  return h.github.deploymentsOf("sluiceway").filter(({ task }) => task === `sluiceway:${stackId}`);
}

// Alice ticks the drifted stack and the one it depends on. The first goes
// out, and a run that a dispatch starts takes the queued repair on.
async function repairStarted(drifts: Record<string, DriftResult>) {
  const h = await scanned(table(), { config: CONFIG, event: "schedule", drifts });
  tick(h, ALICE, ["app:prod", "network:prod"]);
  await wake(h);
  const [first] = matrix(h) as { stack: string; deployment: number }[];
  h.github.addDeploymentStatus(first?.deployment ?? 0, { state: "success", autoInactive: false });
  h.github.seedRun(RESOLVE_RUN, { completed: true });
  h.github.seedRun(NEXT_RUN, { completed: false });
  h.context.runId = NEXT_RUN;
  h.outputs.length = 0;
  await wake(h, { ref: "refs/heads/main", workflow: ".github/workflows/sluiceway.yml" });
  const [entry] = matrix(h) as { stack: string; deployment: number }[];
  return { h, entry };
}

function applyContext(h: ResolveHarness, deploymentId: number): ApplyContext {
  return {
    root: h.context.root,
    env: { PATH: "/usr/bin" },
    mask: () => {},
    adapter: h.adapter,
    run: async () => {
      throw new Error("No test of the apply mode with a table adapter starts a process.");
    },
    github: h.github,
    log: h.log,
    previewTimeoutMinutes: 10,
    now: steppingClock(),
    repoUrl: h.context.repoUrl,
    runId: NEXT_RUN,
    runAttempt: "1",
    jobId: APPLY_JOB_ID,
    sha: SHA,
    actionRef: ACTION_REF,
    deploymentId,
    workflow: { file: "sluiceway.yml", ref: "refs/heads/main" },
    event: h.context.event,
  };
}

describe("a drift repair queued behind a dependency", () => {
  test("is queued with a record that says the hash covers drift", async () => {
    const drifts = { "app:prod": drifted("app:prod", gone) };
    const h = await scanned(table(), { config: CONFIG, event: "schedule", drifts });
    tick(h, ALICE, ["app:prod", "network:prod"]);

    await wake(h);

    expect((matrix(h) as { stack: string }[]).map(({ stack }) => stack)).toEqual(["network:prod"]);
    expect(recordsOf(h, "app:prod").map(({ payload }) => payload)).toEqual([
      expect.objectContaining({ behind: ["network:prod"], drift: true }),
    ]);
  });

  test("is started by a later run under a record that still says drift", async () => {
    const { h, entry } = await repairStarted({ "app:prod": drifted("app:prod", gone) });

    expect(entry?.stack).toBe("app:prod");
    const [queued, started] = recordsOf(h, "app:prod");
    expect(started?.id).toBe(entry?.deployment ?? -1);
    const approved = (queued?.payload as { hash?: string } | undefined)?.hash;
    expect(approved).toMatch(/^[0-9a-f]{16}$/);
    // What a handed-on record carries: the hash and the ticker the tick
    // approved, and the drift the hash covers. The run and its attempt are the
    // run that opens it, and it waits behind nothing any more.
    expect(started?.payload).toEqual({
      v: 1,
      hash: approved,
      ticker: "alice",
      run: NEXT_RUN,
      drift: true,
    });
  });

  test("checks drift again, deploys with the repair, and the trail says drift fixed", async () => {
    const drifts = { "app:prod": drifted("app:prod", gone) };
    const { h, entry } = await repairStarted(drifts);
    h.adapter.driftChecked.length = 0;

    await apply(applyContext(h, entry?.deployment ?? 0));

    expect(h.adapter.driftChecked).toEqual(["app:prod"]);
    expect(h.adapter.applied).toContain("app:prod");
    expect(h.adapter.repaired).toEqual(["app:prod"]);
    const row = parseDashboard(rowsOf(h)["app:prod"] ?? "").rows[0];
    expect(row).toMatchObject({ state: "in-sync", drift: false });
    expect(h.github.issue(h.number).body).toContain("- 🟢&nbsp;app:prod · drift fixed · alice · ");
  });
});
