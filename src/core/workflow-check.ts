// The workflow part of the check (record 0061): what the repo's workflow
// files say about how Sluiceway runs, read as text. The triggers, the
// permissions each mode needs and the ref of the action. It holds the facts.
// The words are render/check.ts. GitHub validates a workflow and runs it, so
// nothing here turns the check red.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
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

const MODES = ["scan", "resolve", "apply", "settle", "check", "init"] as const;
type Mode = (typeof MODES)[number];

// How a step names the version of the action it runs.
//   moving   a major tag such as `v0`, which follows every release of it
//   release  an exact release tag such as `v0.8.0`
//   commit   a full commit SHA
//   other    anything else: a branch, a tag of two numbers, a short SHA
export type RefKind = "moving" | "release" | "commit" | "other";

export interface SluicewayJob {
  job: string;
  // Nothing when the step names no mode, or one that does not exist.
  mode: Mode | undefined;
  ref: string;
  refKind: RefKind;
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
  | { kind: "forbidden-trigger"; path: string; trigger: string }
  // All four jobs stay in one file (slice 2.7, records 0009 and 0035).
  | { kind: "missing-job"; path: string; mode: Exclude<Mode, "check" | "init"> }
  // A scan with no `resolve` in its file draws boxes that nothing acts on
  // (record 0045).
  | { kind: "boxes-do-nothing"; path: string }
  // No permissions block for the job or the workflow: the token gets the
  // repo's default, which a file cannot show.
  | { kind: "no-permissions"; path: string; job: string; mode: Mode; needs: string[] }
  | { kind: "missing-permissions"; path: string; job: string; mode: Mode; missing: string[] };

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
// `contents: write` when merge and deploy is on (record 0054).
function needs(mode: Mode, config: Config): Record<string, Level> {
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

interface Parsed {
  on: Record<string, unknown>;
  permissions: Permissions;
  jobs: Record<string, { permissions: Permissions; steps: unknown[] }>;
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
    };
  }
  return { on: triggersOf(document.on), permissions: permissionsOf(document.permissions), jobs };
}

function sluicewayJob(
  job: string,
  steps: unknown[],
): (SluicewayJob & { named: string }) | undefined {
  for (const step of steps) {
    if (!isRecord(step) || typeof step.uses !== "string") continue;
    const ref = SLUICEWAY_STEP.exec(step.uses.trim())?.[1];
    if (ref === undefined) continue;
    const named = isRecord(step.with) ? String(step.with.mode ?? "") : "";
    const mode = (MODES as readonly string[]).includes(named) ? (named as Mode) : undefined;
    return { job, mode, ref, refKind: refKind(ref), named };
  }
  return undefined;
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
  const found = Object.entries(workflow.jobs).flatMap(([name, job]) => {
    const step = sluicewayJob(name, job.steps);
    return step ? [{ step, permissions: job.permissions ?? workflow.permissions }] : [];
  });
  if (found.length === 0) return;
  const { warnings, notes } = report;
  report.workflows.push({
    path,
    jobs: found.map(({ step: { job, mode, ref, refKind } }) => ({ job, mode, ref, refKind })),
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
  const modes = new Set(found.map(({ step }) => step.mode));
  const runs = (mode: Mode) => modes.has(mode);
  const deploys = [...modes].some(
    (mode) => mode !== undefined && mode !== "check" && mode !== "init",
  );

  if (!called && deploys) {
    for (const trigger of ["pull_request", "pull_request_target", "merge_group"]) {
      if (trigger in workflow.on) warnings.push({ kind: "forbidden-trigger", path, trigger });
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

  if (called) return;
  for (const { step, permissions } of found) {
    if (step.mode === undefined) continue;
    const { job, mode } = step;
    if (permissions === undefined) {
      warnings.push({
        kind: "no-permissions",
        path,
        job,
        mode,
        needs: missing({}, needs(mode, config)),
      });
      continue;
    }
    const lacks = missing(permissions, needs(mode, config));
    if (lacks.length > 0)
      warnings.push({ kind: "missing-permissions", path, job, mode, missing: lacks });
    if (mode === "scan" && !has(permissions, "checks")) {
      notes.push({ kind: "no-preview-pages", path, job });
    }
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
