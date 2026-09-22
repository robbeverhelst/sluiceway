import { join } from "node:path";
import { type Stack, stackId } from "../../core/stack.ts";
import type { ApplyResult, SavedPlan, ToolContext } from "../adapter.ts";
import { stripAnsi } from "../pulumi/tool-log.ts";
import { applyCommand } from "./commands.ts";
import { kubectlEnvironment, optionsOf } from "./environment.ts";
import { RenderedSet } from "./rendered-set.ts";

// The deploy of exactly the rendered set whose diff hash the tick approved
// (record 0060). `apply` hands over the set its fresh preview diffed, and the
// adapter checks that the file still holds those bytes before kubectl applies
// it server-side. There is no deploy that renders again: without the set the
// adapter refuses. The time limit is the job's own, as for every tool.
export async function apply(
  stack: Stack,
  context: ToolContext,
  plan?: SavedPlan,
): Promise<ApplyResult> {
  if (!(plan instanceof RenderedSet) || plan.stackId !== stackId(stack)) {
    throw new Error(
      "A Kubernetes manifests stack deploys only the rendered set its fresh preview kept.",
    );
  }
  if (!(await plan.intact())) {
    throw new Error(
      `The rendered set of ${stackId(stack)} changed after its preview. Nothing was deployed.`,
    );
  }
  const result = await context.run({
    argv: applyCommand(plan.path, optionsOf(stack)),
    cwd: join(context.root, stack.path),
    env: kubectlEnvironment(context.env),
  });
  if (result.status === "not-started") {
    return { ok: false, reason: { kind: "tool-error", exitCode: null }, toolLog: "" };
  }
  // A server-side apply prints each object's kind and name and what happened
  // to it, and no value.
  const toolLog = stripAnsi(result.stdout + result.stderr);
  if (result.status === "exited" && result.exitCode === 0) return { ok: true, toolLog };
  const exitCode = result.status === "exited" ? result.exitCode : null;
  return { ok: false, reason: { kind: "tool-error", exitCode }, toolLog };
}
