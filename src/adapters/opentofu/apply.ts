import { type Stack, stackId } from "../../core/stack.ts";
import type { ApplyResult, SavedPlan, ToolContext } from "../adapter.ts";
import { runDeploy, stripAnsi } from "../tool-run.ts";
import { applyArgs, command, workingDirectory } from "./commands.ts";
import { tofuEnvironment } from "./environment.ts";
import { PlanFile } from "./plan-file.ts";
import { jsonLogWords } from "./tool-log.ts";

// The deploy of exactly the plan whose diff hash the tick approved (record
// 0053, and the first user's earlier dashboard). `apply` hands over the plan
// file its fresh preview wrote and hashed. The tool applies what the file
// holds and nothing else, and refuses a plan the state moved away from since,
// as stale. There is no deploy that plans again: without the saved plan the
// adapter refuses. The time limit is the job's own, as for Pulumi.
export async function apply(
  stack: Stack,
  context: ToolContext,
  plan?: SavedPlan,
): Promise<ApplyResult> {
  if (!(plan instanceof PlanFile) || plan.stackId !== stackId(stack)) {
    throw new Error("An OpenTofu stack deploys only the plan its fresh preview saved.");
  }
  const result = await runDeploy(context.run, {
    argv: command(stack, applyArgs(plan.path)),
    cwd: workingDirectory(context.root, stack),
    // The same workspace the plan was made in.
    env: tofuEnvironment(context.env, stack),
  });
  // The JSON log's progress and diagnostics, without the outputs, which can
  // be secrets (record 0021).
  const toolLog = stripAnsi(result.stderr) + jsonLogWords(result.stdout);
  return result.ok ? { ok: true, toolLog } : { ok: false, reason: result.reason, toolLog };
}
