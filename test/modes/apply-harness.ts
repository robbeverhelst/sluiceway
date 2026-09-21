// What the tests of the apply mode share. A real scan writes the dashboard, a
// person ticks, a real `resolve` creates the deployment record as `queued`,
// and `apply` is handed its id the way the matrix hands it over. Nothing about
// the record or the rows is made up.
import type { ApplyResult, PreviewResult } from "../../src/adapters/adapter.ts";
import type { MatrixEntry } from "../../src/core/resolve.ts";
import { type ApplyContext, apply } from "../../src/modes/apply.ts";
import type { FakeGitHub } from "../fake-github/fake-github.ts";
import { ACTION_REF, type RememberingLog, SHA, type TableAdapter } from "./harness.ts";
import { ALICE, matrix, RESOLVE_RUN, rowsOf, scanned, tick, wake } from "./resolve-harness.ts";

export interface ApplyHarness {
  context: ApplyContext;
  github: FakeGitHub;
  adapter: TableAdapter;
  log: RememberingLog;
  // The answers of the adapter's previews. Change one to move a change after
  // the tick.
  table: Record<string, PreviewResult>;
  // The one deployment record `resolve` handed on.
  deployment: number;
  number: number;
}

// Alice ticks these stacks and `resolve` hands them on. The requests, the
// previews and the log lines of everything before `apply` are forgotten, so a
// test counts only what `apply` did.
export async function handedOn(
  table: Record<string, PreviewResult>,
  stackIds: string[],
  options: { config?: string; deploys?: Record<string, ApplyResult> } = {},
): Promise<ApplyHarness> {
  const h = await scanned(table, options);
  tick(h, ALICE, stackIds);
  await wake(h);
  const entries = matrix(h) as MatrixEntry[];
  const first = entries[0];
  if (!first) throw new Error("resolve handed nothing on.");
  h.github.requests.length = 0;
  h.adapter.previewed.length = 0;
  h.log.lines.length = 0;
  h.log.groups.length = 0;

  const context: ApplyContext = {
    root: h.context.root,
    env: { PATH: "/usr/bin" },
    adapter: h.adapter,
    run: async () => {
      throw new Error("No test of the apply mode with a table adapter starts a process.");
    },
    github: h.github,
    log: h.log,
    previewTimeoutMinutes: 10,
    repoUrl: h.context.repoUrl,
    // `apply` runs in the run that `resolve` started.
    runId: RESOLVE_RUN,
    sha: SHA,
    actionRef: ACTION_REF,
    deploymentId: first.deployment,
    // The same run, so the same event: the edit that `resolve` acted on.
    event: h.context.event,
  };
  return {
    context,
    github: h.github,
    adapter: h.adapter,
    log: h.log,
    table,
    deployment: first.deployment,
    number: h.number,
  };
}

export function runApply(h: ApplyHarness): Promise<void> {
  return apply(h.context);
}

export function states(h: ApplyHarness, id = h.deployment): string[] {
  return h.github.deploymentStatuses(id).map(({ state }) => state);
}

export function rows(h: ApplyHarness): Record<string, string> {
  return rowsOf({ github: h.github, number: h.number } as Parameters<typeof rowsOf>[0]);
}
