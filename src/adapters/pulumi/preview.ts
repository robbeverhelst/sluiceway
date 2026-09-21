import { join } from "node:path";
import type { PreviewFailureReason } from "../../core/failure-reason.ts";
import { type Stack, stackId } from "../../core/stack.ts";
import type { PreviewOptions, PreviewResult } from "../adapter.ts";
import { pulumiEnvironment } from "./environment.ts";
import { foldSteps } from "./fold.ts";
import { parseDiagnostics, parsePreview } from "./schema.ts";
import { stripAnsi } from "./tool-log.ts";

// The command line the fixtures were recorded with (Pulumi research). The
// stack and the directory are always passed and a stack is never selected, so
// previews of different stacks share nothing (record 0012).
function previewCommand(name: string): string[] {
  return ["pulumi", "preview", "--json", "--non-interactive", "--color", "never", "--stack", name];
}

// The exit code the tool documents for "the requested stack does not exist,
// cannot be found, or no stack is selected" (Pulumi docs, CLI exit codes). The
// mapping is fixed from v3.226.1 on, below the minimum version (record 0001).
// A stack is always passed, so for a preview it means that the backend holds
// no such stack. The recorded missing-stack scenario shows it on both versions.
export const STACK_NOT_FOUND_EXIT_CODE = 6;

export async function preview(stack: Stack, options: PreviewOptions): Promise<PreviewResult> {
  if (stack.name === undefined) throw new Error("A Pulumi stack always has a name.");
  const result = await options.run({
    argv: previewCommand(stack.name),
    // Programs resolve files from the stack's directory (record 0012).
    cwd: join(options.root, stack.path),
    env: pulumiEnvironment(options.env),
    timeoutMs: options.timeoutMinutes * 60_000,
  });

  const failed = (
    reason: PreviewFailureReason,
    toolLog: string,
    detail: string[] = [],
  ): PreviewResult => ({ ok: false, reason, detail, toolLog });

  if (result.status === "not-started") return failed({ kind: "tool-error", exitCode: null }, "");
  if (result.status === "timed-out") {
    return failed({ kind: "timed-out", minutes: options.timeoutMinutes }, toolLog(result.stderr));
  }
  // Any exit code but 0 is a failure. The document of a failed preview is not
  // read for steps: it may be whole, empty or no JSON at all (Pulumi research).
  if (result.exitCode !== 0) {
    // The reason comes from the exit code alone. The tool's message is never
    // read for it, so none of it can reach a row (record 0022 as amended).
    const reason: PreviewFailureReason =
      result.exitCode === STACK_NOT_FOUND_EXIT_CODE
        ? { kind: "stack-not-found" }
        : { kind: "tool-error", exitCode: result.exitCode };
    return failed(reason, toolLog(result.stderr, parseDiagnostics(result.stdout)));
  }

  const parsed = parsePreview(result.stdout);
  if (!parsed.ok) {
    return failed({ kind: "unreadable-output" }, toolLog(result.stderr), parsed.problems);
  }
  const log = toolLog(result.stderr, parsed.diagnostics);
  const folded = foldSteps(parsed.steps);
  if (!folded.ok) return failed({ kind: folded.reason }, log, folded.detail);
  return { ok: true, diff: { stackId: stackId(stack), changes: folded.changes }, toolLog: log };
}

// The tool's stderr and its diagnostics (record 0022). Nothing of stdout but
// the diagnostics ever gets here: the rest of it is property values (record
// 0021).
function toolLog(stderr: string, diagnostics: string[] = []): string {
  return stripAnsi([stderr, ...diagnostics].join(""));
}
