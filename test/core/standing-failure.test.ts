import { describe, expect, test } from "bun:test";
import {
  type DeploymentRecord,
  deployFacts,
  deploymentPayload,
  deploymentTask,
  REHEARSED_DESCRIPTION,
  standingFailure,
} from "../../src/core/deployment.ts";
import type { OutsideDeploy } from "../../src/core/outside-deploy.ts";

// Record 0076: a row shows the failure line only while no deploy of its
// stack, from the dashboard or outside it, ended after the failure. The trail
// keeps the failed deploy as history either way.

const STACK = "workspaces/proxmox/k8s:prod";

function record(
  id: number,
  state: string,
  at: string,
  options: { stackId?: string; description?: string } = {},
): DeploymentRecord {
  return {
    id,
    task: deploymentTask(options.stackId ?? STACK),
    environment: "sluiceway",
    sha: "a".repeat(40),
    payload: deploymentPayload({ hash: "2b44350653e84a11", ticker: "alice", run: String(id) }),
    createdAt: at,
    status: { state, description: options.description ?? "", createdAt: at },
  };
}

const failedAt1515 = record(1, "failure", "2026-09-22T15:15:00Z", {
  description: "the tool exited with an error",
});

function outside(at: string, options: Partial<OutsideDeploy> = {}): OutsideDeploy {
  return { stackId: STACK, kind: "deploy", at: new Date(at), ...options };
}

function standing(records: DeploymentRecord[], outsideDeploys: OutsideDeploy[] = []) {
  return standingFailure(STACK, deployFacts(records).byStack.get(STACK), outsideDeploys);
}

describe("the failure line of a row", () => {
  test("stands while the failed deploy is the stack's last deploy", () => {
    expect(standing([failedAt1515])).toMatchObject({
      kind: "failed",
      reason: "the tool exited with an error",
      ticker: "alice",
    });
  });

  test("goes once a deploy outside the dashboard ended after the failure", () => {
    expect(standing([failedAt1515], [outside("2026-09-22T15:24:00Z")])).toBeUndefined();
  });

  test("goes once a destroy outside the dashboard ended after the failure", () => {
    expect(
      standing([failedAt1515], [outside("2026-09-22T15:24:00Z", { kind: "destroy" })]),
    ).toBeUndefined();
  });

  test("stands when the outside deploy ended before the failure, or at the same moment", () => {
    expect(standing([failedAt1515], [outside("2026-09-22T15:00:00Z")])).toBeDefined();
    expect(standing([failedAt1515], [outside("2026-09-22T15:15:00Z")])).toBeDefined();
  });

  test("stands when the deploy after the failure is another stack's", () => {
    expect(
      standing([failedAt1515], [outside("2026-09-22T15:24:00Z", { stackId: "network:dev" })]),
    ).toBeDefined();
  });

  test("goes once a deploy from the dashboard ended after the failure", () => {
    expect(standing([failedAt1515, record(2, "success", "2026-09-22T15:24:00Z")])).toBeUndefined();
  });

  test("stands after a rehearsal, which deploys nothing", () => {
    const rehearsal = record(2, "inactive", "2026-09-22T15:24:00Z", {
      description: REHEARSED_DESCRIPTION,
    });
    expect(standing([failedAt1515, rehearsal])).toBeDefined();
  });

  test("a stack whose last deploy went out has none", () => {
    expect(standing([record(1, "success", "2026-09-22T15:15:00Z")])).toBeUndefined();
    expect(standing([])).toBeUndefined();
  });

  test("the trail keeps the failed deploy after an outside deploy", () => {
    expect(deployFacts([failedAt1515]).trail).toMatchObject([{ stackId: STACK, result: "failed" }]);
  });
});
