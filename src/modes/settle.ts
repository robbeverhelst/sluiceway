// The settle mode (records 0003 and 0035): the job that runs after `apply`,
// with `if: always()`, and gives every open deployment record of its own
// workflow run the result `error`. A cancelled or rejected deploy never
// reports, and without this its stack would stay deploying. With dependencies
// it also starts the next layer (record 0056). It is handed no
// tool environment and no process runner, so it cannot run the tool (record
// 0014, promise 4).

import type { Adapter } from "../adapters/adapter.ts";
import { applyConfig, type ConfiguredStack } from "../core/config.ts";
import { loadConfig } from "../core/config-file.ts";
import { queueState } from "../core/dependencies.ts";
import { type DeploymentRecord, deployFacts } from "../core/deployment.ts";
import { deployFailureText } from "../core/failure-reason.ts";
import { openRecordsOfRun } from "../core/settle.ts";
import { stackId } from "../core/stack.ts";
import { type FallBackStack, readDeploymentRecords } from "../github/deployments.ts";
import { editedIssue } from "../github/event.ts";
import type { JobLog } from "../github/job-log.ts";
import { eventDashboardUrl, type StepOutputs } from "../github/outputs.ts";
import type { GitHubPort } from "../github/port.ts";
import type { WorkflowRef } from "../github/workflow-ref.ts";
import { logGroupTitle } from "../render/log-text.ts";
import { isDeployingState, parseDashboard } from "../render/marker.ts";

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
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function settle(context: SettleContext): Promise<void> {
  const { github, log } = context;
  // From the event, so it costs no request and is there on every way out.
  const url = eventDashboardUrl(context.repoUrl, context.event);
  if (url !== undefined) context.outputs?.set("dashboard-url", url);
  const config = loadConfig(context.root);
  const stacks = applyConfig(config, await context.adapter.discover(context.root, config));

  let records = await readRecords(context, stacks);
  const open = openRecordsOfRun(records, context.runId);

  // Stops at the first record that cannot be written, as `resolve` does, so a
  // missing `deployments: write` costs one request and not one per record.
  const end = async (id: number, stack: string, dead: boolean) => {
    try {
      const status = await github.createDeploymentStatus(id, {
        state: dead ? "failure" : "error",
        description: deployFailureText({ kind: dead ? "upstream-failed" : "run-ended" }),
        logUrl: `${context.repoUrl}/actions/runs/${context.runId}`,
      });
      records = records.map((record) => (record.id === id ? { ...record, status } : record));
    } catch (error) {
      throw new Error(
        `The deployment record of ${logGroupTitle(stack)} could not be given its result: ${message(error)}. The settle job needs the permission \`deployments: write\` (record 0003).`,
      );
    }
  };
  let ended = 0;
  for (const { id, stackId: stack, behind } of open) {
    // A queued record of this run waits for the stacks before it (record
    // 0056). It is not ended because the run is over.
    if (behind) continue;
    await end(id, stack, false);
    ended++;
    log.info(
      `Ended the open deployment of ${logGroupTitle(stack)} (record ${id}): this run ended without a result for it.`,
    );
  }
  // A queued record of this run whose dependency did not go out can never
  // start. From the first stack of a chain on, so the whole chain ends.
  for (let more = true; more; ) {
    more = false;
    for (const { id, stackId: stack, behind } of open) {
      if (!behind || deployFacts(records).byStack.get(stack)?.kind !== "open") continue;
      if (queueState(behind, records) !== "dead") continue;
      await end(id, stack, true);
      ended++;
      more = true;
      log.info(
        `Ended the queued deployment of ${logGroupTitle(stack)} (record ${id}): a stack it depends on did not deploy.`,
      );
    }
  }

  // The next layer (record 0056): every queued stack whose dependencies went
  // out, of this run or of another. `settle` cannot hand `apply` a matrix any
  // more, so it starts the workflow again, and the `resolve` job of that run
  // starts them.
  const ready = [...deployFacts(records).byStack].flatMap(([stack, fact]) =>
    fact.kind === "open" && fact.behind && queueState(fact.behind, records) === "ready"
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
      open.length === 0
        ? "No deployment record of this run is open. Every deploy it started reported a result."
        : "Every deploy this run started reported a result, and what is queued still waits.",
    );
    return;
  }

  // `settle` has no diff to render a row from (record 0014), so it leaves the
  // body alone and starts a full scan, as `resolve` does for the rescan box.
  // That scan meets a deploying row with no open deployment, previews the
  // stack and writes its row with the failure line (record 0004).
  await dispatchScan(context);
  if (ended > 0) {
    log.info(
      "Started a full scan, which writes the rows of these stacks again with the failure line.",
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
