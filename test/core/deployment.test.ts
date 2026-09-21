import { describe, expect, test } from "bun:test";
import {
  type DeployFact,
  type DeploymentRecord,
  deployFacts,
  deploymentPayload,
  deploymentTask,
  readDeploymentPayload,
  rowAtLateRead,
  taskStackId,
} from "../../src/core/deployment.ts";

describe("the task of a deployment record", () => {
  test("is the stack id behind the fixed prefix of record 0003", () => {
    expect(deploymentTask("apps/grafana:prod")).toBe("sluiceway:apps/grafana:prod");
  });

  test("reads back as the stack id", () => {
    expect(taskStackId("sluiceway:apps/grafana:prod")).toBe("apps/grafana:prod");
  });

  test("a task that is not Sluiceway's names no stack", () => {
    // GitHub's own default, which a job level `environment:` key gives.
    expect(taskStackId("deploy")).toBeUndefined();
    expect(taskStackId("other:sluiceway:apps")).toBeUndefined();
    expect(taskStackId("sluiceway:")).toBeUndefined();
  });
});

describe("the payload of a deployment record", () => {
  const facts = { hash: "2b44350653e84a11", ticker: "alice", run: "4242" };

  test("is versioned and carries the approved hash, the ticker and the run", () => {
    // The fixed shape of section 3 of the build plan.
    expect(deploymentPayload(facts)).toEqual({
      v: 1,
      hash: "2b44350653e84a11",
      ticker: "alice",
      run: "4242",
    });
  });

  test("reads back as the same facts", () => {
    expect(readDeploymentPayload(deploymentPayload(facts))).toEqual(facts);
  });

  test("a payload of another version is not read", () => {
    expect(readDeploymentPayload({ ...deploymentPayload(facts), v: 2 })).toBeUndefined();
    expect(readDeploymentPayload({ hash: "2b44350653e84a11", ticker: "alice", run: "4242" })).toBe(
      undefined,
    );
  });

  test("a payload that is not an object, or misses a fact, is not read", () => {
    for (const payload of [null, undefined, "", "{}", 7, [], {}, { v: 1 }]) {
      expect(readDeploymentPayload(payload)).toBeUndefined();
    }
    expect(readDeploymentPayload({ v: 1, hash: "h", ticker: "alice" })).toBeUndefined();
    expect(readDeploymentPayload({ v: 1, hash: "h", ticker: 7, run: "4242" })).toBeUndefined();
  });

  test("a run that is not a run id is not read, so no request is built from it", () => {
    expect(readDeploymentPayload({ v: 1, hash: "h", ticker: "alice", run: "../1" })).toBe(
      undefined,
    );
    expect(readDeploymentPayload({ v: 1, hash: "h", ticker: "alice", run: "" })).toBeUndefined();
  });
});

function record(over: Partial<DeploymentRecord> & { state?: string; at?: string } = {}) {
  const { state, at, ...rest } = over;
  return {
    id: 1,
    task: "sluiceway:apps/grafana:prod",
    environment: "sluiceway",
    sha: "0123456789abcdef0123456789abcdef01234567",
    payload: { v: 1, hash: "2b44350653e84a11", ticker: "alice", run: "4242" },
    createdAt: "2026-09-21T08:50:00Z",
    status:
      state === undefined
        ? undefined
        : { state, description: "", createdAt: at ?? "2026-09-21T08:52:10Z" },
    ...rest,
  } satisfies DeploymentRecord;
}

describe("the deploy facts of a stack", () => {
  test("a queued record is an open deployment that waits to start", () => {
    expect(deployFacts([record({ id: 7, state: "queued" })]).byStack).toEqual(
      new Map([
        [
          "apps/grafana:prod",
          { kind: "open", deployment: 7, waiting: true, ticker: "alice", run: "4242" },
        ],
      ]),
    );
  });

  test("a record in progress is open and no longer waits", () => {
    const { byStack } = deployFacts([record({ state: "in_progress" })]);
    expect(byStack.get("apps/grafana:prod")).toMatchObject({ kind: "open", waiting: false });
  });

  test("a record without a status yet, or in a state that is no result, is open", () => {
    for (const state of [undefined, "pending", "waiting", "a-state-of-tomorrow"]) {
      const { byStack } = deployFacts([record(state === undefined ? {} : { state })]);
      expect(byStack.get("apps/grafana:prod")).toMatchObject({ kind: "open", waiting: true });
    }
  });

  test("success is a deploy that went out, at the time of its status", () => {
    const { byStack } = deployFacts([record({ state: "success", at: "2026-09-21T09:41:30Z" })]);
    expect(byStack.get("apps/grafana:prod")).toEqual({
      kind: "succeeded",
      ticker: "alice",
      run: "4242",
      at: new Date("2026-09-21T09:41:30Z"),
    });
  });

  test("inactive reads as succeeded, then superseded (record 0003)", () => {
    const { byStack } = deployFacts([record({ state: "inactive" })]);
    expect(byStack.get("apps/grafana:prod")).toMatchObject({ kind: "succeeded" });
  });

  test("failure and error are a failed deploy with the reason on the status", () => {
    for (const state of ["failure", "error"]) {
      const failed = record({ state, at: "2026-09-21T08:52:10Z" });
      failed.status = { ...failed.status, description: "the tool exited with an error" } as never;
      expect(deployFacts([failed]).byStack.get("apps/grafana:prod")).toEqual({
        kind: "failed",
        reason: "the tool exited with an error",
        ticker: "alice",
        run: "4242",
        at: new Date("2026-09-21T08:52:10Z"),
      });
    }
  });

  test("a failed record without a reason says so in Sluiceway's own words", () => {
    const { byStack } = deployFacts([record({ state: "failure" })]);
    expect(byStack.get("apps/grafana:prod")).toMatchObject({ reason: "no reason was recorded" });
  });

  test("only the newest record of a stack counts, whatever the order", () => {
    const older = record({ id: 1, createdAt: "2026-09-21T08:00:00Z", state: "failure" });
    const newer = record({ id: 2, createdAt: "2026-09-21T09:00:00Z", state: "success" });
    for (const records of [
      [older, newer],
      [newer, older],
    ]) {
      expect(deployFacts(records).byStack.get("apps/grafana:prod")).toMatchObject({
        kind: "succeeded",
      });
    }
  });

  test("two records of one second: the higher id is the newer one", () => {
    const first = record({ id: 1, state: "success" });
    const second = record({ id: 2, state: "queued" });
    expect(deployFacts([second, first]).byStack.get("apps/grafana:prod")).toMatchObject({
      kind: "open",
      deployment: 2,
    });
  });

  test("a record that is not Sluiceway's is never read", () => {
    const { byStack, succeeded } = deployFacts([record({ task: "deploy", state: "success" })]);
    expect(byStack.size).toBe(0);
    expect(succeeded).toEqual([]);
  });

  test("a record with a payload of another version is left alone and counted", () => {
    const other = record({ payload: { v: 2, hash: "h", ticker: "alice", run: "4242" } });
    const facts = deployFacts([other, record({ id: 2, task: "sluiceway:b", state: "success" })]);
    expect([...facts.byStack.keys()]).toEqual(["b"]);
    expect(facts.unread).toBe(1);
  });

  test("every success is handed over for recently deployed, older ones of a stack too", () => {
    const { succeeded } = deployFacts([
      record({
        id: 1,
        createdAt: "2026-09-21T08:00:00Z",
        state: "inactive",
        at: "2026-09-21T08:05:00Z",
      }),
      record({
        id: 2,
        createdAt: "2026-09-21T09:00:00Z",
        state: "success",
        at: "2026-09-21T09:05:00Z",
      }),
      record({ id: 3, createdAt: "2026-09-21T10:00:00Z", state: "failure" }),
      record({ id: 4, task: "sluiceway:b", state: "queued" }),
    ]);
    expect(succeeded).toEqual([
      {
        stackId: "apps/grafana:prod",
        ticker: "alice",
        run: "4242",
        at: new Date("2026-09-21T08:05:00Z"),
      },
      {
        stackId: "apps/grafana:prod",
        ticker: "alice",
        run: "4242",
        at: new Date("2026-09-21T09:05:00Z"),
      },
    ]);
  });
});

describe("which row a stack gets at the late read of a scan (record 0004)", () => {
  const previewedAt = new Date("2026-09-21T10:00:00Z");
  const before = new Date("2026-09-21T09:59:59Z");
  const after = new Date("2026-09-21T10:00:01Z");
  const open: DeployFact = {
    kind: "open",
    deployment: 7,
    waiting: true,
    ticker: "alice",
    run: "4242",
  };
  const succeeded = (at: Date): DeployFact => ({
    kind: "succeeded",
    ticker: "alice",
    run: "1",
    at,
  });
  const failed = (at: Date): DeployFact => ({
    kind: "failed",
    reason: "the tool exited with an error",
    ticker: "alice",
    run: "1",
    at,
  });

  test("a stack with an open deployment is deploying, whatever the preview says", () => {
    expect(rowAtLateRead({ previewedAt, liveState: "pending", fact: open })).toEqual({
      row: "deploying",
      from: "record",
    });
    expect(rowAtLateRead({ previewedAt: undefined, liveState: undefined, fact: open })).toEqual({
      row: "deploying",
      from: "record",
    });
  });

  test("a live deploying row of an open deployment stays as `resolve` wrote it", () => {
    expect(rowAtLateRead({ previewedAt, liveState: "deploying", fact: open })).toEqual({
      row: "deploying",
      from: "live",
    });
  });

  test("a previewed stack with no record, or one that ended before its preview, gets its fresh row", () => {
    for (const fact of [undefined, succeeded(before), failed(before), succeeded(previewedAt)]) {
      expect(rowAtLateRead({ previewedAt, liveState: "pending", fact })).toEqual({ row: "fresh" });
    }
  });

  test("a deploy that ended after the preview started keeps the live row: the preview predates it", () => {
    for (const fact of [succeeded(after), failed(after)]) {
      expect(rowAtLateRead({ previewedAt, liveState: "in-sync", fact })).toEqual({ row: "live" });
    }
  });

  test("with no live row to keep, or one that still says deploying, the stack is previewed again", () => {
    for (const liveState of [undefined, "deploying"]) {
      expect(rowAtLateRead({ previewedAt, liveState, fact: succeeded(after) })).toEqual({
        row: "preview-first",
        why: "deploy-ended",
      });
    }
  });

  test("a stack is previewed again for this once, then its fresh row is taken", () => {
    expect(
      rowAtLateRead({ previewedAt, liveState: undefined, fact: succeeded(after), again: true }),
    ).toEqual({ row: "fresh" });
  });

  test("a record this scan settled has no writer behind it, so the fresh row is taken", () => {
    expect(
      rowAtLateRead({
        previewedAt,
        liveState: "deploying",
        fact: failed(after),
        settledHere: true,
      }),
    ).toEqual({ row: "fresh" });
  });

  test("a stack this scan did not preview keeps its live row", () => {
    for (const fact of [undefined, succeeded(after), failed(before)]) {
      expect(rowAtLateRead({ previewedAt: undefined, liveState: "pending", fact })).toEqual({
        row: "live",
      });
    }
  });

  test("a live deploying row with no open deployment is previewed: nobody else will repair it", () => {
    for (const fact of [undefined, succeeded(before), failed(after)]) {
      expect(rowAtLateRead({ previewedAt: undefined, liveState: "deploying", fact })).toEqual({
        row: "preview-first",
        why: "no-open-deployment",
      });
    }
  });

  test("a stack with neither a preview nor a live row is previewed (record 0011)", () => {
    expect(
      rowAtLateRead({ previewedAt: undefined, liveState: undefined, fact: undefined }),
    ).toEqual({ row: "preview-first", why: "no-row" });
  });
});
