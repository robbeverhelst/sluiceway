// The apply mode (records 0008, 0019, 0021 and 0035): the job that deploys one
// stack from the deployment record `resolve` handed on. It wires config,
// discovery, the adapter, the diff hash, the deployment record, the renderers
// and the GitHub port together and holds no rules of its own. A deploy only
// ever starts from an open deployment record whose fresh preview gives the
// diff hash the record holds.

import type {
  Adapter,
  DriftResult,
  PreviewOptions,
  PreviewResult,
  ToolDiffResult,
} from "../adapters/adapter.ts";
import { ToolVersionError } from "../adapters/adapter.ts";
import type { ProcessRunner } from "../adapters/process.ts";
import type { Config, ConfiguredStack, IgnoredStack } from "../core/config.ts";
import { applyOutcome, deployEnd, deployGate, unplannedEnd } from "../core/deploy-gate.ts";
import { shownFreezes } from "../core/deploy-window.ts";
import {
  type DeployFacts,
  type DeploymentPayload,
  deployFacts,
  lastDeployedCommit,
  type RecordEnd,
  recordStatus,
  standingFailure,
} from "../core/deployment.ts";
import {
  type DeployFailureReason,
  deployFailureText,
  previewFailureText,
} from "../core/failure-reason.ts";
import { comparedRef, type MovedWhy, movedSinceCheckout } from "../core/moved-since-checkout.ts";
import {
  applyNotification,
  DEFAULT_NOTIFY_EVENTS,
  type NotifyEvent,
  repositoryOf,
} from "../core/notify.ts";
import type { OutsideDeploy } from "../core/outside-deploy.ts";
import { openRepo, type Repo } from "../core/repo.ts";
import { shownValues } from "../core/show-values.ts";
import { stackId } from "../core/stack.ts";
import { type AttributionSource, attributionSource } from "../github/attribution.ts";
import { findDashboard } from "../github/dashboard.ts";
import { swapRows } from "../github/dashboard-write.ts";
import { claimRecord, endRecord, readDeploymentRecords } from "../github/deployments.ts";
import { type StackEnvFilesLoad, stackEnvFiles } from "../github/env-file.ts";
import { publicRepo } from "../github/event.ts";
import type { JobLog } from "../github/job-log.ts";
import { eventDashboardUrl, type StepOutputs, writeResultFile } from "../github/outputs.ts";
import type { GitHubPort } from "../github/port.ts";
import type { WorkflowRef } from "../github/workflow-ref.ts";
import type { Notifier } from "../notify/send.ts";
import {
  ALREADY_ENDED,
  type AppliedPreview,
  type ApplyOutcome,
  renderApplySummary,
} from "../render/apply-summary.ts";
import { BODY_LIMIT, type BudgetOptions } from "../render/budget.ts";
import { RESULT_DOT } from "../render/dots.ts";
import { runLinks, runUrl as runUrlOf } from "../render/links.ts";
import {
  diffLogLines,
  logGroupTitle,
  PUBLIC_LOG_DIFF,
  toolDiffLogLines,
} from "../render/log-text.ts";
import { parseDashboard } from "../render/marker.ts";
import { branchMovedComment, movedComment, valueChangedComment } from "../render/moved-comment.ts";
import { previewRow } from "../render/preview-result.ts";
import { type ApplyResultOutcome, applyResultFile } from "../render/result-file.ts";
import { type AttributionLines, type FailureLine, isDestroy, type Row } from "../render/row.ts";
import { prepareStacks } from "./prepare.ts";

// Everything `apply` needs, handed in as data and seams (build plan, section
// 5). It is the one mode besides `scan` that runs the tool.
export interface ApplyContext {
  // The directory of the checked-out repo.
  root: string;
  // The environment of the job, read once by the glue. The adapter hands it to
  // the tool (record 0013).
  env: Record<string, string | undefined>;
  // The runner's `setSecret`, for the values of the env file the stack names
  // (record 0103): every one is masked before the file is named.
  mask: StackEnvFilesLoad["mask"];
  adapter: Adapter;
  run: ProcessRunner;
  github: GitHubPort;
  log: JobLog;
  // The `preview-timeout` input, in whole minutes. A stack's `previewTimeout`
  // wins (record 0035).
  previewTimeoutMinutes: number;
  // The `deploy-timeout` input, in whole minutes: a time limit on the deploy
  // itself. None when absent (slice 5.9).
  deployTimeoutMinutes?: number | undefined;
  // The clock of the timings in the result file (record 0061).
  now: () => Date;
  // `https://github.com/<owner>/<repo>`.
  repoUrl: string;
  // The run of this job. `resolve` created the record in the same run.
  runId: string;
  // A re-run of the run is a new attempt (record 0044).
  runAttempt: string;
  // The id of the running job. Absent where the runner does not know it.
  jobId?: string | undefined;
  // The commit the job checked out: the head of the default branch that
  // `resolve` put on the record.
  sha: string;
  actionRef: string;
  // The `deployment-id` input: the record to deploy (record 0035).
  deploymentId: number;
  // The workflow of the run and the ref it runs on. `apply` compares the
  // checked-out commit with the head of that branch before its fresh preview,
  // and starts a full scan when the branch moved under the stack (record
  // 0111). Nothing when the runner did not say, and then nothing deploys.
  workflow: WorkflowRef | undefined;
  // The `dry-run` input: stop after the hash check, deploy nothing and end
  // the record as rehearsed (record 0051).
  dryRun?: boolean | undefined;
  // The payload of the event that started the run: the edit of the dashboard
  // that `resolve` acted on. The `dashboard-url` output reads it, and so does
  // the warning for a public repo with `scan.logDiff` on (record 0048).
  event?: unknown;
  // The step outputs and the result file (record 0041). A test that does not
  // look at them leaves them out.
  outputs?: StepOutputs | undefined;
  // The built-in notifications (record 0078). None when the step names no
  // channel.
  notifier?: Notifier | undefined;
  // Only a test has a reason to set this.
  limits?: { body?: BudgetOptions } | undefined;
}

// The job goes red: the stack did not deploy (record 0035). A person who opens
// a green `apply` job must be able to read it as "this went out".
export class ApplyFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplyFailedError";
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function lines(text: string): string[] {
  const all = text.split(/\r?\n/);
  if (all.at(-1) === "") all.pop();
  return all;
}

const RECORD_PERMISSIONS =
  "The apply job needs the permission `deployments: write`, and `deployment-id` has to be the `deployment` of a matrix entry that `resolve` set (record 0035).";

// What the outputs and the result file are made from, filled in as the job
// gets that far.
interface ApplyReport {
  outcome?: ApplyResultOutcome;
  stack?: string;
  ticker?: string;
  reason?: string | undefined;
  applied?: ApplyOutcome | undefined;
  startedAt?: Date;
  // How long the tool's deploy took, once it was asked to deploy.
  deployMilliseconds?: number;
}

export async function apply(context: ApplyContext): Promise<void> {
  const report: ApplyReport = { startedAt: context.now() };
  // Read once, for the deploy and for the notification.
  const repo = openRepo(context.root, context.adapter);
  try {
    await applying(context, repo, report);
  } finally {
    reportOutputs(context, report);
    await notifyOutcome(context, repo, report);
  }
}

// The built-in notification of the outcome (record 0078), on every way out,
// as the outputs are. It never throws, so it never changes the job's result.
// A sluiceway.yaml that cannot be read, which already failed the deploy, sends
// the default events.
async function notifyOutcome(
  context: ApplyContext,
  repo: Repo,
  report: ApplyReport,
): Promise<void> {
  if (!context.notifier) return;
  const notification = applyNotification(report.outcome ?? "failed", report.stack, {
    repository: repositoryOf(context.repoUrl),
    dashboardUrl: eventDashboardUrl(context.repoUrl, context.event),
    runUrl: runUrlOf(context.repoUrl, context.runId, context.runAttempt),
  });
  if (!notification) return;
  let events: readonly NotifyEvent[] = DEFAULT_NOTIFY_EVENTS;
  try {
    events = repo.config().notify.events;
  } catch {
    // The job log already says why the file cannot be read.
  }
  await context.notifier.send([notification], events);
}

// The outputs are set on every way out (record 0041). `refused` is a record
// this job may not deploy, a change that moved since the tick, or deploys
// turned off in sluiceway.yaml (record 0051). Anything
// else that did not go out, an error nobody planned for too, is `failed`.
function reportOutputs(context: ApplyContext, report: ApplyReport): void {
  const { outputs } = context;
  if (!outputs) return;
  const url = eventDashboardUrl(context.repoUrl, context.event);
  const outcome = report.outcome ?? "failed";
  if (url !== undefined) outputs.set("dashboard-url", url);
  outputs.set("outcome", outcome);
  if (report.stack !== undefined) outputs.set("stack", report.stack);
  const text = applyResultFile({
    run: `${context.repoUrl}/actions/runs/${context.runId}`,
    commit: context.sha,
    deployment: context.deploymentId,
    dashboardUrl: url,
    outcome,
    stack: report.stack,
    ticker: report.ticker,
    reason: report.reason,
    applied: report.applied,
    milliseconds: context.now().getTime() - (report.startedAt?.getTime() ?? 0),
    deployMilliseconds: report.deployMilliseconds,
  });
  writeResultFile(outputs, context.log, "apply", text);
}

async function applying(context: ApplyContext, repo: Repo, report: ApplyReport): Promise<void> {
  const { github, log } = context;
  const id = context.deploymentId;

  // The record comes first, before config, discovery or the tool, so a
  // refused re-run costs one request and never touches the tool or its
  // credentials (record 0019).
  const claim = await claimRecord(context, id);
  if (claim.kind === "unread") {
    report.outcome = "failed";
    throw new ApplyFailedError(
      `Deployment record ${id} could not be read: ${message(claim.error)}. ${RECORD_PERMISSIONS}`,
    );
  }
  // Every way out from here to the deploy is a record this job may not deploy.
  report.outcome = "refused";
  if (claim.kind === "ended") {
    log.info(
      `Deployment record ${id} already ended as ${claim.state}. Nothing is deployed. A re-run never deploys (record 0019).`,
    );
    await writeSummary(context, `## Sluiceway apply\n\n${ALREADY_ENDED}\n`);
    throw new ApplyFailedError(ALREADY_ENDED);
  }
  // A record that is not Sluiceway's, or one this version cannot read, is
  // never touched (records 0003 and 0035).
  if (claim.kind === "not-sluiceways") {
    throw new ApplyFailedError(
      `Deployment record ${id} is not one of Sluiceway's: its task does not start with "sluiceway:". Nothing was deployed and the record was left alone.`,
    );
  }
  const id_ = claim.stackId;
  report.stack = id_;
  const name = logGroupTitle(id_);
  if (claim.kind === "unreadable-payload") {
    throw new ApplyFailedError(
      `Deployment record ${id} of ${name} carries a payload this version of Sluiceway cannot read. Nothing was deployed and the record was left alone.`,
    );
  }
  // A record lives as long as its run (record 0003). Deployed from another
  // run, it could be ended under a deploy that is still going.
  if (claim.kind === "other-run") {
    throw new ApplyFailedError(
      `Deployment record ${id} of ${name} belongs to run ${claim.run}, and this is run ${context.runId}. \`apply\` deploys a record only in the run whose \`resolve\` job created it. Nothing was deployed and the record was left alone.`,
    );
  }
  // A queued record is started by a later `resolve`, under a record of its
  // own run (records 0056 and 0104). `resolve` never hands one on.
  if (claim.kind === "queued") {
    const { behind } = claim;
    throw new ApplyFailedError(
      behind
        ? `Deployment record ${id} of ${name} is queued behind ${behind.map(logGroupTitle).join(" and ")}. \`apply\` never deploys a queued record: a later \`resolve\` starts it once ${behind.length === 1 ? "that stack" : "those stacks"} went out. Nothing was deployed and the record was left alone.`
        : `Deployment record ${id} of ${name} waits for the deploy window of ${name} or the end of a deploy freeze (records 0104 and 0115). \`apply\` never deploys a queued record: the first run when both allow starts it. Nothing was deployed and the record was left alone.`,
    );
  }

  const { payload } = claim;
  report.ticker = payload.ticker;
  report.outcome = "failed";
  // The attempt of this run, so the link stays on it after a re-run (slice
  // 5.9).
  const runUrl = runUrlOf(context.repoUrl, context.runId, context.runAttempt);
  if (claim.kind === "unclaimed") {
    throw new ApplyFailedError(
      `Deployment record ${id} of ${name} could not be marked in progress: ${message(claim.error)}. Nothing was deployed. ${RECORD_PERMISSIONS}`,
    );
  }
  log.info(
    `Deployment record ${id}: ${name}, ${payload.onMerge ? "merged" : "ticked"} by ${payload.ticker}, approved diff hash ${payload.hash}. It is in progress.`,
  );

  // From here the record is this job's, and every way out gives it a result,
  // also an error nobody planned for.
  const progress: Progress = { deploying: false };
  let attempt: Attempt;
  try {
    attempt = await deploy(context, repo, id_, payload, runUrl, progress);
  } catch (error) {
    const end = unplannedEnd(progress.deploying);
    attempt = {
      end,
      failed: `${name} was not deployed: ${deployFailureText(end.reason)}. ${message(error)}`,
    };
  }
  const reason = reasonOf(attempt);
  const state = recordStatus(attempt.end).state;
  // A deploy that went out is deployed, also when its record could not be
  // given the result. The job is red then, and says why.
  report.outcome = applyOutcome(attempt.end);
  report.reason = reason && deployFailureText(reason);
  report.applied = attempt.summary;
  if (progress.milliseconds !== undefined) report.deployMilliseconds = progress.milliseconds;
  const failures: string[] = [];
  let ended = false;
  try {
    await endRecord(context, id, attempt.end);
    ended = true;
    // The headline of the job: the dot of its outcome first (slice 4.5).
    log.info(`${RESULT_DOT[report.outcome]} Deployment record ${id} ended as ${state}.`);
  } catch (error) {
    failures.push(
      `Deployment record ${id} of ${name} could not be given its result (${state}): ${message(error)}. The \`settle\` job of this run ends it. ${RECORD_PERMISSIONS}`,
    );
  }

  if (attempt.summary) {
    await writeSummary(
      context,
      renderApplySummary({
        stackId: id_,
        ticker: payload.ticker,
        runUrl,
        outcome: attempt.summary,
        ...(payload.onMerge ? { onMerge: true } : {}),
      }),
    );
  }

  // The dashboard is a view. It is written after the record has its result,
  // and a failure to write it changes nothing about the deploy (record 0004).
  if (ended && attempt.row && attempt.setup) {
    const made = attempt.row;
    let written: number | undefined;
    try {
      written = await swapRow(context, attempt.setup, id_, (facts, attribution, outside) => {
        // It stands while no deploy of the stack ended after it, outside the
        // dashboard included, as the body's trail lists them (record 0076).
        const fact = standingFailure(id_, facts.byStack.get(id_), outside);
        const failure: FailureLine | undefined =
          fact !== undefined
            ? {
                reason: fact.reason,
                ticker: fact.ticker,
                at: fact.at,
                runUrl: runUrlOf(context.repoUrl, fact.run, fact.attempt),
                ...(fact.onMerge ? { onMerge: true } : {}),
              }
            : undefined;
        const row = previewRow(id_, made, runLinks(context), failure, {
          toolDiffInLog: attempt.toolDiffInLog,
        });
        return row.state === "pending" ? { ...row, attribution } : row;
      });
    } catch (error) {
      failures.push(`The dashboard could not be written: ${message(error)}`);
    }
    // A moved change is told to the ticker in one comment (record 0051). It
    // says that the row shows the fresh diff, so it is written only once
    // that is true.
    // So is a value that changed since the tick (record 0102).
    if (written !== undefined && (reason?.kind === "moved" || reason?.kind === "value-changed")) {
      const tick = {
        login: payload.ticker,
        stackId: id_,
        ...(payload.onMerge ? { onMerge: true } : {}),
      };
      try {
        await github.createComment(
          written,
          reason.kind === "moved"
            ? movedComment(tick)
            : valueChangedComment({ ...tick, everyRun: reason.everyRun }),
        );
      } catch (error) {
        failures.push(
          `The comment to ${payload.ticker} about the ${reason.kind === "moved" ? "moved change" : "changed value"} could not be written: ${message(error)}. The job needs the permission \`issues: write\`.`,
        );
      }
    }
  }

  // A push that reached the branch after the checkout (record 0111): no
  // fresh preview shows it, so the row is left to a full scan this job
  // starts, and the ticker is told that the next scan shows the change.
  if (ended && attempt.branchMoved && attempt.setup) {
    const { setup } = attempt;
    try {
      await dispatchScan(context);
    } catch (error) {
      failures.push(message(error));
    }
    try {
      const dashboard = await findDashboard(github, setup.config.dashboard.label);
      if (dashboard) {
        await github.createComment(
          dashboard.number,
          branchMovedComment({
            login: payload.ticker,
            stackId: id_,
            ...(payload.onMerge ? { onMerge: true } : {}),
          }),
        );
      }
    } catch (error) {
      failures.push(
        `The comment to ${payload.ticker} about the newer commit could not be written: ${message(error)}. The job needs the permission \`issues: write\`.`,
      );
    }
  }

  if (attempt.failed) failures.unshift(attempt.failed);
  if (failures.length > 0) throw new ApplyFailedError(failures.join("\n"));
}

// The full scan after a refusal for a newer commit (record 0111), started the
// way `settle` starts one: this same workflow, on this same ref (record 0035).
async function dispatchScan(context: ApplyContext): Promise<void> {
  const { workflow } = context;
  if (!workflow) return;
  try {
    await context.github.dispatchWorkflow(workflow.file, workflow.ref);
    context.log.info("A full scan was started, which shows the change as it is now on the row.");
  } catch (error) {
    throw new Error(
      `A full scan could not be started: ${message(error)}. The apply job needs the permission \`actions: write\`, and the workflow (${workflow.file}) needs a \`workflow_dispatch\` trigger that runs the scan (record 0017). The record is ended, and the next scan writes its row again.`,
    );
  }
}

// How far the job got with the tool's deploy.
interface Progress {
  // Set once the tool was asked to deploy.
  deploying: boolean;
  // How long the deploy took, once it ended (record 0061).
  milliseconds?: number;
}

// What the stack's config and discovery gave, which the row swap needs.
interface Setup {
  config: Config;
  stacks: ConfiguredStack[];
  stack: ConfiguredStack;
  // Listed under In sync with their reasons (record 0051).
  ignored: IgnoredStack[];
  attribution: AttributionSource;
}

interface Attempt {
  // How the record ends.
  end: RecordEnd;
  // Why the job goes red. Nothing when the stack deployed.
  failed?: string | undefined;
  // The preview result the stack's row is made from. Without one the row is
  // left to the next scan, which previews a deploying row whose record ended.
  row?: PreviewResult | undefined;
  // This job's log holds the tool's own diff of the preview the row is made
  // from, so the row's `preview` link lands there (record 0048).
  toolDiffInLog?: boolean | undefined;
  summary?: ApplyOutcome | undefined;
  setup?: Setup | undefined;
  // The branch moved under the stack after the checkout, and the tool never
  // ran (record 0111).
  branchMoved?: boolean | undefined;
}

function reasonOf(attempt: Attempt): DeployFailureReason | undefined {
  return attempt.end.kind === "failed" ? attempt.end.reason : undefined;
}

function applied(result: PreviewResult): AppliedPreview {
  return result.ok
    ? { kind: "diff", diff: result.diff }
    : { kind: "preview-failed", reason: previewFailureText(result.reason) };
}

async function deploy(
  context: ApplyContext,
  repo: Repo,
  id: string,
  payload: DeploymentPayload,
  runUrl: string,
  progress: Progress,
): Promise<Attempt> {
  const { log, adapter } = context;
  const name = logGroupTitle(id);
  const notDeployed = (reason: DeployFailureReason, why = ""): string =>
    `${name} was not deployed: ${deployFailureText(reason)}.${why}`;

  let setup: Setup;
  try {
    const config = repo.config();
    if (!config.deploys) {
      // One reviewed line stops every deploy, also one ticked before it was
      // merged (record 0051). The tool never runs.
      const reason: DeployFailureReason = { kind: "deploys-off" };
      return { end: { kind: "failed", reason }, failed: notDeployed(reason) };
    }
    const { stacks, ignored } = await repo.stacks();
    const stack = stacks.find((one) => stackId(one.stack) === id);
    if (!stack) {
      const reason: DeployFailureReason = { kind: "unknown-stack" };
      return {
        end: { kind: "failed", reason },
        failed: notDeployed(
          reason,
          " Discovery does not find it in the files of this commit, or `ignore` leaves it out. The next scan drops its row.",
        ),
      };
    }
    setup = {
      config,
      stacks,
      stack,
      ignored,
      attribution: attributionSource(
        context.github,
        {
          stacks: stacks.map((one) => ({
            id: stackId(one.stack),
            path: one.stack.path,
            inputs: one.inputs,
          })),
          unrelated: config.scan.unrelated,
          repoUrl: context.repoUrl,
          // The preview of this job ran on this commit.
          scanSha: context.sha,
          ...config.attribution,
          trailLength: config.dashboard.recentlyDeployed,
        },
        (why) =>
          log.info(
            `Attribution was left off the row: ${why}. It only explains a row, so nothing else changes (record 0026).`,
          ),
      ),
    };
  } catch (error) {
    const reason: DeployFailureReason = { kind: "not-started" };
    return { end: { kind: "failed", reason }, failed: notDeployed(reason, ` ${message(error)}`) };
  }

  // A push after the checkout never reaches the fresh preview, so the
  // branch is read before it (record 0111). The tool has not run yet.
  const moved = await sinceCheckout(context, setup, id);
  if (moved) return moved;

  // The environment of the stack: the step's, with the env file its entry
  // names on top (record 0103), masked first. A file that could not be loaded
  // is a failed fresh preview, found by the preparation below.
  const envs = stackEnvFiles({ root: context.root, env: context.env, mask: context.mask, log })([
    { id, envFile: setup.stack.envFile },
  ]);
  const own = envs.get(id);
  const tool = { root: context.root, env: own?.ok ? own.env : context.env, run: context.run };
  try {
    await adapter.checkVersion(tool, [setup.stack.stack]);
  } catch (error) {
    if (!(error instanceof ToolVersionError)) throw error;
    // The message is Sluiceway's own. What the tool printed stays in the job
    // log (record 0022).
    if (error.toolLog !== "") context.log.group("The tool's own words", lines(error.toolLog));
    const reason: DeployFailureReason = { kind: "tool-missing" };
    return {
      end: { kind: "failed", reason },
      failed: notDeployed(reason, ` ${error.message}`),
      setup,
    };
  }

  // The stack's preparation, such as OpenTofu's init, before its fresh
  // preview (record 0053). A failed one is a failed fresh preview.
  const unprepared = (
    await prepareStacks(
      { ...tool, log, adapter },
      [setup.stack],
      context.previewTimeoutMinutes,
      envs,
    )
  ).get(id);

  // The fresh preview: the same call as the scan's, so the hash is taken the
  // same way (records 0008 and 0015). It keeps its plan when the tool can
  // save one, so the deploy goes out exactly as it was hashed (record 0053).
  const options = {
    ...tool,
    timeoutMinutes: setup.stack.previewTimeout ?? context.previewTimeoutMinutes,
    showValues: shownValues(setup.config.dashboard),
    valueFingerprint: setup.stack.valueFingerprint ?? setup.config.valueFingerprint,
  };
  const fresh =
    unprepared ?? (await adapter.preview(setup.stack.stack, { ...options, savePlan: true }));
  try {
    return await afterFreshPreview(context, id, payload, runUrl, progress, setup, fresh, options);
  } finally {
    // A plan file holds values in plain text (record 0021): it goes on every
    // way out, deployed or not.
    if (fresh.ok) await fresh.plan?.dispose();
  }
}

// Record 0111: the commit this run checked out against the head of the
// branch the run is on. A newer commit that a scan would preview the stack
// for is a change that moved since the tick. Anything that keeps the answer
// from being known deploys nothing.
async function sinceCheckout(
  context: ApplyContext,
  setup: Setup,
  id: string,
): Promise<Attempt | undefined> {
  const name = logGroupTitle(id);
  const checkout = context.sha.slice(0, 7);
  const refused = (reason: DeployFailureReason, why: string): Attempt => ({
    end: { kind: "failed", reason },
    failed: `${name} was not deployed: ${deployFailureText(reason)}. ${why}`,
    summary: { kind: "not-deployed", reason: deployFailureText(reason) },
    setup,
  });
  if (!context.workflow) {
    return refused(
      { kind: "not-started" },
      "GITHUB_WORKFLOW_REF is not set, so this job does not know which branch it runs on, and nothing says the branch did not move since the tick.",
    );
  }
  const ref = comparedRef(context.workflow.ref);
  let comparison: Awaited<ReturnType<GitHubPort["compareCommits"]>>;
  try {
    comparison = await context.github.compareCommits(context.sha, ref);
  } catch (error) {
    return refused(
      { kind: "not-started" },
      `Comparing ${checkout}, the commit this run checked out, with ${ref} failed: ${message(error)}. Without it nothing says the branch did not move since the tick. The job needs the permission \`contents: read\`.`,
    );
  }
  const found = movedSinceCheckout({
    comparison,
    stack: id,
    stacks: setup.stacks.map((one) => ({
      id: stackId(one.stack),
      path: one.stack.path,
      inputs: one.inputs,
    })),
    unrelated: setup.config.scan.unrelated,
  });
  if (found.kind === "still") {
    context.log.info(
      `${ref} holds nothing newer for ${name} than ${checkout}, the commit this run checked out.`,
    );
    return undefined;
  }
  return {
    ...refused(
      { kind: "moved" },
      `${movedText(found.why, { ref, checkout, name })} Nothing was previewed or deployed. A full scan is started, which shows the change as it is now on the row. Tick it again to deploy that.`,
    ),
    branchMoved: true,
  };
}

function movedText(
  why: MovedWhy,
  { ref, checkout, name }: { ref: string; checkout: string; name: string },
): string {
  const from = `${ref} moved on from ${checkout}, the commit this run checked out,`;
  const files = (list: string[]) => (list.length === 1 ? "a file" : "files");
  switch (why.kind) {
    case "claims":
      return `${from} to a commit that changes ${files(why.files)} ${name} claims: ${why.files.join(", ")}.`;
    case "unclaimed":
      return `${from} to a commit that changes ${files(why.files)} no stack claims, so a scan of it previews every stack: ${why.files.join(", ")}.`;
    case "not-a-straight-line":
      return `${ref} is not a straight line on from ${checkout}, the commit this run checked out (GitHub says ${why.status}), so what it holds is not what was previewed.`;
    case "file-cap":
      return `${from} and the comparison lists the most files GitHub gives, so which stacks the newer commits change cannot be told.`;
  }
}

async function afterFreshPreview(
  context: ApplyContext,
  id: string,
  payload: DeploymentPayload,
  runUrl: string,
  progress: Progress,
  setup: Setup,
  previewed: PreviewResult,
  options: PreviewOptions,
): Promise<Attempt> {
  const { log, adapter } = context;
  const name = logGroupTitle(id);
  const notDeployed = (reason: DeployFailureReason, why = ""): string =>
    `${name} was not deployed: ${deployFailureText(reason)}.${why}`;
  const notDeployedSummary = (reason: DeployFailureReason, checked: PreviewResult) =>
    ({
      kind: "not-deployed",
      reason: deployFailureText(reason),
      checked: applied(checked),
    }) as const;
  // The stack's own environment, as the fresh preview had it (record 0103).
  const tool = { root: context.root, env: options.env, run: context.run };
  const preview = () => adapter.preview(setup.stack.stack, options);
  // With `scan.logDiff` on, the tool's own diff of the fresh preview goes to
  // the job log before anything is decided, so a person reading this job sees
  // what went out, or what moved (record 0048). It decides nothing.
  const { logDiff } = setup.config.scan;
  if (logDiff && publicRepo(context.event)) {
    log.warning(PUBLIC_LOG_DIFF.message, PUBLIC_LOG_DIFF.title);
  }
  const toolDiff =
    logDiff && previewed.ok && previewed.diff.changes.length > 0
      ? await adapter.toolDiff(setup.stack.stack, options)
      : undefined;
  // The commit of the dashboard's last scan (record 0102): when it is this
  // run's, a value fingerprint that differs is a value that differs between
  // two previews of the same code, and the refusal says so.
  const sameCommit = await lastScanWasOfThisCommit(context, setup);
  const asked = deployGate({
    approved: payload,
    fresh: previewed,
    dryRun: context.dryRun === true,
    sameCommit,
  });
  const gate =
    asked.kind === "check-drift"
      ? asked.withDrift(await checkDriftAgain(context, setup, options, id))
      : asked;
  logPreview(context, id, "The fresh preview", gate.checked, toolDiff);
  const toolDiffInLog = toolDiff !== undefined;
  switch (gate.kind) {
    case "drift-failed":
      return {
        end: gate.end,
        failed: notDeployed(
          gate.end.reason,
          " The drift check failed, and the diff hash the tick approved covers drift.",
        ),
        summary: notDeployedSummary(gate.end.reason, gate.checked),
        setup,
      };
    case "preview-failed":
      return {
        end: gate.end,
        failed: notDeployed(gate.end.reason),
        row: gate.checked,
        summary: notDeployedSummary(gate.end.reason, gate.checked),
        setup,
      };
    case "in-sync":
      // Most likely a deploy outside the dashboard, which is legal (record
      // 0016). The tool deploys nothing. A drift repair says it repaired
      // nothing, not only that the stack is in sync (record 0091).
      log.info(
        payload.drift
          ? "The drift check and the fresh preview show no change: the drift the tick approved is not there any more, so there was nothing to repair. Nothing was deployed."
          : `The fresh preview shows no change: nothing to deploy, ${name} is already in sync. Nothing was deployed.`,
      );
      return {
        end: gate.end,
        row: gate.checked,
        toolDiffInLog,
        summary: { kind: "in-sync" },
        setup,
      };
    case "moved":
      // Nothing goes out, and the row shows the fresh diff, which a fresh
      // tick can approve.
      return {
        end: gate.end,
        failed: notDeployed(
          gate.end.reason,
          ` The fresh preview gives diff hash ${gate.hash} and the tick approved ${payload.hash}. The row on the dashboard shows the fresh diff. Tick it again to deploy that.`,
        ),
        row: gate.checked,
        toolDiffInLog,
        summary: notDeployedSummary(gate.end.reason, gate.checked),
        setup,
      };
    case "value-changed":
      // The hash matches, and a value the row does not show changed since
      // the tick (record 0102). Nothing goes out, and the row shows the fresh
      // diff, which a fresh tick can approve.
      return {
        end: gate.end,
        failed: notDeployed(
          gate.end.reason,
          ` The fresh preview gives diff hash ${gate.hash}, the one the tick approved, and value fingerprint ${gate.fingerprint} where the tick approved ${payload.fingerprint ?? "none"}: a value the row does not show changed since the tick.${
            gate.everyRun
              ? " The dashboard's last scan was of this same commit, so the value differs between two previews of the same code, and no tick can approve it. Turn the value fingerprint off for this stack with `valueFingerprint: false` on its `stacks` entry in `sluiceway.yaml`."
              : " The row on the dashboard shows the change as it is now. Look at it and tick it again to deploy that."
          }`,
        ),
        row: gate.checked,
        toolDiffInLog,
        summary: notDeployedSummary(gate.end.reason, gate.checked),
        setup,
      };
    case "rehearsed":
      // The row is the fresh preview, pending with its box, and it never
      // said deploying.
      log.info(
        `The fresh preview gives diff hash ${gate.hash}, the one the tick approved. This is a rehearsal (dry-run: true), so nothing is deployed.`,
      );
      return {
        end: gate.end,
        row: gate.checked,
        toolDiffInLog,
        summary: { kind: "rehearsed", diff: gate.checked.diff },
        setup,
      };
    case "deploy":
      break;
  }
  const fresh = gate.checked;
  log.info(`The fresh preview gives diff hash ${gate.hash}, the one the tick approved. Deploying.`);

  // The row says deploying, no longer waiting to start (record 0027), for as
  // long as the deploy takes. A failure here never stops the deploy.
  try {
    await swapRow(context, setup, id, (_facts, attribution) => ({
      state: "deploying",
      stackId: id,
      ticker: payload.ticker,
      runUrl,
      waiting: false,
      destroys: fresh.diff.changes.filter(isDestroy).length,
      deletes: fresh.diff.changes.filter((change) => change.op === "delete").length,
      attribution,
      ...(payload.onMerge ? { onMerge: true } : {}),
    }));
  } catch (error) {
    log.info(`The dashboard could not be written before the deploy: ${message(error)}`);
  }

  progress.deploying = true;
  const deployStarted = context.now();
  const limit = deployLimit(tool.run, context.deployTimeoutMinutes);
  let deployed: Awaited<ReturnType<Adapter["apply"]>>;
  try {
    deployed = await adapter.apply(
      setup.stack.stack,
      { ...tool, run: limit.run },
      previewed.ok ? previewed.plan : undefined,
      gate.repairDrift ? { repairDrift: true } : undefined,
    );
  } finally {
    progress.milliseconds = context.now().getTime() - deployStarted.getTime();
  }
  const result = deployEnd(deployed, limit.ranOut(), context.deployTimeoutMinutes);
  const words = lines(deployed.toolLog);
  context.log.group(`${name}: the deploy`, [
    result.kind === "deployed"
      ? "deployed"
      : `deploy failed: ${deployFailureText(result.end.reason)}`,
    ...(words.length > 0 ? ["The tool's own words:", ...words] : []),
  ]);
  switch (result.kind) {
    case "deployed":
      return {
        end: result.end,
        row: { ok: true, diff: { stackId: id, changes: [] }, toolLog: "" },
        summary: { kind: "deployed", diff: fresh.diff },
        setup,
      };
    case "moved":
      // What would go out is no longer what the fresh preview saw (record
      // 0058). Nothing went out, and the row is pending.
      return {
        end: result.end,
        failed: notDeployed(
          result.end.reason,
          " What the deploy would install changed after the fresh preview, so nothing was deployed. The job log says what.",
        ),
        row: fresh,
        toolDiffInLog,
        summary: notDeployedSummary(result.end.reason, fresh),
        setup,
      };
    case "failed": {
      // The stack may be half deployed, so the row comes from a preview of
      // what is left. A second tick then deploys the rest.
      const after = await preview();
      logPreview(context, id, "The preview after the failed deploy", after);
      return {
        end: result.end,
        failed: notDeployed(result.end.reason, " The job log holds the tool's own words."),
        row: after,
        summary: { ...notDeployedSummary(result.end.reason, fresh), after: applied(after) },
        setup,
      };
    }
  }
}

// The drift check that `apply` runs again for a tick whose hash covers drift
// (record 0055). A tool that cannot check drift fails it: the tick approved
// drift that nothing can check now.
async function checkDriftAgain(
  context: ApplyContext,
  setup: Setup,
  options: PreviewOptions,
  id: string,
): Promise<DriftResult> {
  const name = logGroupTitle(id);
  context.log.info(
    `Checked ${name} for drift again, because the diff hash the tick approved covers drift.`,
  );
  const found = (await context.adapter.detectDrift?.(setup.stack.stack, options)) ?? {
    ok: false,
    reason: { kind: "tool-error", exitCode: null },
    detail: ["The tool of this stack has no drift check."],
    toolLog: "",
  };
  const words = lines(found.toolLog);
  const own = found.ok
    ? []
    : [`drift check failed: ${previewFailureText(found.reason)}`, ...found.detail];
  if (own.length + words.length > 0) {
    context.log.group(`${name}: the drift check`, [
      ...own,
      ...(words.length > 0 ? ["The tool's own words:", ...words] : []),
    ]);
  }
  return found;
}

// Every diff in full and the tool's own words go to the job log (records 0022
// and 0037).
function logPreview(
  context: ApplyContext,
  id: string,
  what: string,
  result: PreviewResult,
  toolDiff?: ToolDiffResult,
) {
  const words = lines(result.toolLog + (toolDiff?.toolLog ?? ""));
  const title = `${logGroupTitle(id)}: ${what.toLowerCase()}`;
  const own = [
    ...(result.ok
      ? diffLogLines(result.diff)
      : [`preview failed: ${previewFailureText(result.reason)}`, ...result.detail]),
    ...toolDiffLogLines(toolDiff),
    ...(words.length > 0 ? ["The tool's own words:", ...words] : []),
  ];
  if (toolDiff?.ok) context.log.group(title, own, lines(toolDiff.text));
  else context.log.group(title, own);
}

// The summary is the run's annex: one that cannot be written never changes
// the result (record 0037).
async function writeSummary(context: ApplyContext, text: string): Promise<void> {
  try {
    await context.log.writeSummary(text);
  } catch (error) {
    context.log.info(`Writing the summary failed: ${message(error)}`);
    context.log.warning(
      "The summary of this run could not be written. The job log holds what happened.",
      "Summary not written",
    );
  }
}

// Whether the dashboard's last scan was of the commit this run is of (record
// 0102). One read of the dashboard, before the gate, because the record's end
// is written before the row is. No dashboard, or one that cannot be read, is
// not the same commit: the refusal then asks for a look and a fresh tick.
async function lastScanWasOfThisCommit(context: ApplyContext, setup: Setup): Promise<boolean> {
  try {
    const dashboard = await findDashboard(context.github, setup.config.dashboard.label);
    if (!dashboard) return false;
    return parseDashboard(dashboard.body).root?.scanSha === context.sha;
  } catch {
    return false;
  }
}

// Swaps the row block of this one stack into the dashboard (records 0004 and
// 0009). The row is made at the late read of every try, from the deployment
// records as they are then.
// Gives the number of the dashboard, or nothing when there is none.
async function swapRow(
  context: ApplyContext,
  setup: Setup,
  id: string,
  make: (
    facts: DeployFacts,
    attribution: AttributionLines | undefined,
    // The outside deploys the live body's trail lists (record 0073).
    outside: readonly OutsideDeploy[],
  ) => Row,
): Promise<number | undefined> {
  const { github, log } = context;
  const dashboard = await findDashboard(github, setup.config.dashboard.label);
  if (!dashboard) {
    log.info("There is no open dashboard to write. The next scan makes one.");
    return undefined;
  }
  const result = await swapRows(
    {
      github,
      log,
      runId: context.runId,
      repoUrl: context.repoUrl,
      actionRef: context.actionRef,
      dashboard: setup.config.dashboard,
      deploys: setup.config.deploys,
      ignored: setup.ignored,
      // The deploy freezes (record 0115), by this job's clock.
      // The clock is asked only when there is one, so the timings of a job
      // without freezes are what they were.
      freezes:
        setup.config.freezes.length === 0
          ? []
          : shownFreezes(setup.config.freezes, context.now(), setup.config.dashboard.timeZone),
      budget: context.limits?.body,
    },
    dashboard.number,
    async (live) => {
      const facts = deployFacts(
        await readDeploymentRecords(
          github,
          setup.stacks.map(({ environment }) => environment),
          [{ stackId: id, environment: setup.stack.environment }],
        ),
      );
      const attributed = await setup.attribution.attribute(
        new Map([[id, lastDeployedCommit(facts, id)]]),
      );
      const mine = make(facts, attributed.get(id)?.lines, live.outside);
      const shipped = await setup.attribution.ship(facts.trail);
      return { facts, shipped, rows: new Map([[id, mine]]) };
    },
  );
  if (!result.fits) {
    throw new Error(
      `With this row swapped the dashboard body is ${result.size.toLocaleString("en-US")} characters, and GitHub drops a body over ${BODY_LIMIT.toLocaleString("en-US")} without an error. Nothing was written. The deployment record holds the result, and the next scan brings the row in line.`,
    );
  }
  log.info(
    result.written
      ? `Wrote the dashboard (#${dashboard.number}).`
      : `The dashboard (#${dashboard.number}) already says this. Nothing was written.`,
  );
  return dashboard.number;
}

// How long the tool gets to stop by itself when the deploy ran out of time.
// Longer than a preview's: a tool that is interrupted finishes what it is
// doing to a resource and lets go of the state's lock (slice 5.9).
const DEPLOY_GRACE_MS = 120_000;

// The runner of the deploy. With the `deploy-timeout` input every run of the
// tool in the deploy gets that limit, and remembers when one ran out. Without
// it the deploy has no time limit of Sluiceway's, as before.
function deployLimit(
  run: ProcessRunner,
  minutes: number | undefined,
): { run: ProcessRunner; ranOut: () => boolean } {
  if (minutes === undefined) return { run, ranOut: () => false };
  let ranOut = false;
  return {
    run: async (one) => {
      const result = await run({
        ...one,
        timeoutMs: one.timeoutMs ?? minutes * 60_000,
        graceMs: one.graceMs ?? DEPLOY_GRACE_MS,
      });
      if (result.status === "timed-out") ranOut = true;
      return result;
    },
    ranOut: () => ranOut,
  };
}
