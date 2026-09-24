import { describe, expect, test } from "bun:test";
import type { ApplyResult, DriftResult, PreviewResult } from "../../src/adapters/adapter.ts";
import {
  applyOutcome,
  deployEnd,
  deployGate,
  type GateDecision,
  type GateInput,
  unplannedEnd,
} from "../../src/core/deploy-gate.ts";
import { type RecordEnd, recordStatus, type StatusToWrite } from "../../src/core/deployment.ts";
import type { Change, Diff } from "../../src/core/diff.ts";
import { diffHash } from "../../src/core/diff-hash.ts";
import { valueFingerprint } from "../../src/core/value-fingerprint.ts";

// The deploy gate as tables: no GitHub, no tool. Each case is a record, a
// fresh preview and a drift answer, and what happens to the record.

const STACK = "apps/web:prod";

function change(address: string, keys: string[] = ["image"]): Change {
  return {
    address,
    type: "apps:Deployment",
    name: address,
    op: "update",
    changedKeys: keys,
    replaceKeys: [],
  };
}

function diff(changes: Change[], drift?: Change[]): Diff {
  return drift ? { stackId: STACK, changes, drift } : { stackId: STACK, changes };
}

function ok(d: Diff): PreviewResult {
  return { ok: true, diff: d, toolLog: "" };
}

const FAILED_PREVIEW: PreviewResult = {
  ok: false,
  reason: { kind: "tool-error", exitCode: 1 },
  detail: [],
  toolLog: "",
};

const TICKED = diff([change("a1")]);
const DRIFT = [change("a9", ["replicas"])];
const TICKED_WITH_DRIFT = diff([change("a1")], DRIFT);

function noDrift(): DriftResult {
  return { ok: true, drift: [], toolLog: "" };
}
function drifted(drift: Change[]): DriftResult {
  return { ok: true, drift, toolLog: "" };
}
const FAILED_DRIFT: DriftResult = {
  ok: false,
  reason: { kind: "authentication-error" },
  detail: [],
  toolLog: "",
};

// Runs the gate, and answers its drift question when it asks one.
function gate(input: GateInput, drift?: DriftResult): GateDecision {
  const asked = deployGate(input);
  if (asked.kind !== "check-drift") return asked;
  if (!drift) throw new Error("The gate asked for a drift check the case did not give.");
  return asked.withDrift(drift);
}

describe("the gate asks for the drift check only when the answer counts (record 0055)", () => {
  const cases: [string, GateInput, boolean][] = [
    [
      "hash covers drift, preview worked",
      { approved: { hash: "h", drift: true }, fresh: ok(TICKED), dryRun: false },
      true,
    ],
    [
      "hash covers drift, preview failed",
      { approved: { hash: "h", drift: true }, fresh: FAILED_PREVIEW, dryRun: false },
      false,
    ],
    ["hash covers no drift", { approved: { hash: "h" }, fresh: ok(TICKED), dryRun: false }, false],
    [
      "a rehearsal still checks drift",
      { approved: { hash: "h", drift: true }, fresh: ok(TICKED), dryRun: true },
      true,
    ],
  ];
  for (const [name, input, asks] of cases) {
    test(name, () => {
      expect(deployGate(input).kind === "check-drift").toBe(asks);
    });
  }
});

// The safety rule of record 0008, as a table: what was approved, what the
// fresh preview gives, and what the record gets.
describe("what the gate decides", () => {
  const cases: {
    name: string;
    approved: GateInput["approved"];
    fresh: PreviewResult;
    drift?: DriftResult;
    dryRun?: boolean;
    kind: GateDecision["kind"];
    status?: StatusToWrite;
  }[] = [
    {
      name: "the same diff deploys",
      approved: { hash: diffHash(TICKED) },
      fresh: ok(TICKED),
      kind: "deploy",
    },
    {
      name: "another property changed: moved, ends as error",
      approved: { hash: diffHash(TICKED) },
      fresh: ok(diff([change("a1", ["image", "replicas"])])),
      kind: "moved",
      status: { state: "error", description: "the change moved since the tick" },
    },
    {
      name: "another resource joined: moved",
      approved: { hash: diffHash(TICKED) },
      fresh: ok(diff([change("a1"), change("a2")])),
      kind: "moved",
    },
    {
      name: "a forged hash only approves what the fresh preview shows: moved",
      approved: { hash: "0000000000000000" },
      fresh: ok(TICKED),
      kind: "moved",
    },
    {
      name: "an empty fresh preview is in sync, not moved (record 0051)",
      approved: { hash: diffHash(TICKED) },
      fresh: ok(diff([])),
      kind: "in-sync",
      status: { state: "success", description: "nothing to deploy, already in sync" },
    },
    {
      name: "an empty fresh preview in a rehearsal is in sync too",
      approved: { hash: diffHash(TICKED) },
      fresh: ok(diff([])),
      dryRun: true,
      kind: "in-sync",
    },
    {
      name: "a diff of tracking changes only is not empty, and is hash checked",
      approved: { hash: "0000000000000000" },
      fresh: ok(diff([{ ...change("a1", []), op: "none", tracking: "import" }])),
      kind: "moved",
    },
    {
      name: "a failed fresh preview is a failure of the preview",
      approved: { hash: diffHash(TICKED) },
      fresh: FAILED_PREVIEW,
      kind: "preview-failed",
      status: {
        state: "failure",
        description:
          "the preview before the deploy failed: the tool exited with an error (exit code 1)",
      },
    },
    {
      name: "a rehearsal whose hash matches ends as rehearsed",
      approved: { hash: diffHash(TICKED) },
      fresh: ok(TICKED),
      dryRun: true,
      kind: "rehearsed",
      status: { state: "inactive", description: "rehearsed, nothing was deployed" },
    },
    {
      name: "a rehearsal of a moved change is a moved change",
      approved: { hash: "0000000000000000" },
      fresh: ok(TICKED),
      dryRun: true,
      kind: "moved",
    },
    {
      name: "drift that stayed as ticked deploys",
      approved: { hash: diffHash(TICKED_WITH_DRIFT), drift: true },
      fresh: ok(TICKED),
      drift: drifted(DRIFT),
      kind: "deploy",
    },
    {
      name: "drift that moved after the tick: moved",
      approved: { hash: diffHash(TICKED_WITH_DRIFT), drift: true },
      fresh: ok(TICKED),
      drift: drifted([change("a9", ["replicas", "labels"])]),
      kind: "moved",
    },
    {
      name: "drift put back outside the dashboard, and no change: in sync",
      approved: { hash: diffHash(diff([], DRIFT)), drift: true },
      fresh: ok(diff([])),
      drift: noDrift(),
      kind: "in-sync",
    },
    {
      name: "drift put back, the change still there: moved",
      approved: { hash: diffHash(TICKED_WITH_DRIFT), drift: true },
      fresh: ok(TICKED),
      drift: noDrift(),
      kind: "moved",
    },
    {
      name: "drift alone keeps a preview from being empty",
      approved: { hash: diffHash(diff([], DRIFT)), drift: true },
      fresh: ok(diff([])),
      drift: drifted(DRIFT),
      kind: "deploy",
    },
    {
      name: "a failed drift check stops the deploy as a failed preview",
      approved: { hash: diffHash(TICKED_WITH_DRIFT), drift: true },
      fresh: ok(TICKED),
      drift: FAILED_DRIFT,
      kind: "drift-failed",
      status: {
        state: "failure",
        description:
          "the preview before the deploy failed: the tool could not authenticate or is not authorized",
      },
    },
  ];
  for (const one of cases) {
    test(one.name, () => {
      const decided = gate(
        { approved: one.approved, fresh: one.fresh, dryRun: one.dryRun ?? false },
        one.drift,
      );
      expect(decided.kind).toBe(one.kind);
      if (one.status && decided.kind !== "deploy") {
        expect(recordStatus(decided.end)).toEqual(one.status);
      }
    });
  }
});

describe("what the gate hands on", () => {
  test("the deploy gets the hash, the fresh diff with fresh drift, and the repair", () => {
    const decided = gate(
      {
        approved: { hash: diffHash(TICKED_WITH_DRIFT), drift: true },
        fresh: ok(TICKED),
        dryRun: false,
      },
      drifted(DRIFT),
    );
    expect(decided).toMatchObject({
      kind: "deploy",
      hash: diffHash(TICKED_WITH_DRIFT),
      checked: { ok: true, diff: TICKED_WITH_DRIFT },
      repairDrift: true,
    });
  });

  test("a deploy without drift asks for no repair", () => {
    const decided = gate({
      approved: { hash: diffHash(TICKED) },
      fresh: ok(TICKED),
      dryRun: false,
    });
    expect(decided).toMatchObject({ kind: "deploy", repairDrift: false });
  });

  test("a moved change names the fresh hash", () => {
    const fresh = diff([change("a2")]);
    const decided = gate({ approved: { hash: diffHash(TICKED) }, fresh: ok(fresh), dryRun: false });
    expect(decided).toMatchObject({
      kind: "moved",
      hash: diffHash(fresh),
      checked: { diff: fresh },
    });
  });

  test("after a failed drift check the preview is held as it was, without drift", () => {
    const fresh = ok(TICKED);
    const decided = gate(
      { approved: { hash: diffHash(TICKED_WITH_DRIFT), drift: true }, fresh, dryRun: false },
      FAILED_DRIFT,
    );
    expect(decided.checked).toBe(fresh);
  });

  test("drift from the check is not merged into a hash that never covered it", () => {
    const decided = gate(
      { approved: { hash: diffHash(TICKED) }, fresh: ok(TICKED), dryRun: false },
      drifted(DRIFT),
    );
    expect(decided).toMatchObject({ kind: "deploy", checked: { diff: TICKED } });
  });

  test("the saved plan stays on the preview the deploy gets (record 0053)", () => {
    const plan = { dispose: async () => {} } as unknown as NonNullable<
      Extract<PreviewResult, { ok: true }>["plan"]
    >;
    const decided = gate(
      {
        approved: { hash: diffHash(TICKED_WITH_DRIFT), drift: true },
        fresh: { ...ok(TICKED), plan } as PreviewResult,
        dryRun: false,
      },
      drifted(DRIFT),
    );
    expect(decided.checked.ok && decided.checked.plan).toBe(plan);
  });
});

describe("what the tool's deploy ended with", () => {
  const cases: [string, ApplyResult, boolean, number | undefined, string, RecordEnd][] = [
    ["went out", { ok: true, toolLog: "" }, false, undefined, "deployed", { kind: "deployed" }],
    [
      "failed",
      { ok: false, reason: { kind: "tool-error", exitCode: 2 }, toolLog: "" },
      false,
      undefined,
      "failed",
      { kind: "failed", reason: { kind: "tool-error", exitCode: 2 } },
    ],
    [
      "ran out of time",
      { ok: false, reason: { kind: "tool-error", exitCode: null }, toolLog: "" },
      true,
      15,
      "failed",
      { kind: "failed", reason: { kind: "timed-out", minutes: 15 } },
    ],
    [
      "refused by the adapter as moved (record 0058)",
      { ok: false, reason: { kind: "moved" }, toolLog: "" },
      true,
      15,
      "moved",
      { kind: "failed", reason: { kind: "moved" } },
    ],
    [
      "went out, although a run of the tool ran out of time",
      { ok: true, toolLog: "" },
      true,
      15,
      "deployed",
      { kind: "deployed" },
    ],
  ];
  for (const [name, result, ranOut, minutes, kind, end] of cases) {
    test(name, () => {
      expect(deployEnd(result, ranOut, minutes)).toEqual({ kind, end } as ReturnType<
        typeof deployEnd
      >);
    });
  }

  test("an error nobody planned for fails the tool once it deploys, else nothing started", () => {
    expect(unplannedEnd(true)).toEqual({
      kind: "failed",
      reason: { kind: "tool-error", exitCode: null },
    });
    expect(unplannedEnd(false)).toEqual({ kind: "failed", reason: { kind: "not-started" } });
  });
});

describe("the outcome of apply (record 0041)", () => {
  const cases: [RecordEnd, string][] = [
    [{ kind: "deployed" }, "deployed"],
    [{ kind: "in-sync" }, "in-sync"],
    [{ kind: "rehearsed" }, "rehearsed"],
    [{ kind: "failed", reason: { kind: "moved" } }, "refused"],
    [{ kind: "failed", reason: { kind: "deploys-off" } }, "refused"],
    [{ kind: "failed", reason: { kind: "tool-error", exitCode: 1 } }, "failed"],
    [{ kind: "failed", reason: { kind: "timed-out", minutes: 5 } }, "failed"],
    [{ kind: "failed", reason: { kind: "not-started" } }, "failed"],
    [{ kind: "failed", reason: { kind: "unknown-stack" } }, "failed"],
    [{ kind: "failed", reason: { kind: "tool-missing" } }, "failed"],
    [
      { kind: "failed", reason: { kind: "preview-failed", reason: { kind: "stack-not-found" } } },
      "failed",
    ],
  ];
  for (const [end, outcome] of cases) {
    test(`${end.kind === "failed" ? `failed: ${end.reason.kind}` : end.kind} is ${outcome}`, () => {
      expect(applyOutcome(end)).toBe(outcome as ReturnType<typeof applyOutcome>);
    });
  }
});

// Record 0102: the value fingerprint is compared after the hash. `withValues`
// is the ticked diff with a fingerprint on its change, as an adapter that was
// asked for one hands it over.
describe("the value fingerprint (record 0102)", () => {
  const F1 = "1111111111111111";
  const F2 = "2222222222222222";
  const withValues = (fingerprint: string): Diff => diff([{ ...change("a1"), fingerprint }]);
  const APPROVED = { hash: diffHash(TICKED), fingerprint: valueFingerprint(withValues(F1)) };

  const cases: {
    name: string;
    approved: GateInput["approved"];
    fresh: PreviewResult;
    sameCommit?: boolean;
    dryRun?: boolean;
    kind: GateDecision["kind"];
    status?: StatusToWrite;
    outcome?: string;
  }[] = [
    {
      name: "the same hash and the same fingerprint deploy",
      approved: APPROVED,
      fresh: ok(withValues(F1)),
      kind: "deploy",
    },
    {
      name: "the same hash with another fingerprint is refused: a value changed",
      approved: APPROVED,
      fresh: ok(withValues(F2)),
      kind: "value-changed",
      status: { state: "error", description: "a value changed since the tick" },
      outcome: "refused",
    },
    {
      name: "at the commit of the last scan the value differs on every run, and the reason says so",
      approved: APPROVED,
      fresh: ok(withValues(F2)),
      sameCommit: true,
      kind: "value-changed",
      status: {
        state: "error",
        description:
          "a value changed since the tick with no new commit, so it may differ on every run: see valueFingerprint in sluiceway.yaml",
      },
      outcome: "refused",
    },
    {
      name: "a record without a fingerprint against a fresh preview with one is refused",
      approved: { hash: diffHash(TICKED) },
      fresh: ok(withValues(F1)),
      kind: "value-changed",
      status: { state: "error", description: "a value changed since the tick" },
    },
    {
      name: "a fresh preview without a fingerprint deploys: the check is off, or nothing to cover",
      approved: APPROVED,
      fresh: ok(TICKED),
      kind: "deploy",
    },
    {
      name: "a moved change is moved, whatever the fingerprints",
      approved: APPROVED,
      fresh: ok(diff([{ ...change("a1", ["image", "replicas"]), fingerprint: F2 }])),
      kind: "moved",
    },
    {
      name: "a rehearsal stops after the fingerprint check",
      approved: APPROVED,
      fresh: ok(withValues(F1)),
      dryRun: true,
      kind: "rehearsed",
    },
    {
      name: "a rehearsal is refused like a deploy when a value changed",
      approved: APPROVED,
      fresh: ok(withValues(F2)),
      dryRun: true,
      kind: "value-changed",
    },
  ];
  for (const one of cases) {
    test(one.name, () => {
      const decided = gate({
        approved: one.approved,
        fresh: one.fresh,
        dryRun: one.dryRun ?? false,
        sameCommit: one.sameCommit ?? false,
      });
      expect(decided.kind).toBe(one.kind);
      if (one.status && "end" in decided) expect(recordStatus(decided.end)).toEqual(one.status);
      if (one.outcome && "end" in decided) expect(applyOutcome(decided.end)).toBe("refused");
    });
  }

  test("a description fits GitHub's limit of 140 characters", () => {
    for (const everyRun of [false, true]) {
      const decided = gate({
        approved: APPROVED,
        fresh: ok(withValues(F2)),
        dryRun: false,
        sameCommit: everyRun,
      });
      if (!("end" in decided)) throw new Error("no end");
      expect(recordStatus(decided.end).description?.length ?? 0).toBeLessThanOrEqual(140);
    }
  });

  test("the decision carries both fingerprints for the job log", () => {
    const decided = gate({
      approved: APPROVED,
      fresh: ok(withValues(F2)),
      dryRun: false,
      sameCommit: false,
    });
    expect(decided.kind === "value-changed" && decided.fingerprint).toBe(
      valueFingerprint(withValues(F2)) ?? "",
    );
    expect(decided.kind === "value-changed" && decided.everyRun).toBe(false);
  });
});
