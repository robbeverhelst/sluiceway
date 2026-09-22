import type { Stack } from "../../core/stack.ts";
import type { PreviewOptions, ToolDiffResult } from "../adapter.ts";
import { runTool, stripAnsi } from "../tool-run.ts";
import { command, toolDiffArgs, workingDirectory } from "./commands.ts";
import { optionsOf, tofuEnvironment } from "./environment.ts";

// The plan as the tool displays it (record 0048), in the same directory,
// workspace and time limit as the preview. The tool writes "(sensitive
// value)" for what it holds as sensitive, and every other value as it is. A
// value can lose its mark on the way, as the recording
// log-diff-changed-secret shows: terraform_data copies a sensitive input to
// its output unmarked. That is the risk a repo takes on with scan.logDiff.
export async function toolDiff(stack: Stack, options: PreviewOptions): Promise<ToolDiffResult> {
  const result = await runTool(options.run, {
    argv: command(stack, toolDiffArgs(optionsOf(stack).varFiles)),
    cwd: workingDirectory(options.root, stack),
    env: tofuEnvironment(options.env, stack),
    timeoutMinutes: options.timeoutMinutes,
  });
  if (!result.ok) {
    return { ok: false, reason: result.reason, toolLog: stripAnsi(result.stdout + result.stderr) };
  }
  return { ok: true, text: stripAnsi(result.stdout), toolLog: stripAnsi(result.stderr) };
}
