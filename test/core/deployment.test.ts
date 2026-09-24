import { describe, expect, test } from "bun:test";
import {
  type DeployFact,
  type DeploymentRecord,
  deployFacts,
  deploymentPayload,
  deploymentTask,
  IN_SYNC_DESCRIPTION,
  isOpenStatus,
  lastDeployedCommit,
  MERGED_DESCRIPTION,
  mergePayload,
  pendingAgain,
  REHEARSED_DESCRIPTION,
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

  // Slice 5.9: the attempt of the run that created the record, so a link
  // lands on that attempt after a re-run. An added key, so the version stays.
  test("carries the attempt of the run when it has one, and reads it back", () => {
    const withAttempt = { ...facts, attempt: "2" };
    expect(deploymentPayload(withAttempt)).toEqual({
      v: 1,
      hash: "2b44350653e84a11",
      ticker: "alice",
      run: "4242",
      attempt: "2",
    });
    expect(readDeploymentPayload(deploymentPayload(withAttempt))).toEqual(withAttempt);
  });

  test("an attempt that is not a number is left out, and the record is still read", () => {
    expect(readDeploymentPayload({ ...deploymentPayload(facts), attempt: "../2" })).toEqual(facts);
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

  test("the facts and the trail carry the attempt of the record's run (slice 5.9)", () => {
    const payload = { v: 1, hash: "2b44350653e84a11", ticker: "alice", run: "4242", attempt: "3" };
    const open = deployFacts([record({ id: 7, state: "queued", payload })]);
    expect(open.byStack.get("apps/grafana:prod")).toMatchObject({ run: "4242", attempt: "3" });
    const ended = deployFacts([record({ state: "failure", payload })]);
    expect(ended.byStack.get("apps/grafana:prod")).toMatchObject({ attempt: "3" });
    expect(ended.trail[0]).toMatchObject({ run: "4242", attempt: "3" });
    const done = deployFacts([record({ state: "success", payload })]);
    expect(done.trail[0]).toMatchObject({ attempt: "3" });
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
      hash: "2b44350653e84a11",
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

  // Slice 2.20 (record 0051): an empty fresh preview ends as success with a
  // fixed description, and the trail says so.
  test("a success with nothing to deploy is one, and says so for recently deployed", () => {
    const quiet = record({ state: "success", at: "2026-09-21T09:41:30Z" });
    quiet.status = { ...quiet.status, description: IN_SYNC_DESCRIPTION } as never;
    const facts = deployFacts([quiet]);
    expect(IN_SYNC_DESCRIPTION).toBe("nothing to deploy, already in sync");
    expect(facts.byStack.get("apps/grafana:prod")).toMatchObject({ kind: "succeeded" });
    expect(facts.succeeded).toEqual([
      {
        stackId: "apps/grafana:prod",
        ticker: "alice",
        run: "4242",
        at: new Date("2026-09-21T09:41:30Z"),
        sha: "0123456789abcdef0123456789abcdef01234567",
        result: "in-sync",
      },
    ]);
    // It is where the stack was in sync, so attribution starts there.
    expect(lastDeployedCommit(facts, "apps/grafana:prod")).toBe(
      "0123456789abcdef0123456789abcdef01234567",
    );
  });

  // Slice 2.20 (record 0051): a rehearsal ends as inactive with fixed words.
  // Nothing went out, so it is no deploy fact of the stack and no start of its
  // attribution, and the trail lists it as rehearsed.
  test("a rehearsal is listed for the trail and changes nothing else", () => {
    const failed = record({ id: 1, createdAt: "2026-09-21T08:00:00Z", state: "failure" });
    const rehearsal = record({
      id: 2,
      createdAt: "2026-09-21T09:00:00Z",
      state: "inactive",
      at: "2026-09-21T09:05:00Z",
      sha: "fedcba9876543210fedcba9876543210fedcba98",
    });
    rehearsal.status = { ...rehearsal.status, description: REHEARSED_DESCRIPTION } as never;
    const facts = deployFacts([failed, rehearsal]);
    expect(REHEARSED_DESCRIPTION).toBe("rehearsed, nothing was deployed");
    expect(facts.byStack.get("apps/grafana:prod")).toMatchObject({ kind: "failed" });
    expect(facts.succeeded).toEqual([
      {
        stackId: "apps/grafana:prod",
        ticker: "alice",
        run: "4242",
        at: new Date("2026-09-21T09:05:00Z"),
        sha: "fedcba9876543210fedcba9876543210fedcba98",
        result: "rehearsed",
      },
    ]);
    expect(lastDeployedCommit(facts, "apps/grafana:prod")).toBeUndefined();
  });

  // Slice 4.7 (record 0059): the trail says a deploy repaired drift. The
  // payload says the approved hash covered drift, and a success that did not
  // end as nothing to deploy went out with the drift put back. One that did
  // found the drift gone (record 0091).
  test("a success whose payload covers drift is listed as a drift repair, or as drift gone", () => {
    const payload = { v: 1, hash: "2b44350653e84a11", ticker: "alice", run: "4242", drift: true };
    const repaired = record({ id: 1, state: "success", payload });
    const nothing = record({ id: 2, createdAt: "2026-09-21T09:00:00Z", state: "success", payload });
    nothing.status = { ...nothing.status, description: IN_SYNC_DESCRIPTION } as never;
    const results = deployFacts([repaired, nothing]).succeeded.map(({ result }) => result);
    expect(results).toEqual(["drift-repaired", "drift-gone"]);
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
        sha: "0123456789abcdef0123456789abcdef01234567",
      },
      {
        stackId: "apps/grafana:prod",
        ticker: "alice",
        run: "4242",
        at: new Date("2026-09-21T09:05:00Z"),
        sha: "0123456789abcdef0123456789abcdef01234567",
      },
    ]);
  });
});

describe("the commit attribution starts from (record 0026)", () => {
  const first = "1".repeat(40);
  const second = "2".repeat(40);
  const third = "3".repeat(40);

  test("is the commit of the stack's newest success, whatever came after it and whatever other stacks did", () => {
    const facts = deployFacts([
      record({ id: 1, sha: first, createdAt: "2026-09-21T08:00:00Z", state: "inactive" }),
      record({ id: 2, sha: second, createdAt: "2026-09-21T09:00:00Z", state: "success" }),
      record({ id: 3, sha: third, createdAt: "2026-09-21T10:00:00Z", state: "failure" }),
      record({
        id: 4,
        task: "sluiceway:b",
        sha: third,
        createdAt: "2026-09-21T11:00:00Z",
        state: "success",
      }),
    ]);
    expect(lastDeployedCommit(facts, "apps/grafana:prod")).toBe(second);
  });

  test("is nothing for a stack with no success among the records", () => {
    const facts = deployFacts([record({ id: 3, state: "failure" })]);
    expect(lastDeployedCommit(facts, "apps/grafana:prod")).toBeUndefined();
    expect(lastDeployedCommit(facts, "apps/loki:prod")).toBeUndefined();
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
    hash: "2b44350653e84a11",
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

describe("whether a deployment record is still open (record 0019)", () => {
  const at = "2026-09-21T08:52:10Z";
  test("no status yet, queued and in progress are open", () => {
    expect(isOpenStatus(undefined)).toBe(true);
    expect(isOpenStatus({ state: "queued", description: "", createdAt: at })).toBe(true);
    expect(isOpenStatus({ state: "in_progress", description: "", createdAt: at })).toBe(true);
  });

  test("a state GitHub adds later is open too, so it is never taken for a result", () => {
    expect(isOpenStatus({ state: "waiting", description: "", createdAt: at })).toBe(true);
  });

  test("success, inactive, failure and error are results", () => {
    for (const state of ["success", "inactive", "failure", "error"]) {
      expect(isOpenStatus({ state, description: "", createdAt: at })).toBe(false);
    }
  });
});

describe("pending again right after a deploy (onboarding log, hurdle 21)", () => {
  const fact = (state: string, description = "") =>
    deployFacts([
      { ...record({ state }), status: { state, description, createdAt: "2026-09-21T08:52:10Z" } },
    ]).byStack.get("apps/grafana:prod");

  test("a deploy that went out with this same diff hash", () => {
    expect(pendingAgain(fact("success"), "2b44350653e84a11")).toBe(true);
    expect(pendingAgain(fact("inactive"), "2b44350653e84a11")).toBe(true);
  });

  test("not with another hash, not after a deploy that sent nothing, not without a success", () => {
    expect(pendingAgain(fact("success"), "0123456789abcdef")).toBe(false);
    expect(pendingAgain(fact("success", IN_SYNC_DESCRIPTION), "2b44350653e84a11")).toBe(false);
    expect(pendingAgain(fact("failure"), "2b44350653e84a11")).toBe(false);
    expect(pendingAgain(fact("queued"), "2b44350653e84a11")).toBe(false);
    expect(pendingAgain(undefined, "2b44350653e84a11")).toBe(false);
  });
});

// Slice 4.2 (record 0054): the record a merge tick opens. It carries the pull
// request and no hash, because nothing was previewed yet. A scan hands it on.
describe("a record that deploys after a merge", () => {
  const merge = { ticker: "alice", run: "4242", merge: 418 };

  test("carries the pull request instead of a hash", () => {
    expect(mergePayload(merge)).toEqual({ v: 1, ticker: "alice", run: "4242", merge: 418 });
  });

  test("reads back with an empty hash, which no preview ever gives", () => {
    expect(readDeploymentPayload(mergePayload(merge))).toEqual({ ...merge, hash: "" });
  });

  test("a merge that is not a pull request number is not read", () => {
    for (const bad of [0, -1, 1.5, "418", null]) {
      expect(readDeploymentPayload({ ...mergePayload(merge), merge: bad })).toBeUndefined();
    }
  });

  test("while it waits for its scan, the stack is deploying and the fact names the pull request", () => {
    const { byStack } = deployFacts([
      record({ id: 7, state: "queued", payload: mergePayload(merge) }),
    ]);
    expect(byStack.get("apps/grafana:prod")).toEqual({
      kind: "open",
      deployment: 7,
      waiting: true,
      ticker: "alice",
      run: "4242",
      merge: 418,
    });
  });

  test("once handed on it is no deploy fact and no line of the trail", () => {
    const failed = record({ id: 1, createdAt: "2026-09-21T08:00:00Z", state: "failure" });
    const handedOn = record({
      id: 2,
      createdAt: "2026-09-21T09:00:00Z",
      state: "inactive",
      payload: mergePayload(merge),
    });
    handedOn.status = { ...handedOn.status, description: MERGED_DESCRIPTION } as never;
    const facts = deployFacts([failed, handedOn]);
    expect(MERGED_DESCRIPTION).toBe("merged, the deploy follows in a record of its own");
    expect(facts.byStack.get("apps/grafana:prod")).toMatchObject({ kind: "failed" });
    expect(facts.succeeded).toEqual([]);
  });
});

// Record 0095: a record a stack set to on-merge opened after the scan of a
// merge says so, so its deploying row, its failure line and its line on the
// trail say "merged by" and never read as a tick.
describe("a record opened on merge", () => {
  const facts = { hash: "2b44350653e84a11", ticker: "alice", run: "4242" };

  test("carries onMerge, an added key, so the version stays 1", () => {
    expect(deploymentPayload({ ...facts, onMerge: true })).toEqual({
      v: 1,
      ...facts,
      onMerge: true,
    });
    expect(readDeploymentPayload({ v: 1, ...facts, onMerge: true })).toEqual({
      ...facts,
      onMerge: true,
    });
  });

  test("a record of a tick has no such key, byte for byte as before", () => {
    expect(deploymentPayload(facts)).toEqual({ v: 1, ...facts });
    expect(readDeploymentPayload({ v: 1, ...facts, onMerge: "yes" })).toEqual(facts);
  });

  test("an open, a failed and a succeeded record each say it, and so does the trail", () => {
    const payload = { v: 1, ...facts, onMerge: true };
    const open = deployFacts([record({ id: 1, task: "sluiceway:a", state: "queued", payload })]);
    expect(open.byStack.get("a")).toMatchObject({ kind: "open", onMerge: true });
    const failed = deployFacts([record({ id: 2, task: "sluiceway:b", state: "failure", payload })]);
    expect(failed.byStack.get("b")).toMatchObject({ kind: "failed", onMerge: true });
    expect(failed.trail[0]).toMatchObject({ result: "failed", onMerge: true });
    const went = deployFacts([record({ id: 3, task: "sluiceway:c", state: "success", payload })]);
    expect(went.byStack.get("c")).toMatchObject({ kind: "succeeded", onMerge: true });
    expect(went.trail[0]?.onMerge).toBe(true);
    const ticked = deployFacts([
      record({ id: 4, task: "sluiceway:d", state: "success", payload: { v: 1, ...facts } }),
    ]);
    expect("onMerge" in (ticked.trail[0] ?? {})).toBe(false);
  });
});

// Deploy windows (record 0104): a record that waits for the stack's deploy
// window carries `window`, an added key, and is a queued record without a
// stack to wait behind.
describe("a record that waits for the deploy window", () => {
  const facts = { hash: "2b44350653e84a11", ticker: "alice", run: "4242" };

  test("carries window, an added key written last, so the version stays 1", () => {
    const written = deploymentPayload({ ...facts, fingerprint: "f65a69fe79dd93c3", window: true });
    expect(written).toEqual({ v: 1, ...facts, fingerprint: "f65a69fe79dd93c3", window: true });
    expect(Object.keys(written).at(-1)).toBe("window");
    expect(readDeploymentPayload({ v: 1, ...facts, window: true })).toEqual({
      ...facts,
      window: true,
    });
  });

  test("a record of a tick inside the window has no such key, and only true is read", () => {
    expect(deploymentPayload(facts)).toEqual({ v: 1, ...facts });
    expect(readDeploymentPayload({ v: 1, ...facts, window: "soon" })).toEqual(facts);
  });

  test("may wait behind stacks and for the window at once", () => {
    const both = deploymentPayload({ ...facts, behind: ["b:prod"], window: true });
    expect(readDeploymentPayload(both)).toEqual({ ...facts, behind: ["b:prod"], window: true });
  });

  test("is an open deployment that waits, and the fact says for the window", () => {
    const payload = { v: 1, ...facts, window: true };
    const open = deployFacts([record({ id: 1, task: "sluiceway:a", state: "queued", payload })]);
    expect(open.byStack.get("a")).toEqual({
      kind: "open",
      deployment: 1,
      waiting: true,
      ticker: "alice",
      run: "4242",
      window: true,
    });
    // Once it ended, whether it waited says nothing about the deploy.
    const went = deployFacts([record({ id: 2, task: "sluiceway:c", state: "success", payload })]);
    expect("window" in (went.byStack.get("c") ?? {})).toBe(false);
  });

  test("gives a queued row at the late read of a scan, as a record behind a stack does", () => {
    const fact: DeployFact = {
      kind: "open",
      deployment: 7,
      waiting: true,
      ticker: "alice",
      run: "4242",
      window: true,
    };
    expect(rowAtLateRead({ previewedAt: undefined, liveState: "queued", fact })).toEqual({
      row: "deploying",
      from: "live",
    });
    expect(rowAtLateRead({ previewedAt: undefined, liveState: "deploying", fact })).toEqual({
      row: "deploying",
      from: "record",
    });
  });
});
