import { describe, expect, test } from "bun:test";
import {
  type DeploymentRecord,
  deployFacts,
  lastDeployedCommit,
  REHEARSED_DESCRIPTION,
} from "../../src/core/deployment.ts";

// Slice 4.11 (record 0062): the trail of recently deployed lists every deploy
// that ended, failed ones too, at the time it really ended.

const SHA = "0123456789abcdef0123456789abcdef01234567";

function record(
  over: Partial<DeploymentRecord> & {
    state: string;
    at?: string;
    description?: string;
    succeededAt?: string;
  },
): DeploymentRecord {
  const { state, at, description, succeededAt, ...rest } = over;
  return {
    id: 1,
    task: "sluiceway:apps/grafana:prod",
    environment: "sluiceway",
    sha: SHA,
    payload: { v: 1, hash: "2b44350653e84a11", ticker: "alice", run: "4242" },
    createdAt: "2026-09-21T08:50:00Z",
    status: {
      state,
      description: description ?? "",
      createdAt: at ?? "2026-09-21T08:52:10Z",
      ...(succeededAt === undefined ? {} : { succeededAt }),
    },
    ...rest,
  };
}

describe("the trail", () => {
  test("a failed deploy is a line of the trail, with its reason", () => {
    const facts = deployFacts([
      record({ state: "failure", description: "the deploy failed", at: "2026-09-21T09:00:00Z" }),
    ]);
    expect(facts.trail).toEqual([
      {
        stackId: "apps/grafana:prod",
        ticker: "alice",
        run: "4242",
        at: new Date("2026-09-21T09:00:00Z"),
        result: "failed",
        reason: "the deploy failed",
      },
    ]);
  });

  test("an error is a failed deploy too, and one without words gets the fixed ones", () => {
    const facts = deployFacts([record({ state: "error" })]);
    expect(facts.trail).toMatchObject([{ result: "failed", reason: "no reason was recorded" }]);
  });

  test("a failed deploy is never where attribution starts", () => {
    const facts = deployFacts([
      record({ id: 1, state: "success", createdAt: "2026-09-21T08:00:00Z" }),
      record({
        id: 2,
        state: "failure",
        createdAt: "2026-09-21T09:00:00Z",
        sha: "fedcba9876543210fedcba9876543210fedcba98",
      }),
    ]);
    expect(lastDeployedCommit(facts, "apps/grafana:prod")).toBe(SHA);
    expect(facts.succeeded).toHaveLength(1);
  });

  test("holds every ended deploy, oldest first, and no open one", () => {
    const rehearsal = record({
      id: 3,
      state: "inactive",
      description: REHEARSED_DESCRIPTION,
      createdAt: "2026-09-21T10:00:00Z",
      at: "2026-09-21T10:01:00Z",
    });
    const facts = deployFacts([
      record({ id: 4, state: "in_progress", createdAt: "2026-09-21T11:00:00Z" }),
      rehearsal,
      record({ id: 2, state: "failure", createdAt: "2026-09-21T09:00:00Z" }),
      record({ id: 1, state: "success", createdAt: "2026-09-21T08:00:00Z" }),
    ]);
    expect(facts.trail.map((line) => line.result ?? "deployed")).toEqual([
      "deployed",
      "failed",
      "rehearsed",
    ]);
  });
});

describe("the time of a superseded deploy", () => {
  test("is the time of its success while GitHub still keeps that status", () => {
    const facts = deployFacts([
      record({
        state: "inactive",
        at: "2026-09-21T12:00:00Z",
        succeededAt: "2026-09-21T08:53:00Z",
      }),
    ]);
    const real = new Date("2026-09-21T08:53:00Z");
    expect(facts.byStack.get("apps/grafana:prod")).toMatchObject({ kind: "succeeded", at: real });
    expect(facts.trail).toMatchObject([{ at: real }]);
  });

  test("is the time GitHub superseded it when the success is gone", () => {
    const facts = deployFacts([record({ state: "inactive", at: "2026-09-21T12:00:00Z" })]);
    expect(facts.trail).toMatchObject([{ at: new Date("2026-09-21T12:00:00Z") }]);
  });
});

// Slice 5.5 (record 0072): a deploy that went out says what it shipped, from
// the commit of the stack's success before it to its own commit.
describe("what a deploy shipped", () => {
  const at = (minute: number) => `2026-09-21T09:${String(minute).padStart(2, "0")}:00Z`;
  const one = (
    id: number,
    sha: string,
    state: string,
    rest: Parameters<typeof record>[0] | object = {},
  ) => record({ id, sha, state, at: at(id), createdAt: at(id), ...rest });
  const A = "a".repeat(40);
  const B = "b".repeat(40);
  const C = "c".repeat(40);
  const D = "d".repeat(40);

  test("runs from the success before it, an empty one included, to its own commit", () => {
    const facts = deployFacts([
      one(1, A, "success"),
      one(2, B, "success", { description: "nothing to deploy, already in sync" }),
      one(3, C, "failure"),
      one(4, D, "success"),
    ]);
    expect(facts.trail.map((entry) => entry.shipped)).toEqual([
      undefined,
      undefined,
      undefined,
      { from: B, to: D },
    ]);
  });

  test("a stack's first success in the records read says nothing: there is no guess", () => {
    expect(deployFacts([one(1, A, "success")]).trail[0]?.shipped).toBeUndefined();
  });

  test("a rehearsal ships nothing and is not where the next one starts", () => {
    const facts = deployFacts([
      one(1, A, "success"),
      one(2, B, "inactive", { description: REHEARSED_DESCRIPTION }),
      one(3, C, "success"),
    ]);
    expect(facts.trail.map((entry) => entry.shipped)).toEqual([
      undefined,
      undefined,
      { from: A, to: C },
    ]);
  });

  test("each stack has its own", () => {
    const facts = deployFacts([
      one(1, A, "success"),
      one(2, B, "success", { task: "sluiceway:apps/loki:prod" }),
      one(3, C, "success", { task: "sluiceway:apps/loki:prod" }),
    ]);
    expect(facts.trail.map((entry) => entry.shipped)).toEqual([
      undefined,
      undefined,
      { from: B, to: C },
    ]);
  });
});
