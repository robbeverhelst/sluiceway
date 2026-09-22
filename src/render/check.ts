// The words of the check (record 0042): its summary, and the pieces of text
// the job log shares with it. Everything here is a name Sluiceway derived from
// the repo's files. Nothing comes from the tool, and no value (records 0021,
// 0022).

import type { CheckReport, IgnoreReport, UnclaimedGroup } from "../core/check.ts";
import type { ConfiguredStack } from "../core/config.ts";
import { stackId } from "../core/stack.ts";
import type {
  SluicewayJob,
  WorkflowNote,
  WorkflowReport,
  WorkflowWarning,
} from "../core/workflow-check.ts";
import { escapeText } from "./escape.ts";
import { plural } from "./row.ts";

export const VALID = "The setup is valid.";
export const NO_CONFIG_FILE = "No sluiceway.yaml, so every setting is its default.";
// The one sentence record 0042 asks for.
export const CANNOT_TELL =
  "A check reads files only, so it cannot say that a preview will work: a stack that does not exist in the backend, a missing credential or a registry the runner cannot reach shows only in a scan.";
export const WHERE_FILES_BELONG =
  "A file that some stacks read belongs under the inputs of those stacks in sluiceway.yaml. A file that no stack reads can be listed under scan.unrelated.";
export const PASTE_NOTE =
  "The block below keeps what scan.unrelated has and adds globs for the files that look like docs and tooling. Sluiceway does not decide this for you: leave out any glob that covers a file one of your programs reads.";

// The workflow part (record 0061).
export const WORKFLOW_WARNING_TITLE = "A workflow is missing something";
export const NOTHING_MISSING = "Nothing is missing from the workflows.";
export const NO_SCAN_WORKFLOW = "No workflow in .github/workflows runs a scan yet.";
export const WORKFLOWS_AS_TEXT =
  "The check reads the workflow files as text. The repo's default token permissions, the rules of an environment and what GitHub itself validates live elsewhere and do not show here.";

// A summary lists this many files of a directory. The job log lists them all.
const FILES_PER_DIRECTORY = 20;

export function foundText(count: number): string {
  return count === 0 ? "Found no stacks." : `Found ${plural(count, "stack")}.`;
}

// The settings of one stack, in the words of sluiceway.yaml.
export function settingsText(configured: ConfiguredStack): string {
  const { environment, tickers, inputs } = configured;
  const rule = typeof tickers === "string" ? tickers : tickers.join(", ");
  const claims = inputs.length === 0 ? "no inputs" : `inputs ${inputs.join(", ")}`;
  const waits = dependsOnWords(configured);
  return `environment ${environment}, tickers ${rule}, ${claims}${waits === undefined ? "" : `, depends on ${waits}`}`;
}

// What a stack depends on (records 0056 and 0059): the stack ids the file
// names, and auto, whose stacks only a preview can read. Undefined for none.
function dependsOnWords({ dependsOn, dependsOnAuto }: ConfiguredStack): string | undefined {
  const parts = [
    ...(dependsOn ?? []),
    ...(dependsOnAuto ? ["the stacks its stack references name, read at each preview (auto)"] : []),
  ];
  return parts.length === 0 ? undefined : parts.join(", ");
}

function dependsOnCell({ dependsOn, dependsOnAuto }: ConfiguredStack): string {
  const parts = [
    ...(dependsOn ?? []),
    ...(dependsOnAuto ? ["auto: its stack references, read at each preview"] : []),
  ];
  return parts.length === 0 ? "none" : parts.join(", ");
}

export function ignoreText({ glob, stacks }: IgnoreReport): string {
  return `ignore ${JSON.stringify(glob)} leaves out ${plural(stacks.length, "stack")}: ${stacks.join(", ")}.`;
}

// A glob that leaves out nothing. The hint is onboarding log hurdle 4.
export function unmatchedText(entry: IgnoreReport): string {
  return `ignore ${JSON.stringify(entry.glob)} matches no stack. ${unmatchedWhy(entry)}`;
}

function unmatchedWhy({ hint }: IgnoreReport): string {
  const why = "It is matched against the stack id, not the directory.";
  return hint === undefined
    ? why
    : `${why} ${JSON.stringify(hint.glob)} would leave out ${hint.stacks.join(", ")}.`;
}

export function unclaimedText(count: number): string {
  return `${plural(count, "file")} ${count === 1 ? "is" : "are"} claimed by no stack. A push that changes one of them gives a full scan.`;
}

// Ready to paste over the scan block of sluiceway.yaml. Every glob is written
// as a JSON string, which YAML reads as a double quoted string, so no glob can
// end the block or start a line of its own.
export function unrelatedBlock(existing: string[], suggested: string[]): string[] {
  const globs = [...new Set([...existing, ...suggested])];
  return ["scan:", "  unrelated:", ...globs.map((glob) => `    - ${JSON.stringify(glob)}`)];
}

function refText({ ref, refKind }: SluicewayJob): string {
  switch (refKind) {
    case "moving":
      return `at ${ref}, which follows every release of ${ref}`;
    case "release":
      return `at ${ref}, one release that stays as it is`;
    case "commit":
      return `at commit ${ref.slice(0, 12)}, pinned`;
    case "other":
      return `at ${ref}, which is not a release`;
  }
}

// One job that runs Sluiceway, for the job log.
export function workflowJobText(path: string, job: SluicewayJob): string {
  const mode = job.mode === undefined ? "no known mode" : `mode ${job.mode}`;
  return `${path}, job ${job.job}: ${mode}, ${refText(job)}.`;
}

const MODE_LIST = "scan, resolve, apply, settle, check";

export function workflowWarningText(warning: WorkflowWarning): string {
  const { path } = warning;
  switch (warning.kind) {
    case "unreadable":
      return `${path} is not valid YAML, so the check cannot read how it runs Sluiceway. The Actions tab of the repo shows GitHub's own error.`;
    case "unknown-mode":
      return warning.mode === ""
        ? `${path}, job ${warning.job}: the Sluiceway step has no mode. Use one of: ${MODE_LIST}.`
        : `${path}, job ${warning.job}: the Sluiceway step has mode ${JSON.stringify(warning.mode)}, which does not exist. Use one of: ${MODE_LIST}.`;
    case "unreleased-ref":
      return `${path}, job ${warning.job}: sluiceway/sluiceway@${warning.ref} is not a release. A branch runs code that is not released yet. Use a major tag such as @v0 to follow every release, an exact tag such as @v0.8.0, or a full commit SHA.`;
    case "mixed-refs":
      return `${path} runs Sluiceway at ${warning.refs.join(" and ")}. Use one ref in every job, so that a scan and the deploy it leads to run the same version.`;
    case "missing-trigger":
      return MISSING_TRIGGER[warning.trigger](path);
    case "forbidden-trigger":
      return `${path} runs on ${warning.trigger}. A scan would write the dashboard from code that is not on the default branch yet. Only the workflow of the check may run on pull requests or in a merge queue.`;
    case "missing-job":
      return `${path} has no ${warning.mode} job. The four jobs scan, resolve, apply and settle stay in one file: a scan looks for waiting ticks among the runs of its own workflow, and the rescan box and settle start that same workflow again.`;
    case "boxes-do-nothing":
      return `${path} scans, and no job in it resolves a tick, so a box on the dashboard does nothing. For a workflow that only scans, set dashboard.readOnly: true in sluiceway.yaml.`;
    case "no-permissions":
      return `${path}, job ${warning.job}: there is no permissions block, so the token gets the repo's default, which a file does not show. ${warning.mode} needs ${warning.needs.join(", ")}.`;
    case "missing-permissions":
      return `${path}, job ${warning.job}: ${warning.mode} needs ${warning.missing.join(", ")}. A job's own permissions replace the workflow's.`;
  }
}

const MISSING_TRIGGER: Record<
  Extract<WorkflowWarning, { kind: "missing-trigger" }>["trigger"],
  (path: string) => string
> = {
  push: (path) =>
    `${path} scans and has no push trigger. A push to the default branch starts the scan that shows its change as pending.`,
  schedule: (path) =>
    `${path} scans and has no schedule. The daily full scan catches a change that is not a file in the repo, such as another stack's output.`,
  workflow_dispatch: (path) =>
    `${path} has no workflow_dispatch trigger. The rescan box and settle start a scan through it.`,
  issues: (path) =>
    `${path} has a resolve job and does not listen to issue edits (issues, with the type edited). A tick would start nothing.`,
};

export function workflowNoteText(note: WorkflowNote): string {
  switch (note.kind) {
    case "no-preview-pages":
      return `${note.path}, job ${note.job}: without checks: write there are no preview pages, and a pending row's preview link opens the run's summary.`;
    case "called":
      return `${note.path} is called from another workflow. Its triggers and permissions come from the caller, which the check does not follow.`;
  }
}

// True when some workflow runs a scan.
export function scansSomewhere(workflows: WorkflowReport): boolean {
  return workflows.workflows.some(({ jobs }) => jobs.some((job) => job.mode === "scan"));
}

export interface CheckFacts {
  report: CheckReport;
  // What the workflow files say (record 0061).
  workflows: WorkflowReport;
  // The scan.unrelated globs the config has.
  unrelated: string[];
  hasConfigFile: boolean;
}

export function renderCheckSummary({
  report,
  workflows,
  unrelated,
  hasConfigFile,
}: CheckFacts): string {
  const parts = ["## Sluiceway check", VALID];
  if (!hasConfigFile) parts.push(NO_CONFIG_FILE);

  parts.push("### Stacks", foundText(report.stacks.length));
  if (report.stacks.length > 0) {
    // The column is there only when a stack depends on another, so a setup
    // without dependsOn keeps its table.
    const waits = report.stacks.some(
      (configured) => configured.dependsOn !== undefined || configured.dependsOnAuto,
    );
    parts.push(
      [
        `| Stack | Environment | Tickers | Inputs |${waits ? " Depends on |" : ""}`,
        `|---|---|---|---|${waits ? "---|" : ""}`,
        ...report.stacks.map((configured) => {
          const { environment, tickers, inputs } = configured;
          return row([
            stackId(configured.stack),
            environment,
            typeof tickers === "string" ? tickers : tickers.join(", "),
            inputs.length === 0 ? "none" : inputs.join(", "),
            ...(waits ? [dependsOnCell(configured)] : []),
          ]);
        }),
      ].join("\n"),
    );
  }

  if (report.ignore.length > 0) {
    parts.push(
      "### Ignore",
      [
        "| Glob | Leaves out |",
        "|---|---|",
        ...report.ignore.map((entry) =>
          row([
            entry.glob,
            entry.stacks.length > 0 ? entry.stacks.join(", ") : `No stack. ${unmatchedWhy(entry)}`,
          ]),
        ),
      ].join("\n"),
    );
  }

  parts.push("### Files that no stack claims");
  const count = report.unclaimed.reduce((sum, group) => sum + group.files.length, 0);
  if (count === 0) {
    parts.push("Every file is claimed by a stack or covered by scan.unrelated.");
  } else {
    parts.push(
      unclaimedText(count),
      report.unclaimed.map(groupLine).join("\n"),
      WHERE_FILES_BELONG,
    );
    if (report.suggested.length > 0) {
      parts.push(
        PASTE_NOTE,
        ["```yaml", ...unrelatedBlock(unrelated, report.suggested), "```"].join("\n"),
      );
    }
  }

  parts.push("### Workflows", ...workflowParts(workflows));

  parts.push("### What a check cannot tell", CANNOT_TELL);
  return `${parts.join("\n\n")}\n`;
}

// The summary of a setup that is not valid: the problems, each on its own
// line, in the loader's or discovery's own words.
export function renderCheckFailure(kind: "config" | "discovery", problems: string[]): string {
  const title =
    kind === "config"
      ? "sluiceway.yaml is not valid."
      : "Could not work out the stacks of this repo.";
  return `${[
    "## Sluiceway check",
    title,
    problems.map((problem) => `- ${escapeText(problem)}`).join("\n"),
    "Fix these and run the check again. A scan stops at the same place.",
  ].join("\n\n")}\n`;
}

function workflowParts(workflows: WorkflowReport): string[] {
  const parts: string[] = [];
  if (workflows.workflows.length > 0) {
    parts.push(
      [
        "| Workflow | Job | Mode | Action ref |",
        "|---|---|---|---|",
        ...workflows.workflows.flatMap(({ path, jobs }) =>
          jobs.map((job) => row([path, job.job, job.mode ?? "none", refText(job)])),
        ),
      ].join("\n"),
    );
  }
  if (!scansSomewhere(workflows)) parts.push(NO_SCAN_WORKFLOW);
  if (workflows.warnings.length > 0) {
    parts.push(
      workflows.warnings
        .map((warning) => `- ${escapeText(workflowWarningText(warning))}`)
        .join("\n"),
    );
  }
  if (workflows.notes.length > 0) {
    parts.push(workflows.notes.map((note) => `- ${escapeText(workflowNoteText(note))}`).join("\n"));
  }
  if (workflows.workflows.length > 0 && workflows.warnings.length === 0) {
    parts.push(NOTHING_MISSING);
  }
  parts.push(WORKFLOWS_AS_TEXT);
  return parts;
}

function groupLine({ directory, files }: UnclaimedGroup): string {
  const where = directory === "." ? "The repo root" : escapeText(`${directory}/`);
  const shown = files.slice(0, FILES_PER_DIRECTORY).map(escapeText).join(", ");
  const rest = files.length - FILES_PER_DIRECTORY;
  const more = rest > 0 ? `, and ${plural(rest, "more file")}. The job log lists them all.` : "";
  return `- ${where}, ${plural(files.length, "file")}: ${shown}${more}`;
}

function row(cells: string[]): string {
  return `| ${cells.map(escapeText).join(" | ")} |`;
}
