import { describe, expect, test } from "bun:test";
import {
  type DeploymentRecord,
  deploymentPayload,
  deploymentTask,
} from "../../src/core/deployment.ts";
import {
  type OutsideDeploy,
  outsideDeploys,
  ownRuns,
  trailOutside,
} from "../../src/core/outside-deploy.ts";

// Record 0073: a deploy in the tool's history is Sluiceway's own when a
// deployment record of the same stack carries the run it ran in. Every other
// one is an outside deploy.

function record(id: number, stackId: string, run: string, payload?: unknown): DeploymentRecord {
  return {
    id,
    task: deploymentTask(stackId),
    environment: "sluiceway",
    sha: "a".repeat(40),
    payload: payload ?? deploymentPayload({ hash: "2b44350653e84a11", ticker: "alice", run }),
    createdAt: "2026-09-21T08:00:00Z",
    status: { state: "success", description: "", createdAt: "2026-09-21T08:05:00Z" },
  };
}

const at = (iso: string) => new Date(iso);

describe("the runs of Sluiceway's own deploys", () => {
  test("are the runs on every readable record, per stack", () => {
    const runs = ownRuns([
      record(1, "network:dev", "111"),
      record(2, "network:dev", "222"),
      record(3, "app:prod", "333"),
      // Not Sluiceway's, and a payload this version cannot read.
      { ...record(4, "network:dev", "444"), task: "deploy" },
      record(5, "network:dev", "555", { v: 2, run: "555" }),
    ]);
    expect(runs).toEqual(
      new Map([
        ["network:dev", new Set(["111", "222"])],
        ["app:prod", new Set(["333"])],
      ]),
    );
  });
});

describe("an outside deploy", () => {
  const history = [
    {
      kind: "destroy" as const,
      endedAt: at("2026-09-21T10:00:00Z"),
      commit: { sha: "c".repeat(40), dirty: true },
    },
    { kind: "deploy" as const, endedAt: at("2026-09-21T09:00:00Z"), runId: "999" },
    { kind: "deploy" as const, endedAt: at("2026-09-21T08:00:00Z"), runId: "111" },
    { kind: "deploy" as const, endedAt: at("2026-09-21T07:00:00Z") },
  ];

  test("is every deploy whose run no record of the stack carries", () => {
    expect(outsideDeploys("network:dev", history, new Set(["111"]))).toEqual([
      {
        stackId: "network:dev",
        kind: "destroy",
        at: at("2026-09-21T10:00:00Z"),
        commit: "c".repeat(40),
        dirty: true,
      },
      { stackId: "network:dev", kind: "deploy", at: at("2026-09-21T09:00:00Z") },
      { stackId: "network:dev", kind: "deploy", at: at("2026-09-21T07:00:00Z") },
    ]);
  });

  // A run of another stack's record says nothing about this one.
  test("with no record of the stack, every deploy is outside", () => {
    expect(outsideDeploys("network:dev", history, undefined)).toHaveLength(4);
  });
});

describe("the outside deploys on the trail", () => {
  const live: OutsideDeploy[] = [
    { stackId: "network:dev", kind: "deploy", at: at("2026-09-20T09:00:00Z") },
    { stackId: "app:prod", kind: "deploy", at: at("2026-09-20T08:00:00Z") },
    { stackId: "gone:prod", kind: "deploy", at: at("2026-09-20T07:00:00Z") },
  ];

  test("a stack whose history was read gets what it read, every other keeps its lines", () => {
    const fresh: OutsideDeploy[] = [
      { stackId: "network:dev", kind: "destroy", at: at("2026-09-21T09:00:00Z") },
    ];
    expect(
      trailOutside(["app:prod", "network:dev"], new Map([["network:dev", fresh]]), live),
    ).toEqual([fresh[0], live[1]] as OutsideDeploy[]);
  });

  test("a stack the repo no longer has loses its lines", () => {
    expect(trailOutside(["app:prod", "network:dev"], new Map(), live)).toEqual([
      live[0],
      live[1],
    ] as OutsideDeploy[]);
  });

  test("a history that holds nothing outside clears the stack's lines", () => {
    expect(trailOutside(["network:dev"], new Map([["network:dev", []]]), live)).toEqual([]);
  });
});
