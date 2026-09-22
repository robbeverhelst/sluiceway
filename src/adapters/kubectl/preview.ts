import { join } from "node:path";
import type { PreviewFailureReason } from "../../core/failure-reason.ts";
import { type Stack, stackId } from "../../core/stack.ts";
import type { PreviewOptions, PreviewResult } from "../adapter.ts";
import { stripAnsi } from "../pulumi/tool-log.ts";
import { diffCommand, PREVIEW_DIFF } from "./commands.ts";
import { kubectlEnvironment, optionsOf } from "./environment.ts";
import { foldObjects } from "./fold.ts";
import { type RenderedSet, renderSet } from "./rendered-set.ts";
import { readDiff } from "./unified.ts";

// A preview renders the stack's manifests into a set of its own and runs
// `kubectl diff --server-side` over it: the API server runs the apply as a
// dry run, and kubectl hands the object as it is and as it would be to the
// diff program, which prints both whole. Each gets the stack's time limit.
// The set goes when the preview ends, unless `apply` asked to keep it
// (record 0060).
export async function preview(stack: Stack, options: PreviewOptions): Promise<PreviewResult> {
  const rendered = await renderSet(stack, options);
  if (!rendered.ok) {
    return { ok: false, reason: rendered.reason, detail: [], toolLog: rendered.toolLog };
  }
  let kept = false;
  try {
    const result = await diff(stack, options, rendered.set, rendered.toolLog);
    if (result.ok && options.savePlan) {
      kept = true;
      return { ...result, plan: rendered.set };
    }
    return result;
  } finally {
    if (!kept) await rendered.set.dispose();
  }
}

async function diff(
  stack: Stack,
  options: PreviewOptions,
  set: RenderedSet,
  renderLog: string,
): Promise<PreviewResult> {
  const failed = (
    reason: PreviewFailureReason,
    toolLog: string,
    detail: string[] = [],
  ): PreviewResult => ({ ok: false, reason, detail, toolLog });

  const result = await options.run({
    argv: diffCommand(set.path, optionsOf(stack)),
    cwd: join(options.root, stack.path),
    env: kubectlEnvironment(options.env, { KUBECTL_EXTERNAL_DIFF: PREVIEW_DIFF }),
    timeoutMs: options.timeoutMinutes * 60_000,
  });
  if (result.status === "not-started")
    return failed({ kind: "tool-error", exitCode: null }, renderLog);
  // Never stdout: it is both sides of every object, values and all (record
  // 0021). The reason comes from the exit code alone (record 0022).
  const log = renderLog + stripAnsi(result.stderr);
  if (result.status === "timed-out") {
    return failed({ kind: "timed-out", minutes: options.timeoutMinutes }, log);
  }
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    return failed({ kind: "tool-error", exitCode: result.exitCode }, log);
  }

  const read = readDiff(result.stdout);
  if (!read.ok) return failed({ kind: "unreadable-output" }, log, read.problems);
  // Exit code 1 says the objects differ. With nothing to read, the output is
  // not what the adapter expects, and never in sync.
  if (result.exitCode === 1 && read.pairs.length === 0) {
    return failed({ kind: "unreadable-output" }, log, [
      "The tool's output: expected the objects that differ, as the exit code says there are.",
    ]);
  }
  const folded = foldObjects(read.pairs, options.showValues ?? []);
  if (!folded.ok) return failed({ kind: folded.reason }, log, folded.detail);
  return { ok: true, diff: { stackId: stackId(stack), changes: folded.changes }, toolLog: log };
}
