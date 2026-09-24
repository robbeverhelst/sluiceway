// What a scan shows for one previewed stack, on its row and in the summary.
// Both come from the same preview result, so they can never disagree.

import type { PreviewResult } from "../adapters/adapter.ts";
import { diffHash } from "../core/diff-hash.ts";
import { previewFailureText } from "../core/failure-reason.ts";
import { globOf } from "../core/glob.ts";
import type { PolicyOutcome } from "../core/policy.ts";
import { valueFingerprint } from "../core/value-fingerprint.ts";
import type { RunLinks } from "./links.ts";
import type { FailureLine, Row } from "./row.ts";
import type { SummaryMerge, SummaryStack } from "./summary.ts";

// A diff with changes is a pending row, a diff without is a stack in sync, and
// no diff is a preview failure with a reason from the fixed list (record
// 0022). The links land where the rest is (record 0044): a pending row's on
// the summary, which shows its diff, and a preview failure's on the job log,
// which holds the tool's own words. The failure line is a deploy fact from the stack's newest deployment record
// (record 0003), and rides on whatever row the preview gives. When the job
// log holds the tool's own diff of the stack, a pending row's `preview` link
// lands there instead (record 0048). Whether the tool's diff could be shown
// never changes the row. When the stack has a preview page, a check run with
// its diff, the `preview` link lands there, whatever else holds the diff
// (record 0050).
export function previewRow(
  stackId: string,
  result: PreviewResult,
  links: RunLinks,
  failure?: FailureLine | undefined,
  options: { toolDiffInLog?: boolean | undefined; pageUrl?: string | undefined } = {},
): Row {
  if (!result.ok) {
    return {
      state: "preview-failed",
      stackId,
      reason: previewFailureText(result.reason),
      runUrl: links.log,
      failure,
    };
  }
  const drifted = (result.diff.drift ?? []).length > 0;
  // What the preview read from the program's stack references (record 0059).
  const read = result.dependencies?.stackIds ?? [];
  const dependsOn = read.length === 0 ? {} : { dependsOn: read };
  if (result.diff.changes.length === 0) {
    // Nothing to deploy from the code, and drift found (record 0055). The
    // row links to its preview page, which lists the drift like a pending
    // row's changes, or to the summary without one (record 0059).
    if (drifted) {
      return {
        state: "drift",
        diff: result.diff,
        hash: diffHash(result.diff),
        fingerprint: valueFingerprint(result.diff),
        runUrl: links.summary,
        previewUrl: options.pageUrl,
        failure,
        ...dependsOn,
      };
    }
    return { state: "in-sync", stackId, failure, ...dependsOn };
  }
  // What the change costs a month (record 0105), when the estimate came
  // back. A failed one is a missing line, and the job log says why.
  const cost = result.cost?.ok ? { cost: result.cost.estimate } : {};
  return {
    state: "pending",
    diff: result.diff,
    hash: diffHash(result.diff),
    fingerprint: valueFingerprint(result.diff),
    runUrl: links.summary,
    previewUrl: options.pageUrl ?? (options.toolDiffInLog ? links.log : undefined),
    failure,
    ...dependsOn,
    ...cost,
  };
}

// `merges` is what attribution found for the stack (record 0026), when it is
// known by the time the summary is written.
export function previewSummary(
  stackId: string,
  result: PreviewResult,
  merges?: SummaryMerge[] | undefined,
  // What the policies made of the change (record 0106).
  policies?: PolicyOutcome | undefined,
): SummaryStack {
  if (result.ok) return { kind: "diff", diff: result.diff, merges, policies };
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
  const drifted = (result.diff.drift ?? []).length > 0;
  if (result.diff.changes.length === 0) return drifted ? "drift" : "in sync";
  return drifted ? "pending, with drift" : "pending";
}
