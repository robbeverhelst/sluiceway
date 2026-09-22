import { join } from "node:path";
import type { Stack } from "../../core/stack.ts";
import type { PreviewOptions, ToolDiffResult } from "../adapter.ts";
import { runTool, stripAnsi } from "../tool-run.ts";
import { pulumiEnvironment } from "./environment.ts";
import { PULUMI_EXIT_CODES } from "./exit-codes.ts";

// The preview as the tool displays it (record 0048). `--diff` shows every
// changed property with its old and new value, and the tool prints `[secret]`
// for a value it holds as secret. `--suppress-outputs` keeps the stack outputs
// out, as on the deploy, because a change to outputs alone is not shown in v1
// (record 0036). The rest is the preview's command line without `--json`, and
// no other flag (record 0015).
function toolDiffCommand(name: string): string[] {
  return [
    "pulumi",
    "preview",
    "--diff",
    "--suppress-outputs",
    "--non-interactive",
    "--color",
    "never",
    "--stack",
    name,
  ];
}

export async function toolDiff(stack: Stack, options: PreviewOptions): Promise<ToolDiffResult> {
  if (stack.name === undefined) throw new Error("A Pulumi stack always has a name.");
  const result = await runTool(options.run, {
    argv: toolDiffCommand(stack.name),
    // The same directory, environment and time limit as the preview (record
    // 0012).
    cwd: join(options.root, stack.path),
    env: pulumiEnvironment(options.env),
    timeoutMinutes: options.timeoutMinutes,
    // As on the preview, the reason comes from the exit code alone (record
    // 0022 as amended).
    exitCodes: PULUMI_EXIT_CODES,
  });
  // A run that did not finish may have displayed part of the diff. All of it
  // is the tool's words, for the job log.
  if (!result.ok) {
    return { ok: false, reason: result.reason, toolLog: stripAnsi(result.stdout + result.stderr) };
  }
  return { ok: true, text: stripAnsi(result.stdout), toolLog: stripAnsi(result.stderr) };
}
