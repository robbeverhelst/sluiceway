import { describe, expect, test } from "bun:test";
import type { ConfiguredStack } from "../../src/core/config.ts";
import type { NobodyReason, Tick } from "../../src/core/edit-history.ts";
import type { OpenPullRequest } from "../../src/core/merge-and-deploy.ts";
import { MAX_DEPLOYS_PER_RUN } from "../../src/core/resolve.ts";
import {
  type AllowedMerge,
  handOnConfirms,
  type Judgement,
  judgeMerges,
  judgeTicks,
  knownTicks,
  type LookedUp,
  type MergesRead,
  mergeAnswerRefusal,
  type NamedTick,
  type OpenDeployment,
  scanAfter,
  stacksToRead,
  type TicksRead,
  ticksToLookUp,
} from "../../src/core/tick-judgement.ts";
import type { ParsedRow, RowState } from "../../src/render/marker.ts";

// The judgement of the ticks of one `resolve` run, as a table at its
// interface: what was read goes in, the verdict comes out. No scan, no fake
// GitHub and no issue body.

function stack(id: string, extra: Partial<ConfiguredStack> = {}): ConfiguredStack {
  const [path = "", name = ""] = id.split(":");
  return {
    stack: { path, name, options: {} },
    environment: "sluiceway",
    tickers: "write",
    inputs: [],
    ...extra,
  };
}

function stacksOf(...list: ConfiguredStack[]): Map<string, ConfiguredStack> {
  return new Map(
    list.map((one) => [`${one.stack.path}:${one.stack.name}`, one] as [string, ConfiguredStack]),
  );
}

const STACKS = stacksOf(stack("a:prod"), stack("b:prod"), stack("c:prod"));

const row = (stackId: string, hash = `hash-${stackId}`): Tick => ({ kind: "row", stackId, hash });
const merge = (pr: number, stackIds: string[], head = "h".repeat(40)): Tick => ({
  kind: "merge",
  pr,
  stackIds,
  head,
});
const RESCAN: Tick = { kind: "rescan" };

function by(tick: Tick, login = "alice", type = "User"): NamedTick {
  return {
    tick,
    ticker: { named: true, editor: { login, type }, editedAt: "2026-09-22T10:00:00Z" },
  };
}

function nobody(tick: Tick, reason: NobodyReason): NamedTick {
  return { tick, ticker: { named: false, reason } };
}

// Rows of the live body in one state, each at the hash `hash-<id>`.
function rowsIn(state: RowState, ...ids: string[]): ParsedRow[] {
  return ids.map((stackId) => ({
    known: true,
    stackId,
    state,
    hash: `hash-${stackId}`,
    destroys: 0,
    failed: false,
    shortened: 0,
    drift: state === "drift",
    ticked: false,
    text: "",
  }));
}

function openFact(overrides: Partial<OpenDeployment> = {}): OpenDeployment {
  return { kind: "open", deployment: 9, waiting: false, ticker: "bob", run: "77", ...overrides };
}

function read(named: NamedTick[], overrides: Partial<TicksRead> = {}): TicksRead {
  return {
    named,
    stacks: STACKS,
    open: new Map(),
    rows: [],
    deploys: true,
    phases: [],
    ...overrides,
  };
}

type Answer =
  | { outcome: "allowed" }
  | { outcome: "refused"; reason: "no-write-access" }
  | { outcome: "unverified"; error: unknown }
  | { outcome: "not-a-person" };

// Every lookup the judgement asked for, answered the same way.
function answered(input: TicksRead, answer: Answer = { outcome: "allowed" }): LookedUp[] {
  return ticksToLookUp(input).map((tick) => ({ tick, ...answer }));
}

// With the boxes to clear as lists: `toMatchObject` does not look inside a Map.
function judged(input: TicksRead, answer?: Answer) {
  return plain(judgeTicks(input, answered(input, answer)));
}

function plain(judgement: Judgement) {
  return { ...judgement, clear: [...judgement.clear], clearMerges: [...judgement.clearMerges] };
}

describe("the ticks that need a permission lookup", () => {
  test.each<[string, NamedTick[], Partial<TicksRead>, unknown[]]>([
    [
      "a row tick is judged by its stack's rule",
      [by(row("a:prod"))],
      { stacks: stacksOf(stack("a:prod", { tickers: "admin" })) },
      [{ target: { kind: "stack", stackId: "a:prod", rule: "admin" }, editor: expect.anything() }],
    ],
    [
      "a merge tick is judged once per stack, each by its own rule (record 0071)",
      [by(merge(418, ["a:prod", "b:prod"]))],
      { stacks: stacksOf(stack("a:prod", { tickers: ["alice"] }), stack("b:prod")) },
      [
        {
          target: { kind: "merge", pr: 418, stackIds: ["a:prod"], rule: ["alice"] },
          editor: expect.anything(),
        },
        {
          target: { kind: "merge", pr: 418, stackIds: ["b:prod"], rule: "write" },
          editor: expect.anything(),
        },
      ],
    ],
    [
      "the rescan box has no rule",
      [by(RESCAN)],
      {},
      [{ target: { kind: "rescan" }, editor: expect.anything() }],
    ],
    [
      "a stack that is taken looks nobody up",
      [by(row("a:prod"))],
      { open: new Map([["a:prod", openFact()]]) },
      [],
    ],
    [
      "a merge on a stack that is taken looks nobody up",
      [by(merge(418, ["a:prod", "b:prod"]))],
      { open: new Map([["b:prod", openFact()]]) },
      [],
    ],
    [
      "deploys: false looks nobody up (record 0051)",
      [by(row("a:prod")), by(merge(418, ["b:prod"]))],
      { deploys: false },
      [],
    ],
    ["a tick the history names nobody for", [nobody(row("a:prod"), "end-of-history")], {}, []],
    ["a tick in a body that kept moving", [nobody(row("a:prod"), "not-in-newest-entry")], {}, []],
  ])("%s", (_, named, overrides, expected) => {
    expect(ticksToLookUp(read(named, overrides))).toEqual(expected as never);
  });

  test("a bot is handed on like anyone: the lookup says it is not a person", () => {
    expect(ticksToLookUp(read([by(row("a:prod"), "github-actions", "Bot")]))).toEqual([
      {
        target: { kind: "stack", stackId: "a:prod", rule: "write" },
        editor: { login: "github-actions", type: "Bot" },
      },
    ]);
  });
});

describe("the verdict before anybody is looked up", () => {
  test.each<[string, NamedTick[], Partial<TicksRead>, Record<string, unknown>]>([
    [
      "a row tick on a taken stack is dropped, with no box cleared",
      [by(row("a:prod"))],
      { open: new Map([["a:prod", openFact()]]) },
      {
        dropped: ["a:prod"],
        clear: [],
        findings: [expect.objectContaining({ kind: "taken" })],
      },
    ],
    [
      "a merge tick on a taken stack is cleared with the deploying note (record 0064)",
      [by(merge(418, ["a:prod"]))],
      { open: new Map([["a:prod", openFact()]]) },
      { dropped: [], clearMerges: [[418, "deploying"]], merges: [] },
    ],
    [
      "deploys: false clears a row with its note (record 0051)",
      [by(row("a:prod", "h1"))],
      { deploys: false },
      {
        clear: [["a:prod", { hash: "h1", note: "deploys-off" }]],
        findings: [{ kind: "deploys-off", tick: row("a:prod", "h1") }],
      },
    ],
    [
      "deploys: false clears a merge with its note",
      [by(merge(418, ["a:prod"]))],
      { deploys: false },
      { clearMerges: [[418, "deploys-off"]] },
    ],
    [
      "a taken stack wins over deploys: false",
      [by(row("a:prod"))],
      { deploys: false, open: new Map([["a:prod", openFact()]]) },
      { dropped: ["a:prod"], clear: [] },
    ],
    [
      "a nameless row tick is cleared with the note that asks for a fresh tick (record 0025)",
      [nobody(row("a:prod", "h1"), "entry-without-body")],
      {},
      {
        clear: [["a:prod", { hash: "h1", note: true }]],
        findings: [{ kind: "nameless", tick: row("a:prod", "h1"), reason: "entry-without-body" }],
      },
    ],
    [
      "a nameless merge tick gets the orphan note",
      [nobody(merge(418, ["a:prod"]), "end-of-history")],
      {},
      { clearMerges: [[418, "orphan"]] },
    ],
    [
      "a nameless rescan tick is cleared by writing the body",
      [nobody(RESCAN, "end-of-history")],
      {},
      { rescanHandled: true, rescan: false },
    ],
    [
      "a tick in a body that kept moving is left alone",
      [nobody(row("a:prod"), "not-in-newest-entry")],
      {},
      {
        clear: [],
        dropped: [],
        rescanHandled: false,
        findings: [{ kind: "moving", tick: row("a:prod") }],
      },
    ],
  ])("%s", (_, named, overrides, expected) => {
    expect(judged(read(named, overrides))).toMatchObject(expected);
  });
});

describe("the verdict from the lookups (record 0018)", () => {
  test("an allowed row tick deploys, with its hash, drift and environment", () => {
    const tick: Tick = { kind: "row", stackId: "a:prod", hash: "h1", drift: true };
    const input = read([by(tick)], {
      stacks: stacksOf(stack("a:prod", { environment: "production" })),
    });
    expect(judged(input)).toMatchObject({
      deploys: [
        {
          stackId: "a:prod",
          environment: "production",
          ticker: "alice",
          hash: "h1",
          drift: true,
          behind: undefined,
        },
      ],
      clear: [],
      findings: [{ kind: "allowed", login: "alice" }],
      unverified: [],
    });
  });

  test.each<[string, Answer, Record<string, unknown>]>([
    [
      "a refused tick is cleared without a note: the comment is the message",
      { outcome: "refused", reason: "no-write-access" },
      {
        deploys: [],
        clear: [["a:prod", { hash: "h1", note: false }]],
        findings: [{ kind: "refused", login: "alice", reason: "no-write-access" }],
        unverified: [],
      },
    ],
    [
      "an unverified tick is cleared the same way and turns the job red",
      { outcome: "unverified", error: new Error("boom") },
      {
        deploys: [],
        clear: [["a:prod", { hash: "h1", note: false }]],
        unverified: [expect.objectContaining({ outcome: "unverified" })],
      },
    ],
    [
      "a tick by someone who is not a person is left alone",
      { outcome: "not-a-person" },
      { deploys: [], clear: [], findings: [{ kind: "not-a-person" }] },
    ],
  ])("%s", (_, answer, expected) => {
    expect(judged(read([by(row("a:prod", "h1"))]), answer)).toMatchObject(expected);
  });

  test.each<[string, Answer, { rescan: boolean; rescanHandled: boolean }]>([
    [
      "an allowed rescan tick asks for a full scan",
      { outcome: "allowed" },
      { rescan: true, rescanHandled: true },
    ],
    [
      "a refused rescan tick is cleared and asks for nothing",
      { outcome: "refused", reason: "no-write-access" },
      { rescan: false, rescanHandled: true },
    ],
    [
      "a rescan tick by a bot is left alone",
      { outcome: "not-a-person" },
      { rescan: false, rescanHandled: false },
    ],
  ])("%s", (_, answer, expected) => {
    expect(judged(read([by(RESCAN)]), answer)).toMatchObject(expected);
  });

  test("a merge tick goes on only when every stack of it allowed it (record 0071)", () => {
    const tick = merge(418, ["a:prod", "b:prod"]);
    const input = read([by(tick)]);
    const [first, second] = ticksToLookUp(input);
    if (!first || !second) throw new Error("two lookups expected");
    expect(
      plain(
        judgeTicks(input, [
          { tick: first, outcome: "allowed" },
          { tick: second, outcome: "allowed" },
        ]),
      ),
    ).toMatchObject({ merges: [{ tick, ticker: "alice" }], clearMerges: [] });
    expect(
      plain(
        judgeTicks(input, [
          { tick: first, outcome: "allowed" },
          { tick: second, outcome: "refused", reason: "below-level" },
        ]),
      ),
    ).toMatchObject({ merges: [], clearMerges: [[418, undefined]] });
  });

  test("the job log hears of the ticks in body order, then of the lookups", () => {
    const input = read(
      [by(row("a:prod")), nobody(row("b:prod"), "end-of-history"), by(row("c:prod"))],
      { open: new Map([["a:prod", openFact()]]) },
    );
    expect(judged(input).findings.map(({ kind }) => kind)).toEqual([
      "taken",
      "nameless",
      "allowed",
    ]);
  });
});

describe("the cap on one run (record 0035)", () => {
  test("starts the first 256 in stack id order and clears the rest with the fresh-tick note", () => {
    const ids = Array.from(
      { length: MAX_DEPLOYS_PER_RUN + 2 },
      (_, index) => `s${String(index).padStart(3, "0")}:prod`,
    );
    const input = read(
      [...ids].reverse().map((id) => by(row(id, `h-${id}`))),
      { stacks: stacksOf(...ids.map((id) => stack(id))) },
    );
    const judgement = judged(input);
    expect(judgement.deploys.map(({ stackId }) => stackId)).toEqual(
      ids.slice(0, MAX_DEPLOYS_PER_RUN),
    );
    expect(judgement.clear).toEqual(
      ids.slice(MAX_DEPLOYS_PER_RUN).map((id) => [id, { hash: `h-${id}`, note: true }]),
    );
    expect(judgement.findings.at(-1)).toEqual({ kind: "over-cap", started: 256, over: 2 });
  });
});

describe("dependencies and phases (records 0056 and 0067)", () => {
  const chain = stacksOf(stack("a:prod"), stack("b:prod", { dependsOn: ["a:prod"] }));

  test.each<[string, NamedTick[], Partial<TicksRead>, Record<string, unknown>]>([
    [
      "a dependency with a change nobody ticked refuses the tick, with a note that names it",
      [by(row("b:prod", "h1"))],
      { stacks: chain, rows: rowsIn("pending", "a:prod") },
      {
        deploys: [],
        clear: [["b:prod", { hash: "h1", note: { dependsOn: ["a:prod"] } }]],
        findings: [
          expect.objectContaining({ kind: "allowed" }),
          {
            kind: "waits-on",
            stackId: "b:prod",
            waitingOn: ["a:prod"],
            named: ["a:prod"],
            phases: [],
          },
        ],
      },
    ],
    [
      "ticks in one chain go out one layer at a time",
      [by(row("b:prod", "hb")), by(row("a:prod", "ha"))],
      { stacks: chain, rows: rowsIn("pending", "a:prod", "b:prod") },
      {
        deploys: [
          expect.objectContaining({ stackId: "a:prod", behind: undefined }),
          expect.objectContaining({ stackId: "b:prod", behind: ["a:prod"] }),
        ],
        clear: [],
      },
    ],
    [
      "a dependency that is deploying queues the tick behind it",
      [by(row("b:prod"))],
      { stacks: chain, open: new Map([["a:prod", openFact()]]) },
      { deploys: [expect.objectContaining({ stackId: "b:prod", behind: ["a:prod"] })] },
    ],
    [
      "a dependency in sync is no reason to wait",
      [by(row("b:prod"))],
      { stacks: chain },
      { deploys: [expect.objectContaining({ stackId: "b:prod", behind: undefined })] },
    ],
  ])("%s", (_, named, overrides, expected) => {
    expect(judged(read(named, overrides))).toMatchObject(expected);
  });

  test("a stack that waits through a phase gets a note that names the phase", () => {
    const stacks = stacksOf(
      stack("a:prod", { phase: "base" }),
      stack("b:prod", { phase: "apps", dependsOn: ["a:prod"] }),
    );
    const judgement = judged(
      read([by(row("b:prod", "h1"))], {
        stacks,
        rows: rowsIn("pending", "a:prod"),
        phases: ["base", "apps"],
      }),
    );
    expect(judgement.clear).toEqual([
      [
        "b:prod",
        {
          hash: "h1",
          note: { dependsOn: [], phases: [{ phase: "base", stackIds: ["a:prod"] }] },
        },
      ],
    ]);
  });
});

describe("what resolve reads before it judges", () => {
  test("a tick on a stack discovery does not know is left out, with the ids it misses", () => {
    const ticks = [row("a:prod"), row("x:prod"), merge(418, ["b:prod", "y:prod"]), RESCAN];
    expect(knownTicks(ticks, STACKS)).toEqual({
      known: [row("a:prod"), RESCAN],
      unknown: [
        { tick: row("x:prod"), stackIds: ["x:prod"] },
        { tick: merge(418, ["b:prod", "y:prod"]), stackIds: ["y:prod"] },
      ],
    });
  });

  test("the open deployments are read for the ticked stacks, a merge's too, and their dependencies", () => {
    const stacks = stacksOf(
      stack("a:prod"),
      stack("b:prod", { dependsOn: ["a:prod"] }),
      stack("c:prod"),
      stack("d:prod"),
    );
    const ids = stacksToRead(
      [by(row("b:prod")), by(merge(418, ["c:prod"])), by(RESCAN)],
      stacks,
    ).map(({ stack: { path, name } }) => `${path}:${name}`);
    expect(ids).toEqual(["b:prod", "c:prod", "a:prod"]);
  });
});

describe("a merge tick against its live pull request (record 0054)", () => {
  const HEAD = "h".repeat(40);
  const stacks = stacksOf(
    stack("a:prod", { inputs: [] }),
    stack("b:prod", { dependsOn: ["a:prod"] }),
  );
  function pullRequest(overrides: Partial<OpenPullRequest> = {}): OpenPullRequest {
    return {
      number: 418,
      title: "Update",
      author: "renovate[bot]",
      draft: false,
      base: "main",
      head: HEAD,
      mergeable: "mergeable",
      checks: "success",
      files: ["b/Pulumi.prod.yaml"],
      filesComplete: true,
      fromFork: false,
      ...overrides,
    };
  }
  function mergesRead(overrides: Partial<MergesRead> = {}): MergesRead {
    return {
      stacks,
      open: new Map(),
      rows: [],
      pullRequests: [pullRequest()],
      defaultBranch: "main",
      method: "squash",
      authors: ["renovate[bot]"],
      unrelated: [],
      ...overrides,
    };
  }
  const allowed = (stackIds = ["b:prod"], pr = 418): AllowedMerge => ({
    tick: { kind: "merge", pr, stackIds, head: HEAD },
    ticker: "alice",
  });

  test.each<[string, Partial<MergesRead>, AllowedMerge, unknown]>([
    ["merges with the method it was handed", {}, allowed(), { merge: true, method: "squash" }],
    [
      "a dependency with a change waiting holds the merge back (record 0056)",
      { rows: rowsIn("pending", "a:prod") },
      allowed(),
      { merge: false, refusal: { kind: "waits-on", stackIds: ["a:prod"] } },
    ],
    [
      "a dependency that is deploying holds it back too",
      { open: new Map([["a:prod", openFact()]]) },
      allowed(),
      { merge: false, refusal: { kind: "waits-on", stackIds: ["a:prod"] } },
    ],
    [
      "a pull request that is not open",
      { pullRequests: [] },
      allowed(),
      { merge: false, refusal: { kind: "closed" } },
    ],
    [
      "a new head commit since the tick",
      { pullRequests: [pullRequest({ head: "e".repeat(40) })] },
      allowed(),
      { merge: false, refusal: { kind: "head-moved" } },
    ],
    [
      "a pull request that no longer qualifies",
      { pullRequests: [pullRequest({ draft: true })] },
      allowed(),
      { merge: false, refusal: { kind: "not-qualified", why: "draft" } },
    ],
    [
      "a pull request that qualifies for other stacks than the marker names",
      {},
      allowed(["a:prod"]),
      { merge: false, refusal: { kind: "not-qualified", why: "other-stacks" } },
    ],
    [
      "a repo that allows no merge method",
      { method: undefined },
      allowed(),
      { merge: false, refusal: { kind: "no-method" } },
    ],
  ])("%s", (_, overrides, tick, expected) => {
    expect(judgeMerges(mergesRead(overrides), [tick])).toEqual([
      { ...tick, ...(expected as object) } as never,
    ]);
  });

  test("the ticks are judged in pull request order", () => {
    const verdicts = judgeMerges(mergesRead({ pullRequests: [] }), [
      allowed(["b:prod"], 420),
      allowed(["b:prod"], 418),
    ]);
    expect(verdicts.map(({ tick }) => tick.pr)).toEqual([418, 420]);
  });

  test.each([
    [409, { kind: "head-moved" }],
    [405, { kind: "refused-by-github", message: "Base branch was modified" }],
  ])("GitHub's answer %p to a merge it did not make", (status, expected) => {
    expect(mergeAnswerRefusal({ status, message: "Base branch was modified" })).toEqual(
      expected as never,
    );
  });
});

describe("the scan after the ticks (records 0017, 0054 and 0064)", () => {
  test.each<[string, boolean, number[], boolean, unknown]>([
    ["nothing to scan", false, [], true, { kind: "none" }],
    ["the rescan box asks for a full scan", true, [], false, { kind: "rescan" }],
    ["the rescan box wins over a merge", true, [418], true, { kind: "rescan" }],
    [
      "a merge narrows when the workflow declares the input",
      false,
      [420, 418],
      true,
      { kind: "after-merge", prs: [418, 420], narrowed: true },
    ],
    [
      "a merge scans in full when it does not",
      false,
      [418],
      false,
      { kind: "after-merge", prs: [418], narrowed: false },
    ],
  ])("%s", (_, rescan, merged, declares, expected) => {
    expect(
      scanAfter({ rescan, merged: new Set(merged), declaresMergeScanInput: declares }),
    ).toEqual(expected as never);
  });
});

describe("the bulk box and its confirm box (record 0083)", () => {
  const confirm = (section: "pending" | "drift", ...ids: string[]): Tick => ({
    kind: "confirm",
    section,
    stacks: ids.map((stackId) => ({ stackId, hash: `hash-${stackId}` })),
  });
  const BULK: Tick = { kind: "bulk", section: "pending" };

  test.each<[string, NamedTick[], Partial<TicksRead>, Record<string, unknown>]>([
    [
      "a confirm box is handed on as a row tick per stack, by its ticker",
      [by(confirm("pending", "a:prod", "b:prod"))],
      { rows: rowsIn("pending", "a:prod", "b:prod") },
      {
        named: [
          { ...by(row("a:prod")), via: "pending" },
          { ...by(row("b:prod")), via: "pending" },
        ],
        acts: [{ tick: confirm("pending", "a:prod", "b:prod"), outcome: "consumed" }],
        stale: false,
        findings: [
          {
            kind: "confirm-handed-on",
            tick: expect.anything(),
            login: "alice",
            stackIds: ["a:prod", "b:prod"],
          },
        ],
      },
    ],
    [
      "a confirm box of the drift section hands on ticks whose hash covers drift",
      [by(confirm("drift", "a:prod", "b:prod"))],
      { rows: rowsIn("drift", "a:prod", "b:prod") },
      {
        named: [
          {
            tick: { kind: "row", stackId: "a:prod", hash: "hash-a:prod", drift: true },
            via: "drift",
          },
          {
            tick: { kind: "row", stackId: "b:prod", hash: "hash-b:prod", drift: true },
            via: "drift",
          },
        ],
      },
    ],
    [
      "a stack ticked on its own row keeps that tick and its ticker",
      [by(row("a:prod"), "bob"), by(confirm("pending", "a:prod", "b:prod"))],
      { rows: rowsIn("pending", "a:prod", "b:prod") },
      {
        named: [by(row("a:prod"), "bob"), { ...by(row("b:prod")), via: "pending" }],
        findings: [
          { kind: "confirm-own-row", stackId: "a:prod" },
          expect.objectContaining({ kind: "confirm-handed-on", stackIds: ["b:prod"] }),
        ],
      },
    ],
    [
      "a stack discovery does not know is left alone",
      [by(confirm("pending", "a:prod", "x:prod"))],
      { rows: rowsIn("pending", "a:prod", "x:prod") },
      {
        named: [{ ...by(row("a:prod")), via: "pending" }],
        findings: [
          { kind: "confirm-unknown", stackId: "x:prod", section: "pending" },
          expect.objectContaining({ kind: "confirm-handed-on", stackIds: ["a:prod"] }),
        ],
      },
    ],
    [
      "a confirm box whose rows changed deploys nothing and makes the body be written",
      [by(confirm("pending", "a:prod", "b:prod"))],
      { rows: rowsIn("pending", "a:prod", "c:prod") },
      {
        named: [],
        acts: [],
        stale: true,
        findings: [
          {
            kind: "confirm-stale",
            tick: expect.anything(),
            changes: { added: ["c:prod"], gone: ["b:prod"], moved: [] },
          },
        ],
      },
    ],
    [
      "deploys: false clears the confirm box",
      [by(confirm("pending", "a:prod", "b:prod"))],
      { rows: rowsIn("pending", "a:prod", "b:prod"), deploys: false },
      { named: [], acts: [{ tick: expect.anything(), outcome: "clear" }], stale: false },
    ],
    [
      "a nameless confirm tick is cleared with the orphan note",
      [nobody(confirm("pending", "a:prod", "b:prod"), "end-of-history")],
      { rows: rowsIn("pending", "a:prod", "b:prod") },
      {
        named: [],
        acts: [{ tick: expect.anything(), outcome: "clear", note: { kind: "orphan" } }],
      },
    ],
    [
      "a confirm tick in a body that kept moving is left for the next run",
      [nobody(confirm("pending", "a:prod", "b:prod"), "not-in-newest-entry")],
      { rows: rowsIn("pending", "a:prod", "b:prod") },
      { named: [], acts: [], findings: [expect.objectContaining({ kind: "moving" })] },
    ],
    [
      "every other tick goes through as it is",
      [by(row("a:prod")), by(BULK), by(RESCAN)],
      {},
      { named: [by(row("a:prod")), by(BULK), by(RESCAN)], acts: [], findings: [] },
    ],
  ])("%s", (_, named, overrides, expected) => {
    expect(handOnConfirms(read(named, overrides))).toMatchObject(expected);
  });

  test("a tick handed on from a confirm box is looked up with where it came from", () => {
    const { named } = handOnConfirms(
      read([by(confirm("pending", "a:prod", "b:prod"))], {
        rows: rowsIn("pending", "a:prod", "b:prod"),
      }),
    );
    expect(ticksToLookUp(read(named)).map(({ via }) => via)).toEqual(["pending", "pending"]);
  });

  test("the bulk box needs only a person with write access, as the rescan box does", () => {
    expect(ticksToLookUp(read([by(BULK)]))).toEqual([
      { target: { kind: "bulk", section: "pending" }, editor: { login: "alice", type: "User" } },
    ]);
  });

  test.each<[string, NamedTick[], Partial<TicksRead>, Answer, Record<string, unknown>]>([
    [
      "an allowed bulk box becomes a confirm box that names the rows as they are",
      [by(BULK)],
      { rows: [...rowsIn("pending", "b:prod", "a:prod"), ...rowsIn("drift", "c:prod")] },
      { outcome: "allowed" },
      {
        bulk: [{ tick: BULK, outcome: "confirm", by: "alice", scanRun: "" }],
        findings: [
          { kind: "bulk-allowed", section: "pending", login: "alice", rows: ["a:prod", "b:prod"] },
        ],
        deploys: [],
      },
    ],
    [
      "a refused bulk box is cleared",
      [by(BULK)],
      {},
      { outcome: "refused", reason: "no-write-access" },
      {
        bulk: [{ tick: BULK, outcome: "clear" }],
        findings: [expect.objectContaining({ kind: "refused" })],
      },
    ],
    [
      "a bulk box by a bot is left alone",
      [by(BULK)],
      {},
      { outcome: "not-a-person" },
      { bulk: [], findings: [expect.objectContaining({ kind: "not-a-person" })] },
    ],
    [
      "deploys: false clears the bulk box without a lookup",
      [by(BULK)],
      { deploys: false },
      { outcome: "allowed" },
      { bulk: [{ tick: BULK, outcome: "clear" }], findings: [{ kind: "deploys-off", tick: BULK }] },
    ],
    [
      "a nameless bulk tick is cleared with the orphan note",
      [nobody(BULK, "entry-without-body")],
      {},
      { outcome: "allowed" },
      { bulk: [{ tick: BULK, outcome: "clear", note: { kind: "orphan" } }] },
    ],
  ])("%s", (_, named, overrides, answer, expected) => {
    expect(judged(read(named, overrides), answer)).toMatchObject(expected);
  });

  test("a box cleared for a tick the confirm box made goes on a row that is not ticked", () => {
    const refused = judged(
      read([{ ...by(row("a:prod", "h1")), via: "pending" }, by(row("b:prod", "h2"))]),
      { outcome: "refused", reason: "no-write-access" },
    );
    expect(refused.clear).toEqual([
      ["a:prod", { hash: "h1", note: false, unticked: true }],
      ["b:prod", { hash: "h2", note: false }],
    ]);
  });
});
