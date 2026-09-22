// Auto mode (record 0077): a step with no `mode` runs what the event of its
// run asks for, so the whole loop fits in one job with one Sluiceway step and
// the workflow needs no `if:` and no `needs:`. What runs on which event is the
// rule of core/auto-mode.ts. This wires the modes one after the other the way
// the four jobs of the split workflow did: `resolve` and the scan hand deploys
// on, each goes to `apply` in turn, and `settle` runs last whenever anything
// was handed on, also when a mode before it ended red.

import { type AutoEvent, type AutoMode, autoModes } from "../core/auto-mode.ts";
import { loadConfig } from "../core/config-file.ts";
import { type MatrixEntry, matrixOutput, parseMatrixOutput } from "../core/resolve.ts";
import { editedIssue } from "../github/event.ts";
import type { JobLog } from "../github/job-log.ts";
import type { StepOutputs } from "../github/outputs.ts";
import { notTheDashboardText } from "./resolve.ts";

// What one mode inside the step is handed: the step's log, whose summary it
// shares with the other modes, and the step's outputs.
export interface AutoStep {
  log: JobLog;
  outputs: StepOutputs;
}

export interface AutoContext {
  // The directory of the checked-out repo, for the dashboard's label and
  // `dashboard.readOnly`.
  root: string;
  // `GITHUB_EVENT_NAME` and the payload of the event.
  eventName: string;
  event: unknown;
  log: JobLog;
  // A notice on the run: the one line of a run that has nothing to do.
  notice: (line: string) => void;
  outputs: StepOutputs;
  // The modes, each as the glue builds it for this job.
  run: {
    scan(step: AutoStep): Promise<void>;
    resolve(step: AutoStep): Promise<void>;
    apply(deploymentId: number, step: AutoStep): Promise<void>;
    settle(step: AutoStep): Promise<void>;
    check(step: AutoStep): Promise<void>;
  };
  // For the post step of action.yml: a deploy was handed on, and settle ran.
  // A cancelled run never gets to settle, and the post step does it then.
  handedOn?: () => void;
  settled?: () => void;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// What the rule needs of the event, read from its payload.
export function autoEvent(eventName: string, payload: unknown): AutoEvent {
  const body = record(payload);
  return {
    name: eventName,
    action: text(body?.action),
    ref: text(body?.ref),
    defaultBranch: text(record(body?.repository)?.default_branch),
  };
}

// A broken config file is the modes' to report, with their own messages, so
// here it reads as the default. Each mode auto starts reads the repo itself,
// as the jobs of the split workflow did.
function readOnly(root: string): boolean {
  try {
    return loadConfig(root).dashboard.readOnly;
  } catch {
    return false;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function auto(context: AutoContext): Promise<void> {
  const plan = autoModes(autoEvent(context.eventName, context.event), {
    readOnly: readOnly(context.root),
  });
  if ("notice" in plan) {
    context.notice(plan.notice);
    return;
  }
  // The cheap check of record 0017, before anything else runs: an edit of
  // any other issue is not Sluiceway's.
  if (context.eventName === "issues") {
    const issue = editedIssue(context.event);
    const not =
      issue === undefined
        ? "The issue event names no issue. Nothing to do."
        : notTheDashboardText(issue, () => loadConfig(context.root));
    if (not !== undefined) {
      context.notice(not);
      return;
    }
  }

  const summaries: string[] = [];
  const failures: string[] = [];
  const started: MatrixEntry[] = [];
  let slot = 0;
  // Each mode writes the whole summary of its part. The step's summary is all
  // of them, in the order they ran.
  const stepFor = (): AutoStep & { handed: () => MatrixEntry[] } => {
    const mine = slot++;
    let handed: MatrixEntry[] = [];
    return {
      log: {
        ...context.log,
        async writeSummary(text) {
          summaries[mine] = text;
          await context.log.writeSummary(
            summaries.filter((part) => part !== undefined).join("\n\n"),
          );
        },
      },
      outputs: {
        ...context.outputs,
        set(name, value) {
          // The step's matrix is every deploy it started, set once at the end.
          if (name === "matrix") handed = parseMatrixOutput(value);
          else context.outputs.set(name, value);
        },
        writeResultFile: (mode, text) => context.outputs.writeResultFile(mode, text),
      },
      handed: () => handed,
    };
  };
  const attempt = async (what: string, run: () => Promise<void>): Promise<void> => {
    try {
      await run();
    } catch (error) {
      failures.push(`${what}: ${message(error)}`);
    }
  };

  try {
    for (const mode of plan.modes) {
      const step = stepFor();
      context.log.info(`Sluiceway runs ${mode}, for the ${context.eventName} event of this run.`);
      await attempt(mode, () => runMode(context, mode, step));
      // What was handed on deploys even when the mode itself ended red, as
      // `!cancelled()` let the apply jobs of the split workflow go ahead.
      const entries = step.handed();
      if (entries.length > 0 && started.length === 0) context.handedOn?.();
      started.push(...entries);
      for (const entry of entries) {
        context.log.info(
          `Sluiceway runs apply, for ${entry.stack} (deployment record ${entry.deployment}).`,
        );
        await attempt(`apply of ${entry.stack}`, () =>
          context.run.apply(entry.deployment, stepFor()),
        );
      }
    }
    if (started.length > 0) {
      context.log.info("Sluiceway runs settle, for the deploys this run started.");
      await attempt("settle", () => context.run.settle(stepFor()));
      context.settled?.();
    }
  } finally {
    context.outputs.set("matrix", matrixOutput(started));
  }
  if (failures.length > 0) throw new Error(failures.join(" "));
}

function runMode(context: AutoContext, mode: AutoMode, step: AutoStep): Promise<void> {
  switch (mode) {
    case "scan":
      return context.run.scan(step);
    case "resolve":
      return context.run.resolve(step);
    case "check":
      return context.run.check(step);
  }
}
