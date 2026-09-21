// What a scan shows for one previewed stack, on its row and in the summary.
// Both come from the same preview result, so they can never disagree.

import type { PreviewResult } from "../adapters/adapter.ts";
import { diffHash } from "../core/diff-hash.ts";
import { previewFailureText } from "../core/failure-reason.ts";
import { globOf } from "../core/glob.ts";
import type { FailureLine, Row } from "./row.ts";
import type { SummaryMerge, SummaryStack } from "./summary.ts";

// A diff with changes is a pending row, a diff without is a stack in sync, and
// no diff is a preview failure with a reason from the fixed list (record
// 0022). `runUrl` is the run whose summary and job log hold the rest. The
// failure line is a deploy fact from the stack's newest deployment record
// (record 0003), and rides on whatever row the preview gives.
export function previewRow(
  stackId: string,
  result: PreviewResult,
  runUrl: string,
  failure?: FailureLine | undefined,
): Row {
  if (!result.ok) {
    return {
      state: "preview-failed",
      stackId,
      reason: previewFailureText(result.reason),
      runUrl,
      failure,
    };
  }
  if (result.diff.changes.length === 0) return { state: "in-sync", stackId, failure };
  return { state: "pending", diff: result.diff, hash: diffHash(result.diff), runUrl, failure };
}

// `merges` is what attribution found for the stack (record 0026), when it is
// known by the time the summary is written.
export function previewSummary(
  stackId: string,
  result: PreviewResult,
  merges?: SummaryMerge[] | undefined,
): SummaryStack {
  if (result.ok) return { kind: "diff", diff: result.diff, merges };
  return {
    kind: "preview-failed",
    stackId,
    reason: previewFailureText(result.reason),
    // A stack file with no stack behind it is often one nobody meant to
    // create (onboarding log, hurdle 9). The glob is built from the stack id,
    // a name Sluiceway derived from the repo's files (record 0022).
    ignore: result.reason.kind === "stack-not-found" ? globOf(stackId) : undefined,
  };
}

// The row state a preview result leads to, in the words of the counts line.
export function previewOutcome(result: PreviewResult): string {
  if (!result.ok) return `preview failed, ${previewFailureText(result.reason)}`;
  return result.diff.changes.length === 0 ? "in sync" : "pending";
}
