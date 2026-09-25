// The settle mode (records 0003 and 0035): the job that runs after `apply`,
// with `if: always()`, and gives every open deployment record of its own
// workflow run the result `error`. A cancelled or rejected deploy never
// reports, and without this its stack would stay deploying. With dependencies
// it also starts the next layer (record 0056). It is handed no
// tool environment and no process runner, so it cannot run the tool (record
// 0014, promise 4). The row of each deploy it ended gets the failure line
// right away, from the record, and the full scan it starts writes the fresh
// row after it (record 0113).

import type { Adapter } from "../adapters/adapter.ts";
import type { Config, ConfiguredStack, IgnoredStack } from "../core/config.ts";
import { queueState } from "../core/dependencies.ts";
import { deployState, shownFreezes } from "../core/deploy-window.ts";
import { type DeploymentRecord, deployFacts } from "../core/deployment.ts";
import { openRepo } from "../core/repo.ts";
import { failureToWrite } from "../core/settle.ts";
import { stackId } from "../core/stack.ts";
import { attributionSource } from "../github/attribution.ts";
import { findDashboard } from "../github/dashboard.ts";
import { swapRows } from "../github/dashboard-write.ts";
import {
  type EndedRecord,
  type FallBackStack,
  RecordNotEnded,
  readDeploymentRecords,
  type Settled,
  settleRun,
} from "../github/deployments.ts";
import { editedIssue } from "../github/event.ts";
import type { JobLog } from "../github/job-log.ts";
import { eventDashboardUrl, type StepOutputs } from "../github/outputs.ts";
import type { GitHubPort } from "../github/port.ts";
import type { WorkflowRef } from "../github/workflow-ref.ts";
import type { BudgetOptions } from "../render/budget.ts";
import { DOT_AT_ZERO, RESULT_DOT } from "../render/dots.ts";
import { runUrl } from "../render/links.ts";
import { logGroupTitle } from "../render/log-text.ts";
import { isDeployingState, type ParsedRow, parseDashboard } from "../render/marker.ts";
import { settledRow } from "../render/settled-row.ts";

export interface SettleContext {
  // The directory of the checked-out repo.
  root: string;
  // Discovery reads files only and never asks a backend (record 0014).
  adapter: Pick<Adapter, "discover">;
  github: GitHubPort;
  log: JobLog;
  // `https://github.com/<owner>/<repo>`.
  repoUrl: string;
  // The run this job is part of. Its records are the ones `settle` ends.
  runId: string;
  // The payload of the event that started the run: the edit of the dashboard
  // that `resolve` acted on.
  event: unknown;
  // The workflow a full scan is started from, or nothing when the runner did
  // not say which one this is.
  workflow: WorkflowRef | undefined;
  // The one output of `settle`, `dashboard-url` (record 0041). A test that
  // does not look at it leaves it out.
  outputs?: StepOutputs | undefined;
  // The clock a deploy window is judged by (record 0104). The machine's
  // when a test does not set one.
  now?: (() => Date) | undefined;
  // The action ref the header pictures are served from (record 0033), for
  // the body it writes (record 0113).
  actionRef: string;
  // Only a test has a reason to set this.
  limits?: { body?: BudgetOptions } | undefined;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function settle(context: SettleContext): Promise<void> {
  const { log } = context;
  // From the event, so it costs no request and is there on every way out.
  const url = eventDashboardUrl(context.repoUrl, context.event);
  if (url !== undefined) context.outputs?.set("dashboard-url", url);
  const repo = openRepo(context.root, context.adapter);
  const { stacks, ignored } = await repo.stacks();
  const config = repo.config();

  const read = await readRecords(context, stacks);
  const settled = await settleOwnRun(context, read);
  const { records } = settled;
  const ended = settled.ended.length;

  // The next layer (record 0056): every queued stack whose dependencies went
  // out, of this run or of another, and whose deploy window is open (record
  // 0104): a run started now could not start it otherwise. `settle` cannot
  // hand `apply` a matrix any more, so it starts the workflow again, and the
  // `resolve` job of that run starts them.
  const now = (context.now ?? (() => new Date()))();
  // A deploy freeze holds the next layer too (record 0115).
  const times = new Map(stacks.map((one) => [stackId(one.stack), one]));
  const ready = [...deployFacts(records).byStack].flatMap(([stack, fact]) =>
    fact.kind === "open" &&
    fact.behind &&
    queueState(fact.behind, records) === "ready" &&
    deployState(
      times.get(stack)?.deployWindows,
      times.get(stack)?.freezes,
      now,
      config.dashboard.timeZone,
    ).open
      ? [stack]
      : [],
  );
  for (const stack of ready) {
    log.info(
      `${logGroupTitle(stack)} can start now: what it waited behind went out. Started the workflow again, and its resolve job starts it.`,
    );
  }
  if (ended === 0 && ready.length === 0) {
    log.info(
      settled.open === 0
        ? `${DOT_AT_ZERO} No deployment record of this run is open. Every deploy it started reported a result.`
        : `${DOT_AT_ZERO} Every deploy this run started reported a result, and what is queued still waits.`,
    );
    return;
  }

  // `settle` has no diff to render a row from (record 0014). It puts the
  // failure line on the row of each deploy it ended, which needs no tool, and
  // starts a full scan, as `resolve` does for the rescan box, which previews
  // the stacks and writes their rows with the fresh diff (record 0113).
  if (ended > 0) {
    await writeFailureLines(context, config, { stacks, ignored }, settled.ended);
  }
  await dispatchScan(context);
  if (ended > 0) {
    log.info(
      "Started a full scan, which previews these stacks again and writes their rows with the fresh diff.",
    );
  }
}

// One row swap for the deploys this run ended (record 0113), made at the late
// read of every try from the records as they are then. A write that does not
// happen is a line of the log: the records are ended, and the scan that
// follows writes the rows.
async function writeFailureLines(
  context: SettleContext,
  config: Config,
  repo: { stacks: readonly ConfiguredStack[]; ignored: readonly IgnoredStack[] },
  ended: readonly EndedRecord[],
): Promise<void> {
  const { github, log } = context;
  const ids = new Set(ended.map(({ stackId: id }) => id));
  const mine = repo.stacks.filter(({ stack }) => ids.has(stackId(stack)));
  if (mine.length === 0) return;
  const written: string[] = [];
  try {
    const dashboard = await findDashboard(github, config.dashboard.label);
    if (!dashboard) {
      log.info("There is no open dashboard to write. The full scan writes the row.");
      return;
    }
    const result = await swapRows(
      {
        github,
        log,
        runId: context.runId,
        repoUrl: context.repoUrl,
        actionRef: context.actionRef,
        dashboard: config.dashboard,
        deploys: config.deploys,
        ignored: repo.ignored,
        // The deploy freezes (record 0115), by this job's clock.
        freezes: shownFreezes(
          config.freezes,
          (context.now ?? (() => new Date()))(),
          config.dashboard.timeZone,
        ),
        budget: context.limits?.body,
      },
      dashboard.number,
      async (live, root) => {
        const facts = deployFacts(
          await readDeploymentRecords(
            github,
            repo.stacks.map(({ environment }) => environment),
            mine.map(({ stack, environment }) => ({ stackId: stackId(stack), environment })),
          ),
        );
        const carried = new Map<string, ParsedRow>();
        for (const { stack } of mine) {
          const id = stackId(stack);
          const row = live.first.get(id);
          const failure = failureToWrite(
            id,
            row?.known ? row.state : undefined,
            facts.byStack.get(id),
            live.outside,
            context.runId,
          );
          if (!row || !failure) continue;
          carried.set(
            id,
            settledRow(
              row,
              {
                reason: failure.reason,
                ticker: failure.ticker,
                at: failure.at,
                runUrl: runUrl(context.repoUrl, failure.run, failure.attempt),
                ...(failure.onMerge ? { onMerge: true } : {}),
              },
              { timeZone: config.dashboard.timeZone },
            ),
          );
        }
        written.splice(0, written.length, ...[...carried.keys()].sort());
        // The trail's shipped lines, as in every swap (record 0072). The walk
        // needs the workflow token only, and it never blocks.
        const shipped = await attributionSource(
          github,
          {
            stacks: repo.stacks.map(({ stack, inputs }) => ({
              id: stackId(stack),
              path: stack.path,
              inputs,
            })),
            unrelated: config.scan.unrelated,
            repoUrl: context.repoUrl,
            scanSha: root.scanSha,
            ...config.attribution,
            trailLength: config.dashboard.recentlyDeployed,
          },
          (why) =>
            log.info(
              `The trail was written without what its deploys shipped: ${why}. It only explains the trail, so nothing else changes (record 0072).`,
            ),
        ).ship(facts.trail);
        return { facts, shipped, rows: new Map(), carried };
      },
    );
    if (!result.fits) {
      log.info(
        `With the failure line the dashboard body is ${result.size.toLocaleString("en-US")} characters, over what GitHub keeps. Nothing was written. The full scan writes the row.`,
      );
      return;
    }
  } catch (error) {
    log.info(
      `The failure line could not be written on the row: ${message(error)}. The full scan writes the row.`,
    );
    return;
  }
  for (const id of written) {
    log.info(
      `Wrote the failure line on the row of ${logGroupTitle(id)}, before the full scan previews it again (record 0113).`,
    );
  }
}

// Stops at the first record that cannot be written, as `resolve` does, so a
// missing `deployments: write` costs one request and not one per record. What
// was ended before it is in the log first.
async function settleOwnRun(
  context: SettleContext,
  records: DeploymentRecord[],
): Promise<Settled & { open: number }> {
  try {
    const settled = await settleRun(context.github, records, context.repoUrl, context.runId);
    logEnded(context.log, settled.ended);
    return settled;
  } catch (error) {
    if (!(error instanceof RecordNotEnded)) throw error;
    logEnded(context.log, error.settled.ended);
    throw new Error(
      `The deployment record of ${logGroupTitle(error.stackId)} could not be given its result: ${message(error.cause)}. The settle job needs the permission \`deployments: write\` (record 0003).`,
    );
  }
}

function logEnded(log: JobLog, ended: readonly EndedRecord[]): void {
  for (const { deployment, stackId: stack, dead } of ended) {
    log.info(
      dead
        ? `${RESULT_DOT.failed} Ended the queued deployment of ${logGroupTitle(stack)} (record ${deployment}): a stack it depends on did not deploy.`
        : `${RESULT_DOT.failed} Ended the open deployment of ${logGroupTitle(stack)} (record ${deployment}): this run ended without a result for it.`,
    );
  }
}

// The bounded reads of record 0003, over every environment a stack uses. A
// record of this run is among the newest of its environment, unless a hundred
// newer ones came while a deploy waited on a reviewer. Only then is the live
// dashboard read, and the fall back asks for the stacks that this run may
// have started: a row that says deploying, and a row that is still ticked
// because the body write of `resolve` failed.
async function readRecords(
  context: SettleContext,
  stacks: readonly ConfiguredStack[],
): Promise<DeploymentRecord[]> {
  try {
    return await readDeploymentRecords(
      context.github,
      stacks.map(({ environment }) => environment),
      () => startedHere(context, stacks),
    );
  } catch (error) {
    throw new Error(
      `The deployment records could not be read: ${message(error)}. The settle job needs the permission \`deployments: write\` (record 0003).`,
    );
  }
}

async function startedHere(
  context: SettleContext,
  stacks: readonly ConfiguredStack[],
): Promise<FallBackStack[]> {
  const issue = editedIssue(context.event);
  if (!issue) return [];
  const { body } = await context.github.getIssue(issue.number);
  const rows = parseDashboard(body).rows;
  const hinted = new Set(
    rows.flatMap((row) =>
      row.known && (isDeployingState(row.state) || row.ticked) ? [row.stackId] : [],
    ),
  );
  return stacks.flatMap(({ stack, environment }) =>
    hinted.has(stackId(stack)) ? [{ stackId: stackId(stack), environment }] : [],
  );
}

async function dispatchScan(context: SettleContext): Promise<void> {
  if (!context.workflow) {
    throw new Error(
      "A full scan could not be started: GITHUB_WORKFLOW_REF is not set, so this job does not know which workflow it belongs to. The records are ended, and the next scan writes their rows again.",
    );
  }
  try {
    await context.github.dispatchWorkflow(context.workflow.file, context.workflow.ref);
  } catch (error) {
    throw new Error(
      `A full scan could not be started: ${message(error)}. The settle job needs the permission \`actions: write\`, and the workflow (${context.workflow.file}) needs a \`workflow_dispatch\` trigger that runs the scan (record 0017). The records are ended, and the next scan writes their rows again.`,
    );
  }
}
