import type { PreviewFailureReason } from "../../core/failure-reason.ts";
import { type Stack, stackId } from "../../core/stack.ts";
import type { PreviewOptions, PreviewResult } from "../adapter.ts";
import { stripAnsi } from "../pulumi/tool-log.ts";
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
    options.run({
      argv: command(stack, argv),
      cwd: workingDirectory(options.root, stack),
      env: tofuEnvironment(options.env, stack),
      timeoutMs: options.timeoutMinutes * 60_000,
    });
  const failed = (
    reason: PreviewFailureReason,
    toolLog: string,
    detail: string[] = [],
  ): PreviewResult => ({ ok: false, reason, detail, toolLog });

  const planned = await run(planArgs(plan.path, optionsOf(stack).varFiles));
  if (planned.status === "not-started") return failed({ kind: "tool-error", exitCode: null }, "");
  // The plan's JSON log holds its diagnostics and no values (record 0022).
  const planWords = stripAnsi(planned.stderr) + jsonLogWords(planned.stdout);
  if (planned.status === "timed-out") {
    return failed({ kind: "timed-out", minutes: options.timeoutMinutes }, planWords);
  }
  // The reason comes from the exit code alone, never from the tool's words
  // (record 0022 as amended). A workspace the backend does not hold gives no
  // exit code of its own, so there is no "stack not found" here.
  if (planned.exitCode !== 0) {
    return failed({ kind: "tool-error", exitCode: planned.exitCode }, planWords);
  }

  const shown = await run(showArgs(plan.path));
  if (shown.status === "not-started") {
    return failed({ kind: "tool-error", exitCode: null }, planWords);
  }
  // Never stdout: it is the plan, values and all (record 0021).
  const log = planWords + stripAnsi(shown.stderr);
  if (shown.status === "timed-out") {
    return failed({ kind: "timed-out", minutes: options.timeoutMinutes }, log);
  }
  if (shown.exitCode !== 0) return failed({ kind: "tool-error", exitCode: shown.exitCode }, log);

  const parsed = parsePlan(shown.stdout);
  if (!parsed.ok) return failed({ kind: "unreadable-output" }, log, parsed.problems);
  const folded = foldChanges(parsed.changes, options.showValues ?? []);
  if (!folded.ok) return failed({ kind: folded.reason }, log, folded.detail);
  return { ok: true, diff: { stackId: stackId(stack), changes: folded.changes }, toolLog: log };
}
