import { join } from "node:path";
import type { Stack } from "../../core/stack.ts";
import type { DriftResult, PreviewOptions } from "../adapter.ts";
import { runTool, stripAnsi } from "../tool-run.ts";
import { DIFF_EXIT_CODES, diffCommand, PREVIEW_DIFF } from "./commands.ts";
import { kubectlEnvironment, optionsOf } from "./environment.ts";
import { foldDrift } from "./fold.ts";
import { renderSet } from "./rendered-set.ts";
import { readDiff } from "./unified.ts";

// The drift check of a Kubernetes manifests stack (records 0055 and 0070).
// `kubectl diff` compares with the live objects, so every change made outside
// the code is already on the row: a create for an object someone deleted, an
// update for a field someone changed with the stack's own field manager, or a
// failed preview for a field another field manager took. What the check adds
// is which of those came from outside the code, from two things the cluster
// keeps: the stack's inventory, which says what it deployed, and the managed
// fields of each object, which say who set a field last. So it runs only for
// a stack with pruning or forceConflicts, and a stack with neither is never
// checked: without them nothing it could find would not already be a change
// or a failure on the row.
//
// It renders the set as the preview does and runs the preview's diff with
// the managed fields shown. It changes nothing in the cluster.
export async function detectDrift(
  stack: Stack,
  options: PreviewOptions,
): Promise<DriftResult | undefined> {
  const stackOptions = optionsOf(stack);
  if (stackOptions.prune !== true && stackOptions.forceConflicts !== true) return undefined;
  const rendered = await renderSet(stack, options);
  if (!rendered.ok) return rendered;
  try {
    const result = await runTool(options.run, {
      argv: diffCommand(rendered.set.path, stackOptions, { managedFields: true }),
      cwd: join(options.root, stack.path),
      env: kubectlEnvironment(options.env, { KUBECTL_EXTERNAL_DIFF: PREVIEW_DIFF }),
      timeoutMinutes: options.timeoutMinutes,
      exitCodes: DIFF_EXIT_CODES,
    });
    // Never stdout: it is both sides of every object, values and all.
    const toolLog = rendered.toolLog + stripAnsi(result.stderr);
    if (!result.ok) return { ok: false, reason: result.reason, detail: [], toolLog };
    const read = readDiff(result.stdout);
    if (!read.ok) {
      return { ok: false, reason: { kind: "unreadable-output" }, detail: read.problems, toolLog };
    }
    const folded = foldDrift(read.pairs, {
      ...(rendered.pruning === undefined ? {} : { inventory: rendered.pruning.inventory }),
      listed: rendered.pruning?.listed ?? [],
      manager: stackOptions.fieldManager ?? "kubectl",
    });
    if (!folded.ok) {
      return { ok: false, reason: { kind: folded.reason }, detail: folded.detail, toolLog };
    }
    return { ok: true, drift: folded.changes, toolLog };
  } finally {
    await rendered.set.dispose();
  }
}
