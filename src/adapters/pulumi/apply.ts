import { join } from "node:path";
import type { Stack } from "../../core/stack.ts";
import type { ApplyOptions, ApplyResult, SavedPlan, ToolContext } from "../adapter.ts";
import { pulumiEnvironment } from "./environment.ts";
import { stripAnsi } from "./tool-log.ts";

// The command line of the Pulumi research ("Non-interactive up"), with the
// flags of the preview's command line that make it quiet. `--skip-preview`,
// because `apply` has just run its own preview, and a third run of the program
// buys nothing. No `--json`: on `up` it streams engine events, which carry
// every property value. `--suppress-outputs`, because a stack output can be a
// secret (record 0021). No other flag: a flag that reaches the deploy and not
// the preview breaks the promise of a tick (record 0015).
// With `--refresh` for a row whose hash covers drift (record 0055): the tool
// reads what is real first, then deploys the code over it, which puts the
// drift back. `apply` has checked the drift again just before, like the diff.
function upCommand(name: string, repairDrift: boolean): string[] {
  return [
    "pulumi",
    "up",
    "--yes",
    "--skip-preview",
    ...(repairDrift ? ["--refresh"] : []),
    "--suppress-outputs",
    "--non-interactive",
    "--color",
    "never",
    "--stack",
    name,
  ];
}

export async function apply(
  stack: Stack,
  context: ToolContext,
  // Pulumi saves no plan Sluiceway builds on (Pulumi research), so it never
  // gets one.
  _plan?: SavedPlan,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  if (stack.name === undefined) throw new Error("A Pulumi stack always has a name.");
  const result = await context.run({
    argv: upCommand(stack.name, options.repairDrift === true),
    // The same directory as the preview (record 0012).
    cwd: join(context.root, stack.path),
    env: pulumiEnvironment(context.env),
    // No time limit. The job's own is the user's.
  });

  if (result.status === "not-started") {
    return { ok: false, reason: { kind: "tool-error", exitCode: null }, toolLog: "" };
  }
  // What `up` prints without --json is the tool's own display: which
  // resources it changes, and its diagnostics. It goes to the job log only
  // (record 0022).
  const toolLog = stripAnsi(result.stdout + result.stderr);
  if (result.status === "exited" && result.exitCode === 0) return { ok: true, toolLog };
  // A run without a time limit is never timed out by the runner.
  const exitCode = result.status === "exited" ? result.exitCode : null;
  return { ok: false, reason: { kind: "tool-error", exitCode }, toolLog };
}
