// The words of the check (record 0042): its summary, and the pieces of text
// the job log shares with it. Everything here is a name Sluiceway derived from
// the repo's files. Nothing comes from the tool, and no value (records 0021,
// 0022).

import type {
  BackendCheck,
  CheckReport,
  IgnoreReport,
  InputsEntry,
  StackRead,
  UnclaimedGroup,
} from "../core/check.ts";
import type { ConfiguredStack, IgnoreEntry } from "../core/config.ts";
import { previewFailureText } from "../core/failure-reason.ts";
import { globOf } from "../core/glob.ts";
import { type PhaseGroup, waitsByPhase } from "../core/phases.ts";
import { stackId } from "../core/stack.ts";
import type {
  SluicewayJob,
  WorkflowNote,
  WorkflowReport,
  WorkflowWarning,
} from "../core/workflow-check.ts";
import { escapeText } from "./escape.ts";
import { logGroupTitle } from "./log-text.ts";
import { plural } from "./row.ts";

export const VALID = "The setup is valid.";
export const NO_CONFIG_FILE = "No sluiceway.yaml, so every setting is its default.";
// The one sentence record 0042 asks for.
export const CANNOT_TELL =
  "A check reads files only, so it cannot say that a preview will work: a stack that does not exist in the backend, a missing credential or a registry the runner cannot reach shows only in a scan.";
// With backend: true the check answers the first part of CANNOT_TELL itself
// (record 0074).
export const CANNOT_TELL_WITH_BACKEND =
  "A check cannot say that a preview will work: a missing credential for a provider or a registry the runner cannot reach shows only in a scan.";
export const BACKEND_OFF =
  "With backend: true the check also asks the backend which stacks it holds, with the credentials of its job.";
export const BACKEND_TITLE = "Stacks in the backend";
export const BACKEND_PASTE_TITLE = "Ready to paste into sluiceway.yaml, over ignore";
export const NOT_IN_BACKEND_TITLE = "A stack is not in the backend";
export const COULD_NOT_ASK_TITLE = "Could not ask the backend";
export const ALL_IN_BACKEND = "Every stack the backend was asked about is in it.";
export const BACKEND_PASTE_NOTE =
  "The block below keeps what ignore has and adds the stacks the backend does not hold. Leave out any stack you are about to create.";
// The hint under the files that no stack claims, in the check and in a scan.
// It says which files are worth listing under scan.unrelated and names the
// lockfiles and package manifests among them, which must stay off it
// (issue 164). `shared` comes from sharedFiles in the core, and `show` makes
// a name safe for where it is printed: one line for the log, escaped for a
// summary.
export function whereFilesBelong(
  shared: string[],
  show: (name: string) => string = logGroupTitle,
): string {
  const start =
    "A file that some stacks read belongs under the inputs of those stacks in sluiceway.yaml. A file that no program reads, such as docs, can be listed under scan.unrelated.";
  if (shared.length === 0) {
    return `${start} Keep lockfiles and package manifests off that list: a change to one should preview every stack.`;
  }
  const names = shared.slice(0, SHARED_NAMED).map(show);
  const rest = shared.length - names.length;
  const listed =
    rest > 0
      ? `${names.join(", ")} and ${rest} more`
      : names.length === 1
        ? (names[0] ?? "")
        : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  const why =
    shared.length === 1
      ? "it is a lockfile or a package manifest, and a change to it should preview every stack"
      : "they are lockfiles and package manifests, and a change to one should preview every stack";
  return `${start} Keep ${listed} off that list: ${why}.`;
}

// The hint names this many shared files and counts the rest.
const SHARED_NAMED = 5;
export const PASTE_NOTE =
  "The block below keeps what scan.unrelated has and adds globs for the files that look like docs and tooling. Sluiceway does not decide this for you: leave out any glob that covers a file one of your programs reads.";

// What stacks read and do not claim (record 0074).
export const READS_TITLE = "Files stacks read and do not claim";
export const READS_PASTE_TITLE = "Ready to paste into sluiceway.yaml, under stacks";
export const READ_WARNING_TITLE = "A stack reads a file it does not claim";
export const READS_NOTE =
  "The stack's own files name these as read. The entries below add them to the stacks' inputs, and inputs of several entries add up, so they can go under stacks next to the entries you have. Sluiceway reads only what the files name plainly: a path a program builds at run time does not show here.";

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

// The settings of one stack, in the words of sluiceway.yaml. `phases` are
// the phases of the repo with their stacks (record 0067).
export function settingsText(
  configured: ConfiguredStack,
  phases: readonly PhaseGroup[] = [],
): string {
  const { environment, tickers, inputs } = configured;
  const rule = typeof tickers === "string" ? tickers : tickers.join(", ");
  const claims = inputs.length === 0 ? "no inputs" : `inputs ${inputs.join(", ")}`;
  const phase =
    configured.phase === undefined ? "" : `, phase ${phaseWords(configured, " (read from ", ")")}`;
  const waits = dependsOnWords(configured, phases);
  return `environment ${environment}, tickers ${rule}, ${claims}${phase}${waits === undefined ? "" : `, depends on ${waits}`}`;
}

function phaseWords({ phase, phaseFrom }: ConfiguredStack, before: string, after: string): string {
  return phaseFrom === undefined ? `${phase}` : `${phase}${before}${phaseFrom}${after}`;
}

// What a stack depends on through its phase, grouped by the phase, and the
// rest by stack id (record 0067).
function split(configured: ConfiguredStack, phases: readonly PhaseGroup[]) {
  return waitsByPhase({
    phases: phases.map(({ phase }) => phase),
    phaseOf: new Map(phases.flatMap(({ phase, stackIds }) => stackIds.map((id) => [id, phase]))),
    stackId: stackId(configured.stack),
    waitingOn: configured.dependsOn ?? [],
  });
}

// What a stack depends on (records 0056, 0059 and 0067): the stack ids the
// file names, auto, whose stacks only a preview can read, and every stack of
// every earlier phase, each named with the phase that gives it. Undefined for
// none.
function dependsOnWords(
  configured: ConfiguredStack,
  phases: readonly PhaseGroup[],
): string | undefined {
  const { named, phases: through } = split(configured, phases);
  const parts = [
    ...named,
    ...through.map(({ phase, stackIds }) => `${stackIds.join(", ")} through the ${phase} phase`),
    ...(configured.dependsOnAuto
      ? ["the stacks its stack references name, read at each preview (auto)"]
      : []),
  ];
  return parts.length === 0 ? undefined : parts.join(", ");
}

// The summary names a phase, not every stack in it.
function dependsOnCell(configured: ConfiguredStack, phases: readonly PhaseGroup[]): string {
  const { named, phases: through } = split(configured, phases);
  const parts = [
    ...named,
    ...through.map(({ phase }) => `the ${phase} phase`),
    ...(configured.dependsOnAuto ? ["auto: its stack references, read at each preview"] : []),
  ];
  return parts.length === 0 ? "none" : parts.join(", ");
}

// The phases in order for the job log: the stacks of each, and the phases
// whose every stack it waits on (record 0067).
export function phaseLines(phases: readonly PhaseGroup[]): string[] {
  return phases.map(({ phase, stackIds }, index) => {
    const earlier = phases.slice(0, index).map((one) => one.phase);
    const stacks = stackIds.length === 0 ? "no stack" : stackIds.join(", ");
    const waits = earlier.length === 0 ? "" : `. Waits on every stack of ${listed(earlier)}`;
    return `${index + 1}. ${phase}: ${stacks}${waits}`;
  });
}

// "a", "a and b", "a, b and c".
function listed(words: readonly string[]): string {
  return words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
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

// One file a stack reads and does not claim. A directory ends in a slash.
export function readText(read: StackRead): string {
  const shown = read.kind === "directory" ? `${read.path}/` : read.path;
  return `${read.stackId} reads ${shown}, named in ${read.namedIn}.`;
}

// Only for a read a push would miss.
export function readWarningText(read: StackRead): string {
  return `${readText(read)} A push that changes it does not preview ${read.stackId}. Add it to the inputs of the stack.`;
}

// Ready to paste under `stacks`. Every name is a JSON string, which YAML
// reads as a double quoted string, as in unrelatedBlock.
export function inputsBlock(entries: InputsEntry[]): string[] {
  return [
    "stacks:",
    ...entries.flatMap(({ path, name, globs }) => [
      `  - path: ${JSON.stringify(path)}`,
      ...(name === undefined ? [] : [`    name: ${JSON.stringify(name)}`]),
      "    inputs:",
      ...globs.map((glob) => `      - ${JSON.stringify(glob)}`),
    ]),
  ];
}

// Why the backend could not be asked, in Sluiceway's words (record 0022).
function askFailureText(reason: Extract<BackendCheck, { found: "unknown" }>["reason"]): string {
  return reason.kind === "timed-out"
    ? `the question timed out after ${reason.minutes} ${reason.minutes === 1 ? "minute" : "minutes"}`
    : previewFailureText(reason);
}

// One stack, for the job log.
export function backendText(check: BackendCheck): string {
  switch (check.found) {
    case true:
      return `${check.stackId} is in the backend.`;
    case false:
      return `${check.stackId} is not in the backend.`;
    case "unknown":
      return `${check.stackId}: could not ask the backend, ${askFailureText(check.reason)}.`;
    case "unchecked":
      return `${check.stackId}: not checked, its tool has no list of stacks to ask.`;
  }
}

export function notInBackendText(stackId: string): string {
  return `${stackId} has files in the repo and no stack in the backend, so a scan gives its row a preview failure. Create the stack, or leave it out with the ignore block of this check.`;
}

export function couldNotAskText(check: BackendCheck): string {
  return `${backendText(check)} The tool's own words are in the job log.`;
}

// Ready to paste over the ignore block of sluiceway.yaml: what it has, and the
// stacks the backend does not hold, each as a glob that matches only its id.
export function ignoreBlock(existing: IgnoreEntry[], stackIds: string[]): string[] {
  return [
    "ignore:",
    ...existing.flatMap((entry) =>
      typeof entry === "string"
        ? [`  - ${JSON.stringify(entry)}`]
        : [
            `  - glob: ${JSON.stringify(entry.glob)}`,
            `    reason: ${JSON.stringify(entry.reason)}`,
          ],
    ),
    ...stackIds.map((id) => `  - ${JSON.stringify(globOf(id))}`),
  ];
}

function backendCell(check: BackendCheck): string {
  switch (check.found) {
    case true:
      return "Yes";
    case false:
      return "No";
    case "unknown":
      return `Could not ask: ${askFailureText(check.reason)}`;
    case "unchecked":
      return "Not checked";
  }
}

function backendParts(checks: BackendCheck[], ignore: IgnoreEntry[]): string[] {
  const parts = [
    "### The backend",
    [
      "| Stack | In the backend |",
      "|---|---|",
      ...checks.map((check) => row([check.stackId, backendCell(check)])),
    ].join("\n"),
  ];
  const missing = checks.filter((check) => check.found === false).map((check) => check.stackId);
  if (missing.length === 0) {
    if (checks.some((check) => check.found === true)) parts.push(ALL_IN_BACKEND);
  } else {
    parts.push(BACKEND_PASTE_NOTE, ["```yaml", ...ignoreBlock(ignore, missing), "```"].join("\n"));
  }
  return parts;
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
  const mode =
    job.mode === undefined
      ? "no known mode"
      : job.mode === "auto"
        ? `mode auto, which runs ${job.runs.length === 0 ? "nothing on these triggers" : job.runs.join(", ")}`
        : `mode ${job.mode}`;
  return `${path}, job ${job.job}: ${mode}, ${refText(job)}.`;
}

// Auto runs several modes, and needs what all of them need (record 0077).
function needsWho(mode: string): string {
  return mode === "auto" ? "the modes it runs need" : `${mode} needs`;
}

const MODE_LIST = "auto, scan, resolve, apply, settle, check";

export function workflowWarningText(warning: WorkflowWarning): string {
  const { path } = warning;
  switch (warning.kind) {
    case "unreadable":
      return `${path} is not valid YAML, so the check cannot read how it runs Sluiceway. The Actions tab of the repo shows GitHub's own error.`;
    case "unknown-mode":
      return `${path}, job ${warning.job}: the Sluiceway step has mode ${JSON.stringify(warning.mode)}, which does not exist. Leave the mode out, or use one of: ${MODE_LIST}.`;
    case "unreleased-ref":
      return `${path}, job ${warning.job}: sluiceway/sluiceway@${warning.ref} is not a release. A branch runs code that is not released yet. Use a major tag such as @v0 to follow every release, an exact tag such as @v0.8.0, or a full commit SHA.`;
    case "mixed-refs":
      return `${path} runs Sluiceway at ${warning.refs.join(" and ")}. Use one ref in every job, so that a scan and the deploy it leads to run the same version.`;
    case "missing-trigger":
      return MISSING_TRIGGER[warning.trigger](path);
    case "forbidden-trigger":
      if (warning.auto) {
        return `${path} runs on ${warning.trigger}, and its Sluiceway job loads the credentials of your stacks before it. On ${warning.trigger} those steps would run code that is not on the default branch yet. Keep the check in a workflow of its own, which needs no credentials.`;
      }
      return `${path} runs on ${warning.trigger}. A scan would write the dashboard from code that is not on the default branch yet. Only the workflow of the check may run on pull requests or in a merge queue.`;
    case "missing-job":
      return `${path} has no ${warning.mode} job. The four jobs scan, resolve, apply and settle stay in one file: a scan looks for waiting ticks among the runs of its own workflow, and the rescan box and settle start that same workflow again.`;
    case "boxes-do-nothing":
      return `${path} scans, and no job in it resolves a tick, so a box on the dashboard does nothing. For a workflow that only scans, set dashboard.readOnly: true in sluiceway.yaml.`;
    case "no-permissions":
      return `${path}, job ${warning.job}: there is no permissions block, so the token gets the repo's default, which a file does not show. ${needsWho(warning.mode)} ${warning.needs.join(", ")}.`;
    case "missing-permissions":
      return `${path}, job ${warning.job}: ${needsWho(warning.mode)} ${warning.missing.join(", ")}. A job's own permissions replace the workflow's.`;
    case "no-concurrency":
      return `${path}, job ${warning.job}: there is no concurrency group. ${NO_CONCURRENCY[warning.mode]}`;
    case "auto-no-queue":
      return `${path}, job ${warning.job}: the concurrency group has no queue: max, so a run that waits is dropped when a newer one arrives, a push's scan or a deploy that a dispatch started with it.`;
    case "auto-cancels":
      return `${path}, job ${warning.job}: cancel-in-progress stops a deploy half way when a newer run arrives. Take it out of this job.`;
    case "apply-group-shared":
      return `${path}, job ${warning.job}: the concurrency group does not name the stack, so a deploy waits for the deploy of every other stack. Use group: sluiceway-apply-\${{ matrix.stack }}.`;
    case "apply-no-queue":
      return `${path}, job ${warning.job}: the concurrency group has no queue: max, so a deploy that waits is cancelled when a newer one for the same stack arrives.`;
    case "apply-cancels":
      return `${path}, job ${warning.job}: cancel-in-progress stops a deploy half way when a newer one for the same stack arrives. Take it out of this job.`;
    case "no-status-check":
      return warning.mode === "apply"
        ? `${path}, job ${warning.job}: the if: has no !cancelled(). Without a status check GitHub skips the deploys that resolve started whenever resolve itself ends red.`
        : `${path}, job ${warning.job}: the if: has no always(). settle exists for deploys that were cancelled or failed, and without always() GitHub skips it exactly then.`;
    case "settle-skips-apply":
      return `${path}, job ${warning.job}: settle does not wait for the job ${warning.apply}. Add ${warning.apply} to its needs, so it ends the records of those deploys too.`;
    case "no-merged-apply":
      return `${path}: mergeAndDeploy is on, and no apply job takes the matrix of the scan. The scan after a merge hands the deploy on through its own matrix output, so a merged update would never deploy. Add a copy of the apply job that takes needs.scan.outputs.matrix.`;
    case "scan-no-matrix-output":
      return `${path}, job ${warning.job}: it takes the matrix of the job ${warning.scan}, which has no matrix output. Add outputs: matrix: \${{ steps.<id>.outputs.matrix }} to ${warning.scan}, with that id on its Sluiceway step.`;
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

const NO_CONCURRENCY: Record<"scan" | "resolve" | "apply" | "auto", string> = {
  auto: "Two runs could scan or deploy at once. Use one group with queue: max, such as group: sluiceway-${{ github.event.issue.number }}, so the runs wait in line and an edit of another issue waits for none of them.",
  scan: "Scans would run side by side. Use concurrency: sluiceway-scan, so they run one at a time.",
  resolve:
    "Two runs could handle the same tick. Use concurrency: sluiceway-resolve, so ticks are handled one run at a time.",
  apply:
    "Two deploys of one stack could run at once. Use a group per stack, group: sluiceway-apply-${{ matrix.stack }}, with queue: max.",
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
  return workflows.workflows.some(({ jobs }) => jobs.some((job) => job.runs.includes("scan")));
}

export interface CheckFacts {
  report: CheckReport;
  // What the workflow files say (record 0061).
  workflows: WorkflowReport;
  // The scan.unrelated globs the config has.
  unrelated: string[];
  hasConfigFile: boolean;
  // Only with backend: true (record 0074), with the ignore entries the
  // config has.
  backend?: { checks: BackendCheck[]; ignore: IgnoreEntry[] } | undefined;
}

export function renderCheckSummary({
  report,
  workflows,
  unrelated,
  hasConfigFile,
  backend,
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
    // The same for the phase (record 0067).
    const phased = report.stacks.some((configured) => configured.phase !== undefined);
    parts.push(
      [
        `| Stack | Environment | Tickers | Inputs |${phased ? " Phase |" : ""}${waits ? " Depends on |" : ""}`,
        `|---|---|---|---|${phased ? "---|" : ""}${waits ? "---|" : ""}`,
        ...report.stacks.map((configured) => {
          const { environment, tickers, inputs } = configured;
          return row([
            stackId(configured.stack),
            environment,
            typeof tickers === "string" ? tickers : tickers.join(", "),
            inputs.length === 0 ? "none" : inputs.join(", "),
            ...(phased
              ? [configured.phase === undefined ? "none" : phaseWords(configured, ", from ", "")]
              : []),
            ...(waits ? [dependsOnCell(configured, report.phases)] : []),
          ]);
        }),
      ].join("\n"),
    );
  }

  if (report.phases.length > 0) {
    parts.push(
      "### Phases",
      [
        "| Phase | Stacks | Waits on |",
        "|---|---|---|",
        ...report.phases.map(({ phase, stackIds }, index) => {
          const earlier = report.phases.slice(0, index).map((one) => one.phase);
          return row([
            phase,
            stackIds.length === 0 ? "none" : stackIds.join(", "),
            earlier.length === 0 ? "nothing" : earlier.join(", "),
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
    const configFile =
      report.configFile === undefined
        ? ""
        : ` ${escapeText(report.configFile)} is not listed: no stack claims it, and a change to it previews every stack.`;
    parts.push(
      `Every file is claimed by a stack, covered by scan.unrelated, or one of the docs and tooling files that force nothing by default.${configFile}`,
    );
  } else {
    parts.push(
      unclaimedText(count),
      report.unclaimed.map(groupLine).join("\n"),
      whereFilesBelong(report.shared, escapeText),
    );
    if (report.suggested.length > 0) {
      parts.push(
        PASTE_NOTE,
        ["```yaml", ...unrelatedBlock(unrelated, report.suggested), "```"].join("\n"),
      );
    }
  }

  if (report.reads.length > 0) {
    parts.push(
      `### ${READS_TITLE}`,
      report.reads
        .map((read) => `- ${escapeText(read.missed ? readWarningText(read) : readText(read))}`)
        .join("\n"),
      READS_NOTE,
      ["```yaml", ...inputsBlock(report.inputs), "```"].join("\n"),
    );
  }

  parts.push("### Workflows", ...workflowParts(workflows));

  if (backend !== undefined) parts.push(...backendParts(backend.checks, backend.ignore));

  parts.push(
    "### What a check cannot tell",
    ...(backend === undefined ? [CANNOT_TELL, BACKEND_OFF] : [CANNOT_TELL_WITH_BACKEND]),
  );
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
