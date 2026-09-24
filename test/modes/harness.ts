// What the mode tests share: a fake GitHub, an adapter that answers from a
// table, a job log that remembers, and a clock that gives the same times on
// every run.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  Adapter,
  ApplyResult,
  DriftResult,
  PreviewOptions,
  PreviewResult,
  ToolDiffResult,
} from "../../src/adapters/adapter.ts";
import type { Change } from "../../src/core/diff.ts";
import { type Stack, stackId } from "../../src/core/stack.ts";
import type { JobLog } from "../../src/github/job-log.ts";
import type { ScanContext } from "../../src/modes/scan.ts";
import { FakeGitHub } from "../fake-github/fake-github.ts";

export const REPO_URL = "https://github.com/acme/infra";
export const RUN_ID = "4242";
export const RUN_URL = `${REPO_URL}/actions/runs/${RUN_ID}`;
// Where the links of a fresh row land (record 0044): the summary of the
// attempt, and the log of the job.
export const SUMMARY_URL = `${RUN_URL}/attempts/1`;
export const JOB_ID = "106502264185";
export const JOB_URL = `${RUN_URL}/job/${JOB_ID}`;
export const SHA = "0123456789abcdef0123456789abcdef01234567";
export const ACTION_REF = "v0.1.0";
// What a deploying or queued row starts with under a header (record 0063).
const SPINNERS = `https://raw.githubusercontent.com/sluiceway/sluiceway/${ACTION_REF}/assets/mascot`;
export const SPINNER = `<picture><source media="(prefers-color-scheme: dark)" srcset="${SPINNERS}/spinner-dark.svg"><img alt="" width="16" height="16" src="${SPINNERS}/spinner-light.svg"></picture> `;
// A queued row's crate stands still (record 0098).
export const QUEUED_SPINNER = `<picture><source media="(prefers-color-scheme: dark)" srcset="${SPINNERS}/spinner-queued-dark.svg"><img alt="" width="16" height="16" src="${SPINNERS}/spinner-queued-light.svg"></picture> `;

// A repo root on disk, because config is a file. Discovery is the adapter's,
// so no stack needs a file here.
export function repoRoot(config?: string): string {
  const root = mkdtempSync(join(tmpdir(), "sluiceway-scan-"));
  if (config !== undefined) writeFileSync(join(root, "sluiceway.yaml"), config);
  return root;
}

export function stack(id: string): Stack {
  const [path = "", name] = id.split(":");
  return { path, ...(name === undefined ? {} : { name }), options: {} };
}

export function change(name: string, op: Change["op"] = "update"): Change {
  return {
    address: `urn:${name}`,
    type: "aws:s3/bucket:Bucket",
    name,
    op,
    changedKeys: op === "update" || op === "replace" ? ["tags"] : [],
    replaceKeys: op === "replace" ? ["tags"] : [],
  };
}

export function pending(id: string, ...changes: Change[]): PreviewResult {
  return { ok: true, diff: { stackId: id, changes }, toolLog: "" };
}

export function inSync(id: string): PreviewResult {
  return pending(id);
}

export function failing(toolLog = "error: no credentials\n"): PreviewResult {
  return { ok: false, reason: { kind: "tool-error", exitCode: 255 }, detail: [], toolLog };
}

type Answer = PreviewResult | ((options: PreviewOptions) => Promise<PreviewResult>);

// A drift check's answer (record 0055). `undefined` is a stack whose tool
// cannot check drift.
type DriftAnswer = DriftResult | undefined | ((options: PreviewOptions) => Promise<DriftResult>);

export function drifted(_stackId: string, ...drift: Change[]): DriftResult {
  return { ok: true, drift, toolLog: "" };
}

type ToolDiffAnswer = ToolDiffResult | ((options: PreviewOptions) => Promise<ToolDiffResult>);

// What the tool's own diff of a stack says when a test does not care: a line
// with a value in it, so a test can look for where it went.
export function toolDiffText(id: string): string {
  return `  ~ ${id}: VALUE-OF-${id}\n`;
}

export interface TableAdapter extends Adapter {
  // The stack id of every preview, in the order they were started.
  previewed: string[];
  // The time limit each preview was started with, by stack id.
  timeouts: Record<string, number>;
  // Whether each preview was asked for the value fingerprint (record 0102),
  // by stack id.
  fingerprintAsked: Record<string, boolean | undefined>;
  versionChecks: number;
  // The stack id of every deploy, in order.
  applied: string[];
  // The stack id of every run of the tool's own diff, in the order they were
  // started, and the time limit of each (record 0048).
  toolDiffs: string[];
  toolDiffTimeouts: Record<string, number>;
  // The stack id of every drift check, in order, and of every deploy that was
  // asked to repair drift (record 0055).
  driftChecked: string[];
  repaired: string[];
}

// An adapter that discovers the stacks named in the table, in the order of
// the table, and previews each with the answer next to it. A deploy goes out
// unless `deploys` holds another answer for the stack, and the tool's own diff
// is `toolDiffText` unless `toolDiffs` holds another.
export function tableAdapter(
  table: Record<string, Answer>,
  deploys: Record<string, ApplyResult> = {},
  toolDiffs: Record<string, ToolDiffAnswer> = {},
  // A stack not in here has no drift.
  drifts: Record<string, DriftAnswer> = {},
): TableAdapter {
  const adapter: TableAdapter = {
    driftChecked: [],
    repaired: [],
    detectDrift: async (asked, options) => {
      const id = stackId(asked);
      adapter.driftChecked.push(id);
      if (!Object.hasOwn(drifts, id)) return { ok: true, drift: [], toolLog: "" };
      const answer = drifts[id];
      return typeof answer === "function" ? answer(options) : answer;
    },
    previewed: [],
    timeouts: {},
    fingerprintAsked: {},
    versionChecks: 0,
    applied: [],
    toolDiffs: [],
    toolDiffTimeouts: {},
    toolDiff: async (asked, options) => {
      const id = stackId(asked);
      adapter.toolDiffs.push(id);
      adapter.toolDiffTimeouts[id] = options.timeoutMinutes;
      const answer = toolDiffs[id] ?? { ok: true, text: toolDiffText(id), toolLog: "" };
      return typeof answer === "function" ? answer(options) : answer;
    },
    apply: async (applied, _context, _plan, options) => {
      const id = stackId(applied);
      adapter.applied.push(id);
      if (options?.repairDrift) adapter.repaired.push(id);
      return deploys[id] ?? { ok: true, toolLog: "" };
    },
    discover: async () => Object.keys(table).map(stack),
    checkVersion: async () => {
      adapter.versionChecks++;
    },
    preview: async (previewed, options) => {
      const id = stackId(previewed);
      adapter.previewed.push(id);
      adapter.timeouts[id] = options.timeoutMinutes;
      adapter.fingerprintAsked[id] = options.valueFingerprint;
      const answer = table[id];
      if (answer === undefined) throw new Error(`The table holds no answer for ${id}.`);
      return typeof answer === "function" ? answer(options) : answer;
    },
  };
  return adapter;
}

export interface RememberingLog extends JobLog {
  lines: string[];
  groups: { title: string; lines: string[]; verbatim?: string[] }[];
  warnings: { title: string; message: string }[];
  summaries: string[];
}

export function rememberingLog(): RememberingLog {
  const log: RememberingLog = {
    lines: [],
    groups: [],
    warnings: [],
    summaries: [],
    info: (line) => void log.lines.push(line),
    group: (title, lines, verbatim) =>
      void log.groups.push(verbatim === undefined ? { title, lines } : { title, lines, verbatim }),
    warning: (message, title) => void log.warnings.push({ title, message }),
    writeSummary: async (text) => void log.summaries.push(text),
  };
  return log;
}

// Starts at a fixed moment and moves half a second each time it is read.
export function steppingClock(): () => Date {
  let reads = 0;
  return () => new Date(Date.UTC(2026, 8, 21, 6, 0, 0) + 500 * reads++);
}

export interface Harness {
  context: ScanContext;
  github: FakeGitHub;
  log: RememberingLog;
}

export function harness(
  adapter: Adapter,
  overrides: Partial<ScanContext> & { config?: string } = {},
): Harness {
  const github = new FakeGitHub();
  const log = rememberingLog();
  const { config, ...rest } = overrides;
  const context: ScanContext = {
    root: repoRoot(config),
    env: { PATH: "/usr/bin" },
    adapter,
    run: async () => {
      throw new Error("No test of the scan mode starts a process.");
    },
    github,
    log,
    now: steppingClock(),
    pool: { size: 4, from: "input" },
    previewTimeoutMinutes: 10,
    repoUrl: REPO_URL,
    runId: RUN_ID,
    runAttempt: "1",
    jobId: JOB_ID,
    sha: SHA,
    // Anything but a push gives a full scan. A test of the narrowed scan says
    // "push".
    event: "workflow_dispatch",
    workflow: "sluiceway.yml",
    actionRef: ACTION_REF,
    ...rest,
  };
  return { context, github, log };
}

// The one dashboard of the fake repo.
export function dashboardBody(github: FakeGitHub, number = 1): string {
  return github.issue(number).body;
}
