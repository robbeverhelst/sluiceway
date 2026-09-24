// The scan mode (records 0010, 0011 and 0012). It wires config, discovery, the
// scan plan, the adapter, the renderers and the GitHub port together and holds
// no rules of its own. A scan that follows a push is a narrowed scan: it
// previews the stacks the plan names and carries every other row through.
// Every other scan, and every narrowed scan that cannot trust its comparison,
// is a full scan.

import type {
  Adapter,
  DriftResult,
  PreviewResult,
  ReadDependencies,
  ToolDeploy,
  ToolDiffResult,
} from "../adapters/adapter.ts";
import { ToolVersionError } from "../adapters/adapter.ts";
import type { ProcessRunner } from "../adapters/process.ts";
import { stripAnsi } from "../adapters/tool-run.ts";
import type { Attribution } from "../core/attribution.ts";
import { sharedFiles, suggestedUnrelated } from "../core/check.ts";
import type { Config, ConfiguredStack } from "../core/config.ts";
import { withReadDependencies } from "../core/dependencies.ts";
import {
  type DeployFacts,
  deployFacts,
  lastDeployedCommit,
  type RecordEnd,
} from "../core/deployment.ts";
import { diffHash } from "../core/diff-hash.ts";
import { previewFailureText } from "../core/failure-reason.ts";
import {
  MAX_WAITING_ON_CHECKS,
  NOT_QUALIFIED,
  qualify,
  updatesWaitingOnChecks,
  type WaitingUpdate,
  waitingUpdates,
} from "../core/merge-and-deploy.ts";
import { repositoryOf, scanNotifications } from "../core/notify.ts";
import { type OnMergeWait, onMergeDeploys } from "../core/on-merge.ts";
import { resolveOnItsWay, type TickAtLateRead } from "../core/orphan-tick.ts";
import { ownRuns } from "../core/outside-deploy.ts";
import { type PoolSize, runPool } from "../core/pool.ts";
import { openRepo } from "../core/repo.ts";
import { type MatrixEntry, matrixOutput } from "../core/resolve.ts";
import {
  isFullScan,
  type LateDeploys,
  type LateWhy,
  type Listing,
  mergesAtLateRead,
  NO_DEPLOYS,
  type Placed,
  type PreviewedStack,
  type PreviewFirst,
  placeRows,
  type RowsAtLateRead,
  type ScanSoFar,
  type WaitingMerge,
} from "../core/row-placement.ts";
import {
  COMPARE_FILE_CAP,
  changedPaths,
  comparisonBase,
  type FullScanReason,
  fullScanReasonText,
  narrowsOn,
  type PreviewWhy,
  planScan,
  type ScanPlan,
  treeChanges,
  unclaimedToPlace,
} from "../core/scan-plan.ts";
import { everyPreviewFailed } from "../core/scan-result.ts";
import { shownValues } from "../core/show-values.ts";
import { type Stack, stackId } from "../core/stack.ts";
import type { Deploy } from "../core/tick-judgement.ts";
import { valueFingerprint } from "../core/value-fingerprint.ts";
import { type RunOfTheWorkflow, waitingRun } from "../core/waiting-run.ts";
import { attributionSource } from "../github/attribution.ts";
import { type DashboardResult, findDashboard } from "../github/dashboard.ts";
import {
  type DashboardWriter,
  fitScan,
  type LiveDashboard,
  liveDashboard,
  type ScanAnswer,
  type Written,
  writeScan,
} from "../github/dashboard-write.ts";
import {
  endRecord,
  openRecord,
  readDeploymentRecords,
  settleEndedRuns,
} from "../github/deployments.ts";
import { type StackEnvFilesLoad, stackEnvFiles } from "../github/env-file.ts";
import type { JobLog } from "../github/job-log.ts";
import { dashboardUrl, type StepOutputs, writeResultFile } from "../github/outputs.ts";
import type { GitHubPort } from "../github/port.ts";
import {
  type PreviewPages,
  type PreviewPageToWrite,
  previewPages,
} from "../github/preview-pages.ts";
import type { Notifier } from "../notify/send.ts";
import { BODY_LIMIT, type BudgetOptions, bodyDoesNotFitMessage } from "../render/budget.ts";
import { bulkSweepText } from "../render/bulk-box.ts";
import { whereFilesBelong } from "../render/check.ts";
import { COUNT_DOT, HEADER_DOT } from "../render/dots.ts";
import { dashboardSearchUrl, type RunLinks, runLinks, runUrl } from "../render/links.ts";
import {
  diffLogLines,
  logGroupTitle,
  PUBLIC_LOG_DIFF,
  poolSizeLine,
  toolDiffLogLines,
} from "../render/log-text.ts";
import {
  isDeployingState,
  MARKER_VERSION,
  type ParsedRow,
  parseDashboard,
  type WaitingRunFacts,
} from "../render/marker.ts";
import type { BranchPreview } from "../render/merge-row.ts";
import { renderPreviewPage } from "../render/preview-page.ts";
import { previewOutcome, previewSummary } from "../render/preview-result.ts";
import { type DashboardCounts, scanResultFile } from "../render/result-file.ts";
import { byCodeUnit, driftCounts, onMergeNote, plural } from "../render/row.ts";
import { renderSummary, type UnclaimedFiles } from "../render/summary.ts";
import { waitingRunLogLine } from "../render/waiting-run.ts";
import { previewBranches } from "./branch-preview.ts";
import { readHistories } from "./outside-deploys.ts";
import { prepareStacks } from "./prepare.ts";

// Everything a scan needs, handed in as data and seams (build plan, section
// 5): the port, the process runner, the clock and the environment.
export interface ScanContext {
  // The directory of the checked-out repo.
  root: string;
  // The environment of the job, read once by the glue. The scan never looks
  // inside. The adapter hands it to the tool (record 0013).
  env: Record<string, string | undefined>;
  // The runner's `setSecret`, for the values of the env file a stack names
  // (record 0103): every one is masked before the file is named.
  mask: StackEnvFilesLoad["mask"];
  adapter: Adapter;
  run: ProcessRunner;
  github: GitHubPort;
  log: JobLog;
  now: () => Date;
  // The size of the pool, from the `concurrency` input or the cores of the
  // machine, and which of them it came from (record 0085).
  pool: PoolSize;
  // The `preview-timeout` input, in whole minutes.
  previewTimeoutMinutes: number;
  // The `strict` input: any preview failure turns the job red, after the
  // dashboard is written (slice 5.9).
  strict?: boolean | undefined;
  // `https://github.com/<owner>/<repo>`.
  repoUrl: string;
  runId: string;
  // A re-run of the run is a new attempt (record 0044).
  runAttempt: string;
  // The id of the running job. Absent where the runner does not know it.
  jobId?: string | undefined;
  // The commit the scan checked out.
  sha: string;
  // What started the run, as GitHub names it. Only "push" gives a narrowed
  // scan (record 0010), and a dispatch that names a merge (record 0064).
  event: string;
  // The pull requests `resolve` merged before it dispatched this scan, from
  // the dispatch's input. Empty for any other run (record 0064).
  afterMerge?: readonly number[] | undefined;
  // The file name of the running workflow. The orphan tick sweep asks for the
  // runs of it that an issue edit started (record 0025).
  workflow: string;
  actionRef: string;
  // The step outputs and the result file (record 0041). A test that does not
  // look at them leaves them out.
  outputs?: StepOutputs | undefined;
  // The built-in notifications (record 0078). None when the step names no
  // channel, and in a test that does not look.
  notifier?: Notifier | undefined;
  // How many requests the port has made so far, counted on the wire. The
  // scan logs it last, so the API budget of record 0017 can be read from a
  // real run. A test that does not look at it leaves it out.
  requests?: (() => number) | undefined;
  // Whether the repo is public, from the payload of the event. Absent when
  // the payload does not say (record 0048).
  publicRepo?: boolean | undefined;
  // Who pushed to the default branch, as the push event names them, when a
  // push to the default branch started this scan. It is the merge a stack
  // set to on-merge deploys on, and who that deploy is attributed to (record
  // 0095). Absent for every other scan.
  mergedBy?: string | undefined;
  // Whether a person started the run, from the sender of the event. A
  // dispatch by the workflow token (`settle`, the rescan box) is not one
  // (record 0055).
  startedByPerson?: boolean | undefined;
  // Only a test has a reason to set these.
  limits?: { body?: BudgetOptions; summaryBudget?: number } | undefined;
}

// The scan wrote a dashboard that tells the truth and still could not do its
// work (record 0012). The job goes red after the write.
export class ScanFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScanFailedError";
  }
}

interface Previewed extends PreviewedStack {
  id: string;
  milliseconds: number;
  // The tool's own diff, for the stack's group of the job log and nothing
  // else (record 0048). Only a pending stack of a scan with `scan.logDiff` on
  // has one.
  toolDiff?: ToolDiffResult | undefined;
  // The drift check of the stack, when this scan ran one (record 0055). What
  // it found is in `result` already. A failed one is only for the job log.
  drift?: DriftResult | undefined;
}

// Row placement answers "preview these first" as a value (see
// core/row-placement.ts). The builder of the write loop has no such answer, so
// the scan throws this one out of it, previews the stacks and returns to its
// late read (record 0011). It never leaves the scan.
class PreviewFirstError extends Error {
  constructor(readonly first: PreviewFirst) {
    super("More stacks have to be previewed before the dashboard can be written.");
    this.name = "PreviewFirstError";
  }
}

// The rows of a late read, or out of the builder to preview first.
function placed(answer: RowsAtLateRead): Extract<RowsAtLateRead, { kind: "placed" }> {
  if (answer.kind === "preview-first") throw new PreviewFirstError(answer);
  return answer;
}

function seconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(1)} s`;
}

function minutes(count: number): string {
  return plural(count, "minute");
}

function lines(text: string): string[] {
  const all = text.split(/\r?\n/);
  if (all.at(-1) === "") all.pop();
  return all;
}

function short(sha: string): string {
  return sha.slice(0, 7);
}

// What the outputs and the result file are made from, filled in as the scan
// gets that far.
interface ScanReport {
  startedAt?: Date;
  // Every stack previewed so far, as the summary shows them.
  previewed?: Previewed[];
  // The dashboard this scan wrote, or found already saying the same.
  dashboard?: { url: string; changed: boolean; counts: DashboardCounts };
  // The merges each stack claims, once the late read found them (record 0061).
  attributed?: Attributed;
}

export async function scan(context: ScanContext): Promise<void> {
  // The defaults of the build plan, section 3: a scan that fails before it
  // writes the dashboard still hands a notify step numbers it can read.
  context.outputs?.set("pending", "0");
  context.outputs?.set("preview-failed", "0");
  context.outputs?.set("in-sync", "0");
  context.outputs?.set("dashboard-changed", "false");
  // Only a scan after a merge hands anything to `apply` (record 0054).
  context.outputs?.set("matrix", "[]");
  const report: ScanReport = {};
  try {
    await scanning(context, report);
  } finally {
    reportOutputs(context, report);
    logRequests(context);
  }
}

// GitHub gives the workflow token 1,000 requests an hour per repo, and more
// on GitHub Enterprise Cloud (record 0017).
function logRequests(context: ScanContext): void {
  if (!context.requests) return;
  context.log.info(
    `The scan made ${plural(context.requests(), "request")} to the GitHub API. GitHub allows the workflow token at least 1,000 an hour in a repo.`,
  );
}

// The outputs are set on every way out, a red one too, from what the scan got
// as far as. The result file exists once a summary did.
function reportOutputs(context: ScanContext, report: ScanReport): void {
  const { outputs } = context;
  if (!outputs) return;
  const { dashboard, previewed, startedAt } = report;
  if (dashboard) {
    outputs.set("dashboard-url", dashboard.url);
    outputs.set("pending", String(dashboard.counts.pending));
    outputs.set("preview-failed", String(dashboard.counts.previewFailed));
    outputs.set("in-sync", String(dashboard.counts.inSync));
    outputs.set("dashboard-changed", String(dashboard.changed));
  }
  if (!previewed || !startedAt) return;
  const text = scanResultFile({
    run: runUrl(context.repoUrl, context.runId, undefined),
    commit: context.sha,
    milliseconds: context.now().getTime() - startedAt.getTime(),
    dashboard,
    stacks: previewed.map(({ id, result, milliseconds }) => ({
      // The same stacks as the summary, made the same way (records 0041 and
      // 0061).
      stack: previewSummary(id, result, report.attributed?.get(id)?.merges),
      milliseconds,
    })),
  });
  writeResultFile(outputs, context.log, "scan", text);
}

async function scanning(context: ScanContext, report: ScanReport): Promise<void> {
  const { log, now } = context;
  const startedAt = now();
  report.startedAt = startedAt;
  const at = startedAt.toISOString();
  const links = runLinks(context);
  let waitingRunFacts: { found: WaitingRunFacts | undefined } | undefined;

  // Config and discovery come first and cost no preview. An error in either
  // fails the job before the tool or GitHub is touched (record 0012). Every
  // scan runs discovery, a narrowed one too (record 0011).
  const repo = openRepo(context.root, context.adapter);
  const config = repo.config();
  const { stacks, ignored } = await repo.stacks();
  const ids = stacks.map(({ stack }) => stackId(stack));
  log.info(stacks.length === 0 ? "Found no stacks." : `Found ${plural(stacks.length, "stack")}.`);
  const { logDiff } = config.scan;
  if (logDiff && context.publicRepo) {
    log.warning(PUBLIC_LOG_DIFF.message, PUBLIC_LOG_DIFF.title);
  }
  // The env file of each stack that names one (record 0103), read once per
  // job when the stack is first previewed, prepared or read, masked first.
  const envFiles = stackEnvFiles({ root: context.root, env: context.env, mask: context.mask, log });

  // The stacks whose row showed drift at the first read (record 0055).
  const knownDrift = new Set<string>();
  const plan = await makePlan(context, config, stacks, knownDrift);
  logPlan(context, plan, stacks.length);
  const checkDrift = driftCheckRule(config, context, knownDrift, stacks);
  const planned = plan.kind === "full" ? undefined : new Set(plan.previews.map(({ id }) => id));
  const unclaimed = unclaimedFiles(plan, config);
  let next = planned ? stacks.filter(({ stack }) => planned.has(stackId(stack))) : stacks;

  // The updates waiting to merge (record 0054): read once, before the slow
  // work, and drawn at the late read, where the ticks are.
  const listing = await listUpdates(context, config, stacks);
  // With mergeAndDeploy.preview, each listed update as it would be after the
  // merge (record 0071). The tools are checked first, as for any preview.
  let versionChecked = false;
  let branchPreviews = new Map<number, BranchPreview[]>();
  if (listing.kind === "listed" && config.mergeAndDeploy.preview && listing.updates.length > 0) {
    await checkVersion(
      context,
      stacks.map(({ stack }) => stack),
    );
    versionChecked = true;
    branchPreviews = await previewBranches(context, stacks, listing.updates, envFiles);
  }
  // The records this scan opened for merged changes, handed to `apply`.
  const handedOn: MatrixEntry[] = [];
  // The stacks set to on-merge this scan opened a record for, so a later try
  // of the write loop never opens a second one (record 0095), and the ones
  // whose change waits for a tick after all, with why.
  const openedOnMerge = new Set<string>();
  let waitsOnMerge = new Map<string, OnMergeWait>();

  // Attribution (record 0026): walked once per job, shared by every stack,
  // and it never blocks.
  const attribution = attributionSource(
    context.github,
    {
      stacks: stacks.map(({ stack, inputs }) => ({ id: stackId(stack), path: stack.path, inputs })),
      unrelated: config.scan.unrelated,
      repoUrl: context.repoUrl,
      scanSha: context.sha,
      ...config.attribution,
      trailLength: config.dashboard.recentlyDeployed,
    },
    (message) =>
      log.info(
        `Attribution was left off the rows: ${message}. It only explains a row, so the scan goes on without it (record 0026).`,
      ),
  );
  let attributed: Attributed = new Map();

  const previewed = new Map<string, Previewed>();
  // The preview page of every pending stack that has one, by stack id
  // (record 0050).
  const pageUrls = new Map<string, string>();
  const pages = previewPages(context.github, context.sha);
  let rounds = 0;
  // The stacks whose preparation worked in an earlier round (record 0053).
  const prepared = new Set<string>();
  let lastPlaced: Placed | undefined;
  let written: Written & DashboardResult;
  let startedFrom: string | undefined;
  // Stacks this scan previewed a second time for a deploy that ended under it.
  const again = new Set<string>();
  // The tools' own histories, read once the scan is full (record 0073).
  let histories: Map<string, ToolDeploy[]> | undefined;
  let poolSaid = false;
  const sayPool = () => {
    if (!poolSaid) context.log.info(poolSizeLine(context.pool));
    poolSaid = true;
  };
  for (;;) {
    if (next.length > 0 && !versionChecked) {
      // The tools of every stack of the repo, once per job, so a later round
      // needs no check of its own.
      await checkVersion(
        context,
        stacks.map(({ stack }) => stack),
      );
      versionChecked = true;
    }
    const round = await previewAll(
      context,
      next,
      logDiff,
      shownValues(config.dashboard),
      config.valueFingerprint,
      prepared,
      sayPool,
      checkDrift,
      stacks.map(({ stack }) => stack),
      envFiles,
    );
    for (const one of round) previewed.set(one.id, one);
    logResults(context, round);

    // The dashboard is the product and the summary is its annex: a summary
    // that cannot be written never stops the scan (record 0037). It holds
    // every stack this scan previewed, so a later round writes it again.
    const all = [...previewed.values()].sort((a, b) => byCodeUnit(a.id, b.id));
    if (round.length > 0 || rounds === 0) {
      await writeSummary(context, all, { logDiff, unclaimed });
      report.previewed = all;
    }
    rounds++;
    await writePages(context, pages, round, pageUrls, {
      links,
      label: config.dashboard.label,
      logDiff,
    });

    // All slow work is done. The body is built from the late read: the live
    // body and the deployment records (record 0004). A fresh row for every
    // previewed stack, the live row block for every other, byte for byte
    // (record 0011), and at every stack the scan defers to fresher facts.
    // A full scan is a scan that previews every stack, whatever row each
    // stack then gets.
    const full = isFullScan({ ids, previewed });
    // Once a job, after the previews, so a run that started meanwhile is not
    // named (record 0086).
    if (waitingRunFacts === undefined) waitingRunFacts = await findWaitingRun(context, at);
    const writer: DashboardWriter = {
      github: context.github,
      runId: context.runId,
      log,
      repoUrl: context.repoUrl,
      actionRef: context.actionRef,
      dashboard: config.dashboard,
      deploys: config.deploys,
      ignored,
      budget: context.limits?.body,
    };

    // Only a full scan reads the tools' histories: after every preview, once,
    // and before the late read that matches them with the records (record
    // 0073).
    if (histories === undefined && ids.length > 0 && full) {
      histories = await readHistories(
        context,
        stacks,
        config.dashboard.recentlyDeployed,
        envFiles(stacks.map(({ stack, envFile }) => ({ id: stackId(stack), envFile }))),
      );
    }
    // What the scan has at its late read. Row placement decides every row
    // from it and the late read, and never reads or writes itself.
    const soFar: ScanSoFar = {
      ids,
      scan: {
        sha: context.sha,
        runId: context.runId,
        at,
        waitingRun: waitingRunFacts.found,
      },
      repoUrl: context.repoUrl,
      links,
      logDiff,
      readOnly: config.dashboard.readOnly,
      redact: config.dashboard.redact,
      listing,
      branchPreviews,
      previewed,
      again,
      pageUrls,
      histories,
    };

    let answer: ScanAnswer;
    try {
      // With a fresh row for every stack the body depends on the live one only
      // through the deployment records, which change a few lines. A body that
      // does not fit on its own fails the scan before any request.
      if (full) {
        const alone = placed(
          placeRows(soFar, {
            live: liveDashboard(""),
            deploys: NO_DEPLOYS,
            resolveWaits: false,
            attributed: new Map(),
          }),
        ).rows;
        const fitted = fitScan(writer, full, alone);
        if (!fitted.fits) throw new ScanFailedError(bodyDoesNotFitMessage(fitted.size));
      }
      answer = await writeScan(writer, full, async (live) => {
        // The body this scan started from, for the notifications: the first
        // late read, "" for a new dashboard. A retry reads the scan's own
        // body back, which is no news.
        startedFrom ??= live.body;
        let deploys = await lateDeploys(context, stacks, previewed, live);
        // A merge that waits for this scan (record 0054). Its stack has to be
        // previewed first, and then the fresh diff goes to a record of its
        // own. Once handed on, the records are read again, so the row is made
        // from the new one.
        const merges = mergesAtLateRead(soFar, deploys.facts);
        if (merges.kind === "preview-first") throw new PreviewFirstError(merges);
        const { waiting } = merges;
        if (waiting.length > 0) {
          const ended = await handOffMerges(context, config, stacks, previewed, waiting, handedOn);
          // Before the body, so a failed write does not lose the hand-off
          // (record 0035).
          context.outputs?.set("matrix", matrixOutput(handedOn));
          if (ended) deploys = await lateDeploys(context, stacks, previewed, live);
        }
        // Stacks set to on-merge that this scan found pending go out now,
        // through the path of a tick (record 0095). After the merges, so a
        // stack a merge from the dashboard already handed on is open.
        const onMerge = onMergeDeploys(
          onMergeInput(context, config, stacks, previewed, live, deploys.facts),
        );
        waitsOnMerge = onMerge.waits;
        const fresh = onMerge.deploys.filter(({ stackId: id }) => !openedOnMerge.has(id));
        if (fresh.length > 0) {
          await handOnMerged(context, fresh, handedOn, openedOnMerge);
          context.outputs?.set("matrix", matrixOutput(handedOn));
          deploys = await lateDeploys(context, stacks, previewed, live);
        }
        attributed = await attribution.attribute(startingCommits(deploys.facts, previewed));
        const shipped = await attribution.ship(deploys.facts.trail);
        const late = placed(
          placeRows(soFar, {
            live,
            deploys,
            resolveWaits:
              !config.dashboard.readOnly && (await resolveWaits(context, live, deploys)),
            attributed,
            shipped,
            waitsOnMerge,
          }),
        );
        lastPlaced = late.placed;
        return late.rows;
      });
    } catch (error) {
      if (!(error instanceof PreviewFirstError)) throw error;
      const late = new Set(error.first.stacks.map(({ id }) => id));
      next = stacks.filter(({ stack }) => late.has(stackId(stack)));
      for (const { id, why } of error.first.stacks) {
        if (why === "deploy-ended") again.add(id);
        log.info(`${logGroupTitle(id)} ${PREVIEW_FIRST[why]}`);
      }
      continue;
    }
    if (answer.fits) {
      written = answer;
      break;
    }
    // A body over the hard limit is never handed to a writer (record 0028).
    // Only a fresh row can be shortened, so a scan that carries rows previews
    // those too and can then shorten everything.
    if (full) throw new ScanFailedError(bodyDoesNotFitMessage(answer.size));
    const why: FullScanReason = { kind: "does-not-fit", carried: lastPlaced?.carriedBlocks ?? 0 };
    next = stacks.filter(({ stack }) => !previewed.has(stackId(stack)));
    log.info(
      `This scan falls back to a full scan: ${fullScanReasonText(why)}. Previewing the other ${plural(next.length, "stack")} now.`,
    );
  }

  reportDashboard(context, written, lastPlaced);
  for (const [id, wait] of [...waitsOnMerge].sort(([a], [b]) => byCodeUnit(a, b))) {
    log.info(onMergeLogLine(id, wait));
  }
  report.attributed = attributed;
  report.dashboard = {
    url: dashboardUrl(context.repoUrl, written.number),
    changed: written.written,
    // The counts line of the body as written, from its row markers.
    counts: written.counts,
  };
  // Before anything can turn the job red, so a red scan still tells. A send
  // never throws (record 0078).
  await context.notifier?.send(
    scanNotifications(startedFrom ?? "", written.body, {
      repository: repositoryOf(context.repoUrl),
      dashboardUrl: report.dashboard.url,
    }),
    config.notify.events,
  );

  // The summary was written before the late read, which is where the commit
  // of a stack's last deploy comes from. Now that it is known, the summary is
  // written once more with the pull requests of every previewed stack.
  if ([...attributed.values()].some(({ merges }) => merges.length > 0)) {
    const all = [...previewed.values()].sort((a, b) => byCodeUnit(a.id, b.id));
    await writeSummary(context, all, { logDiff, unclaimed }, attributed);
  }

  const failed = [...previewed.values()].filter(({ result }) => !result.ok);
  const faults = failed
    .filter(({ result }) => !result.ok && result.reason.kind === "internal-error")
    .map(({ id }) => id)
    .sort(byCodeUnit);
  if (faults.length > 0) {
    throw new ScanFailedError(
      `The preview of ${faults.join(", ")} failed inside Sluiceway, which is a bug. The dashboard was written first and shows ${faults.length === 1 ? "it" : "them"} as a preview failure. The job log holds the error in the group of the stack. Please report it at https://github.com/sluiceway/sluiceway/issues.`,
    );
  }
  if (everyPreviewFailed(previewed.size, failed.length)) {
    throw new ScanFailedError(
      `Every preview failed (${failed.length} of ${previewed.size}). That nearly always means the environment is broken, such as missing credentials or a backend that cannot be reached. The dashboard was written first and shows a preview failure on every row of a previewed stack, which is true: nothing can be deployed either. The job log holds what the tool printed, in the group of each stack.`,
    );
  }
  if (context.strict && failed.length > 0) {
    const ids = failed.map(({ id }) => id).sort(byCodeUnit);
    throw new ScanFailedError(
      `${plural(failed.length, "preview")} failed (${ids.join(", ")}), and the strict input turns the job red on any preview failure. The dashboard was written first and shows ${failed.length === 1 ? "it" : "them"}.`,
    );
  }
}

const PREVIEW_FIRST: Record<LateWhy, string> = {
  "no-row": "is previewed now: the dashboard has no row for it any more.",
  "no-open-deployment": "is previewed now: its row says deploying and no deployment is open.",
  "deploy-ended": "is previewed again: a deploy of it ended after its preview started.",
  "orphan-tick":
    "is previewed now: its row holds an orphan tick, and only a fresh row can ask for a fresh tick.",
  merged:
    "is previewed now: a pull request for it was merged, and its deploy waits for this preview.",
};

// What attribution found, by stack id. A stack is missing when the lookup
// failed, and its row then has no such line.
type Attributed = ReadonlyMap<string, Attribution>;

// The stacks whose row gets an attribution line, each with the commit on its
// last successful deployment record: a stack this scan found pending, and a
// stack with an open deployment (record 0026).
function startingCommits(
  facts: DeployFacts,
  previewed: ReadonlyMap<string, Previewed>,
): Map<string, string | undefined> {
  const from = new Map<string, string | undefined>();
  const add = (id: string) => from.set(id, lastDeployedCommit(facts, id));
  for (const [id, { result }] of previewed)
    if (result.ok && result.diff.changes.length > 0) add(id);
  for (const [id, fact] of facts.byStack) if (fact.kind === "open") add(id);
  return from;
}

// The late read of the deployment records: bounded reads, then every open
// deployment whose run is over gets its result (record 0003). It runs inside
// the builder of the write loop, so every try sees the records as they are.
async function lateDeploys(
  context: ScanContext,
  stacks: ConfiguredStack[],
  previewed: ReadonlyMap<string, Previewed>,
  live: LiveDashboard,
): Promise<LateDeploys> {
  const { log, github } = context;
  const liveStates = new Map(live.rows.map((row) => [row.stackId, row.state] as const));
  // In sync stacks need no lookup (record 0003). A pending stack does, and so
  // does a stack whose live row says deploying.
  const fallBack = stacks
    .map(({ stack, environment }) => ({ stackId: stackId(stack), environment }))
    .filter(({ stackId: id }) => {
      const result = previewed.get(id)?.result;
      return (
        (result?.ok === true && result.diff.changes.length > 0) ||
        isDeployingState(liveStates.get(id) ?? "")
      );
    });
  try {
    const records = await readDeploymentRecords(
      github,
      stacks.map(({ environment }) => environment),
      fallBack,
    );
    const settled = await settleEndedRuns(github, records, context.repoUrl);
    for (const { stackId: id, run } of settled.ended) {
      log.info(
        `Ended the open deployment of ${logGroupTitle(id)}: run ${run} is over and never reported a result.`,
      );
    }
    return {
      facts: deployFacts(settled.records),
      settled: new Set(settled.ended.map(({ stackId: id }) => id)),
      runs: ownRuns(settled.records),
    };
  } catch (error) {
    throw new Error(
      `The deployment records could not be read: ${error instanceof Error ? error.message : error}. The scan job needs the permissions \`deployments: write\` and \`actions: read\` next to \`contents: read\` and \`issues: write\` (record 0003).`,
    );
  }
}

// A run of this workflow that has waited for a runner since ten minutes or
// more before the scan started (record 0086). It is a line on the dashboard
// and nothing else, so a read that fails leaves the line out and the scan
// goes on: it never turns the job red and never holds anything back.
async function findWaitingRun(
  context: ScanContext,
  at: string,
): Promise<{ found: WaitingRunFacts | undefined }> {
  let runs: RunOfTheWorkflow[];
  try {
    runs = await context.github.listQueuedRuns(context.workflow);
  } catch (error) {
    context.log.info(
      `The queued runs of ${context.workflow} could not be read: ${error instanceof Error ? error.message : error}. The dashboard says nothing about a run that waits for a runner this time. The scan job needs the permission \`actions: read\` (record 0086).`,
    );
    return { found: undefined };
  }
  const found = waitingRun(runs, new Date(at), context.runId);
  if (found) context.log.info(waitingRunLogLine(found, at, context.workflow, context.repoUrl));
  return { found };
}

// The other half of the orphan tick rule (record 0025): whether a run that an
// issue edit started is queued or in progress. Any `resolve` run handles every
// tick, so while one is on its way the scan keeps its hands off. Only a late
// read that meets a tick on a stack with no open deployment pays for the
// lookup, which is one request.
async function resolveWaits(
  context: ScanContext,
  live: LiveDashboard,
  deploys: LateDeploys,
): Promise<boolean> {
  const met =
    live.rows.some(
      (row) => row.known && row.ticked && deploys.facts.byStack.get(row.stackId)?.kind !== "open",
    ) ||
    live.merges.some((merge) => merge.ticked) ||
    live.bulk.some((line) => line.ticked);
  if (!met) return false;
  try {
    return resolveOnItsWay(await context.github.listIssuesRuns(context.workflow), context.runId);
  } catch (error) {
    throw new Error(
      `The runs of ${logGroupTitle(context.workflow)} that an issue edit started could not be read: ${error instanceof Error ? error.message : error}. The scan met a ticked box and has to know whether a \`resolve\` run is still on its way before it clears it. The scan job needs the permission \`actions: read\` (record 0025).`,
    );
  }
}

// The first read and the compare call (record 0010). A scan that does not
// follow a push makes neither.
async function makePlan(
  context: ScanContext,
  config: Config,
  stacks: ConfiguredStack[],
  // Filled with the stacks whose row at the first read says its hash covers
  // drift (record 0055).
  knownDrift: Set<string>,
): Promise<ScanPlan> {
  const { log } = context;
  const full = (why: FullScanReason): ScanPlan => ({ kind: "full", why });

  // Only a scan that may narrow pays for the first read.
  const afterMerge = context.afterMerge ?? [];
  const narrows = narrowsOn(context.event, afterMerge);
  if (narrows && context.event !== "push") {
    log.info(
      `This scan follows the merge of ${afterMerge.map((pr) => `#${pr}`).join(", ")} from the dashboard.`,
    );
  }
  const dashboard = narrows
    ? await findDashboard(context.github, config.dashboard.label)
    : undefined;
  const live = dashboard && parseDashboard(dashboard.body);
  for (const row of live?.rows ?? []) if (row.known && row.drift) knownDrift.add(row.stackId);
  const base = comparisonBase(context.event, live, MARKER_VERSION, afterMerge);
  if (base.kind !== "compare") return full(base);

  let comparison: Awaited<ReturnType<typeof context.github.compareCommits>>;
  try {
    comparison = await context.github.compareCommits(base.from, context.sha);
  } catch (error) {
    // GitHub's own words, about two commits. A commit it no longer has, as
    // after a force push, ends here too.
    log.info(
      `Comparing ${short(base.from)} with ${short(context.sha)} failed: ${error instanceof Error ? error.message : error}`,
    );
    return full({ kind: "compare-failed" });
  }
  let changed = changedPaths(comparison);
  if (changed.kind === "file-cap") {
    // Past the 300 files of a comparison the trees of the two commits say
    // which paths changed: two requests, whatever the number of files (slice
    // 5.9). A tree GitHub left entries out of cannot be trusted.
    const paths = await treeDiff(context, base.from);
    if (paths === undefined) return full(changed);
    log.info(
      `The comparison lists ${COMPARE_FILE_CAP} files, the most GitHub gives, so the trees of the two commits were compared: ${plural(paths.length, "file")} changed.`,
    );
    changed = { kind: "changed", paths };
  } else if (changed.kind === "changed") {
    log.info(
      `${plural(comparison.files.length, "file")} changed between ${short(base.from)}, the commit of the last scan, and ${short(context.sha)}.`,
    );
  }
  if (changed.kind !== "changed") return full(changed);

  return planScan(
    stacks.map(({ stack, inputs }) => ({ id: stackId(stack), path: stack.path, inputs })),
    changed.paths,
    config.scan.unrelated,
    live?.rows ?? [],
  );
}

// The paths the trees of the last scan's commit and the checked-out one differ
// by, or nothing when a tree could not be read whole (slice 5.9).
async function treeDiff(context: ScanContext, from: string): Promise<string[] | undefined> {
  try {
    const [base, head] = [
      await context.github.readTree(from),
      await context.github.readTree(context.sha),
    ];
    if (base.truncated || head.truncated) return undefined;
    return treeChanges(base.entries, head.entries);
  } catch (error) {
    context.log.info(
      `Reading the trees of ${short(from)} and ${short(context.sha)} failed: ${error instanceof Error ? error.message : error}`,
    );
    return undefined;
  }
}

// A file name comes from outside, so it never gets a line of its own and
// never brings a line break along.
function fileName(path: string): string {
  return logGroupTitle(path);
}

function whyText(why: PreviewWhy): string {
  switch (why.kind) {
    case "claims": {
      const [first = "", ...rest] = why.files;
      return rest.length === 0
        ? `it claims ${fileName(first)}`
        : `it claims ${fileName(first)} and ${rest.length} more changed ${rest.length === 1 ? "file" : "files"}`;
    }
    case "no-row":
      return "it has no row on the dashboard";
    case "preview-failed":
      return "its row is a preview failure";
  }
}

// The files that made a push fall back to a full scan, for the summary, with
// the globs the check would offer for them (onboarding log, hurdle 5). Nothing
// for any other scan, and nothing when only the config file changed.
function unclaimedFiles(plan: ScanPlan, config: Config): UnclaimedFiles | undefined {
  if (plan.kind !== "full" || plan.why.kind !== "unclaimed") return undefined;
  const files = unclaimedToPlace(plan.why.files);
  if (files.length === 0) return undefined;
  return {
    files: files.map(fileName),
    unrelated: config.scan.unrelated,
    suggested: suggestedUnrelated(files),
    shared: sharedFiles(files),
  };
}

// The job log says plainly whether the scan is narrowed or full, and why.
function logPlan(context: ScanContext, plan: ScanPlan, stackCount: number): void {
  const { log } = context;
  if (plan.kind === "full") {
    const { why } = plan;
    if (why.kind === "event") {
      log.info(`This is a full scan: ${fullScanReasonText(why)}.`);
      return;
    }
    // A file name comes from outside.
    const safe: FullScanReason =
      why.kind === "unclaimed" ? { kind: "unclaimed", files: why.files.map(fileName) } : why;
    log.info(
      `This is a full scan. ${context.event === "push" ? "A push" : "The scan after a merge"} gives a narrowed scan, and this one fell back to a full scan: ${fullScanReasonText(safe)}.`,
    );
    const toPlace = why.kind === "unclaimed" ? unclaimedToPlace(why.files) : [];
    if (toPlace.length > 0) {
      log.group("Changed files that no stack claims", [
        ...toPlace.map((file) => `unclaimed: ${fileName(file)}`),
        whereFilesBelong(sharedFiles(toPlace)),
      ]);
    }
    return;
  }
  const kept = stackCount - plan.previews.length;
  log.info(
    plan.previews.length === 0
      ? "This is a narrowed scan. No stack has to be previewed, so every row is kept as it is."
      : `This is a narrowed scan: it previews ${plan.previews.length} of ${plural(stackCount, "stack")}${kept > 0 ? ` and keeps the ${kept === 1 ? "row" : "rows"} of the other ${kept} as ${kept === 1 ? "it is" : "they are"}` : ""}.`,
  );
  for (const { id, why } of plan.previews) {
    log.info(`${logGroupTitle(id)} is previewed: ${whyText(why)}.`);
  }
}

async function checkVersion(context: ScanContext, stacks: Stack[]): Promise<void> {
  try {
    await context.adapter.checkVersion(
      { root: context.root, env: context.env, run: context.run },
      stacks,
    );
  } catch (error) {
    // The message is Sluiceway's own and fails the job. What the tool printed
    // stays in the job log (record 0022).
    if (error instanceof ToolVersionError && error.toolLog !== "") {
      context.log.group("The tool's own words", lines(error.toolLog));
    }
    throw error;
  }
}

// Previews through the pool, in stack id order (record 0012). How long each
// preview took and the total go to the job log, because the right pool size
// and time limit for a runner are read from those numbers.
// Which stacks a scan checks for drift (record 0055). With `drift.enabled`,
// a scan that a schedule starts, or a dispatch that a person started, checks
// every stack it previews. A dispatch by the workflow token is `settle` after
// a deploy or the rescan box, and checking there would read every real
// resource after every deploy. Any other scan checks only the stacks whose
// row showed drift at its first read, so drift that is known is not dropped
// when a push previews the stack. A stack entry turns the check on or off for
// its own stacks, and the same scans check (record 0059).
function driftCheckRule(
  config: Config,
  context: ScanContext,
  knownDrift: ReadonlySet<string>,
  stacks: readonly ConfiguredStack[],
): (id: string) => boolean {
  const enabled = new Set(
    stacks.flatMap((one) => ((one.drift ?? config.drift.enabled) ? [stackId(one.stack)] : [])),
  );
  if (enabled.size === 0) return () => false;
  const every =
    context.event === "schedule" ||
    (context.event === "workflow_dispatch" && context.startedByPerson === true);
  return (id) => enabled.has(id) && (every || knownDrift.has(id));
}

async function previewAll(
  context: ScanContext,
  stacks: ConfiguredStack[],
  logDiff: boolean,
  showValues: readonly string[],
  // The repo's `valueFingerprint` (record 0102). A stack entry may set its own.
  valueFingerprint: boolean,
  prepared: Set<string>,
  // Says the size of the pool and where it came from. It speaks once a job,
  // however many rounds preview (record 0085).
  sayPool: () => void,
  checkDrift: (id: string) => boolean,
  // Every stack of the repo, which a stack with `dependsOn: auto` may depend
  // on (record 0059).
  repoStacks: readonly Stack[],
  // The env file of each stack (record 0103).
  envFiles: ReturnType<typeof stackEnvFiles>,
): Promise<Previewed[]> {
  const { log, now, adapter } = context;
  // Nothing to preview, so a repo without stacks needs no tool, and neither
  // does a narrowed scan that keeps every row.
  if (stacks.length === 0) return [];
  const tool = { root: context.root, env: context.env, run: context.run };

  // The environment of each stack: the step's, with the stack's own env file
  // on top (record 0103). A file that could not be loaded is that stack's
  // preview failure, found by the preparation below.
  const envs = envFiles(stacks.map(({ stack, envFile }) => ({ id: stackId(stack), envFile })));
  const envOf = (id: string): Record<string, string | undefined> => {
    const own = envs.get(id);
    return own?.ok ? own.env : tool.env;
  };

  // Every preparation runs alone and before the pool (record 0053). A stack
  // whose preparation failed is a preview failure and is not previewed.
  const unprepared = stacks.filter(({ stack }) => !prepared.has(stackId(stack)));
  const failed = await prepareStacks(
    { ...tool, log, adapter },
    unprepared,
    context.previewTimeoutMinutes,
    envs,
  );
  for (const { stack } of unprepared) {
    if (!failed.has(stackId(stack))) prepared.add(stackId(stack));
  }
  const unpreparedFailures: Previewed[] = stacks.flatMap(({ stack }) => {
    const result = failed.get(stackId(stack));
    return result === undefined
      ? []
      : [{ id: stackId(stack), result, startedAt: now(), milliseconds: 0 }];
  });
  stacks = stacks.filter(({ stack }) => !failed.has(stackId(stack)));
  if (stacks.length === 0) return unpreparedFailures;

  sayPool();
  log.info(
    `Previewing ${plural(stacks.length, "stack")} with a pool of ${context.pool.size} and a time limit of ${minutes(context.previewTimeoutMinutes)} for each preview.`,
  );
  const poolStarted = now().getTime();
  const previewed = await runPool(stacks, context.pool.size, async (configured) => {
    const id = stackId(configured.stack);
    const startedAt = now();
    const started = startedAt.getTime();
    const options = {
      ...tool,
      env: envOf(id),
      run: liveRun(tool.run, id, log),
      timeoutMinutes: configured.previewTimeout ?? context.previewTimeoutMinutes,
      showValues,
      valueFingerprint: configured.valueFingerprint ?? valueFingerprint,
    };
    let previewedOnly: PreviewResult;
    try {
      previewedOnly = await adapter.preview(configured.stack, {
        ...options,
        ...(configured.dependsOnAuto ? { dependencies: repoStacks } : {}),
      });
    } catch (error) {
      // The adapter turns everything the tool can do wrong into a preview
      // failure, so an error here is a bug of Sluiceway's own. It is the
      // stack's preview failure, the other stacks go on, and the job goes red
      // after the write (slice 5.9). The error stays in the job log.
      const milliseconds = now().getTime() - started;
      const detail = lines(error instanceof Error ? (error.stack ?? String(error)) : String(error));
      const result: PreviewResult = {
        ok: false,
        reason: { kind: "internal-error" },
        detail,
        toolLog: "",
      };
      log.info(
        `Previewed ${logGroupTitle(id)} in ${seconds(milliseconds)}: ${previewOutcome(result)}`,
      );
      return { id, result, startedAt, milliseconds };
    }
    let milliseconds = now().getTime() - started;
    log.info(
      `Previewed ${logGroupTitle(id)} in ${seconds(milliseconds)}: ${previewOutcome(previewedOnly)}`,
    );
    if (previewedOnly.ok && previewedOnly.dependencies) {
      log.info(readDependenciesText(id, previewedOnly.dependencies));
    }
    // The drift check takes the same slot of the pool and the same time limit,
    // right after the preview, so one stack never runs the tool twice at once
    // (record 0055). A stack whose preview failed has no row to show drift on.
    let result = previewedOnly;
    let drift: DriftResult | undefined;
    if (previewedOnly.ok && checkDrift(id) && adapter.detectDrift) {
      const driftStarted = now().getTime();
      drift = await adapter.detectDrift(configured.stack, options);
      const took = seconds(now().getTime() - driftStarted);
      if (drift === undefined) {
        log.info(`${logGroupTitle(id)} was not checked for drift: its tool has no drift check.`);
      } else if (!drift.ok) {
        log.info(
          `Checked ${logGroupTitle(id)} for drift in ${took}: the check failed, ${previewFailureText(drift.reason)}.`,
        );
      } else {
        log.info(
          `Checked ${logGroupTitle(id)} for drift in ${took}: ${drift.drift.length === 0 ? "no drift" : driftCounts(drift.drift)}.`,
        );
        if (drift.drift.length > 0) {
          result = { ...previewedOnly, diff: { ...previewedOnly.diff, drift: drift.drift } };
        }
      }
      milliseconds = now().getTime() - started;
    }
    // The second run of the tool takes the same slot of the pool and the same
    // time limit, and only a pending stack gets one (record 0048).
    if (!logDiff || !result.ok || result.diff.changes.length === 0) {
      return { id, result, startedAt, milliseconds, drift };
    }
    const toolDiffStarted = now().getTime();
    const toolDiff = await adapter.toolDiff(configured.stack, options);
    log.info(
      `Ran the tool's own diff of ${logGroupTitle(id)} in ${seconds(now().getTime() - toolDiffStarted)}${toolDiff.ok ? "" : `: ${previewFailureText(toolDiff.reason)}`}.`,
    );
    return { id, result, startedAt, milliseconds, toolDiff, drift };
  });
  const total = now().getTime() - poolStarted;

  const addedUp = previewed.reduce((sum, { milliseconds }) => sum + milliseconds, 0);
  const slowest = previewed.reduce((a, b) => (b.milliseconds > a.milliseconds ? b : a));
  log.info(
    `Previewed ${plural(previewed.length, "stack")} in ${seconds(total)} with a pool of ${context.pool.size}. Added up, the previews took ${seconds(addedUp)}. The slowest was ${logGroupTitle(slowest.id)} with ${seconds(slowest.milliseconds)}.`,
  );
  return [...previewed, ...unpreparedFailures];
}

// The runner of one stack's previews, which puts each line the tool writes to
// stderr in the job log while it runs, behind the stack id, since previews
// run side by side (slice 5.9). The tool's words may reach the job log
// (record 0022), and stdout, which holds values, never does here. The group of
// the stack still holds them all once the pool is done.
function liveRun(run: ProcessRunner, id: string, log: JobLog): ProcessRunner {
  const prefix = `[${logGroupTitle(id)}]`;
  return (one) => run({ ...one, onStderrLine: (line) => log.info(`${prefix} ${stripAnsi(line)}`) });
}

// What a stack with `dependsOn: auto` read (record 0059). A reference to a
// stack outside the repo is said out loud, never kept silent.
function readDependenciesText(id: string, read: ReadDependencies): string {
  const named =
    read.stackIds.length === 0
      ? `${logGroupTitle(id)} reads no stack of this repo through its stack references.`
      : `${logGroupTitle(id)} reads ${read.stackIds.map(logGroupTitle).join(", ")} through its stack references.`;
  if (read.elsewhere === 0) return named;
  const one = read.elsewhere === 1;
  return `${named} ${plural(read.elsewhere, "stack reference")} ${one ? "names" : "name"} no stack of this repo that Sluiceway knows, so nothing waits on ${one ? "it" : "them"}.`;
}

// The tool's own words and every diff in full go to the job log, grouped per
// stack, on every scan (records 0022 and 0037). A preview failure is a warning
// on the run as well (record 0012).
function logResults(context: ScanContext, previewed: Previewed[]): void {
  const { log } = context;
  for (const { id, result, toolDiff, drift } of previewed) {
    const words = lines(result.toolLog + (toolDiff?.toolLog ?? "") + (drift?.toolLog ?? ""));
    const own = [
      ...(result.ok
        ? diffLogLines(result.diff)
        : [`preview failed: ${previewFailureText(result.reason)}`, ...result.detail]),
      // A failed drift check says why. What it found is in the diff above.
      ...(drift !== undefined && !drift.ok
        ? [`drift check failed: ${previewFailureText(drift.reason)}`, ...drift.detail]
        : []),
      ...toolDiffLogLines(toolDiff),
      ...(words.length > 0 ? ["The tool's own words:", ...words] : []),
    ];
    if (toolDiff?.ok) log.group(logGroupTitle(id), own, lines(toolDiff.text));
    else log.group(logGroupTitle(id), own);
  }
  for (const { id, result, drift } of previewed) {
    if (!result.ok) {
      log.warning(
        `${COUNT_DOT["preview-failed"]} The preview of ${logGroupTitle(id)} failed: ${previewFailureText(result.reason)}.`,
        "Preview failed",
      );
    }
    // Never silent: the row shows the preview alone, and the run says why
    // (record 0055).
    if (drift !== undefined && !drift.ok) {
      log.warning(
        `The drift check of ${logGroupTitle(id)} failed: ${previewFailureText(drift.reason)}. Its row shows the preview alone.`,
        "Drift check failed",
      );
    }
  }
}

// The preview page of every pending stack of a round: a check run on the
// scanned commit with the stack's diff (record 0050). A page that cannot be
// written never stops the scan. Its row's `preview` link lands where record
// 0044 or 0048 sends it, and the job log says why.
async function writePages(
  context: ScanContext,
  pages: PreviewPages,
  round: Previewed[],
  urls: Map<string, string>,
  options: { links: RunLinks; label: string; logDiff: boolean },
): Promise<void> {
  const { log } = context;
  const { links, logDiff } = options;
  const toWrite: PreviewPageToWrite[] = [];
  for (const { id, result } of round) {
    // A stack previewed again takes the page of its newest preview or none.
    urls.delete(id);
    // A pending stack, and a drifted one, whose drift the page lists like a
    // pending stack's changes (record 0059).
    if (!result.ok) continue;
    if (result.diff.changes.length === 0 && (result.diff.drift ?? []).length === 0) continue;
    const page = renderPreviewPage(
      result.diff,
      {
        dashboard: dashboardSearchUrl(context.repoUrl, options.label),
        summary: links.summary,
        log: context.jobId === undefined ? undefined : links.log,
      },
      { toolDiffInLog: logDiff },
    );
    const { title, summary, text } = page;
    toWrite.push({ stackId: id, output: { title, summary, text } });
  }
  if (toWrite.length === 0) return;

  const written = await pages.write(toWrite);
  for (const [id, url] of written.urls) urls.set(id, url);
  const fallBack =
    logDiff && context.jobId !== undefined ? "the job log" : "the summary of the scan";
  if (written.urls.size > 0) {
    log.info(
      `Wrote the preview pages of ${plural(written.urls.size, "stack")} on ${short(context.sha)}: ${written.created} created, ${written.updated} updated.`,
    );
  }
  for (const { stackId: id, message } of written.failed) {
    log.info(
      `The preview page of ${logGroupTitle(id)} could not be written: ${message}. Its preview link lands on ${fallBack}.`,
    );
  }
  const { refused } = written;
  if (!refused) return;
  if (refused.permission) {
    log.info(
      `No preview page was written: GitHub answered "${refused.message}". With \`checks: write\` in the permissions of the scan job, a pending row's preview link lands on a page of its own that shows the stack's diff (record 0050). Until then it lands on ${fallBack}.`,
    );
  } else {
    log.info(
      `GitHub answered "${refused.message}" while the preview pages were written. No more pages are written in this scan, and the preview links of ${plural(written.skipped.length, "stack")} land on ${fallBack}.`,
    );
  }
}

async function writeSummary(
  context: ScanContext,
  previewed: Previewed[],
  { logDiff, unclaimed }: { logDiff: boolean; unclaimed: UnclaimedFiles | undefined },
  attributed: Attributed = new Map(),
): Promise<void> {
  const { log } = context;
  const summary = renderSummary(
    previewed.map(({ id, result }) => previewSummary(id, result, attributed.get(id)?.merges)),
    {
      budget: context.limits?.summaryBudget,
      jobLogUrl: context.jobId === undefined ? undefined : runLinks(context).log,
      toolDiffInLog: logDiff,
      unclaimed,
    },
  );
  if (!summary.fits) {
    // GitHub would drop it whole (record 0037).
    log.warning(
      "The summary of this run is too large for GitHub even with every stack shortened as far as it goes, so it was not written. The dashboard is still brought up to date, and the job log of this run holds every diff in full.",
      "Summary not written",
    );
    return;
  }
  try {
    await log.writeSummary(summary.text);
  } catch (error) {
    log.info(`Writing the summary failed: ${error instanceof Error ? error.message : error}`);
    log.warning(
      "The summary of this run could not be written. The dashboard is still brought up to date, and the job log of this run holds every diff in full.",
      "Summary not written",
    );
  }
}

const NOTHING_ON_ITS_WAY =
  "no deployment of it is open, and no run that an issue edit started is queued or in progress";

// What the scan did with a tick, for the job log (record 0025).
function tickText(
  id: string,
  tick: Exclude<TickAtLateRead, "preview-first">,
  box: boolean,
  waits: boolean,
): string {
  switch (tick) {
    case "carry":
      return `Left the tick on ${id} alone: a run that an issue edit started is queued or in progress, and its \`resolve\` job handles every tick.`;
    case "next-scan":
      return `Left the orphan tick on ${id} for the next scan: the row is kept as it is, because a deploy of the stack ended after its preview started.`;
    case "sweep": {
      const asks = box ? "The row asks for a fresh tick." : "The row has no box any more.";
      return waits
        ? `Cleared the tick on ${id}: the row no longer shows what was ticked, so \`resolve\` has nothing to act on. ${asks}`
        : `Cleared an orphan tick on ${id}: ${NOTHING_ON_ITS_WAY}. ${asks}`;
    }
  }
}

const FOUND: Record<DashboardResult["found"], string> = {
  open: "Wrote the dashboard",
  reopened: "Reopened the dashboard and wrote it",
  created: "Created the dashboard",
};

function reportDashboard(
  context: ScanContext,
  written: Written & DashboardResult,
  lastPlaced: Placed | undefined,
): void {
  const { log } = context;
  const { shortened } = written;
  const size = `${written.body.length.toLocaleString("en-US")} of ${BODY_LIMIT.toLocaleString("en-US")} characters`;
  // The headline of the scan starts with the dot of the header state it wrote,
  // so a person scanning the log sees the result at once (slice 4.5).
  const dot = HEADER_DOT[written.header];
  log.info(
    `${dot} ${FOUND[written.found]}: ${context.repoUrl}/issues/${written.number} (${size}).`,
  );
  if (written.tries > 1) log.info(`The write took ${written.tries} tries.`);
  if (shortened > 0) log.info(`${plural(shortened, "row")} shortened to fit the size budget.`);
  const left = written.mergesLeftOut;
  if (left > 0) {
    log.info(
      `${plural(left, "more pull request")} ${left === 1 ? "qualifies" : "qualify"} and ${left === 1 ? "is" : "are"} not listed: the dashboard has no room for ${left === 1 ? "it" : "them"}. They are listed as the older ones merge.`,
    );
  }
  if (lastPlaced && lastPlaced.carried.length > 0) {
    log.info(
      `Carried ${plural(lastPlaced.carried.length, "row")} through as ${lastPlaced.carried.length === 1 ? "it was" : "they were"}, for the stacks this scan did not preview.`,
    );
  }
  for (const id of lastPlaced?.dropped ?? []) {
    log.info(`Dropped the row of ${logGroupTitle(id)}: discovery knows no such stack.`);
  }
  for (const id of lastPlaced?.deploying ?? []) {
    log.info(
      `${logGroupTitle(id)} has an open deployment, so its row says deploying and has no box, whatever the preview says.`,
    );
  }
  for (const id of lastPlaced?.deferred ?? []) {
    log.info(
      `Kept the live row of ${logGroupTitle(id)}: a deploy of it ended after its preview started.`,
    );
  }
  for (const { id, tick, box } of lastPlaced?.ticks ?? []) {
    log.info(tickText(logGroupTitle(id), tick, box, lastPlaced?.resolveWaits ?? false));
  }
  for (const { pr, tick } of lastPlaced?.mergeTicks ?? []) {
    log.info(
      tick === "carry"
        ? `Left the tick on the merge of #${pr} alone: a run that an issue edit started is queued or in progress, and its \`resolve\` job handles every tick.`
        : `Cleared an orphan tick on the merge of #${pr}: no run that an issue edit started is queued or in progress. Tick it again to merge.`,
    );
  }
  for (const line of bulkSweepText(lastPlaced?.bulk ?? [], parseDashboard(written.body).bulk)) {
    log.info(line);
  }
  const unread = lastPlaced?.unread ?? 0;
  if (unread > 0) {
    log.info(
      unread === 1
        ? "1 deployment record carries a payload this version of Sluiceway cannot read. It was left alone."
        : `${unread} deployment records carry a payload this version of Sluiceway cannot read. They were left alone.`,
    );
  }
  for (const duplicate of written.closedDuplicates) {
    log.info(`Closed #${duplicate}, a second dashboard.`);
  }
  if (written.renamed) {
    log.info(
      `Renamed the dashboard from ${JSON.stringify(written.renamed.from)} to the dashboard.title of sluiceway.yaml.`,
    );
  }
  if (written.pin === "pinned" && written.found !== "created") {
    log.info(
      "Pinned the dashboard. Set dashboard.pin: false in sluiceway.yaml to keep it unpinned.",
    );
  }
  // A dashboard that exists is pinned on every scan (slice 5.9), so a pin that
  // fails there is a line of the log, not a warning on every run.
  if (written.pin === "failed" && written.found !== "created") {
    log.info(
      `The dashboard (#${written.number}) could not be pinned. A repo holds at most three pinned issues. Set dashboard.pin: false in sluiceway.yaml to stop trying.`,
    );
  }
  if (written.pin === "failed" && written.found === "created") {
    log.warning(
      `The new dashboard (#${written.number}) could not be pinned. A repo holds at most three pinned issues. Pin it by hand if you want it at the top of the issue list.`,
      "Dashboard not pinned",
    );
  }
}

// One GraphQL query, and only when mergeAndDeploy names authors. A list that
// cannot be read never fails the scan: the updates only offer a merge, and
// `resolve` reads the pull request again before it merges one.
async function listUpdates(
  context: ScanContext,
  config: Config,
  stacks: ConfiguredStack[],
): Promise<Listing> {
  const { authors } = config.mergeAndDeploy;
  if (authors.length === 0 || !config.deploys || config.dashboard.readOnly) return { kind: "off" };
  const { log } = context;
  let open: Awaited<ReturnType<GitHubPort["listOpenPullRequests"]>>;
  try {
    open = await context.github.listOpenPullRequests();
  } catch (error) {
    log.info(
      `The open pull requests could not be read: ${error instanceof Error ? error.message : error}. The updates waiting to merge are kept as they were. The scan job needs the permission \`pull-requests: read\` (record 0054).`,
    );
    return { kind: "failed" };
  }
  const options = {
    authors,
    defaultBranch: open.defaultBranch,
    stacks: stacks.map(({ stack, inputs }) => ({ id: stackId(stack), path: stack.path, inputs })),
    unrelated: config.scan.unrelated,
    // As the config says it. `resolve` also knows what the rows read from
    // stack references, and judges again before it merges (record 0071).
    dependsOn: new Map(stacks.map((one) => [stackId(one.stack), one.dependsOn ?? []] as const)),
  };
  // A pull request by someone who is not on the list is an ordinary one and
  // gets no line.
  // Of one whose checks have not finished the log names what would still
  // stop it once they are green, when anything would (record 0081).
  for (const pullRequest of open.pullRequests) {
    const qualified = qualify(
      pullRequest.checks === "pending" ? { ...pullRequest, checks: "success" } : pullRequest,
      options,
    );
    const pending = pullRequest.checks === "pending";
    if (qualified.qualifies ? !pending : qualified.why === "author") continue;
    log.info(
      qualified.qualifies
        ? `#${pullRequest.number} is not listed to merge yet: its checks have not all finished. Its line has no box until they are green.`
        : `#${pullRequest.number} is not listed to merge: ${NOT_QUALIFIED[qualified.why]}.`,
    );
  }
  const updates = waitingUpdates(open.pullRequests, options);
  log.info(
    updates.length === 0
      ? "No pull request waits to merge."
      : `${plural(updates.length, "pull request")} ${updates.length === 1 ? "waits" : "wait"} to merge: ${updates.map(({ pullRequest }) => `#${pullRequest.number}`).join(", ")}.`,
  );
  const onChecks = updatesWaitingOnChecks(open.pullRequests, options);
  const shown = onChecks.slice(0, MAX_WAITING_ON_CHECKS);
  const numbers = (list: WaitingUpdate[]) =>
    list.map(({ pullRequest }) => `#${pullRequest.number}`).join(", ");
  if (shown.length > 0) {
    log.info(
      `${plural(shown.length, "pull request")} ${shown.length === 1 ? "waits on its checks" : "wait on their checks"}: ${numbers(shown)}.`,
    );
  }
  const rest = onChecks.slice(MAX_WAITING_ON_CHECKS);
  if (rest.length > 0) {
    log.info(
      `${plural(rest.length, "more pull request")} ${rest.length === 1 ? "waits on its checks and is" : "wait on their checks and are"} not listed: ${numbers(rest)}.`,
    );
  }
  return { kind: "listed", updates, onChecks: shown };
}

// The hand-off of record 0054. A scan of a commit that holds the merge ends
// the merge record: with nothing to deploy as in sync, with a failed preview
// or deploys turned off as failed, and otherwise as handed on, with a new
// record that carries the fresh diff hash, the ticker and this run, which
// `apply` then deploys as it deploys any tick. The fresh preview of `apply`
// and its hash check guard that deploy (record 0008). The merge record is
// ended before the new one is opened, so a hand-off is never made twice.
// Says whether it ended a record.
async function handOffMerges(
  context: ScanContext,
  config: Config,
  stacks: ConfiguredStack[],
  previewed: ReadonlyMap<string, Previewed>,
  waiting: WaitingMerge[],
  handedOn: MatrixEntry[],
): Promise<boolean> {
  const { log } = context;
  let ended = false;
  for (const { id, fact } of waiting) {
    const name = logGroupTitle(id);
    const merge = await holdsMerge(context, fact.deployment);
    if (!merge.holds) {
      if (merge.sha !== undefined) {
        log.info(
          `${name} waits for the scan of #${fact.merge}: this scan checked out ${short(context.sha)}, which does not hold the merge ${short(merge.sha)} yet.`,
        );
      }
      continue;
    }
    const stack = stacks.find(({ stack: one }) => stackId(one) === id);
    const result = previewed.get(id)?.result;
    const end = async (how: RecordEnd): Promise<void> => {
      try {
        await endRecord(context, fact.deployment, how);
      } catch (error) {
        throw new Error(
          `The deployment record ${fact.deployment} of ${name} could not be ended: ${error instanceof Error ? error.message : error}. The scan job needs the permission \`deployments: write\` (record 0054).`,
        );
      }
      ended = true;
    };
    if (!stack || !result) {
      await end({ kind: "failed", reason: { kind: "unknown-stack" } });
      log.info(
        `${name} is not in the repo any more, so the merge of #${fact.merge} deploys nothing.`,
      );
    } else if (!config.deploys) {
      await end({ kind: "failed", reason: { kind: "deploys-off" } });
      log.info(
        `#${fact.merge} is merged, and deploys are turned off in sluiceway.yaml (deploys: false). ${name} is not deployed.`,
      );
    } else if (!result.ok) {
      await end({ kind: "failed", reason: { kind: "preview-failed", reason: result.reason } });
      log.info(
        `#${fact.merge} is merged, and the preview of ${name} failed, so nothing is deployed.`,
      );
    } else if (result.diff.changes.length === 0) {
      await end({ kind: "in-sync" });
      log.info(`#${fact.merge} is merged, and ${name} has nothing to deploy.`);
    } else {
      await end({ kind: "merged" });
      const hash = diffHash(result.diff);
      try {
        const record = await openRecord(context, {
          stackId: id,
          environment: stack.environment,
          sha: context.sha,
          ticker: fact.ticker,
          hash,
          // The hash covers drift when this scan found some (record 0055).
          drift: (result.diff.drift ?? []).length > 0,
          // And the record carries the value fingerprint (record 0102).
          fingerprint: valueFingerprint(result.diff),
        });
        handedOn.push({ stack: id, environment: stack.environment, deployment: record.deployment });
        if (record.unfinished !== undefined) throw record.unfinished;
        log.info(
          `#${fact.merge} is merged: deployment record ${record.deployment} of ${name} is queued with diff hash ${hash}, ticked by ${fact.ticker}, and handed to apply.`,
        );
      } catch (error) {
        throw new Error(
          `#${fact.merge} is merged, and the deployment record that deploys ${name} could not be written: ${error instanceof Error ? error.message : error}. The scan job needs the permission \`deployments: write\` (record 0054). Nothing deploys: the row shows the stack as pending, and a tick deploys it.`,
        );
      }
    }
  }
  return ended;
}

// What the decision of record 0095 needs, from what the scan has at its late
// read. A stack whose deploy ended after its preview started keeps its live
// row (record 0004), so its preview decides nothing here either.
function onMergeInput(
  context: ScanContext,
  config: Config,
  stacks: ConfiguredStack[],
  previewed: ReadonlyMap<string, Previewed>,
  live: LiveDashboard,
  facts: DeployFacts,
): Parameters<typeof onMergeDeploys>[0] {
  const liveRows = live.current ? live.first : new Map<string, ParsedRow>();
  // `dependsOn: auto` (record 0059): what the preview read, else what the
  // row says an earlier preview read, as `resolve` reads it.
  const read = new Map<string, string[]>();
  for (const [id, { result }] of previewed) {
    if (result.ok && result.dependencies) read.set(id, result.dependencies.stackIds);
  }
  for (const [id, row] of liveRows) {
    if (!read.has(id) && row.known && row.dependsOn) read.set(id, row.dependsOn);
  }
  const { dependsOn } = withReadDependencies({
    configured: new Map(stacks.map((one) => [stackId(one.stack), one.dependsOn ?? []])),
    auto: new Set(stacks.flatMap((one) => (one.dependsOnAuto ? [stackId(one.stack)] : []))),
    read,
  });
  const open = new Set<string>();
  const fresh = new Map<string, Previewed["result"]>();
  for (const [id, one] of previewed) {
    const fact = facts.byStack.get(id);
    if (fact?.kind === "open") open.add(id);
    else if (fact === undefined || fact.at <= one.startedAt) fresh.set(id, one.result);
  }
  for (const [id, fact] of facts.byStack) if (fact.kind === "open") open.add(id);
  const livePending = new Set<string>();
  for (const [id, row] of liveRows) {
    if (!previewed.has(id) && row.known && row.state === "pending") livePending.add(id);
  }
  return {
    mergedBy: context.mergedBy,
    deploys: config.deploys,
    readOnly: config.dashboard.readOnly,
    stacks: stacks.map((one) => {
      const id = stackId(one.stack);
      return {
        id,
        environment: one.environment,
        deploy: one.deploy ?? "on-tick",
        dependsOn: dependsOn.get(id),
        phase: one.phase,
      };
    }),
    previewed: fresh,
    livePending,
    open,
    phases: config.phases,
  };
}

// The records of the stacks that deploy on merge (record 0095), opened as
// `resolve` opens the records of a tick: the first layer handed to `apply`,
// the rest queued behind it (record 0056). Stops at the first record that
// cannot be written, as `resolve` does.
async function handOnMerged(
  context: ScanContext,
  going: readonly Deploy[],
  handedOn: MatrixEntry[],
  opened: Set<string>,
): Promise<void> {
  const { log } = context;
  for (const one of going) {
    const name = logGroupTitle(one.stackId);
    try {
      const record = await openRecord(context, {
        stackId: one.stackId,
        environment: one.environment,
        sha: context.sha,
        ticker: one.ticker,
        hash: one.hash,
        behind: one.behind,
        onMerge: true,
        fingerprint: one.fingerprint,
      });
      opened.add(one.stackId);
      if (one.behind === undefined) {
        handedOn.push({
          stack: one.stackId,
          environment: one.environment,
          deployment: record.deployment,
        });
      }
      if (record.unfinished !== undefined) throw record.unfinished;
      log.info(
        one.behind === undefined
          ? `${name} deploys on merge: deployment record ${record.deployment} is queued with diff hash ${one.hash}, merged by ${one.ticker}, and handed to apply.`
          : `${name} deploys on merge: deployment record ${record.deployment} with diff hash ${one.hash}, merged by ${one.ticker}, is queued behind ${one.behind.map(logGroupTitle).join(" and ")}, and a later run starts it.`,
      );
    } catch (error) {
      throw new Error(
        `The deployment record that deploys ${name} on merge could not be written: ${error instanceof Error ? error.message : error}. The scan job needs the permission \`deployments: write\` (record 0095). Nothing more deploys on merge in this run: the row shows the stack as pending, and a tick deploys it.`,
      );
    }
  }
}

// The job log's line for a stack set to on-merge whose change waits: the
// row's note, as plain text.
function onMergeLogLine(id: string, wait: OnMergeWait): string {
  return onMergeNote(wait)
    .replace(":information_source: this stack", logGroupTitle(id))
    .replaceAll("**", "")
    .replaceAll("`", "");
}

// Whether the commit this scan checked out holds the merge commit of the
// record. A comparison that fails or is not a straight line says no, and the
// record waits for a later scan.
async function holdsMerge(
  context: ScanContext,
  deployment: number,
): Promise<{ holds: boolean; sha?: string }> {
  const { github, log } = context;
  let sha: string;
  try {
    ({ sha } = await github.getDeployment(deployment));
  } catch (error) {
    log.info(
      `Deployment record ${deployment} could not be read: ${error instanceof Error ? error.message : error}. It waits for a later scan.`,
    );
    return { holds: false };
  }
  if (sha === context.sha) return { holds: true, sha };
  let status: string;
  try {
    ({ status } = await github.compareCommits(sha, context.sha));
  } catch {
    status = "failed";
  }
  return { holds: status === "ahead" || status === "identical", sha };
}
