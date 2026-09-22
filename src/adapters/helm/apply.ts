import { join } from "node:path";
import { type Stack, stackId } from "../../core/stack.ts";
import type { ApplyResult, SavedPlan, ToolContext } from "../adapter.ts";
import { stripAnsi } from "../pulumi/tool-log.ts";
import { deployCommand, renderCommand } from "./commands.ts";
import { helmEnvironment, optionsOf } from "./environment.ts";
import { RenderedManifests } from "./rendered.ts";

// The deploy of exactly what the fresh preview rendered (record 0058). Helm
// saves no plan, so the deploy renders the chart once more right before it
// starts, with the same command line as the fresh preview's render, and goes
// out only when the manifests are the same. A template that renders
// differently every time, or a `lookup` whose answer moved, is refused as a
// moved change and nothing is deployed. The render and the deploy have no
// time limit of their own, as for every tool: a deploy stopped half way
// leaves a release half deployed.
export async function apply(
  stack: Stack,
  context: ToolContext,
  plan?: SavedPlan,
): Promise<ApplyResult> {
  if (!(plan instanceof RenderedManifests) || plan.stackId !== stackId(stack)) {
    throw new Error("A Helm stack deploys only what its fresh preview rendered.");
  }
  const helm = optionsOf(stack);
  const run = (argv: string[]) =>
    context.run({
      argv,
      cwd: join(context.root, stack.path),
      env: helmEnvironment(context.env),
    });

  const rendered = await run(renderCommand(helm));
  if (rendered.status === "not-started") {
    return { ok: false, reason: { kind: "tool-error", exitCode: null }, toolLog: "" };
  }
  // Never stdout: it is every manifest, values and all.
  const renderWords = stripAnsi(rendered.stderr);
  if (rendered.status !== "exited" || rendered.exitCode !== 0) {
    const exitCode = rendered.status === "exited" ? rendered.exitCode : null;
    return { ok: false, reason: { kind: "tool-error", exitCode }, toolLog: renderWords };
  }
  if (!plan.matches(rendered.stdout)) {
    return { ok: false, reason: { kind: "moved" }, toolLog: renderWords };
  }

  const deployed = await run(deployCommand(helm));
  if (deployed.status === "not-started") {
    return { ok: false, reason: { kind: "tool-error", exitCode: null }, toolLog: renderWords };
  }
  // What `helm upgrade` prints is the release's name, namespace, status and
  // revision. The chart's notes are hidden, because they can print a value.
  const toolLog = renderWords + stripAnsi(deployed.stdout + deployed.stderr);
  if (deployed.status === "exited" && deployed.exitCode === 0) return { ok: true, toolLog };
  const exitCode = deployed.status === "exited" ? deployed.exitCode : null;
  return { ok: false, reason: { kind: "tool-error", exitCode }, toolLog };
}
