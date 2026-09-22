import { join } from "node:path";
import type { Stack } from "../../core/stack.ts";
import type { PreviewOptions, ToolDiffResult } from "../adapter.ts";
import { runTool, stripAnsi } from "../tool-run.ts";
import { DIFF_EXIT_CODES, diffCommand } from "./commands.ts";
import { kubectlEnvironment, optionsOf } from "./environment.ts";
import { renderSet } from "./rendered-set.ts";

// kubectl diff as a person reads it (record 0048): the preview's command over
// a set rendered the same way, with the job's own diff program, which is
// `diff -u -N` unless the workflow sets KUBECTL_EXTERNAL_DIFF. kubectl masks
// the data of a Secret itself, and prints every other value as it is: a
// ConfigMap's too. That is the risk a repo takes on with scan.logDiff.
export async function toolDiff(stack: Stack, options: PreviewOptions): Promise<ToolDiffResult> {
  const rendered = await renderSet(stack, options);
  if (!rendered.ok) return { ok: false, reason: rendered.reason, toolLog: rendered.toolLog };
  // With pruning the set holds the inventory, and the log shows it as kubectl
  // does, with the names it lists and no value (record 0070).
  try {
    const result = await runTool(options.run, {
      argv: diffCommand(rendered.set.path, optionsOf(stack)),
      cwd: join(options.root, stack.path),
      env: kubectlEnvironment(options.env),
      timeoutMinutes: options.timeoutMinutes,
      // 1 is differences, which is what this diff is for.
      exitCodes: DIFF_EXIT_CODES,
    });
    const toolLog = rendered.toolLog + stripAnsi(result.stderr);
    if (!result.ok) return { ok: false, reason: result.reason, toolLog };
    return { ok: true, text: stripAnsi(result.stdout), toolLog };
  } finally {
    await rendered.set.dispose();
  }
}
