import type { Diff } from "../core/diff.ts";
import type { DeployFailureReason, PreviewFailureReason } from "../core/failure-reason.ts";
import type { Stack } from "../core/stack.ts";
import type { ProcessRunner } from "./process.ts";

// What an adapter needs in order to start its tool. All of it is handed in, so
// an adapter reads no global and tests can replay recorded output.
export interface ToolContext {
  // The directory of the checked-out repo.
  root: string;
  // The environment of the job, as the glue read it once. The tool gets all of
  // it except the INPUT_* variables (record 0013).
  env: Record<string, string | undefined>;
  run: ProcessRunner;
}

export interface PreviewOptions extends ToolContext {
  // The time limit of this one preview, in whole minutes (record 0012).
  timeoutMinutes: number;
  // `dashboard.showValues` (record 0052): the only paths whose values the
  // diff may hold. Absent or empty, it holds none.
  showValues?: readonly string[] | undefined;
}

export type PreviewResult = (
  | { ok: true; diff: Diff }
  | {
      ok: false;
      reason: PreviewFailureReason;
      // Sluiceway's own words on what went wrong, for the job log. They name a
      // place in the tool's output and what was expected there, never what was
      // found (record 0021).
      detail: string[];
    }
) & {
  // The tool's own words: its stderr and its diagnostics, with ANSI escapes
  // stripped. They can quote a value, so they go to the job log and nowhere
  // else (record 0022).
  toolLog: string;
};

export type ApplyResult = (
  | { ok: true }
  | { ok: false; reason: Extract<DeployFailureReason, { kind: "tool-error" }> }
) & {
  // The tool's own words, with ANSI escapes stripped. They go to the job log
  // and nowhere else (record 0022).
  toolLog: string;
};

// The tool's own diff (record 0048): what a deploy would change as the tool
// displays it, values included, except the ones the tool holds as secret. It
// exists only for the job log, in the group of its stack, and only when a repo
// turned `scan.logDiff` on. Nothing else may take `text`: not a row, the
// summary, the result file, an annotation or a deployment record.
export type ToolDiffResult = (
  | { ok: true; text: string }
  | { ok: false; reason: PreviewFailureReason }
) & {
  // The tool's other words, with ANSI escapes stripped (record 0022).
  toolLog: string;
};

// The tool is missing, too old, or did not say which version it is. The scan
// cannot do its work, so this fails the job (records 0001 and 0012). The
// message is Sluiceway's own. What the tool printed is in toolLog, for the
// job log only (record 0022).
export class ToolVersionError extends Error {
  readonly toolLog: string;

  constructor(message: string, toolLog = "") {
    super(message);
    this.name = "ToolVersionError";
    this.toolLog = toolLog;
  }
}

// What Sluiceway needs from an infrastructure tool. Everything the tool's own
// words mean stays behind this interface (record 0006).
export interface Adapter {
  // Finds the stacks under root, the directory of the checked-out repo, from
  // files alone. It never asks a backend and never starts the tool, because
  // resolve and settle run it in a job that holds no credentials (record
  // 0014). Paths come back in the form a stack id uses, and the stacks in the
  // same order every time. What cannot be worked out is a DiscoveryError.
  // Ignore is not the adapter's business: applyConfig drops ignored stacks.
  discover(root: string): Promise<Stack[]>;

  // Checks once, before any preview, that the tool is there and new enough.
  // Anything else is a ToolVersionError. No warn-and-continue (record 0001).
  checkVersion(context: ToolContext): Promise<void>;

  // Works out what deploying the stack would change. It always resolves: a
  // preview that gave no diff is a preview failure with a reason, so one
  // broken stack never stops the others (record 0012). No property value is in
  // the diff, the reason or the detail (record 0021), except the values at
  // paths that `showValues` lists (record 0052).
  preview(stack: Stack, options: PreviewOptions): Promise<PreviewResult>;

  // Runs the tool a second time for a stack whose preview is pending, and
  // gives the tool's own diff (record 0048). Same directory, environment and
  // time limit as the preview. It always resolves, and nothing Sluiceway
  // decides depends on it: the row and the diff hash come from the preview.
  toolDiff(stack: Stack, options: PreviewOptions): Promise<ToolDiffResult>;

  // Deploys the stack as the code is now. `apply` calls it only right after a
  // fresh preview gave the diff hash the tick approved (record 0008), and the
  // command line differs from the preview's only in what makes it a deploy
  // (record 0015). It has no time limit of its own: a deploy stopped half way
  // leaves a stack half deployed. It always resolves.
  apply(stack: Stack, context: ToolContext): Promise<ApplyResult>;
}
