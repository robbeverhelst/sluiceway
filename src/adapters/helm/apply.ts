import { join } from "node:path";
import { z } from "zod";
import { type Stack, stackId } from "../../core/stack.ts";
import type { ApplyOptions, ApplyResult, SavedPlan, ToolContext } from "../adapter.ts";
import { type DeployRun, runDeploy, stripAnsi } from "../tool-run.ts";
import { deployCommand, metadataCommand, renderCommand, versionCommand } from "./commands.ts";
import { helmEnvironment, optionsOf } from "./environment.ts";
import { RenderedManifests } from "./rendered.ts";
import { readVersion } from "./version.ts";

// The deploy of exactly what the fresh preview rendered (record 0058). Helm
// saves no plan, so the deploy renders the chart once more right before it
// starts, with the same command line as the fresh preview's render, and goes
// out only when the manifests are the same. A template that renders
// differently every time, or a `lookup` whose answer moved, is refused as a
// moved change and nothing is deployed. The render and the deploy have no
// time limit of their own, as for every tool: a deploy stopped half way
// leaves a release half deployed.
//
// Then the deploy's flags (record 0069): the version of helm, because Helm 4
// renamed --atomic, and for a deploy that puts drift back on Helm 4, how the
// release is applied. Helm 3 and a release applied client-side merge the
// chart into the live objects, which puts drift back by itself. A release
// Helm 4 applies server-side refuses a field another manager changed unless
// the deploy forces it, and Helm 4 refuses --force-conflicts on a release
// applied client-side.
export async function apply(
  stack: Stack,
  context: ToolContext,
  plan?: SavedPlan,
  options?: ApplyOptions,
): Promise<ApplyResult> {
  if (!(plan instanceof RenderedManifests) || plan.stackId !== stackId(stack)) {
    throw new Error("A Helm stack deploys only what its fresh preview rendered.");
  }
  const helm = optionsOf(stack);
  const run = (argv: string[]) =>
    runDeploy(context.run, {
      argv,
      cwd: join(context.root, stack.path),
      env: helmEnvironment(context.env),
    });
  const failed = (result: DeployRun, toolLog: string): ApplyResult => ({
    ok: false,
    // A run that ended well and still stops the deploy is a tool error with
    // its exit code, 0.
    reason: result.ok ? { kind: "tool-error", exitCode: 0 } : result.reason,
    toolLog,
  });

  const rendered = await run(renderCommand(helm));
  // Never stdout: it is every manifest, values and all.
  let toolLog = stripAnsi(rendered.stderr);
  if (!rendered.ok) return failed(rendered, toolLog);
  if (!plan.matches(rendered.stdout)) {
    return { ok: false, reason: { kind: "moved" }, toolLog };
  }

  const version = await run(versionCommand());
  toolLog += stripAnsi(version.stderr);
  const major = version.ok ? readVersion(version.stdout)?.numbers[0] : undefined;
  if (major === undefined) {
    return failed(version, toolLog + (version.ok ? stripAnsi(version.stdout) : ""));
  }

  let forceConflicts = false;
  if (options?.repairDrift === true && major >= 4) {
    const metadata = await run(metadataCommand(helm));
    toolLog += stripAnsi(metadata.stderr);
    if (!metadata.ok) return failed(metadata, toolLog);
    forceConflicts = appliedServerSide(metadata.stdout);
  }

  const deployed = await run(deployCommand(helm, { major, forceConflicts }));
  // What `helm upgrade` prints is the release's name, namespace, status and
  // revision. The chart's notes are hidden, because they can print a value.
  toolLog += stripAnsi(deployed.stdout + deployed.stderr);
  return deployed.ok ? { ok: true, toolLog } : failed(deployed, toolLog);
}

// Helm 4 writes "ssa" for a release it applies server-side, and "csa", or
// nothing for a release Helm 3 made, for one it applies client-side. Anything
// else is taken as client-side: the deploy then puts back what a client-side
// merge puts back, and a conflict fails it with helm's own words.
const metadataSchema = z.object({ applyMethod: z.string().optional() });

function appliedServerSide(stdout: string): boolean {
  try {
    return metadataSchema.safeParse(JSON.parse(stdout)).data?.applyMethod === "ssa";
  } catch {
    return false;
  }
}
