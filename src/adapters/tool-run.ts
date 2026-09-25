import type { PreviewFailureReason } from "../core/failure-reason.ts";
import type { ToolRun } from "../core/tool-result.ts";
import type { ProcessRunner, Run } from "./process.ts";

// One run of a tool and what it came to: the tool's output, or a reason from
// the fixed list of record 0022. Every adapter starts its tool through here,
// so the time limit, a tool that could not be started, a run that ran out of
// time and the reason of an exit code are decided in one place. What an exit
// code means is the tool's own, so each adapter hands in the codes its tool
// documents. Which of the tool's words go to the job log is the adapter's
// too, because only it knows which stream holds values (record 0021): both
// streams come back either way, and a tool that was never started printed
// nothing.

// What the exit codes of one command mean.
export interface ExitCodes {
  // The codes after which the output is read. Absent, only 0.
  success?: readonly number[];
  // The codes the tool documents, each with a reason of its own. Every other
  // code is a tool error with the code on the row. The reason comes from the
  // code alone, never from the tool's words (record 0022 as amended).
  reasons?: Readonly<Record<number, PreviewFailureReason>>;
}

// The command, its directory and the whole environment of the child.
export type ToolCommand = Pick<Run, "argv" | "cwd" | "env">;

export interface ToolRunSpec extends ToolCommand {
  // The time limit of this one run, in whole minutes (record 0012).
  timeoutMinutes: number;
  exitCodes?: ExitCodes | undefined;
}

// What the run came to lives in core/, which reads it (issue 245).
export type { ToolRun } from "../core/tool-result.ts";

// A run with a time limit: a preview, the drift check, the tool diff, a
// preparation, a read of the tool's history or of its backend.
export async function runTool(runner: ProcessRunner, spec: ToolRunSpec): Promise<ToolRun> {
  const { timeoutMinutes, exitCodes = {}, ...command } = spec;
  const result = await runner({ ...command, timeoutMs: timeoutMinutes * 60_000 });
  if (result.status === "not-started") {
    return { ok: false, reason: { kind: "tool-error", exitCode: null }, stdout: "", stderr: "" };
  }
  const { stdout, stderr } = result;
  if (result.status === "timed-out") {
    return { ok: false, reason: { kind: "timed-out", minutes: timeoutMinutes }, stdout, stderr };
  }
  const { exitCode } = result;
  if (exitCode !== null && (exitCodes.success ?? [0]).includes(exitCode)) {
    return {
      ok: true,
      exitCode,
      stdout,
      stderr,
      ...(result.outputCutAt === undefined ? {} : { outputCutAt: result.outputCutAt }),
    };
  }
  const own = exitCode === null ? undefined : exitCodes.reasons?.[exitCode];
  return { ok: false, reason: own ?? { kind: "tool-error", exitCode }, stdout, stderr };
}

export type DeployRun = (
  | { ok: true }
  | { ok: false; reason: { kind: "tool-error"; exitCode: number | null } }
) & { stdout: string; stderr: string };

// A run that is part of a deploy. It has no time limit of its own: stopping a
// deploy half way can leave a stack half deployed. When `apply` hands in a
// runner with the `deploy-timeout` input's limit, a run it stopped has no exit
// code, and `apply` says why (slice 5.9). A deploy keeps its exit code: the
// reasons a tool gives its codes are for a person deciding on a tick.
export async function runDeploy(runner: ProcessRunner, command: ToolCommand): Promise<DeployRun> {
  const result = await runner(command);
  if (result.status === "not-started") {
    return { ok: false, reason: { kind: "tool-error", exitCode: null }, stdout: "", stderr: "" };
  }
  const { stdout, stderr } = result;
  if (result.status === "exited" && result.exitCode === 0) return { ok: true, stdout, stderr };
  const exitCode = result.status === "exited" ? result.exitCode : null;
  return { ok: false, reason: { kind: "tool-error", exitCode }, stdout, stderr };
}

// Control sequences (colour, cursor) and operating system commands (titles,
// links), by their ECMA-48 grammar.
const ANSI_ESCAPES = new RegExp(
  [
    "\\u001b\\[[0-?]*[ -/]*[@-~]",
    "\\u001b\\][^\\u0007\\u001b]*(?:\\u0007|\\u001b\\\\)",
    "\\u001b[@-Z\\\\^_]",
  ].join("|"),
  "g",
);

// The tool's words go to the job log as they are, with ANSI escapes stripped
// (record 0022). Its diagnostics hold escapes even when colour is turned off.
export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPES, "");
}
