import { describe, expect, test } from "bun:test";
import { planDeploys, queueState, withReadDependencies } from "../../src/core/dependencies.ts";
import {
  type DeploymentRecord,
  deployFacts,
  deploymentPayload,
  HANDED_ON_DESCRIPTION,
  readDeploymentPayload,
} from "../../src/core/deployment.ts";

// The rules of record 0056. A stack waits only on the stacks it names in
// `dependsOn`, and only on a change that can still go out: a pending row, a
// deploy that is open, or a tick in the same run.

const chain = new Map([
  ["app:prod", ["network:prod"]],
  ["site:prod", ["app:prod"]],
]);

const plan = (
  allowed: string[],
  options: { pending?: string[]; open?: string[]; dependsOn?: Map<string, string[]> } = {},
) =>
  planDeploys({
    allowed,
    dependsOn: options.dependsOn ?? chain,
    pending: new Set(options.pending ?? []),
    open: new Set(options.open ?? []),
  });

describe("planDeploys", () => {
  test("stacks without dependencies all start", () => {
    expect(plan(["network:dev", "network:prod"])).toEqual({
      start: ["network:dev", "network:prod"],
      queued: [],
      refused: [],
    });
  });

  test("a tick whose dependency has a change waiting and is not ticked is refused, naming it", () => {
    expect(plan(["app:prod"], { pending: ["network:prod", "app:prod"] })).toEqual({
      start: [],
      queued: [],
      refused: [{ stackId: "app:prod", waitingOn: ["network:prod"] }],
    });
  });

  test("a dependency that is in sync or failed its preview holds nothing back", () => {
    expect(plan(["app:prod"], { pending: ["app:prod"] }).start).toEqual(["app:prod"]);
  });

  test("a refusal travels down the chain in the same run", () => {
    expect(plan(["app:prod", "site:prod"], { pending: ["network:prod"] }).refused).toEqual([
      { stackId: "app:prod", waitingOn: ["network:prod"] },
      { stackId: "site:prod", waitingOn: ["app:prod"] },
    ]);
  });

  test("three ticked stacks in a chain: the first layer starts, the rest are queued behind the one before", () => {
    expect(
      plan(["app:prod", "network:prod", "site:prod"], {
        pending: ["network:prod", "app:prod", "site:prod"],
      }),
    ).toEqual({
      start: ["network:prod"],
      queued: [
        { stackId: "app:prod", behind: ["network:prod"] },
        { stackId: "site:prod", behind: ["app:prod"] },
      ],
      refused: [],
    });
  });

  test("a tick on a stack whose dependency is deploying is queued behind it", () => {
    expect(plan(["app:prod"], { open: ["network:prod"], pending: ["network:prod"] })).toEqual({
      start: [],
      queued: [{ stackId: "app:prod", behind: ["network:prod"] }],
      refused: [],
    });
  });

  test("two dependencies: queued behind both, in stack id order", () => {
    const two = new Map([["site:prod", ["network:prod", "app:prod"]]]);
    expect(plan(["site:prod", "network:prod", "app:prod"], { dependsOn: two })).toEqual({
      start: ["app:prod", "network:prod"],
      queued: [{ stackId: "site:prod", behind: ["app:prod", "network:prod"] }],
      refused: [],
    });
  });
});

let nextId = 1;
function record(
  stack: string,
  state: string | undefined,
  options: { at: string; description?: string; behind?: string[] },
): DeploymentRecord {
  return {
    id: nextId++,
    task: `sluiceway:${stack}`,
    environment: "sluiceway",
    sha: "abc",
    payload: deploymentPayload({
      hash: "0123456789abcdef",
      ticker: "alice",
      run: "7",
      ...(options.behind ? { behind: options.behind } : {}),
    }),
    createdAt: options.at,
    status:
      state === undefined
        ? undefined
        : { state, description: options.description ?? "", createdAt: options.at },
  };
}

describe("the payload of a queued record", () => {
  test("carries the stacks it waits behind, and reads back", () => {
    const payload = deploymentPayload({
      hash: "0123456789abcdef",
      ticker: "alice",
      run: "7",
      behind: ["network:prod"],
    });
    expect(payload).toEqual({
      v: 1,
      hash: "0123456789abcdef",
      ticker: "alice",
      run: "7",
      behind: ["network:prod"],
    });
    expect(readDeploymentPayload(payload)?.behind).toEqual(["network:prod"]);
  });

  test("a payload without it is the payload of every other record", () => {
    expect(deploymentPayload({ hash: "h", ticker: "alice", run: "7" })).toEqual({
      v: 1,
      hash: "h",
      ticker: "alice",
      run: "7",
    });
  });

  test("a behind that is not a list of stack ids is not read", () => {
    expect(
      readDeploymentPayload({ v: 1, hash: "h", ticker: "alice", run: "7", behind: "x" }),
    ).toBeUndefined();
  });

  test("an open queued record is an open deployment that says what it waits behind", () => {
    const facts = deployFacts([
      record("app:prod", "queued", { at: "2026-09-22T10:00:00Z", behind: ["network:prod"] }),
    ]);
    expect(facts.byStack.get("app:prod")).toMatchObject({
      kind: "open",
      behind: ["network:prod"],
    });
  });

  test("a record handed on to a later run is no deploy fact and no line of the trail", () => {
    const facts = deployFacts([
      record("app:prod", "success", { at: "2026-09-22T09:00:00Z" }),
      record("app:prod", "inactive", {
        at: "2026-09-22T10:00:00Z",
        description: HANDED_ON_DESCRIPTION,
        behind: ["network:prod"],
      }),
    ]);
    expect(facts.byStack.get("app:prod")?.kind).toBe("succeeded");
    expect(facts.succeeded).toHaveLength(1);
  });
});

describe("queueState", () => {
  const at = "2026-09-22T10:00:00Z";
  const later = "2026-09-22T10:05:00Z";

  test("waiting while a stack it waits behind is open", () => {
    expect(queueState(["network:prod"], [record("network:prod", "in_progress", { at })])).toBe(
      "waiting",
    );
  });

  test("ready once every stack it waits behind went out", () => {
    expect(
      queueState(
        ["network:prod", "network:dev"],
        [record("network:prod", "success", { at }), record("network:dev", "inactive", { at })],
      ),
    ).toBe("ready");
  });

  test("a stack that had nothing to deploy, or was rehearsed, lets it go on", () => {
    expect(
      queueState(
        ["network:prod"],
        [
          record("network:prod", "failure", { at }),
          record("network:prod", "inactive", {
            at: later,
            description: "rehearsed, nothing was deployed",
          }),
        ],
      ),
    ).toBe("ready");
  });

  test("dead when a stack it waits behind failed, and when it has no record at all", () => {
    expect(queueState(["network:prod"], [record("network:prod", "error", { at })])).toBe("dead");
    expect(queueState(["network:prod"], [])).toBe("dead");
  });

  test("a record handed on is skipped: the newer one counts", () => {
    expect(
      queueState(
        ["app:prod"],
        [
          record("app:prod", "queued", { at: later, behind: ["network:prod"] }),
          record("app:prod", "inactive", { at, description: HANDED_ON_DESCRIPTION }),
        ],
      ),
    ).toBe("waiting");
  });
});

// `dependsOn: auto` (slice 4.7, record 0059): `resolve` adds what a stack's
// row says its preview read to what sluiceway.yaml names. A read that names a
// stack discovery does not know, or the stack itself, is left out, and one
// that would close a circle is dropped and named, so a chain can never wait
// on itself.
describe("withReadDependencies", () => {
  const configured = new Map<string, string[]>([
    ["app:prod", []],
    ["db:prod", []],
    ["network:prod", []],
    ["site:prod", ["app:prod"]],
  ]);

  test("adds what the row read, only for a stack with auto", () => {
    const { dependsOn, dropped } = withReadDependencies({
      configured,
      auto: new Set(["app:prod"]),
      read: new Map([
        ["app:prod", ["network:prod", "db:prod"]],
        ["db:prod", ["network:prod"]],
      ]),
    });
    expect(dependsOn.get("app:prod")).toEqual(["db:prod", "network:prod"]);
    // db:prod has no auto, so its row is not read.
    expect(dependsOn.get("db:prod")).toEqual([]);
    expect(dependsOn.get("site:prod")).toEqual(["app:prod"]);
    expect(dropped).toEqual([]);
  });

  test("keeps what the file names, and each stack once", () => {
    const { dependsOn } = withReadDependencies({
      configured: new Map([...configured, ["app:prod", ["network:prod"]]]),
      auto: new Set(["app:prod"]),
      read: new Map([["app:prod", ["network:prod", "db:prod"]]]),
    });
    expect(dependsOn.get("app:prod")).toEqual(["db:prod", "network:prod"]);
  });

  test("a stack discovery does not know, and the stack itself, are left out", () => {
    const { dependsOn } = withReadDependencies({
      configured,
      auto: new Set(["app:prod"]),
      read: new Map([["app:prod", ["gone:prod", "app:prod"]]]),
    });
    expect(dependsOn.get("app:prod")).toEqual([]);
  });

  test("a read that closes a circle is dropped and named", () => {
    const { dependsOn, dropped } = withReadDependencies({
      configured,
      auto: new Set(["app:prod", "network:prod"]),
      read: new Map([
        // site:prod depends on app:prod in the file.
        ["app:prod", ["site:prod", "network:prod"]],
        ["network:prod", ["app:prod"]],
      ]),
    });
    expect(dependsOn.get("app:prod")).toEqual(["network:prod"]);
    expect(dependsOn.get("network:prod")).toEqual([]);
    expect(dropped).toEqual([
      { stackId: "app:prod", dependency: "site:prod" },
      { stackId: "network:prod", dependency: "app:prod" },
    ]);
  });
});
