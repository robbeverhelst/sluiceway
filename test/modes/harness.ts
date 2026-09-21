// What the mode tests share: a fake GitHub, an adapter that answers from a
// table, a job log that remembers, and a clock that gives the same times on
// every run.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  Adapter,
  ApplyResult,
  PreviewOptions,
  PreviewResult,
} from "../../src/adapters/adapter.ts";
import type { Change } from "../../src/core/diff.ts";
import { type Stack, stackId } from "../../src/core/stack.ts";
import type { JobLog } from "../../src/github/job-log.ts";
import type { ScanContext } from "../../src/modes/scan.ts";
import { FakeGitHub } from "../fake-github/fake-github.ts";

export const REPO_URL = "https://github.com/acme/infra";
export const RUN_ID = "4242";
export const RUN_URL = `${REPO_URL}/actions/runs/${RUN_ID}`;
export const SHA = "0123456789abcdef0123456789abcdef01234567";
export const ACTION_REF = "v0.1.0";

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

export interface TableAdapter extends Adapter {
  // The stack id of every preview, in the order they were started.
  previewed: string[];
  // The time limit each preview was started with, by stack id.
  timeouts: Record<string, number>;
  versionChecks: number;
  // The stack id of every deploy, in order.
  applied: string[];
}

// An adapter that discovers the stacks named in the table, in the order of
// the table, and previews each with the answer next to it. A deploy goes out
// unless `deploys` holds another answer for the stack.
export function tableAdapter(
  table: Record<string, Answer>,
  deploys: Record<string, ApplyResult> = {},
): TableAdapter {
  const adapter: TableAdapter = {
    previewed: [],
    timeouts: {},
    versionChecks: 0,
    applied: [],
    apply: async (applied) => {
      const id = stackId(applied);
      adapter.applied.push(id);
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
      const answer = table[id];
      if (answer === undefined) throw new Error(`The table holds no answer for ${id}.`);
      return typeof answer === "function" ? answer(options) : answer;
    },
  };
  return adapter;
}

export interface RememberingLog extends JobLog {
  lines: string[];
  groups: { title: string; lines: string[] }[];
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
    group: (title, lines) => void log.groups.push({ title, lines }),
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
    concurrency: 4,
    previewTimeoutMinutes: 10,
    repoUrl: REPO_URL,
    runId: RUN_ID,
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
