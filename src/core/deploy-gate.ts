// The deploy gate of `apply` (records 0008, 0019, 0051 and 0055): what happens
// to an open deployment record once its fresh preview is in, before anything
// is deployed, and the outcome the job reports once the tool answered. It
// reads nothing and runs nothing. `apply` hands it the record, the fresh
// preview and the drift check, runs the tool and writes what it decides.
//
// A green `apply` means "this went out" (record 0035). These rules are what
// keep that true: nothing deploys unless the fresh preview gives the diff hash
// the tick approved.

import type { ApplyResult, DriftResult, PreviewResult } from "../adapters/adapter.ts";
import type { ApplyResultOutcome } from "../render/result-file.ts";
import type { DeploymentPayload, RecordEnd } from "./deployment.ts";
import { diffHash } from "./diff-hash.ts";
import type { DeployFailureReason } from "./failure-reason.ts";

// A record end that is a failure, with its reason from the fixed list.
export type FailedEnd = Extract<RecordEnd, { kind: "failed" }>;

type FreshPreview = Extract<PreviewResult, { ok: true }>;

export interface GateInput {
  // What the tick approved: the diff hash, and whether it covers drift.
  approved: Pick<DeploymentPayload, "hash" | "drift">;
  // The fresh preview of `apply`, the same call as the scan's.
  fresh: PreviewResult;
  // The `dry-run` input: stop after the hash check (record 0051).
  dryRun: boolean;
}

// What the gate decided. `checked` is the fresh preview as it was held against
// the tick, with fresh drift in it when the hash covers drift. It is what the
// job log shows and, unless the drift check failed, what the row is made from.
export type GateDecision =
  // The drift check failed, and the hash the tick approved covers drift. The
  // row is left to the next scan.
  | { kind: "drift-failed"; end: FailedEnd; checked: PreviewResult }
  | { kind: "preview-failed"; end: FailedEnd; checked: PreviewResult }
  // Nothing to deploy: the stack is already as its code says (record 0051).
  | { kind: "in-sync"; end: RecordEnd; checked: FreshPreview }
  // The change moved since the tick (record 0008).
  | { kind: "moved"; end: FailedEnd; hash: string; checked: FreshPreview }
  // Everything a deploy checks was checked, and nothing goes out (record 0051).
  | { kind: "rehearsed"; end: RecordEnd; hash: string; checked: FreshPreview }
  // The hash matches: deploy. With drift in the hash the deploy puts it back
  // (record 0055).
  | { kind: "deploy"; hash: string; checked: FreshPreview; repairDrift: boolean };

// The gate asks for the drift check before it decides, because only it knows
// when the answer counts (record 0055). `apply` runs the check and hands the
// answer to `withDrift`.
export interface CheckDrift {
  kind: "check-drift";
  withDrift: (drift: DriftResult) => GateDecision;
}

export function deployGate(input: GateInput): GateDecision | CheckDrift {
  const { approved, fresh } = input;
  // A hash that covers drift is compared with fresh drift too (records 0009
  // and 0055), so drift that moved after the tick stops the deploy.
  if (approved.drift && fresh.ok) {
    return { kind: "check-drift", withDrift: (drift) => decide(input, drift) };
  }
  return decide(input, undefined);
}

function decide(input: GateInput, drift: DriftResult | undefined): GateDecision {
  const { approved, fresh: previewed, dryRun } = input;
  if (drift !== undefined && !drift.ok) {
    return {
      kind: "drift-failed",
      end: failed({ kind: "preview-failed", reason: drift.reason }),
      checked: previewed,
    };
  }
  if (!previewed.ok) {
    return {
      kind: "preview-failed",
      end: failed({ kind: "preview-failed", reason: previewed.reason }),
      checked: previewed,
    };
  }
  const fresh: FreshPreview =
    drift?.ok && drift.drift.length > 0
      ? { ...previewed, diff: { ...previewed.diff, drift: drift.drift } }
      : previewed;
  const drifted = (fresh.diff.drift ?? []).length > 0;
  // An empty fresh preview is no moved change and no failure (record 0051). A
  // diff with only tracking changes is not empty.
  if (fresh.diff.changes.length === 0 && !drifted) {
    return { kind: "in-sync", end: { kind: "in-sync" }, checked: fresh };
  }
  // The safety rule of record 0008: the hash covers exactly what the row
  // showed, so another hash is another change than the one that was ticked.
  const hash = diffHash(fresh.diff);
  if (hash !== approved.hash) {
    return { kind: "moved", end: failed({ kind: "moved" }), hash, checked: fresh };
  }
  if (dryRun) return { kind: "rehearsed", end: { kind: "rehearsed" }, hash, checked: fresh };
  return { kind: "deploy", hash, checked: fresh, repairDrift: drifted };
}

// What the tool's deploy ended with. `moved` is a deploy the adapter refused
// before its tool deployed anything (record 0058): nothing went out, like a
// change that moved before the deploy. `failed` may have gone out half way.
export type DeployEnd =
  | { kind: "deployed"; end: RecordEnd }
  | { kind: "moved"; end: FailedEnd }
  | { kind: "failed"; end: FailedEnd };

// Every adapter reads a run that ran out of time as a tool error without an
// exit code. The mode knows it was the limit (`ranOut`), and the record says
// so (slice 5.9).
export function deployEnd(
  result: ApplyResult,
  ranOut: boolean,
  timeoutMinutes: number | undefined,
): DeployEnd {
  if (result.ok) return { kind: "deployed", end: { kind: "deployed" } };
  if (result.reason.kind === "moved") return { kind: "moved", end: failed(result.reason) };
  if (result.reason.kind === "tool-error" && ranOut) {
    return { kind: "failed", end: failed({ kind: "timed-out", minutes: timeoutMinutes ?? 0 }) };
  }
  return { kind: "failed", end: failed(result.reason) };
}

// The end of a record after an error nobody planned for: a failure of the
// tool once it was asked to deploy, else a deploy that never started.
export function unplannedEnd(deploying: boolean): FailedEnd {
  return failed(deploying ? { kind: "tool-error", exitCode: null } : { kind: "not-started" });
}

// The `outcome` of a record `apply` gave a result (record 0041). A deploy that
// went out is deployed, also when its record could not be given the result.
// `refused` is nothing wrong with the stack or the tool: a change that moved,
// or deploys turned off (record 0051). Everything else is `failed`.
export function applyOutcome(end: RecordEnd): ApplyResultOutcome {
  switch (end.kind) {
    case "deployed":
    case "in-sync":
    case "rehearsed":
      return end.kind;
    case "failed":
      return end.reason.kind === "moved" || end.reason.kind === "deploys-off"
        ? "refused"
        : "failed";
    // Ends of `resolve` and a scan, never of `apply`.
    case "handed-on":
    case "merged":
      return "failed";
  }
}

function failed(reason: DeployFailureReason): FailedEnd {
  return { kind: "failed", reason };
}
