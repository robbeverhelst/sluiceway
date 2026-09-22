import { join } from "node:path";
import type { Stack } from "../../core/stack.ts";
import type { PreviewOptions, ToolDiffResult } from "../adapter.ts";
import { runTool, stripAnsi } from "../tool-run.ts";
import { toolDiffCommand } from "./commands.ts";
import { helmEnvironment, optionsOf } from "./environment.ts";

// The diff as the plugin prints it for a person (record 0048), in the same
// directory, environment and time limit as the preview. The plugin puts a
// stand-in in place of a Secret's data, and prints every other value as the
// chart renders it: a token a chart writes into a ConfigMap is printed. That
// is the risk a repo takes on with scan.logDiff.
export async function toolDiff(stack: Stack, options: PreviewOptions): Promise<ToolDiffResult> {
  const result = await runTool(options.run, {
    argv: toolDiffCommand(optionsOf(stack)),
    cwd: join(options.root, stack.path),
    env: helmEnvironment(options.env),
    timeoutMinutes: options.timeoutMinutes,
  });
  if (!result.ok) {
    return { ok: false, reason: result.reason, toolLog: stripAnsi(result.stdout + result.stderr) };
  }
  return { ok: true, text: stripAnsi(result.stdout), toolLog: stripAnsi(result.stderr) };
}
