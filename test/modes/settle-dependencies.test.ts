import { describe, expect, test } from "bun:test";
import { type SettleContext, settle } from "../../src/modes/settle.ts";
import { change, pending } from "./harness.ts";
import {
  ALICE,
  matrix,
  RESOLVE_RUN,
  type ResolveHarness,
  scanned,
  tick,
  WORKFLOW,
  wake,
} from "./resolve-harness.ts";

// `settle` and queued records (record 0056): it starts the next layer by
// starting the workflow again, whose `resolve` takes the queued stacks on. It
// never gives a queued record of its run the "run ended" error, and ends one
// whose dependency did not go out.

const TABLE = {
  "app:prod": pending("app:prod", change("web")),
  "network:prod": pending("network:prod", change("vpc")),
  "site:prod": pending("site:prod", change("cdn")),
};

const CHAIN =
  "stacks:\n  - path: app\n    dependsOn: [network:prod]\n  - path: site\n    dependsOn: [app:prod]\n";

function settleContext(h: ResolveHarness): SettleContext {
  return {
    root: h.context.root,
    adapter: h.adapter,
    github: h.github,
    log: h.log,
    repoUrl: h.context.repoUrl,
    runId: h.context.runId,
    event: h.context.event,
    workflow: WORKFLOW,
  };
}

async function chain(): Promise<ResolveHarness> {
  const h = await scanned(TABLE, { config: CHAIN });
  tick(h, ALICE, ["site:prod", "app:prod", "network:prod"]);
  await wake(h);
  h.log.lines.length = 0;
  return h;
}

function recordOf(h: ResolveHarness, stack: string) {
  const record = h.github
    .deploymentsOf("sluiceway")
    .find(({ task }) => task === `sluiceway:${stack}`);
  if (!record) throw new Error(`no record of ${stack}`);
  return record;
}

function first(h: ResolveHarness): number {
  return (matrix(h) as { deployment: number }[])[0]?.deployment ?? 0;
}

describe("settle after a layer", () => {
  test("starts the workflow again when the layer went out, and leaves the queued records open", async () => {
    const h = await chain();
    h.github.addDeploymentStatus(first(h), { state: "success", autoInactive: false });

    await settle(settleContext(h));

    expect(h.github.dispatches).toEqual([{ workflow: WORKFLOW.file, ref: WORKFLOW.ref }]);
    expect(recordOf(h, "app:prod").status?.state).toBe("queued");
    expect(recordOf(h, "site:prod").status?.state).toBe("queued");
    expect(h.log.lines).toContain(
      "app:prod can start now: what it waited behind went out. Started the workflow again, and its resolve job starts it.",
    );
  });

  test("ends the queued records of its run when the layer failed, down the whole chain", async () => {
    const h = await chain();
    h.github.addDeploymentStatus(first(h), { state: "failure", autoInactive: false });

    await settle(settleContext(h));

    for (const stack of ["app:prod", "site:prod"]) {
      expect(recordOf(h, stack).status).toMatchObject({
        state: "failure",
        description: "a stack it depends on did not deploy",
      });
    }
    // The full scan that writes the rows again with their failure line.
    expect(h.github.dispatches).toHaveLength(1);
  });

  test("a layer that never reported ends as the run ended, and what waited behind it with it", async () => {
    const h = await chain();

    await settle(settleContext(h));

    expect(recordOf(h, "network:prod").status?.description).toBe("the run ended without a result");
    expect(recordOf(h, "app:prod").status?.description).toBe(
      "a stack it depends on did not deploy",
    );
  });

  test("while what a queued record waits behind is still open, nothing is started", async () => {
    const h = await chain();
    h.github.addDeploymentStatus(first(h), { state: "success", autoInactive: false });
    // A later run took app:prod on and is deploying it: site:prod still waits.
    h.github.addDeploymentStatus(recordOf(h, "app:prod").id, {
      state: "inactive",
      description: "started in a later run",
      autoInactive: false,
    });
    h.github.seedDeployment({
      task: "sluiceway:app:prod",
      payload: { v: 1, hash: "2b44350653e84a11", ticker: "alice", run: "6161" },
      status: { state: "in_progress" },
    });
    h.github.seedRun("6161", { completed: false });

    await settle(settleContext(h));

    expect(h.github.dispatches).toEqual([]);
    expect(recordOf(h, "site:prod").status?.state).toBe("queued");
    expect(RESOLVE_RUN).toBe(h.context.runId);
  });
});
