// What the tests of the resolve mode share. The dashboard is written by a real
// scan against the same fake GitHub, so every row is one the real renderer
// made, and a person's tick is an edit of that body.
import type { PreviewResult } from "../../src/adapters/adapter.ts";
import type { IssueAuthor } from "../../src/github/port.ts";
import { type ResolveContext, resolve } from "../../src/modes/resolve.ts";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import type { FakeGitHub } from "../fake-github/fake-github.ts";
import {
  ACTION_REF,
  harness,
  REPO_URL,
  type RememberingLog,
  SHA,
  type TableAdapter,
  tableAdapter,
} from "./harness.ts";

// The run of the scan that wrote the dashboard, and the run of `resolve`.
export const SCAN_RUN = "4242";
export const RESOLVE_RUN = "5151";
export const RESOLVE_RUN_URL = `${REPO_URL}/actions/runs/${RESOLVE_RUN}`;
export const WORKFLOW = { file: "sluiceway.yml", ref: "refs/heads/main" };

export const ALICE: IssueAuthor = { login: "alice", type: "User" };
export const BOB: IssueAuthor = { login: "bob", type: "User" };
export const WRITE = { push: true, maintain: false, admin: false };
export const ADMIN = { push: true, maintain: true, admin: true };

export interface Output {
  name: string;
  value: string;
  // How many requests had been made when the output was set.
  afterRequests: number;
}

export interface ResolveHarness {
  context: ResolveContext;
  github: FakeGitHub;
  adapter: TableAdapter;
  log: RememberingLog;
  outputs: Output[];
  // The dashboard's issue number.
  number: number;
}

// A repo whose dashboard a full scan just wrote. Alice has write access. The
// requests of the scan are forgotten, so a test counts only what `resolve`
// asked.
export async function scanned(
  table: Record<string, PreviewResult>,
  options: { config?: string } = {},
): Promise<ResolveHarness> {
  const adapter = tableAdapter(table);
  const { context: scanContext, github, log } = harness(adapter, options);
  await scan(scanContext);
  github.requests.length = 0;
  adapter.previewed.length = 0;
  adapter.versionChecks = 0;
  log.lines.length = 0;
  github.seedPermission(ALICE.login, WRITE);
  github.seedRun(RESOLVE_RUN, { completed: false });

  const outputs: Output[] = [];
  const context: ResolveContext = {
    root: scanContext.root,
    adapter,
    github,
    log,
    repoUrl: REPO_URL,
    runId: RESOLVE_RUN,
    sha: SHA,
    actionRef: ACTION_REF,
    event: undefined,
    workflow: WORKFLOW,
    setOutput: (name, value) =>
      void outputs.push({ name, value, afterRequests: github.requests.length }),
  };
  return { context, github, adapter, log, outputs, number: 1 };
}

// A person ticks boxes in one edit: the rows of these stacks, and the rescan
// box when asked.
export function tick(
  h: ResolveHarness,
  who: IssueAuthor,
  stackIds: string[],
  options: { rescan?: boolean } = {},
): void {
  const lines = h.github.issue(h.number).body.split("\n");
  const ids = new Set(stackIds);
  const edited = lines.map((line) => {
    const row = parseDashboard(line).rows[0];
    if (row && ids.has(row.stackId)) return line.replace(/^- \[ \] /, "- [x] ");
    if (options.rescan && line.includes("<!-- sluiceway:rescan -->")) {
      return line.replace(/^- \[ \] /, "- [x] ");
    }
    return line;
  });
  h.github.editBody(h.number, edited.join("\n"), who);
}

// Runs `resolve` as the job the oldest waiting event starts. With no event
// waiting, it runs on the payload given.
export async function wake(h: ResolveHarness, payload?: unknown): Promise<void> {
  h.context.event = payload ?? h.github.deliverEvent();
  await resolve(h.context);
}

export function matrix(h: ResolveHarness): unknown {
  const output = h.outputs.findLast(({ name }) => name === "matrix");
  return output ? JSON.parse(output.value) : undefined;
}

export function rowsOf(h: ResolveHarness): Record<string, string> {
  return Object.fromEntries(
    parseDashboard(h.github.issue(h.number).body).rows.map((row) => [row.stackId, row.text]),
  );
}
