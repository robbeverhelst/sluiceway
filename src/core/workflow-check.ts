// The workflow part of the check (record 0061): what the repo's workflow
// files say about how Sluiceway runs, read as text. The triggers, the
// permissions each mode needs and the ref of the action. It holds the facts.
// The words are render/check.ts. GitHub validates a workflow and runs it, so
// nothing here turns the check red.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { autoModesOn, isMode, type Mode } from "./auto-mode.ts";
import type { Config } from "./config.ts";

// Where GitHub reads workflows from, relative to the repo root.
export const WORKFLOW_DIRECTORY = ".github/workflows";

export interface WorkflowFile {
  // Relative to the repo root, forward slashes.
  path: string;
  text: string;
}

// The workflow files of a checkout, by name. GitHub reads only the files
// directly in the directory. None when the directory is not there.
export function readWorkflowFiles(root: string): WorkflowFile[] {
  let names: string[];
  try {
    names = readdirSync(join(root, WORKFLOW_DIRECTORY), { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  return names.sort(byCodeUnit).map((name) => ({
    path: `${WORKFLOW_DIRECTORY}/${name}`,
    text: readFileSync(join(root, WORKFLOW_DIRECTORY, name), "utf8"),
  }));
}

// How a step names the version of the action it runs.
//   moving   a major tag such as `v0`, which follows every release of it
//   release  an exact release tag such as `v0.8.0`
//   commit   a full commit SHA
//   other    anything else: a branch, a tag of two numbers, a short SHA
export type RefKind = "moving" | "release" | "commit" | "other";

export interface SluicewayJob {
  job: string;
  // Nothing when the step names a mode that does not exist. A step with no
  // mode is auto (record 0077).
  mode: Mode | undefined;
  // The modes the job runs: its own, or for auto the ones the triggers of its
  // file start (record 0077). Empty for a mode that does not exist.
  runs: Mode[];
  ref: string;
  refKind: RefKind;
  // The GitHub Environment the job names, as written: a name or an
  // expression only a run evaluates. Not there when it names none. Its rules,
  // such as required reviewers, are a setting of the repo that no file shows
  // (record 0093).
  environment?: string;
}

// A workflow file that runs Sluiceway in at least one job.
export interface SluicewayWorkflow {
  path: string;
  jobs: SluicewayJob[];
}

// What a workflow is missing, or does that a record forbids. A warning each.
export type WorkflowWarning =
  // The file is not YAML GitHub could run.
  | { kind: "unreadable"; path: string }
  | { kind: "unknown-mode"; path: string; job: string; mode: string }
  | { kind: "unreleased-ref"; path: string; job: string; ref: string }
  // The jobs of one file run different versions of Sluiceway.
  | { kind: "mixed-refs"; path: string; refs: string[] }
  // The rescan box and `settle` start the workflow again, and `resolve` wakes
  // on an edit of the dashboard (records 0025, 0035). The schedule is the
  // daily full scan (record 0011).
  | {
      kind: "missing-trigger";
      path: string;
      trigger: "push" | "schedule" | "workflow_dispatch" | "issues";
    }
  // A scan would write the dashboard from code that is not on the default
  // branch yet.
  | { kind: "forbidden-trigger"; path: string; trigger: string; auto?: true }
  // All four jobs stay in one file (slice 2.7, records 0009 and 0035).
  | { kind: "missing-job"; path: string; mode: Exclude<Mode, "check" | "init"> }
  // A scan with no `resolve` in its file draws boxes that nothing acts on
  // (record 0045).
  | { kind: "boxes-do-nothing"; path: string }
  // No permissions block for the job or the workflow: the token gets the
  // repo's default, which a file cannot show.
  | { kind: "no-permissions"; path: string; job: string; mode: Mode; needs: string[] }
  | { kind: "missing-permissions"; path: string; job: string; mode: Mode; missing: string[] }
  // Record 0074 from here on. Scans run one at a time, ticks too, and deploys
  // one at a time per stack (records 0004, 0025, 0035).
  | {
      kind: "no-concurrency";
      path: string;
      job: string;
      mode: "scan" | "resolve" | "apply" | "auto";
    }
  // Record 0077: the one job of auto mode waits in line, and a waiting run is
  // never dropped, nor a running one stopped.
  | { kind: "auto-no-queue"; path: string; job: string }
  | { kind: "auto-cancels"; path: string; job: string }
  // One group for every stack makes a deploy wait for another stack's.
  | { kind: "apply-group-shared"; path: string; job: string }
  // Without queue: max a waiting deploy is cancelled by a newer one.
  | { kind: "apply-no-queue"; path: string; job: string }
  // cancel-in-progress stops a deploy half way.
  | { kind: "apply-cancels"; path: string; job: string }
  // apply needs !cancelled() or always() to run after a red resolve, and
  // settle needs always() to run after a cancelled deploy.
  | { kind: "no-status-check"; path: string; job: string; mode: "apply" | "settle" }
  // settle ends the records of deploys that ended without a result, so it
  // runs after every apply job.
  | { kind: "settle-skips-apply"; path: string; job: string; apply: string }
  // Merge and deploy (records 0054, 0064): the scan after a merge hands its
  // deploy to a second apply job through its own matrix output.
  | { kind: "no-merged-apply"; path: string }
  | { kind: "scan-no-matrix-output"; path: string; job: string; scan: string };

// Something worth knowing that is not a mistake.
export type WorkflowNote =
  // Without `checks: write` a pending row's preview link opens the summary
  // (record 0050).
  | { kind: "no-preview-pages"; path: string; job: string }
  // A reusable workflow gets its triggers and permissions from its caller,
  // which the check does not follow.
  | { kind: "called"; path: string };

export interface WorkflowReport {
  workflows: SluicewayWorkflow[];
  warnings: WorkflowWarning[];
  notes: WorkflowNote[];
}

type Level = "read" | "write";

// What the workflow token needs in each mode, from the calls the mode makes.
// The README's block gives all of it at once. `resolve` merges with
// `contents: write` when merge and deploy is on (record 0054). Written by
// hand: the calls live in the modes and the GitHub port, which core cannot
// read, and a test pins the table.
export function tokenNeeds(mode: Mode, config: Config): Record<string, Level> {
  switch (mode) {
    case "scan":
      return {
        contents: "read",
        issues: "write",
        deployments: "write",
        actions: "read",
        "pull-requests": "read",
      };
    case "resolve":
      return {
        contents: config.mergeAndDeploy.authors.length > 0 ? "write" : "read",
        issues: "write",
        deployments: "write",
        actions: "write",
        "pull-requests": "read",
      };
    case "apply":
      return {
        contents: "read",
        issues: "write",
        deployments: "write",
        "pull-requests": "read",
      };
    case "settle":
      return { contents: "read", issues: "read", deployments: "write", actions: "write" };
    // The union of the modes it runs, worked out by the caller.
    case "auto":
      return {};
    case "check":
    // init reads the files of the checkout and writes into it, nowhere else
    // (record 0065).
    case "init":
      return { contents: "read" };
  }
}

const SLUICEWAY_STEP = /^sluiceway\/sluiceway@(.+)$/i;

export function refKind(ref: string): RefKind {
  if (/^v\d+$/.test(ref)) return "moving";
  if (/^v\d+\.\d+\.\d+$/.test(ref)) return "release";
  if (/^[0-9a-f]{40}$/.test(ref)) return "commit";
  return "other";
}

type Permissions = Record<string, string> | "read-all" | "write-all" | undefined;

// What the check reads of one job.
interface ParsedJob {
  permissions: Permissions;
  steps: unknown[];
  // `concurrency` in its long form. Undefined when the job has none.
  concurrency: { group: string; queue: string; cancels: boolean } | undefined;
  // The `if:` as text, "" when there is none.
  condition: string;
  needs: string[];
  // The names of the job's outputs.
  outputs: string[];
  // The strategy block as text, where a matrix names the job it comes from.
  strategy: string;
  environment: string | undefined;
}

interface Parsed {
  on: Record<string, unknown>;
  permissions: Permissions;
  jobs: Record<string, ParsedJob>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function permissionsOf(value: unknown): Permissions {
  if (value === "read-all" || value === "write-all") return value;
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(Object.entries(value).map(([key, level]) => [key, String(level)]));
}

// `on` as a string, a list or a map, always as a map.
function triggersOf(value: unknown): Record<string, unknown> {
  if (typeof value === "string") return { [value]: null };
  if (Array.isArray(value)) return Object.fromEntries(value.map((event) => [String(event), null]));
  return isRecord(value) ? value : {};
}

// `environment` as a name or as a map with a name, always as the name. A map
// without one is a workflow GitHub would not run.
function environmentOf(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (!isRecord(value) || value.name === undefined || value.name === null) return undefined;
  return String(value.name);
}

// `concurrency` as a group name or as a map, always as the map.
function concurrencyOf(value: unknown): ParsedJob["concurrency"] {
  if (typeof value === "string" || typeof value === "number") {
    return { group: String(value), queue: "", cancels: false };
  }
  if (!isRecord(value) || value.group === undefined) return undefined;
  const cancels = value["cancel-in-progress"];
  return {
    group: String(value.group),
    queue: value.queue === undefined ? "" : String(value.queue),
    // An expression may cancel, and whether it does shows only in a run.
    cancels: cancels === true || cancels === "true",
  };
}

function parseWorkflow(text: string): Parsed | "unreadable" | undefined {
  let document: unknown;
  try {
    document = parse(text);
  } catch {
    return "unreadable";
  }
  if (!isRecord(document) || !isRecord(document.jobs)) return undefined;
  const jobs: Parsed["jobs"] = {};
  for (const [name, job] of Object.entries(document.jobs)) {
    if (!isRecord(job)) continue;
    jobs[name] = {
      permissions: permissionsOf(job.permissions),
      steps: Array.isArray(job.steps) ? job.steps : [],
      concurrency: concurrencyOf(job.concurrency),
      condition: job.if === undefined || job.if === null ? "" : String(job.if),
      needs:
        typeof job.needs === "string"
          ? [job.needs]
          : Array.isArray(job.needs)
            ? job.needs.map(String)
            : [],
      outputs: isRecord(job.outputs) ? Object.keys(job.outputs) : [],
      strategy: job.strategy === undefined ? "" : JSON.stringify(job.strategy),
      environment: environmentOf(job.environment),
    };
  }
  return { on: triggersOf(document.on), permissions: permissionsOf(document.permissions), jobs };
}

function sluicewayJob(
  job: string,
  steps: unknown[],
  auto: Mode[],
): (SluicewayJob & { named: string }) | undefined {
  for (const step of steps) {
    if (!isRecord(step) || typeof step.uses !== "string") continue;
    const ref = SLUICEWAY_STEP.exec(step.uses.trim())?.[1];
    if (ref === undefined) continue;
    const written = isRecord(step.with) ? String(step.with.mode ?? "").trim() : "";
    // No mode is auto, as action.yml's default says (record 0077).
    const named = written === "" ? "auto" : written;
    const mode = isMode(named) ? named : undefined;
    const runs = mode === undefined ? [] : mode === "auto" ? auto : [mode];
    return { job, mode, runs, ref, refKind: refKind(ref), named };
  }
  return undefined;
}

// What an auto job runs, from the triggers of its file, by the rule of
// core/auto-mode.ts. An `issues` trigger counts only when it takes an edit.
function autoRuns(on: Record<string, unknown>, config: Config): Mode[] {
  const events = Object.keys(on).filter(
    (event) => event !== "issues" || listensToEdits(on.issues, true),
  );
  return autoModesOn(
    { events, called: "workflow_call" in on },
    { readOnly: config.dashboard.readOnly },
  );
}

// What a job's token needs for every mode it runs, the stronger level of two.
function needsAll(modes: Mode[], config: Config): Record<string, Level> {
  const all: Record<string, Level> = {};
  for (const mode of modes) {
    for (const [scope, level] of Object.entries(tokenNeeds(mode, config))) {
      if (all[scope] !== "write") all[scope] = level;
    }
  }
  return all;
}

// The levels a job's token lacks. A job's own block replaces the workflow's.
function missing(granted: Permissions, wanted: Record<string, Level>): string[] {
  return Object.entries(wanted)
    .filter(([scope, level]) => {
      if (granted === "write-all") return false;
      if (granted === "read-all") return level === "write";
      const has = granted?.[scope];
      return !(has === "write" || (has === "read" && level === "read"));
    })
    .map(([scope, level]) => `${scope}: ${level}`);
}

function has(granted: Permissions, scope: string): boolean {
  return granted === "write-all" || (isRecord(granted) && granted[scope] === "write");
}

export function checkWorkflows(files: WorkflowFile[], config: Config): WorkflowReport {
  const report: WorkflowReport = { workflows: [], warnings: [], notes: [] };
  for (const { path, text } of files) {
    const parsed = parseWorkflow(text);
    if (parsed === "unreadable") {
      if (/sluiceway\/sluiceway@/i.test(text)) {
        report.warnings.push({ kind: "unreadable", path });
      }
      continue;
    }
    if (parsed === undefined) continue;
    checkOne(path, parsed, config, report);
  }
  return report;
}

function checkOne(path: string, workflow: Parsed, config: Config, report: WorkflowReport): void {
  const auto = autoRuns(workflow.on, config);
  const found = Object.entries(workflow.jobs).flatMap(([name, job]) => {
    const step = sluicewayJob(name, job.steps, auto);
    if (step === undefined) return [];
    if (job.environment !== undefined) step.environment = job.environment;
    return [{ step, permissions: job.permissions ?? workflow.permissions }];
  });
  if (found.length === 0) return;
  const { warnings, notes } = report;
  report.workflows.push({
    path,
    jobs: found.map(({ step: { job, mode, runs, ref, refKind, environment } }) => ({
      job,
      mode,
      runs,
      ref,
      refKind,
      ...(environment === undefined ? {} : { environment }),
    })),
  });

  for (const { step } of found) {
    if (step.mode === undefined) {
      warnings.push({ kind: "unknown-mode", path, job: step.job, mode: step.named });
    }
    if (step.refKind === "other") {
      warnings.push({ kind: "unreleased-ref", path, job: step.job, ref: step.ref });
    }
  }
  const refs = [...new Set(found.map(({ step }) => step.ref))];
  if (refs.length > 1) warnings.push({ kind: "mixed-refs", path, refs });

  const called = "workflow_call" in workflow.on;
  if (called) notes.push({ kind: "called", path });
  const modes = new Set(found.flatMap(({ step }) => step.runs));
  const runs = (mode: Mode) => modes.has(mode);
  const deploys = [...modes].some((mode) => mode !== "check" && mode !== "init");
  const autoDeploys = found.some(
    ({ step }) => step.mode === "auto" && step.runs.some((mode) => mode !== "check"),
  );

  if (!called && deploys) {
    for (const trigger of ["pull_request", "pull_request_target", "merge_group"]) {
      if (!(trigger in workflow.on)) continue;
      warnings.push(
        autoDeploys
          ? { kind: "forbidden-trigger", path, trigger, auto: true }
          : { kind: "forbidden-trigger", path, trigger },
      );
    }
  }
  if (!called && runs("scan")) {
    for (const trigger of ["push", "schedule", "workflow_dispatch"] as const) {
      if (!(trigger in workflow.on)) warnings.push({ kind: "missing-trigger", path, trigger });
    }
  }
  if (!called && runs("resolve") && !listensToEdits(workflow.on.issues, "issues" in workflow.on)) {
    warnings.push({ kind: "missing-trigger", path, trigger: "issues" });
  }
  if (runs("resolve") || runs("apply") || runs("settle")) {
    for (const mode of ["scan", "resolve", "apply", "settle"] as const) {
      if (!runs(mode)) warnings.push({ kind: "missing-job", path, mode });
    }
  } else if (runs("scan") && !config.dashboard.readOnly) {
    warnings.push({ kind: "boxes-do-nothing", path });
  }

  checkJobs(path, workflow, found, config, warnings);

  if (called) return;
  for (const { step, permissions } of found) {
    if (step.mode === undefined) continue;
    const { job, mode } = step;
    const wanted = needsAll(step.runs, config);
    if (permissions === undefined) {
      warnings.push({ kind: "no-permissions", path, job, mode, needs: missing({}, wanted) });
      continue;
    }
    const lacks = missing(permissions, wanted);
    if (lacks.length > 0)
      warnings.push({ kind: "missing-permissions", path, job, mode, missing: lacks });
    if (step.runs.includes("scan") && !has(permissions, "checks")) {
      notes.push({ kind: "no-preview-pages", path, job });
    }
  }
}

// The job settings a mode relies on (record 0074). Each is read from the
// file as it is written: a group or a condition is an expression GitHub
// evaluates, so only what the text plainly lacks is a warning.
function checkJobs(
  path: string,
  workflow: Parsed,
  found: { step: SluicewayJob }[],
  config: Config,
  warnings: WorkflowWarning[],
): void {
  const jobOf = (name: string): ParsedJob => workflow.jobs[name] as ParsedJob;
  const withMode = (mode: Mode) =>
    found.filter(({ step }) => step.mode === mode).map(({ step }) => step.job);
  for (const { step } of found) {
    const { job, mode } = step;
    const { concurrency, condition } = jobOf(job);
    // One job for the whole loop: one run at a time, none dropped, none
    // stopped half way (record 0077). A job that only checks needs none.
    if (mode === "auto" && step.runs.some((one) => one !== "check")) {
      if (concurrency === undefined) {
        warnings.push({ kind: "no-concurrency", path, job, mode });
      } else {
        if (concurrency.queue !== "max") warnings.push({ kind: "auto-no-queue", path, job });
        if (concurrency.cancels) warnings.push({ kind: "auto-cancels", path, job });
      }
    }
    if (mode === "scan" || mode === "resolve" || mode === "apply") {
      if (concurrency === undefined) {
        warnings.push({ kind: "no-concurrency", path, job, mode });
      } else if (mode === "apply") {
        if (!/\bmatrix\.stack\b/.test(concurrency.group)) {
          warnings.push({ kind: "apply-group-shared", path, job });
        }
        if (concurrency.queue !== "max") warnings.push({ kind: "apply-no-queue", path, job });
        if (concurrency.cancels) warnings.push({ kind: "apply-cancels", path, job });
      }
    }
    if (mode === "apply" && !/!\s*cancelled\(\s*\)|\balways\(\s*\)/.test(condition)) {
      warnings.push({ kind: "no-status-check", path, job, mode });
    }
    if (mode === "settle" && !/(^|[^!\w])always\(\s*\)/.test(condition)) {
      warnings.push({ kind: "no-status-check", path, job, mode });
    }
  }

  const applies = withMode("apply");
  for (const settle of withMode("settle")) {
    const { needs } = jobOf(settle);
    for (const apply of applies) {
      if (!needs.includes(apply)) {
        warnings.push({ kind: "settle-skips-apply", path, job: settle, apply });
      }
    }
  }

  // The job whose matrix an apply job takes, from `needs.<job>.outputs.matrix`
  // in its strategy.
  const scans = withMode("scan");
  const fromScan = applies.flatMap((apply) => {
    const source = /needs\.([\w-]+)\.outputs\.matrix/.exec(jobOf(apply).strategy)?.[1];
    return source !== undefined && scans.includes(source) ? [{ apply, scan: source }] : [];
  });
  for (const { apply, scan } of fromScan) {
    if (!jobOf(scan).outputs.includes("matrix")) {
      warnings.push({ kind: "scan-no-matrix-output", path, job: apply, scan });
    }
  }
  const mergesAndDeploys = config.mergeAndDeploy.authors.length > 0;
  if (mergesAndDeploys && scans.length > 0 && withMode("resolve").length > 0) {
    if (fromScan.length === 0) warnings.push({ kind: "no-merged-apply", path });
  }
}

// `issues` with no types listens to every kind of issue event, `edited` too.
function listensToEdits(issues: unknown, present: boolean): boolean {
  if (!present) return false;
  if (!isRecord(issues) || issues.types === undefined) return true;
  const types = issues.types;
  return Array.isArray(types) ? types.includes("edited") : types === "edited";
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
