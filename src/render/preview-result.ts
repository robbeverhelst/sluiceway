// What a scan shows for one previewed stack, on its row and in the summary.
// Both come from the same preview result, so they can never disagree.

import type { PreviewResult } from "../adapters/adapter.ts";
import { diffHash } from "../core/diff-hash.ts";
import { previewFailureText } from "../core/failure-reason.ts";
import type { FailureLine, Row } from "./row.ts";
import type { SummaryStack } from "./summary.ts";

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

export function previewSummary(stackId: string, result: PreviewResult): SummaryStack {
  return result.ok
    ? { kind: "diff", diff: result.diff }
    : { kind: "preview-failed", stackId, reason: previewFailureText(result.reason) };
}

// The row state a preview result leads to, in the words of the counts line.
export function previewOutcome(result: PreviewResult): string {
  if (!result.ok) return `preview failed, ${previewFailureText(result.reason)}`;
  return result.diff.changes.length === 0 ? "in sync" : "pending";
}
