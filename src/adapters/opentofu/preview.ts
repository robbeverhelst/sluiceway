import type { PreviewFailureReason } from "../../core/failure-reason.ts";
import { type Stack, stackId } from "../../core/stack.ts";
import type { PreviewOptions, PreviewResult } from "../adapter.ts";
import { runTool, stripAnsi } from "../tool-run.ts";
import { command, planArgs, showArgs, workingDirectory } from "./commands.ts";
import { optionsOf, tofuEnvironment } from "./environment.ts";
import { foldChanges } from "./fold.ts";
import { PlanFile } from "./plan-file.ts";
import { parsePlan } from "./schema.ts";
import { jsonLogWords } from "./tool-log.ts";

// A preview is two commands: `tofu plan -out` writes the plan file, and
// `tofu show -json` of that file prints the plan the adapter reads (OpenTofu
// docs: the plan file format is not for other tools, its JSON is). Both run
// in the stack's directory, with its workspace, and each gets the stack's time
// limit. The plan file goes when the preview ends, unless `apply` asked to
// keep it (record 0053).
export async function preview(stack: Stack, options: PreviewOptions): Promise<PreviewResult> {
  const plan = await PlanFile.create(stackId(stack));
  let kept = false;
  try {
    const result = await planAndShow(stack, options, plan);
    if (result.ok && options.savePlan) {
      kept = true;
      return { ...result, plan };
    }
    return result;
  } finally {
    if (!kept) await plan.dispose();
  }
}

async function planAndShow(
  stack: Stack,
  options: PreviewOptions,
  plan: PlanFile,
): Promise<PreviewResult> {
  const run = (argv: string[]) =>
    runTool(options.run, {
      argv: command(stack, argv),
      cwd: workingDirectory(options.root, stack),
      env: tofuEnvironment(options.env, stack),
      timeoutMinutes: options.timeoutMinutes,
    });
  const failed = (
    reason: PreviewFailureReason,
    toolLog: string,
    detail: string[] = [],
  ): PreviewResult => ({ ok: false, reason, detail, toolLog });

  // The reason comes from the exit code alone, never from the tool's words
  // (record 0022 as amended). A workspace the backend does not hold gives no
  // exit code of its own, so there is no "stack not found" here.
  const planned = await run(planArgs(plan.path, optionsOf(stack).varFiles));
  // The plan's JSON log holds its diagnostics and no values (record 0022).
  const planWords = stripAnsi(planned.stderr) + jsonLogWords(planned.stdout);
  if (!planned.ok) return failed(planned.reason, planWords);

  const shown = await run(showArgs(plan.path));
  // Never stdout: it is the plan, values and all (record 0021).
  const log = planWords + stripAnsi(shown.stderr);
  if (!shown.ok) return failed(shown.reason, log);

  const parsed = parsePlan(shown.stdout);
  if (!parsed.ok) return failed({ kind: "unreadable-output" }, log, parsed.problems);
  const folded = foldChanges(
    parsed.changes,
    options.showValues ?? [],
    options.valueFingerprint === true,
  );
  if (!folded.ok) return failed({ kind: folded.reason }, log, folded.detail);
  return {
    ok: true,
    diff: { stackId: stackId(stack), changes: folded.changes },
    toolLog: log,
    // The plan JSON as the tool printed it, for the policies alone (record
    // 0106).
    ...(options.keepDocument ? { document: { text: shown.stdout, format: "json" } } : {}),
  };
}
