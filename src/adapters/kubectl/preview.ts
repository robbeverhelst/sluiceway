import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PreviewFailureReason } from "../../core/failure-reason.ts";
import { type Stack, stackId } from "../../core/stack.ts";
import type { PreviewOptions, PreviewResult } from "../adapter.ts";
import { runTool, stripAnsi } from "../tool-run.ts";
import { DIFF_EXIT_CODES, diffCommand, PREVIEW_DIFF } from "./commands.ts";
import { kubectlEnvironment, optionsOf } from "./environment.ts";
import { foldObjects } from "./fold.ts";
import { type Rendered, renderSet } from "./rendered-set.ts";
import { readDiff } from "./unified.ts";

// A preview renders the stack's manifests into a set of its own and runs
// `kubectl diff --server-side` over it: the API server runs the apply as a
// dry run, and kubectl hands the object as it is and as it would be to the
// diff program, which prints both whole. Each gets the stack's time limit.
// The set goes when the preview ends, unless `apply` asked to keep it
// (record 0060). With pruning, the objects the deploy deletes join the diff
// as deletes (record 0070).
export async function preview(stack: Stack, options: PreviewOptions): Promise<PreviewResult> {
  const rendered = await renderSet(stack, options);
  if (!rendered.ok) {
    return {
      ok: false,
      reason: rendered.reason,
      detail: rendered.detail,
      toolLog: rendered.toolLog,
    };
  }
  let kept = false;
  try {
    const result = await diff(stack, options, rendered);
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
  { set, toolLog: renderLog, pruning }: Extract<Rendered, { ok: true }>,
): Promise<PreviewResult> {
  const failed = (
    reason: PreviewFailureReason,
    toolLog: string,
    detail: string[] = [],
  ): PreviewResult => ({ ok: false, reason, detail, toolLog });

  const result = await runTool(options.run, {
    argv: diffCommand(set.path, optionsOf(stack)),
    cwd: join(options.root, stack.path),
    env: kubectlEnvironment(options.env, { KUBECTL_EXTERNAL_DIFF: PREVIEW_DIFF }),
    timeoutMinutes: options.timeoutMinutes,
    exitCodes: DIFF_EXIT_CODES,
  });
  // Never stdout: it is both sides of every object, values and all (record
  // 0021). The reason comes from the exit code alone (record 0022).
  const log = renderLog + stripAnsi(result.stderr);
  if (!result.ok) return failed(result.reason, log);

  const read = readDiff(result.stdout);
  if (!read.ok) return failed({ kind: "unreadable-output" }, log, read.problems);
  // Exit code 1 says the objects differ. With nothing to read, the output is
  // not what the adapter expects, and never in sync.
  if (result.exitCode === 1 && read.pairs.length === 0) {
    return failed({ kind: "unreadable-output" }, log, [
      "The tool's output: expected the objects that differ, as the exit code says there are.",
    ]);
  }
  const folded = foldObjects(
    read.pairs,
    options.showValues ?? [],
    pruning?.inventory,
    options.valueFingerprint === true,
  );
  if (!folded.ok) return failed({ kind: folded.reason }, log, folded.detail);
  const changes = [...folded.changes, ...(pruning?.deletes ?? [])].sort((a, b) =>
    a.address < b.address ? -1 : a.address > b.address ? 1 : 0,
  );
  // The rendered set, for the policies alone (record 0106): the manifests as
  // the deploy would apply them.
  const document = options.keepDocument
    ? { document: { text: await readFile(set.path, "utf8"), format: "yaml" as const } }
    : {};
  return { ok: true, diff: { stackId: stackId(stack), changes }, toolLog: log, ...document };
}
