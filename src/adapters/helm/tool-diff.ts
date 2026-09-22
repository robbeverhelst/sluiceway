import { join } from "node:path";
import type { Stack } from "../../core/stack.ts";
import type { PreviewOptions, ToolDiffResult } from "../adapter.ts";
import { stripAnsi } from "../pulumi/tool-log.ts";
import { toolDiffCommand } from "./commands.ts";
import { helmEnvironment, optionsOf } from "./environment.ts";
import { failureOf } from "./preview.ts";

// The diff as the plugin prints it for a person (record 0048), in the same
// directory, environment and time limit as the preview. The plugin puts a
// stand-in in place of a Secret's data, and prints every other value as the
// chart renders it: a token a chart writes into a ConfigMap is printed. That
// is the risk a repo takes on with scan.logDiff.
export async function toolDiff(stack: Stack, options: PreviewOptions): Promise<ToolDiffResult> {
  const result = await options.run({
    argv: toolDiffCommand(optionsOf(stack)),
    cwd: join(options.root, stack.path),
    env: helmEnvironment(options.env),
    timeoutMs: options.timeoutMinutes * 60_000,
  });
  if (result.status === "not-started") {
    return { ok: false, reason: { kind: "tool-error", exitCode: null }, toolLog: "" };
  }
  const reason = failureOf(result, options.timeoutMinutes);
  if (reason !== undefined) {
    return { ok: false, reason, toolLog: stripAnsi(result.stdout + result.stderr) };
  }
  return { ok: true, text: stripAnsi(result.stdout), toolLog: stripAnsi(result.stderr) };
}
