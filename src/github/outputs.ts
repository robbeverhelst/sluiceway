import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as core from "@actions/core";
import { isBotIssueWithRootMarker } from "./dashboard.ts";
import { type EventIssue, editedIssue } from "./event.ts";
import type { JobLog } from "./job-log.ts";

// The step outputs and the result file of record 0041 (build plan, section 3).
// Sluiceway sends nothing: it hands the workflow what a next step needs to
// tell people or chart numbers, and the secret of that step stays there.

export type OutputName =
  | "dashboard-url"
  | "pending"
  | "preview-failed"
  | "in-sync"
  | "dashboard-changed"
  | "outcome"
  | "stack"
  | "result-file";

export interface StepOutputs {
  set(name: OutputName, value: string): void;
  // Writes the result file of this step and gives its path. Fails when the
  // runner gave no temporary directory, or the file cannot be written.
  writeResultFile(mode: "scan" | "apply", text: string): string;
}

// The file name holds the mode, so a scan and an apply in one job keep their
// own. `RUNNER_TEMP` is emptied at the start and the end of every job, and
// Sluiceway never uploads the file (record 0041).
export function resultFileName(mode: "scan" | "apply"): string {
  return `sluiceway-${mode}-result.json`;
}

export function actionsOutputs(runnerTemp: string | undefined): StepOutputs {
  return {
    set: (name, value) => core.setOutput(name, value),
    writeResultFile(mode, text) {
      if (!runnerTemp) {
        throw new Error("RUNNER_TEMP is not set, so there is no directory for the result file");
      }
      const path = join(runnerTemp, resultFileName(mode));
      writeFileSync(path, text);
      return path;
    },
  };
}

// The web address of the dashboard, from the issue edit that started the run
// of `apply` and `settle`, which costs no request. Only an issue the bot wrote
// with a root marker on its first line counts: `resolve` checked the rest of
// record 0009 before it handed anything on. Nothing for any other event.
export function eventDashboardUrl(repoUrl: string, event: unknown): string | undefined {
  const issue: EventIssue | undefined = editedIssue(event);
  if (!issue || !isBotIssueWithRootMarker(issue)) return undefined;
  return dashboardUrl(repoUrl, issue.number);
}

export function dashboardUrl(repoUrl: string, number: number): string {
  return `${repoUrl}/issues/${number}`;
}

// Writes the result file and sets its output. A file that cannot be written
// changes nothing else: the outputs, the dashboard and the job result stay
// what they are, like a summary that cannot be written (record 0037).
export function writeResultFile(
  outputs: StepOutputs,
  log: JobLog,
  mode: "scan" | "apply",
  text: string,
): void {
  let path: string;
  try {
    path = outputs.writeResultFile(mode, text);
  } catch (error) {
    log.info(
      `Writing the result file failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    log.warning(
      "The result file of this step could not be written. The job log says why. Nothing else changes.",
      "Result file not written",
    );
    return;
  }
  outputs.set("result-file", path);
  log.info(`Wrote the result file: ${path}`);
}
