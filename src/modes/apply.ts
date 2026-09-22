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
import {
  applyConfig,
  type Config,
  type ConfiguredStack,
  type IgnoredStack,
  ignoredStacks,
} from "../core/config.ts";
import { loadConfig } from "../core/config-file.ts";
import {
  type DeployFacts,
  type DeploymentPayload,
  deployFacts,
  IN_SYNC_DESCRIPTION,
  isOpenStatus,
  lastDeployedCommit,
  REHEARSED_DESCRIPTION,
  readDeploymentPayload,
  standingFailure,
  taskStackId,
} from "../core/deployment.ts";
import { diffHash } from "../core/diff-hash.ts";
import {
  type DeployFailureReason,
  deployFailureText,
  previewFailureText,
} from "../core/failure-reason.ts";
import {
  applyNotification,
  DEFAULT_NOTIFY_EVENTS,
  type NotifyEvent,
  repositoryOf,
} from "../core/notify.ts";
import type { OutsideDeploy } from "../core/outside-deploy.ts";
import { shownValues } from "../core/show-values.ts";
import { stackId } from "../core/stack.ts";
import { type AttributionSource, attributionSource } from "../github/attribution.ts";
import { findDashboard } from "../github/dashboard.ts";
import { swapRows } from "../github/dashboard-write.ts";
import { readDeploymentRecords } from "../github/deployments.ts";
import { publicRepo } from "../github/event.ts";
import type { JobLog } from "../github/job-log.ts";
import { eventDashboardUrl, type StepOutputs, writeResultFile } from "../github/outputs.ts";
import type { GitHubPort } from "../github/port.ts";
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
import { movedComment } from "../render/moved-comment.ts";
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
  try {
    await applying(context, report);
  } finally {
    reportOutputs(context, report);
    await notifyOutcome(context, report);
  }
}

// The built-in notification of the outcome (record 0078), on every way out,
// as the outputs are. It never throws, so it never changes the job's result.
// A sluiceway.yaml that cannot be read, which already failed the deploy, sends
// the default events.
async function notifyOutcome(context: ApplyContext, report: ApplyReport): Promise<void> {
  if (!context.notifier) return;
  const notification = applyNotification(report.outcome ?? "failed", report.stack, {
    repository: repositoryOf(context.repoUrl),
    dashboardUrl: eventDashboardUrl(context.repoUrl, context.event),
    runUrl: runUrlOf(context.repoUrl, context.runId, context.runAttempt),
  });
  if (!notification) return;
  let events: readonly NotifyEvent[] = DEFAULT_NOTIFY_EVENTS;
  try {
    events = loadConfig(context.root).notify.events;
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

async function applying(context: ApplyContext, report: ApplyReport): Promise<void> {
  const { github, log } = context;
  const id = context.deploymentId;

  // The record comes first, before config, discovery or the tool, so a
  // refused re-run costs one request and never touches the tool or its
  // credentials (record 0019).
  let status: Awaited<ReturnType<GitHubPort["latestDeploymentStatus"]>>;
  try {
    status = await github.latestDeploymentStatus(id);
  } catch (error) {
    report.outcome = "failed";
    throw new ApplyFailedError(
      `Deployment record ${id} could not be read: ${message(error)}. ${RECORD_PERMISSIONS}`,
    );
  }
  // Every way out from here to the deploy is a record this job may not deploy.
  report.outcome = "refused";
  if (!isOpenStatus(status)) {
    log.info(
      `Deployment record ${id} already ended as ${status?.state}. Nothing is deployed. A re-run never deploys (record 0019).`,
    );
    await writeSummary(context, `## Sluiceway apply\n\n${ALREADY_ENDED}\n`);
    throw new ApplyFailedError(ALREADY_ENDED);
  }

  let task: string;
  let payload: DeploymentPayload | undefined;
  try {
    const deployment = await github.getDeployment(id);
    task = deployment.task;
    payload = readDeploymentPayload(deployment.payload);
  } catch (error) {
    report.outcome = "failed";
    throw new ApplyFailedError(
      `Deployment record ${id} could not be read: ${message(error)}. ${RECORD_PERMISSIONS}`,
    );
  }
  // A record that is not Sluiceway's, or one this version cannot read, is
  // never touched (records 0003 and 0035).
  const id_ = taskStackId(task);
  if (id_ === undefined) {
    throw new ApplyFailedError(
      `Deployment record ${id} is not one of Sluiceway's: its task does not start with "sluiceway:". Nothing was deployed and the record was left alone.`,
    );
  }
  report.stack = id_;
  const name = logGroupTitle(id_);
  if (!payload) {
    throw new ApplyFailedError(
      `Deployment record ${id} of ${name} carries a payload this version of Sluiceway cannot read. Nothing was deployed and the record was left alone.`,
    );
  }
  // A record lives as long as its run (record 0003). Deployed from another
  // run, it could be ended under a deploy that is still going.
  if (payload.run !== context.runId) {
    throw new ApplyFailedError(
      `Deployment record ${id} of ${name} belongs to run ${payload.run}, and this is run ${context.runId}. \`apply\` deploys a record only in the run whose \`resolve\` job created it. Nothing was deployed and the record was left alone.`,
    );
  }

  // A queued record is started by a later `resolve`, under a record of its
  // own run (record 0056). `resolve` never hands one on.
  if (payload.behind) {
    throw new ApplyFailedError(
      `Deployment record ${id} of ${name} is queued behind ${payload.behind.map(logGroupTitle).join(" and ")}. \`apply\` never deploys a queued record: a later \`resolve\` starts it once ${payload.behind.length === 1 ? "that stack" : "those stacks"} went out. Nothing was deployed and the record was left alone.`,
    );
  }

  report.ticker = payload.ticker;
  report.outcome = "failed";
  // The attempt of this run, so the link stays on it after a re-run (slice
  // 5.9).
  const runUrl = runUrlOf(context.repoUrl, context.runId, context.runAttempt);
  try {
    await github.createDeploymentStatus(id, { state: "in_progress", logUrl: runUrl });
  } catch (error) {
    throw new ApplyFailedError(
      `Deployment record ${id} of ${name} could not be marked in progress: ${message(error)}. Nothing was deployed. ${RECORD_PERMISSIONS}`,
    );
  }
  log.info(
    `Deployment record ${id}: ${name}, ticked by ${payload.ticker}, approved diff hash ${payload.hash}. It is in progress.`,
  );

  // From here the record is this job's, and every way out gives it a result,
  // also an error nobody planned for.
  const progress: Progress = { deploying: false };
  let attempt: Attempt;
  try {
    attempt = await deploy(context, id_, payload, runUrl, progress);
  } catch (error) {
    const reason: DeployFailureReason = progress.deploying
      ? { kind: "tool-error", exitCode: null }
      : { kind: "not-started" };
    attempt = {
      state: "failure",
      reason,
      failed: `${name} was not deployed: ${deployFailureText(reason)}. ${message(error)}`,
    };
  }
  // A deploy that went out is deployed, also when its record could not be
  // given the result. The job is red then, and says why.
  report.outcome =
    attempt.summary?.kind === "in-sync" || attempt.summary?.kind === "rehearsed"
      ? attempt.summary.kind
      : attempt.state === "success"
        ? "deployed"
        : attempt.reason?.kind === "moved" || attempt.reason?.kind === "deploys-off"
          ? "refused"
          : "failed";
  report.reason = attempt.reason && deployFailureText(attempt.reason);
  report.applied = attempt.summary;
  if (progress.milliseconds !== undefined) report.deployMilliseconds = progress.milliseconds;
  const failures: string[] = [];
  let ended = false;
  try {
    await github.createDeploymentStatus(id, {
      state: attempt.state,
      description: attempt.description ?? (attempt.reason && deployFailureText(attempt.reason)),
      logUrl: runUrl,
    });
    ended = true;
    // The headline of the job: the dot of its outcome first (slice 4.5).
    log.info(`${RESULT_DOT[report.outcome]} Deployment record ${id} ended as ${attempt.state}.`);
  } catch (error) {
    failures.push(
      `Deployment record ${id} of ${name} could not be given its result (${attempt.state}): ${message(error)}. The \`settle\` job of this run ends it. ${RECORD_PERMISSIONS}`,
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
    if (written !== undefined && attempt.reason?.kind === "moved") {
      try {
        await github.createComment(written, movedComment({ login: payload.ticker, stackId: id_ }));
      } catch (error) {
        failures.push(
          `The comment to ${payload.ticker} about the moved change could not be written: ${message(error)}. The job needs the permission \`issues: write\`.`,
        );
      }
    }
  }

  if (attempt.failed) failures.unshift(attempt.failed);
  if (failures.length > 0) throw new ApplyFailedError(failures.join("\n"));
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
  state: "success" | "failure" | "error" | "inactive";
  reason?: DeployFailureReason | undefined;
  // The status description of a result that is no failure (record 0051).
  description?: string | undefined;
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
}

function applied(result: PreviewResult): AppliedPreview {
  return result.ok
    ? { kind: "diff", diff: result.diff }
    : { kind: "preview-failed", reason: previewFailureText(result.reason) };
}

async function deploy(
  context: ApplyContext,
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
    const config = loadConfig(context.root);
    if (!config.deploys) {
      // One reviewed line stops every deploy, also one ticked before it was
      // merged (record 0051). The tool never runs.
      const reason: DeployFailureReason = { kind: "deploys-off" };
      return { state: "failure", reason, failed: notDeployed(reason) };
    }
    const found = await adapter.discover(context.root, config);
    const stacks = applyConfig(config, found);
    const stack = stacks.find((one) => stackId(one.stack) === id);
    if (!stack) {
      const reason: DeployFailureReason = { kind: "unknown-stack" };
      return {
        state: "failure",
        reason,
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
      ignored: ignoredStacks(config, found),
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
    return { state: "failure", reason, failed: notDeployed(reason, ` ${message(error)}`) };
  }

  const tool = { root: context.root, env: context.env, run: context.run };
  try {
    await adapter.checkVersion(tool, [setup.stack.stack]);
  } catch (error) {
    if (!(error instanceof ToolVersionError)) throw error;
    // The message is Sluiceway's own. What the tool printed stays in the job
    // log (record 0022).
    if (error.toolLog !== "") context.log.group("The tool's own words", lines(error.toolLog));
    const reason: DeployFailureReason = { kind: "tool-missing" };
    return { state: "failure", reason, failed: notDeployed(reason, ` ${error.message}`), setup };
  }

  // The stack's preparation, such as OpenTofu's init, before its fresh
  // preview (record 0053). A failed one is a failed fresh preview.
  const unprepared = (
    await prepareStacks({ ...tool, log, adapter }, [setup.stack], context.previewTimeoutMinutes)
  ).get(id);

  // The fresh preview: the same call as the scan's, so the hash is taken the
  // same way (records 0008 and 0015). It keeps its plan when the tool can
  // save one, so the deploy goes out exactly as it was hashed (record 0053).
  const options = {
    ...tool,
    timeoutMinutes: setup.stack.previewTimeout ?? context.previewTimeoutMinutes,
    showValues: shownValues(setup.config.dashboard),
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
  const tool = { root: context.root, env: context.env, run: context.run };
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
  // A hash that covers drift is compared with fresh drift too (records 0009
  // and 0055), so drift that moved after the tick stops the deploy.
  const drift =
    payload.drift && previewed.ok ? await checkDriftAgain(context, setup, options, id) : undefined;
  if (drift !== undefined && !drift.ok) {
    logPreview(context, id, "The fresh preview", previewed, toolDiff);
    const reason: DeployFailureReason = { kind: "preview-failed", reason: drift.reason };
    return {
      state: "failure",
      reason,
      failed: notDeployed(
        reason,
        " The drift check failed, and the diff hash the tick approved covers drift.",
      ),
      summary: {
        kind: "not-deployed",
        reason: deployFailureText(reason),
        checked: applied(previewed),
      },
      setup,
    };
  }
  const fresh: PreviewResult =
    previewed.ok && drift?.ok && drift.drift.length > 0
      ? { ...previewed, diff: { ...previewed.diff, drift: drift.drift } }
      : previewed;
  logPreview(context, id, "The fresh preview", fresh, toolDiff);
  if (!fresh.ok) {
    const reason: DeployFailureReason = { kind: "preview-failed", reason: fresh.reason };
    return {
      state: "failure",
      reason,
      failed: notDeployed(reason),
      row: fresh,
      summary: { kind: "not-deployed", reason: deployFailureText(reason), checked: applied(fresh) },
      setup,
    };
  }

  // Nothing to deploy: the stack is already as its code says, most likely
  // from a deploy outside the dashboard, which is legal (record 0016). That is
  // no moved change and no failure (record 0051). The record ends as success
  // with fixed words, the row is in sync, and the tool deploys nothing.
  if (fresh.diff.changes.length === 0 && (fresh.diff.drift ?? []).length === 0) {
    log.info(
      `The fresh preview shows no change: nothing to deploy, ${name} is already in sync. Nothing was deployed.`,
    );
    return {
      state: "success",
      description: IN_SYNC_DESCRIPTION,
      row: fresh,
      toolDiffInLog: toolDiff !== undefined,
      summary: { kind: "in-sync" },
      setup,
    };
  }

  const hash = diffHash(fresh.diff);
  if (hash !== payload.hash) {
    // The change moved since the tick (record 0008). Nothing goes out, and
    // the row shows the fresh diff, which a fresh tick can approve.
    const reason: DeployFailureReason = { kind: "moved" };
    return {
      state: "error",
      reason,
      failed: notDeployed(
        reason,
        ` The fresh preview gives diff hash ${hash} and the tick approved ${payload.hash}. The row on the dashboard shows the fresh diff. Tick it again to deploy that.`,
      ),
      row: fresh,
      toolDiffInLog: toolDiff !== undefined,
      summary: { kind: "not-deployed", reason: deployFailureText(reason), checked: applied(fresh) },
      setup,
    };
  }
  if (context.dryRun) {
    // A rehearsal stops here (record 0051): everything a deploy checks was
    // checked, and nothing goes out. The row is the fresh preview, pending
    // with its box, and it never said deploying.
    log.info(
      `The fresh preview gives diff hash ${hash}, the one the tick approved. This is a rehearsal (dry-run: true), so nothing is deployed.`,
    );
    return {
      state: "inactive",
      description: REHEARSED_DESCRIPTION,
      row: fresh,
      toolDiffInLog: toolDiff !== undefined,
      summary: { kind: "rehearsed", diff: fresh.diff },
      setup,
    };
  }
  log.info(`The fresh preview gives diff hash ${hash}, the one the tick approved. Deploying.`);

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
    }));
  } catch (error) {
    log.info(`The dashboard could not be written before the deploy: ${message(error)}`);
  }

  progress.deploying = true;
  // The deploy reads what is real first when the hash covers drift, which
  // puts the drift back as the code says (record 0055).
  const repairDrift = (fresh.diff.drift ?? []).length > 0;
  const deployStarted = context.now();
  const limit = deployLimit(tool.run, context.deployTimeoutMinutes);
  let deployed: Awaited<ReturnType<Adapter["apply"]>>;
  try {
    deployed = await adapter.apply(
      setup.stack.stack,
      { ...tool, run: limit.run },
      previewed.ok ? previewed.plan : undefined,
      repairDrift ? { repairDrift } : undefined,
    );
  } finally {
    progress.milliseconds = context.now().getTime() - deployStarted.getTime();
  }
  // Every adapter reads a run that ran out of time as a tool error without an
  // exit code. The mode knows it was the limit, and says so.
  const result: DeployResult =
    !deployed.ok && deployed.reason.kind === "tool-error" && limit.ranOut()
      ? {
          ok: false,
          reason: { kind: "timed-out", minutes: context.deployTimeoutMinutes ?? 0 },
          toolLog: deployed.toolLog,
        }
      : deployed;
  const words = lines(result.toolLog);
  context.log.group(`${name}: the deploy`, [
    result.ok ? "deployed" : `deploy failed: ${deployFailureText(result.reason)}`,
    ...(words.length > 0 ? ["The tool's own words:", ...words] : []),
  ]);
  if (result.ok) {
    return {
      state: "success",
      row: { ok: true, diff: { stackId: id, changes: [] }, toolLog: "" },
      summary: { kind: "deployed", diff: fresh.diff },
      setup,
    };
  }
  if (result.reason.kind === "moved") {
    // The adapter found, before its tool deployed anything, that what would
    // go out is no longer what the fresh preview saw (record 0058). That is a
    // moved change like any other: nothing went out, and the row is pending.
    return {
      state: "error",
      reason: result.reason,
      failed: notDeployed(
        result.reason,
        " What the deploy would install changed after the fresh preview, so nothing was deployed. The job log says what.",
      ),
      row: fresh,
      toolDiffInLog: toolDiff !== undefined,
      summary: {
        kind: "not-deployed",
        reason: deployFailureText(result.reason),
        checked: applied(fresh),
      },
      setup,
    };
  }

  // The stack may be half deployed, so the row comes from a preview of what
  // is left. A second tick then deploys the rest.
  const after = await preview();
  logPreview(context, id, "The preview after the failed deploy", after);
  return {
    state: "failure",
    reason: result.reason,
    failed: notDeployed(result.reason, " The job log holds the tool's own words."),
    row: after,
    summary: {
      kind: "not-deployed",
      reason: deployFailureText(result.reason),
      checked: applied(fresh),
      after: applied(after),
    },
    setup,
  };
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
      repoUrl: context.repoUrl,
      actionRef: context.actionRef,
      dashboard: setup.config.dashboard,
      ignored: setup.ignored,
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

// What a deploy ended with, the reason of a deploy that ran out of time
// included (slice 5.9).
type DeployResult =
  | Awaited<ReturnType<Adapter["apply"]>>
  | { ok: false; reason: { kind: "timed-out"; minutes: number }; toolLog: string };

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
