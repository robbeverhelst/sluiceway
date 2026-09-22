import { join } from "node:path";
import type { Stack } from "../../core/stack.ts";
import type { PreviewOptions, ToolDiffResult } from "../adapter.ts";
import { stripAnsi } from "../pulumi/tool-log.ts";
import { toolDiffCommand } from "./commands.ts";
import { optionsOf, tofuEnvironment } from "./environment.ts";

// The plan as the tool displays it (record 0048), in the same directory,
// workspace and time limit as the preview. The tool writes "(sensitive
// value)" for what it holds as sensitive, and every other value as it is. A
// value can lose its mark on the way, as the recording
// log-diff-changed-secret shows: terraform_data copies a sensitive input to
// its output unmarked. That is the risk a repo takes on with scan.logDiff.
export async function toolDiff(stack: Stack, options: PreviewOptions): Promise<ToolDiffResult> {
  const result = await options.run({
    argv: toolDiffCommand(optionsOf(stack).varFiles),
    cwd: join(options.root, stack.path),
    env: tofuEnvironment(options.env, stack),
    timeoutMs: options.timeoutMinutes * 60_000,
  });
  if (result.status === "not-started") {
    return { ok: false, reason: { kind: "tool-error", exitCode: null }, toolLog: "" };
  }
  const words = stripAnsi(result.stdout + result.stderr);
  if (result.status === "timed-out") {
    return {
      ok: false,
      reason: { kind: "timed-out", minutes: options.timeoutMinutes },
      toolLog: words,
    };
  }
  if (result.exitCode !== 0) {
    return { ok: false, reason: { kind: "tool-error", exitCode: result.exitCode }, toolLog: words };
  }
  return { ok: true, text: stripAnsi(result.stdout), toolLog: stripAnsi(result.stderr) };
}
