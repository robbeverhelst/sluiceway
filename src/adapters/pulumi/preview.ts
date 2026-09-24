import { join } from "node:path";
import type { PreviewFailureReason } from "../../core/failure-reason.ts";
import { type Stack, stackId } from "../../core/stack.ts";
import type { PreviewOptions, PreviewResult } from "../adapter.ts";
import { runTool, stripAnsi } from "../tool-run.ts";
import { pulumiEnvironment } from "./environment.ts";
import { PULUMI_EXIT_CODES } from "./exit-codes.ts";
import { foldSteps } from "./fold.ts";
import { parseDiagnostics, parsePreview } from "./schema.ts";

// The command line the fixtures were recorded with (Pulumi research). The
// stack and the directory are always passed and a stack is never selected, so
// previews of different stacks share nothing (record 0012).
function previewCommand(name: string): string[] {
  return ["pulumi", "preview", "--json", "--non-interactive", "--color", "never", "--stack", name];
}

// The preview, and the names its stack references give (record 0059). The
// names stay inside the adapter: its index turns them into stack ids, and
// nothing else sees them.
export async function previewWithReferences(
  stack: Stack,
  options: PreviewOptions,
): Promise<{ result: PreviewResult; references: string[] }> {
  if (stack.name === undefined) throw new Error("A Pulumi stack always has a name.");
  const result = await runTool(options.run, {
    argv: previewCommand(stack.name),
    // Programs resolve files from the stack's directory (record 0012).
    cwd: join(options.root, stack.path),
    env: pulumiEnvironment(options.env),
    timeoutMinutes: options.timeoutMinutes,
    exitCodes: PULUMI_EXIT_CODES,
  });

  const failed = (reason: PreviewFailureReason, toolLog: string, detail: string[] = []) => ({
    result: { ok: false, reason, detail, toolLog } as PreviewResult,
    references: [],
  });

  // Any exit code but 0 is a failure. The document of a failed preview is not
  // read for steps: it may be whole, empty or no JSON at all (Pulumi research).
  // Only one the tool finished holds diagnostics.
  if (!result.ok) {
    const finished = result.reason.kind !== "timed-out";
    return failed(
      result.reason,
      toolLog(result.stderr, finished ? parseDiagnostics(result.stdout) : []),
    );
  }

  // A document the runner cut at its limit is not whole (slice 5.9).
  if (result.outputCutAt !== undefined) {
    return failed(
      { kind: "output-too-large", megabytes: Math.floor(result.outputCutAt / 1024 / 1024) },
      toolLog(result.stderr),
    );
  }

  const parsed = parsePreview(result.stdout, options.showValues, options.valueFingerprint === true);
  if (!parsed.ok) {
    return failed({ kind: "unreadable-output" }, toolLog(result.stderr), parsed.problems);
  }
  const log = toolLog(result.stderr, parsed.diagnostics);
  const folded = foldSteps(parsed.steps);
  if (!folded.ok) return failed({ kind: folded.reason }, log, folded.detail);
  return {
    result: { ok: true, diff: { stackId: stackId(stack), changes: folded.changes }, toolLog: log },
    references: parsed.steps.flatMap((step) => step.stackReference ?? []),
  };
}

// The tool's stderr and its diagnostics (record 0022). Nothing of stdout but
// the diagnostics ever gets here: the rest of it is property values (record
// 0021).
function toolLog(stderr: string, diagnostics: string[] = []): string {
  return stripAnsi([stderr, ...diagnostics].join(""));
}
