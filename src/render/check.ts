// The words of the check (record 0042): the parts it reports, each as the job
// log and the summary show it. Everything here is a name Sluiceway derived
// from the repo's files, and no value (records 0021, 0022). The one thing from
// a tool is its own words with backend: true, which go to the job log as they
// are, as they did before they passed through here.

import { MODES } from "../core/auto-mode.ts";
import type {
  BackendCheck,
  CheckReport,
  IgnoreReport,
  InputsEntry,
  StackRead,
  UnclaimedGroup,
} from "../core/check.ts";
import type { ConfiguredStack, IgnoreEntry } from "../core/config.ts";
import {
  type CredentialNeed,
  type JobCredentials,
  type JudgedNeed,
  type StackNeeds,
  wayWords,
} from "../core/credentials.ts";
import type { DiscoveryNote } from "../core/discovery.ts";
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
import { minuteAt } from "./time.ts";

const VALID = "The setup is valid.";
const NO_CONFIG_FILE = "No sluiceway.yaml, so every setting is its default.";
// The one sentence record 0042 asks for.
const CANNOT_TELL =
  "A check reads files only, so it cannot say that a preview will work: a stack that does not exist in the backend, a missing credential or a registry the runner cannot reach shows only in a scan.";
// With backend: true the check answers the first part of CANNOT_TELL itself
// (record 0074).
const CANNOT_TELL_WITH_BACKEND =
  "A check cannot say that a preview will work: a missing credential for a provider or a registry the runner cannot reach shows only in a scan.";
const BACKEND_OFF =
  "With backend: true the check also asks the backend which stacks it holds, with the credentials of its job.";
const PREVIEWED_PULL_REQUEST =
  "With pull-request-preview: true the pull request preview above ran the tool for the stacks the pull request claims, and for no other stack.";
const BACKEND_TITLE = "Stacks in the backend";
const BACKEND_PASTE_TITLE = "Ready to paste into sluiceway.yaml, over ignore";
const NOT_IN_BACKEND_TITLE = "A stack is not in the backend";
const COULD_NOT_ASK_TITLE = "Could not ask the backend";
const ALL_IN_BACKEND = "Every stack the backend was asked about is in it.";
const BACKEND_PASTE_NOTE =
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
const READS_TITLE = "Files stacks read and do not claim";
const READS_PASTE_TITLE = "Ready to paste into sluiceway.yaml, under stacks";
const READ_WARNING_TITLE = "A stack reads a file it does not claim";
const READS_NOTE =
  "The stack's own files name these as read. The entries below add them to the stacks' inputs, and inputs of several entries add up, so they can go under stacks next to the entries you have. Sluiceway reads only what the files name plainly: a path a program builds at run time does not show here.";

// The credentials part (record 0099).
const NEEDS_TITLE = "Credentials each stack needs";
const CREDENTIALS_NOTE =
  "What each stack's own files say its tool will want from the job environment, as names, and which of them nothing in the workflow appears to provide. A program can read any variable, and a step that writes to the environment is opaque to the check, so this is a reading of the files and never a guarantee. No value is read or shown.";

// The workflow part (record 0061).
const WORKFLOW_WARNING_TITLE = "A workflow is missing something";
export const NOTHING_MISSING = "Nothing is missing from the workflows.";
const NO_SCAN_WORKFLOW = "No workflow in .github/workflows runs a scan yet.";
const WORKFLOWS_AS_TEXT =
  "The check reads the workflow files as text. The repo's default token permissions, the rules of an environment and what GitHub itself validates live elsewhere and do not show here.";

// A summary lists this many files of a directory. The job log lists them all.
const FILES_PER_DIRECTORY = 20;

export function foundText(count: number): string {
  return count === 0 ? "Found no stacks." : `Found ${plural(count, "stack")}.`;
}

// The settings of one stack, in the words of sluiceway.yaml. `phases` are
// the phases of the repo with their stacks (record 0067).
function settingsText(configured: ConfiguredStack, phases: readonly PhaseGroup[] = []): string {
  const { environment, tickers, inputs } = configured;
  const rule = typeof tickers === "string" ? tickers : tickers.join(", ");
  const claims = inputs.length === 0 ? "no inputs" : `inputs ${inputs.join(", ")}`;
  const phase =
    configured.phase === undefined ? "" : `, phase ${phaseWords(configured, " (read from ", ")")}`;
  const waits = dependsOnWords(configured, phases);
  const onMerge = configured.deploy === "on-merge" ? ", deploys on merge" : "";
  return `environment ${environment}, tickers ${rule}, ${claims}${phase}${waits === undefined ? "" : `, depends on ${waits}`}${onMerge}`;
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
function phaseLines(phases: readonly PhaseGroup[]): string[] {
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

function ignoreText({ glob, stacks }: IgnoreReport): string {
  return `ignore ${JSON.stringify(glob)} leaves out ${plural(stacks.length, "stack")}: ${stacks.join(", ")}.`;
}

// A glob that leaves out nothing. The hint is onboarding log hurdle 4.
function unmatchedText(entry: IgnoreReport): string {
  return `ignore ${JSON.stringify(entry.glob)} matches no stack. ${unmatchedWhy(entry)}`;
}

function unmatchedWhy({ hint }: IgnoreReport): string {
  const why = "It is matched against the stack id, not the directory.";
  return hint === undefined
    ? why
    : `${why} ${JSON.stringify(hint.glob)} would leave out ${hint.stacks.join(", ")}.`;
}

function unclaimedText(count: number): string {
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
function readText(read: StackRead): string {
  const shown = read.kind === "directory" ? `${read.path}/` : read.path;
  return `${read.stackId} reads ${shown}, named in ${read.namedIn}.`;
}

// Only for a read a push would miss.
function readWarningText(read: StackRead): string {
  return `${readText(read)} A push that changes it does not preview ${read.stackId}. Add it to the inputs of the stack.`;
}

// Ready to paste under `stacks`. Every name is a JSON string, which YAML
// reads as a double quoted string, as in unrelatedBlock.
function inputsBlock(entries: InputsEntry[]): string[] {
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
function backendText(check: BackendCheck): string {
  switch (check.found) {
    case true:
      return `${check.stackId} is in the backend.`;
    case false:
      return check.createInBackend
        ? `${check.stackId} is not in the backend, and the first scan creates it (createInBackend).`
        : `${check.stackId} is not in the backend.`;
    case "unknown":
      return `${check.stackId}: could not ask the backend, ${askFailureText(check.reason)}.`;
    case "unchecked":
      return `${check.stackId}: not checked, its tool has no list of stacks to ask.`;
  }
}

function notInBackendText(stackId: string): string {
  return `${stackId} has files in the repo and no stack in the backend, so a scan gives its row a preview failure. Create the stack, or leave it out with the ignore block of this check.`;
}

function couldNotAskText(check: BackendCheck): string {
  return `${backendText(check)} The tool's own words are in the job log.`;
}

// Ready to paste over the ignore block of sluiceway.yaml: what it has, and the
// stacks the backend does not hold, each as a glob that matches only its id.
function ignoreBlock(existing: IgnoreEntry[], stackIds: string[]): string[] {
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
      return check.createInBackend ? "No, the first scan creates it" : "No";
    case "unknown":
      return `Could not ask: ${askFailureText(check.reason)}`;
    case "unchecked":
      return "Not checked";
  }
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
function workflowJobText(path: string, job: SluicewayJob): string {
  const mode =
    job.mode === undefined
      ? "no known mode"
      : job.mode === "auto"
        ? `mode auto, which runs ${job.runs.length === 0 ? "nothing on these triggers" : job.runs.join(", ")}`
        : `mode ${job.mode}`;
  return `${path}, job ${job.job}: ${mode}, ${refText(job)}.`;
}

// Who decides who may deploy, for one job that deploys (record 0093). Only
// what the file shows: whether the job names an environment. Whether that
// environment has required reviewers is a setting of the repo, and the check
// makes no GitHub call, so the words say so rather than guess.
function whoMayDeployText(path: string, job: SluicewayJob): string {
  const { environment } = job;
  if (environment === undefined) {
    return `Who may deploy: ${path}, job ${job.job} names no GitHub Environment, so the tick rule alone decides who may deploy.`;
  }
  return `Who may deploy: ${path}, job ${job.job} deploys in the GitHub Environment ${environment}. The tick rule decides who may ask. If ${environment} has required reviewers, they decide who may deploy. Whether it has them is a setting of the repo, which the check cannot read.`;
}

// Auto runs several modes, and needs what all of them need (record 0077).
function needsWho(mode: string): string {
  return mode === "auto" ? "the modes it runs need" : `${mode} needs`;
}

// The modes a workflow step may name. init writes the workflow and runs once,
// outside one, so the words do not offer it.
const MODE_LIST = MODES.filter((mode) => mode !== "init").join(", ");

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
    case "preview-on-target":
      return `${path}, job ${warning.job}: pull-request-preview: true runs on pull_request_target, which Sluiceway never previews on: it runs with the secrets of the base branch against code that is not merged. Run it on pull_request, where a fork's pull request is refused.`;
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
    case "no-on-merge-apply":
      return `${path}: a stack is set to deploy: on-merge, and no apply job takes the matrix of the scan. The scan of a merge hands that deploy on through its own matrix output, so it would never start. Add a copy of the apply job that takes needs.scan.outputs.matrix.`;
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

function workflowNoteText(note: WorkflowNote): string {
  switch (note.kind) {
    case "no-preview-pages":
      return `${note.path}, job ${note.job}: without checks: write there are no preview pages, and a pending row's preview link opens the run's summary.`;
    case "called":
      return `${note.path} is called from another workflow. Its triggers and permissions come from the caller, which the check does not follow.`;
  }
}

// True when some workflow runs a scan.
function scansSomewhere(workflows: WorkflowReport): boolean {
  return workflows.workflows.some(({ jobs }) => jobs.some((job) => job.runs.includes("scan")));
}

// One entry of the job log. A line from the repo is made one line before it
// gets here.
export type CheckLogEntry =
  | { info: string }
  | { warning: string; title: string }
  | { group: string; lines: string[] };

// One part of the check: the facts of one topic, as the job log and the
// summary each show them. The log has every fact, a summary cuts long lists
// and adds the headings and the notes a reader of the page needs. Both views
// of a fact are written next to each other here, so a new fact is one edit
// (record 0042: the job log holds everything the summary holds).
export interface CheckPart {
  log: CheckLogEntry[];
  // Paragraphs of markdown, joined by a blank line.
  summary: string[];
}

// What the files say, before the backend is asked.
export interface CheckFacts {
  report: CheckReport;
  // What discovery made of the directories it looks at without an entry
  // (record 0092).
  discovery?: DiscoveryNote[];
  // What the workflow files say (record 0061).
  workflows: WorkflowReport;
  // What each stack needs, and what each job hands it (record 0099).
  credentials: { stacks: StackNeeds[]; jobs: JobCredentials[] };
  // The scan.unrelated globs the config has.
  unrelated: string[];
  hasConfigFile: boolean;
  // The recordWriters the config names (record 0109).
  recordWriters?: readonly string[] | undefined;
  // The deploy freezes that already ended when the check ran (record 0115),
  // by their place in the list, and the dashboard zone to say the end in.
  endedFreezes?: readonly EndedFreeze[] | undefined;
  timeZone?: string | undefined;
}

export interface EndedFreeze {
  index: number;
  reason?: string | undefined;
  ended: Date;
}

// The parts of a valid setup that come from the files, in the order the job
// log and the summary show them. The backend and the closing follow.
export function checkParts(facts: CheckFacts): CheckPart[] {
  const { report } = facts;
  return [
    headerPart(facts.hasConfigFile, facts.recordWriters ?? []),
    freezesPart(facts.endedFreezes ?? [], facts.timeZone),
    stacksPart(report),
    discoveryPart(facts.discovery ?? []),
    phasesPart(report.phases),
    ignorePart(report.ignore),
    unclaimedPart(report, facts.unrelated),
    readsPart(report),
    workflowsPart(facts.workflows),
    credentialsPart(facts.credentials),
  ];
}

// The verdict opens the summary. The job log says it last, in closingPart.
function headerPart(hasConfigFile: boolean, recordWriters: readonly string[]): CheckPart {
  const noFile = hasConfigFile ? [] : [NO_CONFIG_FILE];
  const writers = recordWriters.length === 0 ? [] : [recordWritersText(recordWriters)];
  return {
    log: [...noFile, ...writers].map((text) => ({ info: text })),
    summary: ["## Sluiceway check", VALID, ...noFile, ...writers],
  };
}

// Who may open a deployment record that a dispatched or scheduled run
// deploys (record 0109). Nothing is said when the list is empty, which is
// the default and hands none on.
function recordWritersText(recordWriters: readonly string[]): string {
  return `Record writers: ${recordWriters.join(", ")}. A deployment record one of them opens that names a dispatched or scheduled run is deployed by that run, through the fresh preview and the hash check (recordWriters).`;
}

// A freeze that already ended holds nothing (record 0115). It is a warning
// and no error: the file stays valid, and the freeze can go.
function freezesPart(ended: readonly EndedFreeze[], timeZone: string | undefined): CheckPart {
  const text = ({ index, reason, ended: at }: EndedFreeze, markdown: boolean) => {
    const key = markdown ? `\`freezes[${index}]\`` : `freezes[${index}]`;
    const why = reason === undefined ? "" : ` (${markdown ? escapeText(reason) : reason})`;
    return `${key}${why} ended ${minuteAt(at, timeZone)} and holds nothing any more. Take it out of sluiceway.yaml.`;
  };
  return {
    log: ended.map((one) => ({
      warning: text(one, false),
      title: "A deploy freeze already ended",
    })),
    summary:
      ended.length === 0 ? [] : ["### Deploy freezes", ...ended.map((one) => text(one, true))],
  };
}

function stacksPart({ stacks, phases }: CheckReport): CheckPart {
  const found = foundText(stacks.length);
  if (stacks.length === 0) return { log: [{ info: found }], summary: ["### Stacks", found] };
  // The column is there only when a stack depends on another, so a setup
  // without dependsOn keeps its table.
  const waits = stacks.some(
    (configured) => configured.dependsOn !== undefined || configured.dependsOnAuto,
  );
  // The same for the phase (record 0067).
  const phased = stacks.some((configured) => configured.phase !== undefined);
  // And for a stack that deploys on merge (record 0095).
  const onMerge = stacks.some((configured) => configured.deploy === "on-merge");
  return {
    log: [
      { info: found },
      {
        group: "Stacks",
        lines: stacks.map((configured) =>
          line(`${stackId(configured.stack)}: ${settingsText(configured, phases)}`),
        ),
      },
    ],
    summary: [
      "### Stacks",
      found,
      [
        `| Stack | Environment | Tickers | Inputs |${phased ? " Phase |" : ""}${waits ? " Depends on |" : ""}${onMerge ? " Deploys |" : ""}`,
        `|---|---|---|---|${phased ? "---|" : ""}${waits ? "---|" : ""}${onMerge ? "---|" : ""}`,
        ...stacks.map((configured) => {
          const { environment, tickers, inputs } = configured;
          return row([
            stackId(configured.stack),
            environment,
            typeof tickers === "string" ? tickers : tickers.join(", "),
            inputs.length === 0 ? "none" : inputs.join(", "),
            ...(phased
              ? [configured.phase === undefined ? "none" : phaseWords(configured, ", from ", "")]
              : []),
            ...(waits ? [dependsOnCell(configured, phases)] : []),
            ...(onMerge ? [configured.deploy === "on-merge" ? "on merge" : "on a tick"] : []),
          ]);
        }),
      ].join("\n"),
    ],
  };
}

const DISCOVERY_TITLE = "Root modules found from their files";
const DISCOVERY_HINT =
  "A stacks entry with tool declares a directory it left out, and ignore or discovery.rootModules: false leaves out one it found.";

// Every directory of OpenTofu or Terraform files, with what root module
// discovery made of it and why (record 0092). A repo without such files has
// no part.
function discoveryPart(notes: DiscoveryNote[]): CheckPart {
  if (notes.length === 0) return { log: [], summary: [] };
  const found = notes.filter((note) => note.outcome === "found").length;
  const left = notes.filter((note) => note.outcome === "left-out").length;
  const count = `Discovery found ${found === 0 ? "no root module" : plural(found, "root module")}${left === 0 ? "" : ` and left out ${left} ${left === 1 ? "directory" : "directories"}`}.`;
  return {
    log: [
      { info: count },
      {
        group: DISCOVERY_TITLE,
        lines: notes.map(({ path, outcome, because }) =>
          line(
            outcome === "declared"
              ? `${path}: ${because}`
              : `${path}: ${outcome === "found" ? "found" : "left out"}, ${because}`,
          ),
        ),
      },
    ],
    summary: [
      `### ${DISCOVERY_TITLE}`,
      `${count} ${DISCOVERY_HINT}`,
      [
        "| Directory | Stack | Why |",
        "|---|---|---|",
        ...notes.map(({ path, outcome, stackId, because }) =>
          row([
            path,
            outcome === "found" ? (stackId ?? path) : outcome === "declared" ? "declared" : "none",
            because,
          ]),
        ),
      ].join("\n"),
    ],
  };
}

function phasesPart(phases: PhaseGroup[]): CheckPart {
  if (phases.length === 0) return { log: [], summary: [] };
  return {
    log: [{ group: "Phases", lines: phaseLines(phases).map(line) }],
    summary: [
      "### Phases",
      [
        "| Phase | Stacks | Waits on |",
        "|---|---|---|",
        ...phases.map(({ phase, stackIds }, index) => {
          const earlier = phases.slice(0, index).map((one) => one.phase);
          return row([
            phase,
            stackIds.length === 0 ? "none" : stackIds.join(", "),
            earlier.length === 0 ? "nothing" : earlier.join(", "),
          ]);
        }),
      ].join("\n"),
    ],
  };
}

function ignorePart(ignore: IgnoreReport[]): CheckPart {
  if (ignore.length === 0) return { log: [], summary: [] };
  return {
    log: ignore.map((entry) =>
      entry.stacks.length > 0
        ? { info: line(ignoreText(entry)) }
        : { warning: line(unmatchedText(entry)), title: "An ignore glob matches no stack" },
    ),
    summary: [
      "### Ignore",
      [
        "| Glob | Leaves out |",
        "|---|---|",
        ...ignore.map((entry) =>
          row([
            entry.glob,
            entry.stacks.length > 0 ? entry.stacks.join(", ") : `No stack. ${unmatchedWhy(entry)}`,
          ]),
        ),
      ].join("\n"),
    ],
  };
}

function unclaimedPart(report: CheckReport, unrelated: string[]): CheckPart {
  const heading = "### Files that no stack claims";
  const files = report.unclaimed.flatMap((group) => group.files);
  if (files.length === 0) {
    const configFile =
      report.configFile === undefined
        ? ""
        : ` ${escapeText(report.configFile)} is not listed: no stack claims it, and a change to it previews every stack.`;
    return {
      log: [],
      summary: [
        heading,
        `Every file is claimed by a stack, covered by scan.unrelated, or one of the docs and tooling files that force nothing by default.${configFile}`,
      ],
    };
  }
  const count = unclaimedText(files.length);
  const block = report.suggested.length === 0 ? [] : unrelatedBlock(unrelated, report.suggested);
  return {
    log: [
      { info: count },
      { group: "Files that no stack claims", lines: files.map(line) },
      { info: whereFilesBelong(report.shared) },
      ...(block.length === 0
        ? []
        : [{ group: "Ready to paste into sluiceway.yaml", lines: block.map(line) }]),
    ],
    summary: [
      heading,
      count,
      report.unclaimed.map(groupLine).join("\n"),
      whereFilesBelong(report.shared, escapeText),
      ...(block.length === 0 ? [] : [PASTE_NOTE, yaml(block)]),
    ],
  };
}

function readsPart({ reads, inputs }: CheckReport): CheckPart {
  if (reads.length === 0) return { log: [], summary: [] };
  const block = inputsBlock(inputs);
  return {
    log: [
      { group: READS_TITLE, lines: reads.map((read) => line(readText(read))) },
      ...reads
        .filter((read) => read.missed)
        .map((read) => ({ warning: line(readWarningText(read)), title: READ_WARNING_TITLE })),
      { info: READS_NOTE },
      { group: READS_PASTE_TITLE, lines: block.map(line) },
    ],
    summary: [
      `### ${READS_TITLE}`,
      reads
        .map((read) => `- ${escapeText(read.missed ? readWarningText(read) : readText(read))}`)
        .join("\n"),
      READS_NOTE,
      yaml(block),
    ],
  };
}

// The ways of a need: "A, B, or C", and "A or B" for two.
function waysText(need: CredentialNeed): string {
  const words = need.ways.map(wayWords);
  if (words.length <= 1) return words[0] ?? "";
  if (words.length === 2) return `${words[0]} or ${words[1]}`;
  return `${words.slice(0, -1).join(", ")}, or ${words.at(-1)}`;
}

// One need of one stack, for the job log.
function needText(stackId: string, need: CredentialNeed): string {
  const ways =
    need.ways.length === 0
      ? `${need.what}, which the check has no table for`
      : `${need.what}: ${waysText(need)}`;
  return `${stackId} needs ${ways}. Named in ${need.namedIn}.`;
}

// The ways of a need in the line that says nothing provides it: the last
// one joined with "or" and no comma, so the line reads as one breath.
function unmetWays(need: CredentialNeed): string {
  const words = need.ways.map(wayWords);
  return words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} or ${words.at(-1)}`;
}

// The needs nothing in a job names, one line each, stacks with the same
// need together (record 0099). Never a warning: a guess is not a failure.
function unmetLines({ path, job, judged }: JobCredentials): string[] {
  const unmet = judged.filter(
    (one): one is JudgedNeed & { stackId: string; met: false } => one.met === false,
  );
  const grouped = Map.groupBy(unmet, (one) => `${one.need.what}\n${unmetWays(one.need)}`);
  return [...grouped.values()].map((ones) => {
    const first = ones[0] as (typeof ones)[number];
    const stacks = [...new Set(ones.map((one) => one.stackId))];
    const who = `${listed(stacks)} ${stacks.length === 1 ? "needs" : "need"}`;
    const maybe = [...new Set(ones.flatMap((one) => one.maybe))];
    const opaque =
      maybe.length === 0
        ? ""
        : maybe.length === 1
          ? ` The step ${maybe[0]} may load it, and the check cannot see into it.`
          : ` The steps ${listed(maybe)} may load it, and the check cannot see into them.`;
    // The env files of the stacks the check cannot read (record 0103).
    const unread = [...new Set(ones.flatMap((one) => one.unread))];
    const files =
      unread.length === 0
        ? ""
        : unread.length === 1
          ? ` The envFile ${unread[0]} of the stack may list it, and the check cannot read it.`
          : ` The envFiles ${listed(unread)} of the stacks may list it, and the check cannot read them.`;
    return `Nothing in ${path}, job ${job} provides ${unmetWays(first.need)}, which ${who} for ${first.need.what}.${opaque}${files}`;
  });
}

function providesLine({ path, job }: JobCredentials): string {
  return `${path}, job ${job} names a way to every credential the stacks' files ask for.`;
}

// What each stack's files say its tool will want, and what each job that
// runs the tool hands it (record 0099). Names only, and never a warning.
function credentialsPart({ stacks, jobs }: CheckFacts["credentials"]): CheckPart {
  if (stacks.length === 0) return { log: [], summary: [] };
  const lines = stacks.map(({ stackId, needs }) =>
    needs.length === 0
      ? `${stackId} needs nothing that its files name.`
      : needs.map((need) => needText(stackId, need)),
  );
  const rows = stacks.flatMap(({ stackId, needs }) =>
    needs.length === 0
      ? [row([stackId, "nothing that its files name", "", ""])]
      : needs.map((need) =>
          row([
            stackId,
            need.what,
            need.ways.length === 0 ? "the check has no table for it" : waysText(need),
            need.namedIn,
          ]),
        ),
  );
  const perJob = jobs.map((one) => {
    const unmet = unmetLines(one);
    return { one, lines: unmet.length === 0 ? [providesLine(one)] : unmet };
  });
  return {
    log: [
      { group: NEEDS_TITLE, lines: lines.flat().map(line) },
      ...perJob.flatMap(({ one, lines: texts }): CheckLogEntry[] => [
        {
          group: `What ${one.path}, job ${one.job} provides`,
          lines: one.judged
            .filter(
              (judged): judged is JudgedNeed & { stackId: string; met: true } =>
                judged.met === true,
            )
            .map((judged) => line(`${judged.stackId}, ${judged.need.what}: ${judged.by}.`)),
        },
        ...texts.map((text) => ({ info: line(text) })),
      ]),
    ],
    summary: [
      "### Credentials",
      CREDENTIALS_NOTE,
      ["| Stack | Needs | Any one of | Named in |", "|---|---|---|---|", ...rows].join("\n"),
      ...(perJob.length === 0
        ? []
        : [
            perJob
              .flatMap(({ lines: texts }) => texts.map((text) => `- ${escapeText(text)}`))
              .join("\n"),
          ]),
    ],
  };
}

// What the workflow files lack is a warning, never a red job: GitHub is the
// one that validates and runs them (record 0061).
function workflowsPart(workflows: WorkflowReport): CheckPart {
  const listed = workflows.workflows.length > 0;
  const noScan = scansSomewhere(workflows) ? [] : [NO_SCAN_WORKFLOW];
  const warnings = workflows.warnings.map(workflowWarningText);
  const notes = workflows.notes.map(workflowNoteText);
  const nothingMissing = listed && warnings.length === 0 ? [NOTHING_MISSING] : [];
  const deployers = workflows.workflows.flatMap(({ path, jobs }) =>
    jobs.filter((job) => job.runs.includes("apply")).map((job) => whoMayDeployText(path, job)),
  );
  const bullets = (texts: string[]) =>
    texts.length === 0 ? [] : [texts.map((text) => `- ${escapeText(text)}`).join("\n")];
  return {
    log: [
      ...(listed
        ? [
            {
              group: "Workflows",
              lines: workflows.workflows.flatMap(({ path, jobs }) =>
                jobs.map((job) => line(workflowJobText(path, job))),
              ),
            },
          ]
        : []),
      ...deployers.map((text) => ({ info: line(text) })),
      ...noScan.map((text) => ({ info: text })),
      ...warnings.map((text) => ({ warning: line(text), title: WORKFLOW_WARNING_TITLE })),
      ...notes.map((text) => ({ info: line(text) })),
      ...nothingMissing.map((text) => ({ info: text })),
    ],
    summary: [
      "### Workflows",
      ...(listed
        ? [
            [
              "| Workflow | Job | Mode | Action ref |",
              "|---|---|---|---|",
              ...workflows.workflows.flatMap(({ path, jobs }) =>
                jobs.map((job) => row([path, job.job, job.mode ?? "none", refText(job)])),
              ),
            ].join("\n"),
          ]
        : []),
      ...bullets(deployers),
      ...noScan,
      ...bullets(warnings),
      ...bullets(notes),
      ...nothingMissing,
      WORKFLOWS_AS_TEXT,
    ],
  };
}

// What the backend said about every stack that has a row (record 0074), with
// the tool's own words for the job log alone. What it finds is a warning: the
// job's red stays the verdict of record 0042.
export function backendPart(
  checks: BackendCheck[],
  ignore: IgnoreEntry[],
  toolLog: string,
): CheckPart {
  const notThere = checks.filter((check) => check.found === false);
  // A stack the first scan creates (record 0107) is no red row to come, so
  // it is no warning and gets no ignore entry.
  const missing = notThere.filter((check) => !check.createInBackend).map((check) => check.stackId);
  const block = missing.length === 0 ? [] : ignoreBlock(ignore, missing);
  const allIn = notThere.length === 0 && checks.some((check) => check.found === true);
  return {
    log: [
      ...(toolLog === ""
        ? []
        : [{ group: "The tool's own words", lines: toolLog.replace(/\n$/, "").split("\n") }]),
      { group: BACKEND_TITLE, lines: checks.map((check) => line(backendText(check))) },
      ...checks.flatMap((check): CheckLogEntry[] => {
        if (check.found === "unknown") {
          return [{ warning: line(couldNotAskText(check)), title: COULD_NOT_ASK_TITLE }];
        }
        if (check.found === false && !check.createInBackend) {
          return [{ warning: line(notInBackendText(check.stackId)), title: NOT_IN_BACKEND_TITLE }];
        }
        return [];
      }),
      ...(block.length === 0
        ? []
        : [{ info: BACKEND_PASTE_NOTE }, { group: BACKEND_PASTE_TITLE, lines: block.map(line) }]),
      ...(allIn ? [{ info: ALL_IN_BACKEND }] : []),
    ],
    summary: [
      "### The backend",
      [
        "| Stack | In the backend |",
        "|---|---|",
        ...checks.map((check) => row([check.stackId, backendCell(check)])),
      ].join("\n"),
      ...(block.length === 0 ? [] : [BACKEND_PASTE_NOTE, yaml(block)]),
      ...(allIn ? [ALL_IN_BACKEND] : []),
    ],
  };
}

// What a check cannot tell, with the one sentence record 0042 asks for. The
// job log says the verdict here, after everything else.
export function closingPart(askedBackend: boolean, previewedPullRequest = false): CheckPart {
  const cannot = askedBackend ? [CANNOT_TELL_WITH_BACKEND] : [CANNOT_TELL, BACKEND_OFF];
  // With pull-request-preview: true the tool ran for the claimed stacks, and
  // for no other (record 0101).
  if (previewedPullRequest) cannot.push(PREVIEWED_PULL_REQUEST);
  return {
    log: [VALID, ...cannot].map((text) => ({ info: text })),
    summary: ["### What a check cannot tell", ...cannot],
  };
}

// The summary of a valid setup: every part, in order.
export function renderCheckSummary(parts: CheckPart[]): string {
  return `${parts.flatMap((part) => part.summary).join("\n\n")}\n`;
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

function yaml(lines: string[]): string {
  return ["```yaml", ...lines, "```"].join("\n");
}

// A name from the repo never starts a line of its own in the job log.
const line = logGroupTitle;
