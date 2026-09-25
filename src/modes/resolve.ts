// The resolve mode (records 0017, 0025 and 0035): the job that an issue edit
// starts. It wires config, discovery, the walk through the edit history, the
// tick judgement, the deployment records, the renderers and the GitHub port
// together and holds no rules of its own: it reads, hands what it read to
// core/tick-judgement.ts, and acts on the verdict. It is handed no tool
// environment and no process runner, so it cannot run the tool (record 0014,
// promise 4).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Adapter } from "../adapters/adapter.ts";
import type { BulkAct } from "../core/bulk.ts";
import type { Config, ConfiguredStack, IgnoredStack } from "../core/config.ts";
import { queueState, withReadDependencies } from "../core/dependencies.ts";
import { deployState, queuedWindow, shownFreezes } from "../core/deploy-window.ts";
import { deployFacts, lastDeployedCommit, taskStackId } from "../core/deployment.ts";
import {
  type Tick as BodyTick,
  HISTORY_PAGE_SIZE,
  type NobodyReason,
  nameTickers,
  ticksIn,
} from "../core/edit-history.ts";
import {
  type MergeMethod,
  mergeMethod,
  NOT_QUALIFIED,
  type NotQualified,
} from "../core/merge-and-deploy.ts";
import { declaresMergeScanInput, MERGE_SCAN_INPUT, mergeScanInputs } from "../core/merge-scan.ts";
import { repositoryOf } from "../core/notify.ts";
import { renovateMergeSetting } from "../core/renovate-config.ts";
import { openRepo, type Repo, type RepoStacks } from "../core/repo.ts";
import { capDeploys, type MatrixEntry, matrixOutput } from "../core/resolve.ts";
import { deployableRecordsOfRun } from "../core/settle.ts";
import { stackId } from "../core/stack.ts";
import { type Stopwatch, stopwatch } from "../core/stopwatch.ts";
import {
  type AllowedMerge,
  type Clear,
  type Finding,
  handOnConfirms,
  judgeMerges,
  judgeTicks,
  knownTicks,
  type LookedUp,
  type MergeRefusal,
  mergeAnswerRefusal,
  type NamedTick,
  type OpenDeployment,
  scanAfter,
  stacksToRead,
  type TicksRead,
  ticksToLookUp,
} from "../core/tick-judgement.ts";
import { WORKFLOW_DIRECTORY } from "../core/workflow-check.ts";
import { type AttributionSource, attributionSource } from "../github/attribution.ts";
import { findDashboard, isBotIssueWithRootMarker } from "../github/dashboard.ts";
import { swapRows as swapInto, type Written } from "../github/dashboard-write.ts";
import {
  openRecord,
  readDeploymentRecords,
  settleEndedRuns,
  startQueuedRecord,
} from "../github/deployments.ts";
import { type EventIssue, editedIssue } from "../github/event.ts";
import type { JobLog } from "../github/job-log.ts";
import { dashboardUrl } from "../github/outputs.ts";
import type { GitHubPort } from "../github/port.ts";
import {
  commentOnRefusedTicks,
  judgeTicks as lookUpTickers,
  refusedTicks,
  type Tick,
} from "../github/ticks.ts";
import type { WorkflowRef } from "../github/workflow-ref.ts";
import type { Notifier } from "../notify/send.ts";
import { BODY_LIMIT, type BudgetOptions } from "../render/budget.ts";
import { bulkName } from "../render/bulk-box.ts";
import { clearTick } from "../render/clear-tick.ts";
import { runUrl as runUrlOf } from "../render/links.ts";
import { logGroupTitle } from "../render/log-text.ts";
import {
  MARKER_VERSION,
  type ParsedMerge,
  type ParsedRow,
  parseDashboard,
} from "../render/marker.ts";
import { clearMergeTick, type MergeNote } from "../render/merge-row.ts";
import type { RefusedTick } from "../render/refused-ticks.ts";
import { resolveSummary } from "../render/resolve-summary.ts";
import { byCodeUnit, plural, type Row, windowWords } from "../render/row.ts";
import { minuteAt } from "../render/time.ts";
import { type ResolvePart, resolveTimingLine } from "../render/timing.ts";

export interface ResolveContext {
  // The directory of the checked-out repo.
  root: string;
  // Discovery reads files only and never asks a backend (record 0014).
  adapter: Pick<Adapter, "discover">;
  github: GitHubPort;
  log: JobLog;
  // `https://github.com/<owner>/<repo>`.
  repoUrl: string;
  runId: string;
  // The attempt of the run, kept on the records it creates so a link lands
  // on it after a re-run (slice 5.9). Absent in a test that does not look.
  runAttempt?: string | undefined;
  // The commit the job checked out: the head of the default branch, because an
  // `issues` event always runs there (record 0003).
  sha: string;
  actionRef: string;
  // The payload of the event that woke the job. Only a wake-up (record 0025).
  event: unknown;
  // The workflow the rescan box dispatches, or nothing when the runner did not
  // say which one this is.
  workflow: WorkflowRef | undefined;
  setOutput: (name: string, value: string) => void;
  // The built-in notifications (record 0078). None when the step names no
  // channel.
  notifier?: Notifier | undefined;
  // Only a test has a reason to set this.
  limits?: { body?: BudgetOptions } | undefined;
  // The clock of the timing line (slice 5.23). Without it there is none: a
  // test that does not look leaves it out.
  now?: (() => Date) | undefined;
  // Milliseconds from the start of the process to the start of `resolve`,
  // for the timing line, when the step knows it.
  startup?: number | undefined;
}

// Where `resolve`'s time goes, part by part.
type Watch = Stopwatch<ResolvePart>;

// What `resolve` tells auto mode beyond `matrix` (record 0109): how many of
// the deploys it handed on were outside records, which another writer opened
// for this run. A dispatched run that handed on nothing else skips its scan.
export interface ResolveOutcome {
  outsideRecords: number;
}

// `resolve` always sets `matrix`, to `[]` when it started nothing (record
// 0035), also when it fails before it got that far.
export async function resolve(context: ResolveContext): Promise<ResolveOutcome> {
  let handedOn = false;
  const handOn = (entries: readonly MatrixEntry[]) => {
    context.setOutput("matrix", matrixOutput(entries));
    handedOn = true;
  };
  // What the job log says once the run acts on the dashboard, for the job
  // summary (slice 5.9). An edit of any other issue writes none.
  const report: RunReport = { acting: false, lines: [], scanStarted: false, outsideRecords: 0 };
  const watch: Watch = stopwatch(context.now ?? (() => new Date(0)));
  const recording: ResolveContext = {
    ...context,
    log: {
      ...context.log,
      info: (line) => {
        if (report.acting) report.lines.push(line);
        context.log.info(line);
      },
    },
  };
  try {
    await resolveTicks(recording, handOn, report, watch);
  } finally {
    if (!handedOn) handOn([]);
    if (report.acting) await writeRunSummary(context, report);
    // The job log only, not the summary: it is about Sluiceway, not the
    // dashboard (slice 5.23).
    if (report.acting && context.now) {
      context.log.info(
        resolveTimingLine({
          total: watch.total(),
          parts: watch.parts(),
          startup: context.startup,
        }),
      );
    }
  }
  return { outsideRecords: report.outsideRecords };
}

// The cheap check of record 0017, as one line for the job log, or nothing
// when the edited issue is the dashboard. The half that needs no config comes
// first, so a broken `sluiceway.yaml` never turns an edit of an ordinary issue
// red: `config` is asked only for the second half. Auto mode asks the same
// question before it starts `resolve` (record 0077).
export function notTheDashboardText(issue: EventIssue, config: () => Config): string | undefined {
  const text = `Issue #${issue.number} is not the open dashboard. Nothing to do.`;
  if (issue.state !== "open" || !isBotIssueWithRootMarker(issue)) return text;
  return issue.labels.includes(config().dashboard.label) ? undefined : text;
}

// What goes on the job summary of `resolve` (slice 5.9).
interface RunReport {
  // The run got as far as a dashboard, or as the records it may start.
  acting: boolean;
  lines: string[];
  scanStarted: boolean;
  // The page of the scan it started, when GitHub named it.
  scanUrl?: string | undefined;
  // The outside records it handed on (record 0109).
  outsideRecords: number;
}

// A summary that cannot be written never turns the job red: the job log
// holds all of it.
async function writeRunSummary(context: ResolveContext, report: RunReport): Promise<void> {
  try {
    await context.log.writeSummary(
      resolveSummary({
        lines: report.lines,
        scanUrl: report.scanUrl,
        scanStarted: report.scanStarted,
      }),
    );
  } catch (error) {
    context.log.info(`The job summary could not be written: ${message(error)}`);
  }
}

// How often the body and the history are read when the body moved between
// the read and the walk (record 0025). Every edit by a person wakes another
// run, so a tick that is still moving then is that run's.
const MAX_READS = 3;

// A deploy this run started: the record exists. With `behind` it is queued
// behind those stacks and not handed on (record 0056).
interface Started {
  stackId: string;
  environment: string;
  deployment: number;
  ticker: string;
  behind?: string[] | undefined;
  // Opened on merge, and `ticker` is whoever merged (record 0095).
  onMerge?: boolean | undefined;
  // Waits for the stack's deploy window, and is not handed on (record 0104).
  window?: true | undefined;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function resolveTicks(
  context: ResolveContext,
  handOn: (entries: readonly MatrixEntry[]) => void,
  report: RunReport,
  watch: Watch,
): Promise<void> {
  const { log, github } = context;
  // Read once, whichever way the run goes.
  const repo = timedRepo(openRepo(context.root, context.adapter), watch);

  // The cheap check (record 0017): the edited issue is judged from the payload
  // alone, green and without an API call, because `issues.edited` fires for
  // every issue of the repo. The half that needs no config comes first, so a
  // broken `sluiceway.yaml` never turns an edit of an ordinary issue red.
  const issue = editedIssue(context.event);
  if (!issue) {
    report.acting = true;
    await startQueued(context, repo, handOn, watch, report);
    return;
  }
  const notTheDashboard = notTheDashboardText(issue, repo.config);
  if (notTheDashboard !== undefined) {
    log.info(notTheDashboard);
    return;
  }
  const config = repo.config();
  report.acting = true;

  // Nothing else is taken from the payload (record 0025). The body and the
  // history come from one query, so they describe one moment, and the run acts
  // on every ticked row it finds, whoever's edit woke it.
  let stacks: Map<string, ConfiguredStack> | undefined;
  let ignored: IgnoredStack[] = [];
  let named: NamedTick[] = [];
  let liveRows: ParsedRow[] = [];
  for (let reads = 1; ; reads++) {
    const first = await watch.time("dashboard", () =>
      github.readEditHistory(issue.number, {
        size: HISTORY_PAGE_SIZE,
        after: undefined,
      }),
    );
    const { root, rows } = parseDashboard(first.body);
    liveRows = rows;
    if (!root) {
      log.info(`The body of #${issue.number} has no root marker any more. Nothing to do.`);
      return;
    }
    if (root.version !== MARKER_VERSION) {
      // A body of another version is not touched (record 0009). The scan
      // writes it again in its own version and clears the ticks on it.
      log.info(
        `The dashboard is written in marker version ${root.version} and this is version ${MARKER_VERSION}. Its body is left alone, and a full scan is started to write it again.`,
      );
      report.scanUrl = await dispatchScan(context);
      report.scanStarted = true;
      if (report.scanUrl) log.info(`Started a full scan: ${report.scanUrl}`);
      return;
    }
    const ticks = ticksIn(first.body);
    if (ticks.length === 0) {
      log.info("No box is ticked. Nothing to do.");
      return;
    }

    // Discovery reads files only (record 0014).
    if (!stacks) ({ stacks, ignored } = byId(await repo.stacks()));
    const { known, unknown } = knownTicks(ticks, stacks);
    for (const { tick, stackIds } of unknown) {
      log.info(
        `${tick.kind === "merge" ? `${tickName(tick)} is ticked, and discovery knows no stack ${stackIds.map(logGroupTitle).join(" or ")}` : `${tickName(tick)} is ticked, and discovery knows no such stack`}. Left alone.`,
      );
    }
    const tickers = await watch.time("ticks", () =>
      nameTickers(known, (after) =>
        after === undefined
          ? Promise.resolve(first)
          : github.readEditHistory(issue.number, { size: HISTORY_PAGE_SIZE, after }),
      ),
    );
    named = known.flatMap((tick, index) => {
      const ticker = tickers[index];
      return ticker ? [{ tick, ticker }] : [];
    });
    const moved = named.some(
      ({ ticker }) => !ticker.named && ticker.reason === "not-in-newest-entry",
    );
    if (!moved || reads === MAX_READS) break;
    log.info("The body moved between the read and the walk. Reading again.");
  }
  if (!stacks) return;

  // What the rows say the previews read from stack references (record 0059).
  stacks = withRowDependencies(context, stacks, liveRows);

  // A tick on a confirm box is one tick per stack it names, by its ticker
  // (record 0083). What became of the bulk and confirm ticks is drawn by the
  // body writer, from their acts.
  const confirms = handOnConfirms({
    named,
    stacks,
    rows: liveRows,
    deploys: config.deploys,
  });
  for (const finding of confirms.findings) log.info(findingText(finding));
  named = confirms.named;

  // A stack with an open deployment is taken (record 0003).
  const open = await watch.time("records", () =>
    openDeployments(context, stacksToRead(named, stacks)),
  );
  const read: TicksRead = {
    named,
    stacks,
    open,
    rows: liveRows,
    deploys: config.deploys,
    phases: config.phases,
    // A deploy window is judged at this moment, in the dashboard zone
    // (record 0104).
    clock: { now: clockOf(context)(), timeZone: config.dashboard.timeZone },
  };
  // The lookups are the one read the judgement asks for (record 0018).
  const outcomes = await watch.time("ticks", () => lookUpTickers(github, ticksToLookUp(read)));
  const judgement = watch.time("ticks", () => judgeTicks(read, outcomes));
  for (const finding of judgement.findings) {
    log.info(findingText(finding, config.dashboard.timeZone));
  }
  const { dropped, clear, clearMerges } = judgement;
  const bulkActs = [...confirms.acts, ...judgement.bulk];

  // From here on a failure does not stop the run: what was started is handed
  // on and shown first, and the job goes red at the end.
  const failures: string[] = [];

  // The record comes first, as `queued` (record 0003): from now on the stack
  // is taken. A record without a status is an open deployment too, so one
  // whose status failed is still handed on.
  const started: Started[] = [];
  for (const one of judgement.deploys) {
    const { stackId: id, environment, ticker, hash, drift, behind, fingerprint, window } = one;
    try {
      const record = await watch.time("opening", () =>
        openRecord(context, {
          stackId: id,
          environment,
          sha: context.sha,
          ticker,
          hash,
          behind,
          drift,
          fingerprint,
          window,
        }),
      );
      started.push({
        stackId: id,
        environment,
        deployment: record.deployment,
        ticker,
        behind,
        ...(window ? { window } : {}),
      });
      if (record.unfinished !== undefined) throw record.unfinished;
      log.info(
        behind
          ? `${logGroupTitle(id)}: deployment record ${record.deployment} is queued behind ${behind.map(logGroupTitle).join(" and ")}. A later run starts it once ${behind.length === 1 ? "that stack" : "those stacks"} went out.`
          : window
            ? config.freezes.length > 0
              ? `${logGroupTitle(id)}: deployment record ${record.deployment} is queued for the deploy window or the end of a deploy freeze. The first run when both allow starts it.`
              : `${logGroupTitle(id)}: deployment record ${record.deployment} is queued for the deploy window. A run inside the window starts it.`
            : `${logGroupTitle(id)}: deployment record ${record.deployment} is queued.`,
      );
    } catch (error) {
      failures.push(
        `The deployment record of ${logGroupTitle(id)} could not be written: ${message(error)}. The resolve job needs the permission \`deployments: write\` (record 0003). No further deploy was started, and the ticks that are left stay for the next run.`,
      );
      break;
    }
  }

  // Directly after the records and before the body write, so a failed body
  // write does not lose the hand-off (record 0035).
  handOn(
    started.flatMap(({ stackId: stack, environment, deployment, behind, window }) =>
      behind || window ? [] : [{ stack, environment, deployment }],
    ),
  );

  // The merges come after the hand-off, so a merge that fails never costs a
  // deploy that was already started (record 0054).
  const merging = await mergeAll(context, config, read, judgement.merges);
  if (merging.failure !== undefined) failures.push(merging.failure);
  for (const pr of merging.cleared) clearMerges.set(pr, undefined);
  const merged = merging.merged;

  // One scan for the rescan box and for every merge (records 0017, 0054 and
  // 0064). The workflow file is read only when a merge could narrow it.
  const scan = scanAfter({
    rescan: judgement.rescan,
    merged: merging.mergedPrs,
    declaresMergeScanInput:
      merging.mergedPrs.size > 0 && declaresMergeScanInput(workflowText(context)),
  });
  if (scan.kind !== "none") {
    const narrow = scan.kind === "after-merge" && scan.narrowed;
    try {
      const scanUrl = await dispatchScan(
        context,
        scan.kind === "after-merge" && scan.narrowed ? mergeScanInputs(scan.prs) : undefined,
      );
      report.scanUrl = scanUrl;
      report.scanStarted = true;
      // The page of the scan, when GitHub named it (slice 5.9).
      const at = scanUrl === undefined ? "." : `: ${scanUrl}`;
      log.info(
        scan.kind === "rescan"
          ? `Started a full scan for the rescan box${at}`
          : narrow
            ? `Started the scan after the merge of ${scan.prs.map((pr) => `#${pr}`).join(", ")}. It previews what changed since the last scan and hands the merged change to apply.`
            : `Started a full scan, which previews the merged change and hands it to apply. It is narrowed to the merged change when ${logGroupTitle(context.workflow?.file ?? "the workflow")} declares the workflow_dispatch input ${MERGE_SCAN_INPUT} (record 0064).`,
      );
    } catch (error) {
      failures.push(message(error));
    }
  }

  // The body write comes before the comment. The comment says the box is
  // cleared, and it is only written once that is true. When the write fails
  // the boxes stay ticked, and the next run refuses them again and says so
  // then.
  let written = true;
  if (
    started.length > 0 ||
    dropped.length > 0 ||
    clear.size > 0 ||
    judgement.rescanHandled ||
    clearMerges.size > 0 ||
    merging.mergedPrs.size > 0 ||
    bulkActs.length > 0 ||
    confirms.stale
  ) {
    try {
      const result = await watch.time("body", () =>
        swapRows(context, config, [...stacks.values()], ignored, issue.number, {
          started: [...started, ...merged],
          dropped,
          clear,
          merges: { merged: merging.mergedPrs, clear: clearMerges },
          bulk: bulkActs,
        }),
      );
      log.info(
        result.written
          ? `Wrote the dashboard (#${issue.number}).`
          : `The dashboard (#${issue.number}) already says all of this. Nothing was written.`,
      );
    } catch (error) {
      written = false;
      failures.push(message(error));
    }
  }
  if (written) {
    try {
      await commentOnRefusedTicks(github, issue.number, outcomes, merging.problems);
    } catch (error) {
      failures.push(`The comment about the refused ticks could not be written: ${message(error)}.`);
    }
    // The same ticks the comment is about, in one message (record 0078). A
    // send never throws.
    const refused = refusedTicks(outcomes, merging.problems);
    if (refused.length > 0) {
      await context.notifier?.send(
        [
          {
            event: "refused",
            repository: repositoryOf(context.repoUrl),
            stacks: refusedStacks(refused),
            dashboardUrl: dashboardUrl(context.repoUrl, issue.number),
            runUrl: `${context.repoUrl}/actions/runs/${context.runId}`,
          },
        ],
        config.notify.events,
      );
    }
  }

  // An unverified tick fails closed and turns the job red (record 0018).
  if (judgement.unverified.length > 0) failures.push(unverifiedMessage(judgement.unverified));
  if (failures.length > 0) throw new Error(failures.join("\n"));
}

// One line of the job log for each thing the judgement found. The zone is
// the dashboard's, for a time the line says (record 0089).
function findingText(finding: Finding, timeZone = "UTC"): string {
  switch (finding.kind) {
    case "taken": {
      const { tick, fact } = finding;
      // Nothing is merged for a stack that is taken (record 0054). Nobody gets
      // a comment, so the row gets a note (record 0064), and the job log says
      // more.
      return tick.kind === "merge"
        ? `${tickName(tick)} is ticked, and the stack already has an open deployment, ticked by ${fact.ticker} in run ${fact.run}. Nothing is merged and the box is cleared. Tick it again once that deploy is over.`
        : `${tickName(tick)} is ticked and already has an open deployment, ticked by ${fact.ticker} in run ${fact.run}. The tick is dropped.`;
    }
    case "deploys-off": {
      // One reviewed line stops every deploy (record 0051). Nothing could go
      // out whoever ticked, so nobody is looked up and nobody is mentioned.
      const off = `${tickName(finding.tick)} is ticked, and deploys are turned off in sluiceway.yaml (deploys: false).`;
      switch (finding.tick.kind) {
        case "merge":
          return `${off} Nothing is merged and the box is cleared.`;
        case "bulk":
          return `${off} The box goes.`;
        case "confirm":
          return `${off} Nothing is deployed and the box goes.`;
        default:
          return `${off} The box is cleared.`;
      }
    }
    case "policy-failed":
      // The row has no box (record 0106), so the tick came from an edit of
      // the body. Nobody is looked up and nobody is mentioned.
      return `${tickName(finding.tick)} is ticked, and a policy failed on its change, so its row has no box. The box is cleared.`;
    case "moving":
      return `${tickName(finding.tick)} is ticked in a body that kept moving. Left for the run that edit woke.`;
    case "nameless":
      // Nobody certain to mention, so no comment, and the job stays green
      // (record 0025).
      return `${tickName(finding.tick)} is ticked and the edit history names nobody for it (${NOBODY[finding.reason]}). The box is cleared.`;
    case "not-a-person":
      return `${targetName(finding.target)} was ticked by ${finding.editor.login || "nobody"}, who is not a person. Left alone.`;
    case "allowed":
      return `${targetName(finding.target)} was ticked by ${finding.login}.`;
    case "bulk-allowed": {
      const { rows } = finding;
      const name = capitalized(bulkName("box", finding.section));
      return rows.length < 2
        ? `${name} was ticked by ${finding.login}, and the section has fewer than two rows now. Each has its own box, so the box goes.`
        : `${name} was ticked by ${finding.login}. Its confirm box names ${plural(rows.length, "stack")}: ${listed(rows)}.`;
    }
    case "refused":
      return `${targetName(finding.target)} was ticked by ${finding.login}, who may not tick it (${finding.reason}). The box is cleared.`;
    case "unverified":
      return `${targetName(finding.target)} was ticked by ${finding.login}, and GitHub gave no answer about their access: ${message(finding.error)}. The box is cleared.`;
    case "over-cap": {
      const one = finding.over === 1;
      return `One run starts at most ${finding.started} deploys. ${plural(finding.over, "tick")} beyond that ${one ? "is" : "are"} cleared and ${one ? "needs" : "need"} a fresh tick.`;
    }
    case "waits-on": {
      const words = [
        ...finding.named.map(logGroupTitle),
        ...finding.phases.flatMap(({ phase, stackIds }) =>
          stackIds.map((dependency) => `${logGroupTitle(dependency)} of the ${phase} phase`),
        ),
      ];
      const one = finding.waitingOn.length === 1;
      return `${logGroupTitle(finding.stackId)} is ticked, and it depends on ${words.join(" and ")}, which ${one ? "has a change" : "have changes"} waiting and ${one ? "is" : "are"} not ticked. The box is cleared.`;
    }
    case "window-closed":
      // A deploy freeze holds it (record 0115): the words of its row.
      if (finding.freeze !== undefined) {
        return `${logGroupTitle(finding.stackId)} is ticked during a deploy freeze. Its deployment record waits for ${windowWords({ opens: finding.opens, freeze: finding.freeze }, timeZone)}, and the first run after that starts it.`;
      }
      return `${logGroupTitle(finding.stackId)} is ticked outside its deploy window, ${finding.opens === undefined ? "and no window of it opens within a week" : `which opens ${minuteAt(finding.opens, timeZone)}`}. Its deployment record waits for the window, and a run inside the window starts it.`;
    case "confirm-stale": {
      const { tick, changes } = finding;
      const section = tick.kind === "confirm" ? tick.section : "pending";
      const what = [
        ...(changes.added.length > 0
          ? [`${listed(changes.added)} ${changes.added.length === 1 ? "is" : "are"} new`]
          : []),
        ...(changes.gone.length > 0
          ? [
              `${listed(changes.gone)} ${changes.gone.length === 1 ? "is" : "are"} not ${section === "pending" ? "pending" : "drifted"} any more`,
            ]
          : []),
        ...(changes.moved.length > 0
          ? [`${listed(changes.moved)} ${changes.moved.length === 1 ? "has" : "have"} a new diff`]
          : []),
      ];
      return `${tickName(tick)} was ticked, and its rows changed since it was drawn (${what.join(", ")}). Nothing is deployed and the bulk box asks for a fresh tick.`;
    }
    case "confirm-own-row":
      return `${logGroupTitle(finding.stackId)} is ticked on its own row too. That tick and its ticker count.`;
    case "confirm-unknown":
      return `${logGroupTitle(finding.stackId)} is in ${bulkName("confirm", finding.section)}, and discovery knows no such stack. Left alone.`;
    case "confirm-handed-on":
      return `${tickName(finding.tick)} was ticked by ${finding.login}. It stands for a tick on each of ${plural(finding.stackIds.length, "stack")}: ${listed(finding.stackIds)}.`;
  }
}

// The stacks of the refused ticks, each once, in code unit order. The rescan
// box has none.
function refusedStacks(refused: readonly RefusedTick[]): string[] {
  const ids = refused.flatMap(({ target }) =>
    target.kind === "stack" ? [target.stackId] : target.kind === "merge" ? target.stackIds : [],
  );
  return [...new Set(ids)].sort(byCodeUnit);
}

function tickName(tick: BodyTick): string {
  if (tick.kind === "row") return logGroupTitle(tick.stackId);
  if (tick.kind === "merge") {
    return `The merge of #${tick.pr} for ${tick.stackIds.map(logGroupTitle).join(" and ")}`;
  }
  if (tick.kind === "bulk") return capitalized(bulkName("box", tick.section));
  if (tick.kind === "confirm") return capitalized(bulkName("confirm", tick.section));
  return "The rescan box";
}

function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

// "a, b and c", for the job log.
function listed(ids: readonly string[]): string {
  const names = ids.map(logGroupTitle);
  return names.length < 2
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function targetName(target: Tick["target"]): string {
  if (target.kind === "stack") return logGroupTitle(target.stackId);
  if (target.kind === "merge") {
    return `The merge of #${target.pr} for ${target.stackIds.map(logGroupTitle).join(" and ")}`;
  }
  if (target.kind === "bulk") return capitalized(bulkName("box", target.section));
  return "The rescan box";
}

// What the merges of one run came to (record 0054).
interface Merging {
  // The records that deploy after a merge, one per merged pull request whose
  // record could be written. They go on the dashboard as deploying rows, and
  // not in the matrix: the scan after the merge hands them on.
  merged: Started[];
  mergedPrs: Set<number>;
  // Allowed ticks that started nothing because of their pull request. Their
  // boxes are cleared and the comment says why.
  cleared: number[];
  problems: RefusedTick[];
  // Why the job goes red. The boxes of the merges not tried stay ticked for
  // the next run.
  failure?: string | undefined;
}

// The method Renovate would use, read from its config in the checkout as
// Renovate reads it on GitHub (record 0064). The job log says where it came
// from, and names the presets that were not read.
async function renovateStrategyOf(context: ResolveContext): Promise<string | undefined> {
  const [owner = "", repo = ""] = new URL(context.repoUrl).pathname.split("/").filter(Boolean);
  const setting = await renovateMergeSetting(
    (path) => {
      try {
        return readFileSync(join(context.root, path), "utf8");
      } catch {
        return undefined;
      }
    },
    { owner, repo },
    // A preset outside the checkout is read through the GitHub API (record
    // 0071).
    (file) => context.github.readRepositoryFile(file),
  );
  const one = setting.unread.length === 1;
  const unread =
    setting.unread.length === 0
      ? ""
      : ` The ${one ? "preset" : "presets"} ${setting.unread.map(logGroupTitle).join(" and ")} ${one ? "was" : "were"} not read: a preset is read from a GitHub repo the workflow token can read, never from npm or a web address, and never with parameters.`;
  const none =
    setting.file === undefined
      ? "No Renovate config sets automergeStrategy"
      : `Renovate's config ${logGroupTitle(setting.file)} sets no automergeStrategy`;
  context.log.info(
    setting.strategy === undefined
      ? `${none}, so the method is the first the repo allows of squash, merge and rebase, as Renovate picks it.${unread}`
      : `Renovate's config is ${logGroupTitle(setting.file ?? "")}, and it sets automergeStrategy to ${logGroupTitle(setting.strategy)}.${unread}`,
  );
  return setting.strategy;
}

// Judges each allowed merge tick against the live pull request again, merges
// the ones that still qualify at the commit that was ticked, and opens a
// record for each merge (record 0054). The pull request is read again because
// the marker is text a person can edit, and checks and files may have
// changed since the scan.
async function mergeAll(
  context: ResolveContext,
  config: Config,
  read: TicksRead,
  ticks: readonly AllowedMerge[],
): Promise<Merging> {
  const { github, log } = context;
  const result: Merging = { merged: [], mergedPrs: new Set(), cleared: [], problems: [] };
  if (ticks.length === 0) return result;

  let open: Awaited<ReturnType<GitHubPort["listOpenPullRequests"]>>;
  let method: MergeMethod | undefined;
  try {
    open = await github.listOpenPullRequests();
  } catch (error) {
    result.failure = `The open pull requests could not be read: ${message(error)}. The resolve job needs the permission \`pull-requests: read\` (record 0054). Nothing was merged, and the boxes stay ticked for the next run.`;
    return result;
  }
  try {
    method = mergeMethod(await github.allowedMergeMethods(), await renovateStrategyOf(context));
  } catch (error) {
    result.failure = `The merge settings of the repo could not be read: ${message(error)}. The resolve job needs the permission \`contents: write\` to merge (record 0054). Nothing was merged, and the boxes stay ticked for the next run.`;
    return result;
  }

  const { stacks } = read;
  const verdicts = judgeMerges(
    {
      stacks,
      open: read.open,
      rows: read.rows,
      pullRequests: open.pullRequests,
      defaultBranch: open.defaultBranch,
      method,
      authors: config.mergeAndDeploy.authors,
      unrelated: config.scan.unrelated,
    },
    ticks,
  );
  for (const verdict of verdicts) {
    const { tick, ticker } = verdict;
    const name = tickName(tick);
    const target = {
      kind: "merge" as const,
      pr: tick.pr,
      stackIds: tick.stackIds,
      rule: "write" as const,
    };
    const refuse = (refusal: MergeRefusal) => {
      result.cleared.push(tick.pr);
      result.problems.push({ target, login: ticker, ...mergeProblem(refusal) });
    };
    if (!verdict.merge) {
      log.info(`${name} was ticked by ${ticker}, ${mergeRefusalText(verdict.refusal)}`);
      refuse(verdict.refusal);
      continue;
    }

    let answer: Awaited<ReturnType<GitHubPort["mergePullRequest"]>>;
    try {
      answer = await github.mergePullRequest(tick.pr, { head: tick.head, method: verdict.method });
    } catch (error) {
      result.failure = `#${tick.pr} could not be merged: ${message(error)}. The resolve job needs the permission \`contents: write\` to merge (record 0054). Nothing more was merged, and the boxes that are left stay ticked for the next run.`;
      return result;
    }
    if (!answer.merged) {
      log.info(
        `${name} was ticked by ${ticker}, and GitHub refused the merge (${answer.status}): ${answer.message}`,
      );
      refuse(mergeAnswerRefusal(answer));
      continue;
    }
    log.info(
      `${name} was ticked by ${ticker} and is merged (${verdict.method}) as ${answer.sha.slice(0, 7)}.`,
    );
    result.mergedPrs.add(tick.pr);

    // One record per stack, written on the merge commit, which waits for the
    // scan after the merge. It is not handed to `apply`: nothing was
    // previewed yet (records 0054 and 0071).
    for (const id of tick.stackIds) {
      const stack = stacks.get(id);
      if (!stack) continue;
      try {
        const record = await openRecord(context, {
          stackId: id,
          environment: stack.environment,
          sha: answer.sha,
          ticker,
          merge: tick.pr,
        });
        result.merged.push({
          stackId: id,
          environment: stack.environment,
          deployment: record.deployment,
          ticker,
        });
        if (record.unfinished !== undefined) throw record.unfinished;
        log.info(
          `${logGroupTitle(id)}: deployment record ${record.deployment} is queued and deploys after the scan of the merge.`,
        );
      } catch (error) {
        result.failure = `#${tick.pr} is merged, and the deployment record of ${logGroupTitle(id)} could not be written: ${message(error)}. The resolve job needs the permission \`deployments: write\` (record 0003). Nothing deploys for it: the scan shows the stack as pending, and a tick on its row deploys it. Nothing more was merged.`;
        return result;
      }
    }
  }
  return result;
}

// The half sentence of the job log after "... was ticked by <login>,".
function mergeRefusalText(refusal: Exclude<MergeRefusal, { kind: "refused-by-github" }>): string {
  switch (refusal.kind) {
    case "waits-on": {
      const one = refusal.stackIds.length === 1;
      return `and the stack depends on ${refusal.stackIds.map(logGroupTitle).join(" and ")}, which ${one ? "has a change" : "have changes"} waiting. Nothing is merged.`;
    }
    case "closed":
      return "and the pull request is not open any more.";
    case "head-moved":
      return "and the pull request has a new head commit since.";
    case "not-qualified":
      return `and the pull request no longer qualifies: ${notQualifiedText(refusal.why)}.`;
    case "no-method":
      return "and the repo allows no merge method.";
  }
}

function notQualifiedText(why: NotQualified | "other-stacks"): string {
  return why === "other-stacks" ? "its files belong to another stack" : NOT_QUALIFIED[why];
}

// What the comment says about a merge that started nothing (record 0054).
function mergeProblem(refusal: MergeRefusal): Pick<RefusedTick, "reason" | "detail" | "waitsOn"> {
  switch (refusal.kind) {
    case "waits-on":
      return { reason: "waits-on", detail: undefined, waitsOn: refusal.stackIds };
    case "closed":
      return { reason: "not-qualified", detail: "it is not open any more", waitsOn: undefined };
    case "head-moved":
      return { reason: "head-moved", detail: undefined, waitsOn: undefined };
    case "not-qualified":
      return { reason: "not-qualified", detail: notQualifiedText(refusal.why), waitsOn: undefined };
    case "no-method":
      return {
        reason: "merge-refused",
        detail: "the repository allows no merge method",
        waitsOn: undefined,
      };
    case "refused-by-github":
      return { reason: "merge-refused", detail: refusal.message, waitsOn: undefined };
  }
}

const NOBODY: Record<NobodyReason, string> = {
  "entry-without-body": "an entry of the edit history has no body",
  "end-of-history": "the tick is older than the edit history GitHub keeps",
  "not-in-newest-entry": "the body kept moving",
};

function runUrl(context: ResolveContext): string {
  return runUrlOf(context.repoUrl, context.runId, context.runAttempt);
}

// The clock of the run, for a deploy window (record 0104): the one a test
// injects, else the machine's.
function clockOf(context: ResolveContext): () => Date {
  return context.now ?? (() => new Date());
}

function unverifiedMessage(unverified: readonly LookedUp[]): string {
  const logins = [...new Set(unverified.map(({ tick }) => tick.editor.login))].join(", ");
  return `GitHub gave no answer about the access of ${logins}, so ${plural(unverified.length, "tick")} could not be verified. Nothing was deployed for ${unverified.length === 1 ? "it" : "them"}, and the comment on the dashboard asks for a fresh tick (record 0018).`;
}

// The stacks that exist for Sluiceway, by id, and the ones an `ignore` entry
// with a reason leaves out, which the body lists (record 0051).
interface Discovered {
  stacks: Map<string, ConfiguredStack>;
  ignored: IgnoredStack[];
}

// The repo, with the time of reading its config and of discovery on the
// timing line (slice 5.23). Both are read once, so the time is the first ask's.
function timedRepo(repo: Repo, watch: Watch): Repo {
  return {
    config: () => watch.time("config", () => repo.config()),
    stacks: () => watch.time("discovery", () => repo.stacks()),
  };
}

function byId({ stacks, ignored }: RepoStacks): Discovered {
  return { stacks: new Map(stacks.map((stack) => [stackId(stack.stack), stack])), ignored };
}

// The rescan box, and a body of another version, start a full scan by
// dispatching this same workflow (records 0009 and 0017).
// The text of the running workflow's file in the checkout, or nothing.
function workflowText(context: ResolveContext): string {
  if (!context.workflow) return "";
  try {
    return readFileSync(join(context.root, WORKFLOW_DIRECTORY, context.workflow.file), "utf8");
  } catch {
    return "";
  }
}

async function dispatchScan(
  context: ResolveContext,
  inputs?: Record<string, string>,
): Promise<string | undefined> {
  if (!context.workflow) {
    throw new Error(
      "A full scan could not be started: GITHUB_WORKFLOW_REF is not set, so this job does not know which workflow it belongs to.",
    );
  }
  try {
    return await context.github.dispatchWorkflow(
      context.workflow.file,
      context.workflow.ref,
      inputs,
    );
  } catch (error) {
    throw new Error(
      `A full scan could not be started: ${message(error)}. The resolve job needs the permission \`actions: write\`, and the workflow (${context.workflow.file}) needs a \`workflow_dispatch\` trigger that runs the scan (record 0017).`,
    );
  }
}

async function readRecords(
  context: ResolveContext,
  environments: readonly string[],
  fallBack: readonly ConfiguredStack[],
) {
  try {
    return await readDeploymentRecords(
      context.github,
      environments,
      fallBack.map(({ stack, environment }) => ({ stackId: stackId(stack), environment })),
    );
  } catch (error) {
    throw new Error(
      `The deployment records could not be read: ${message(error)}. The resolve job needs the permissions \`deployments: write\` and \`actions: read\` next to \`contents: read\` and \`issues: write\` (record 0003).`,
    );
  }
}

// The open deployments of the ticked stacks. One whose run is over gets its
// result here (record 0003), so the fresh tick on that stack is not dropped
// for a deploy that will never report.
async function openDeployments(
  context: ResolveContext,
  ticked: readonly ConfiguredStack[],
): Promise<Map<string, OpenDeployment>> {
  if (ticked.length === 0) return new Map();
  const ids = new Set(ticked.map(({ stack }) => stackId(stack)));
  const records = await readRecords(
    context,
    ticked.map(({ environment }) => environment),
    ticked,
  );
  const theirs = records.filter((record) => ids.has(taskStackId(record.task) ?? ""));
  const settled = await settleEndedRuns(context.github, theirs, context.repoUrl);
  for (const { stackId: id } of settled.ended) {
    context.log.info(
      `Ended the open deployment of ${logGroupTitle(id)}: its run is over and never reported a result.`,
    );
  }
  const open = new Map<string, OpenDeployment>();
  for (const [id, fact] of deployFacts(settled.records).byStack) {
    if (fact.kind === "open") open.set(id, fact);
  }
  return open;
}

interface Swap {
  started: readonly Started[];
  dropped: readonly string[];
  clear: ReadonlyMap<string, Clear>;
  // The merge rows of pull requests this run merged go, and the ones whose
  // box it clears stay without their tick (record 0054).
  merges?:
    | { merged: ReadonlySet<number>; clear: ReadonlyMap<number, MergeNote | undefined> }
    | undefined;
  // What became of the ticks on the bulk and confirm boxes (record 0083).
  bulk?: readonly BulkAct[] | undefined;
}

// Swaps this run's own row blocks into the dashboard (records 0004 and 0009).
// The rows are made at the late read of every try, from the deployment
// records as they are then.
async function swapRows(
  context: ResolveContext,
  config: Config,
  stacks: readonly ConfiguredStack[],
  ignored: readonly IgnoredStack[],
  issue: number,
  swap: Swap,
): Promise<Written> {
  // By `scan-sha`, so the walk is made once however many tries the write takes.
  const attribution = new Map<string, AttributionSource>();
  const result = await swapInto(
    {
      github: context.github,
      runId: context.runId,
      log: context.log,
      repoUrl: context.repoUrl,
      actionRef: context.actionRef,
      dashboard: config.dashboard,
      deploys: config.deploys,
      ignored,
      // The deploy freezes (record 0115), by this run's clock.
      freezes: shownFreezes(config.freezes, clockOf(context)(), config.dashboard.timeZone),
      budget: context.limits?.body,
    },
    issue,
    async (live, root) => {
      const droppedStacks = stacks.filter(({ stack }) => swap.dropped.includes(stackId(stack)));
      const facts = deployFacts(
        await readRecords(
          context,
          stacks.map(({ environment }) => environment),
          droppedStacks,
        ),
      );

      // A row's text is never parsed, so the line of a deploying row is worked
      // out again, up to the commit the live body was scanned at (record 0026).
      // It needs the workflow token only, and it never blocks.
      const source =
        attribution.get(root.scanSha) ??
        attributionSource(
          context.github,
          {
            stacks: stacks.map(({ stack, inputs }) => ({
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
            context.log.info(
              `Attribution was left off the rows: ${why}. It only explains a row, so nothing else changes (record 0026).`,
            ),
        );
      attribution.set(root.scanSha, source);
      const deployingIds = [
        ...swap.started.map((one) => one.stackId),
        ...swap.dropped.filter((id) => facts.byStack.get(id)?.kind === "open"),
      ];
      const lines = await source.attribute(
        new Map(deployingIds.map((id) => [id, lastDeployedCommit(facts, id)])),
      );
      const shipped = await source.ship(facts.trail);

      const rows = new Map<string, Row>();
      const carried = new Map<string, ParsedRow>();
      // What a queued row says of the deploy window, at this moment in the
      // dashboard zone (record 0104).
      const windows = new Map(
        stacks.flatMap((one) =>
          one.deployWindows ? [[stackId(one.stack), one.deployWindows] as const] : [],
        ),
      );
      const now = clockOf(context)();
      const windowOf = (id: string, record: Parameters<typeof queuedWindow>[0]) =>
        queuedWindow(record, windows.get(id), now, config.dashboard.timeZone, config.freezes);
      // `destroys` is copied from the old marker, because the header needs it
      // and the row's text is never read (record 0031). A stack whose row was
      // deleted by hand since the tick is deploying all the same, and every
      // deploying stack has a row.
      for (const one of swap.started) {
        const old = live.first.get(one.stackId);
        rows.set(one.stackId, {
          state: "deploying",
          stackId: one.stackId,
          ticker: one.ticker,
          runUrl: runUrl(context),
          // The record is `queued` until `apply` takes it.
          waiting: true,
          destroys: old?.known ? old.destroys : 0,
          deletes: old?.known ? old.deletes : undefined,
          attribution: lines.get(one.stackId)?.lines,
          behind: one.behind,
          ...(one.onMerge ? { onMerge: true } : {}),
          window: windowOf(one.stackId, one),
        });
      }
      for (const [id, row] of live.first) {
        if (!row.known || rows.has(id)) continue;
        const fact = facts.byStack.get(id);
        const wanted = swap.clear.get(id);
        if (swap.dropped.includes(id) && fact?.kind === "open" && row.state !== "deploying") {
          // A deploying row that a lost write turned back is repaired by the
          // tick that is dropped for it (record 0004).
          rows.set(id, {
            state: "deploying",
            stackId: id,
            ticker: fact.ticker,
            runUrl: runUrlOf(context.repoUrl, fact.run, fact.attempt),
            waiting: fact.waiting,
            destroys: row.destroys,
            deletes: row.deletes,
            attribution: lines.get(id)?.lines,
            behind: fact.behind,
            ...(fact.onMerge ? { onMerge: true } : {}),
            window: windowOf(id, fact),
          });
        } else if (wanted && (row.ticked || wanted.unticked) && row.hash === wanted.hash) {
          carried.set(id, clearTick(row, { note: wanted.note, unticked: wanted.unticked }));
        }
      }

      // Every other merge row is carried as it is. Of two lines for one pull
      // request the first counts.
      const merges: ParsedMerge[] = [];
      for (const merge of live.merges) {
        if (swap.merges?.merged.has(merge.pr) || merges.some((one) => one.pr === merge.pr)) {
          continue;
        }
        merges.push(
          swap.merges?.clear.has(merge.pr)
            ? clearMergeTick(merge, { note: swap.merges.clear.get(merge.pr) })
            : merge,
        );
      }
      // A confirm box is drawn after the scan of the body it goes into
      // (record 0083).
      const acts = (swap.bulk ?? []).map((act) =>
        act.outcome === "confirm" ? { ...act, scanRun: root.scanRun } : act,
      );
      return { facts, shipped, rows, carried, merges, bulk: { acts } };
    },
  );
  if (!result.fits) {
    throw new Error(
      `With these rows swapped the dashboard body is ${result.size.toLocaleString("en-US")} characters, and GitHub drops a body over ${BODY_LIMIT.toLocaleString("en-US")} without an error. Nothing was written. The deployment records hold what was started, and the next scan brings the rows in line.`,
    );
  }
  return result;
}

// `dependsOn: auto` (record 0059): a stack with auto depends on what the file
// names and on what its row says its last preview read from the program's
// stack references. A read that would close a circle is dropped and said.
function withRowDependencies(
  context: ResolveContext,
  stacks: Map<string, ConfiguredStack>,
  rows: readonly ParsedRow[],
): Map<string, ConfiguredStack> {
  const auto = new Set(
    [...stacks.values()].flatMap((one) => (one.dependsOnAuto ? [stackId(one.stack)] : [])),
  );
  if (auto.size === 0) return stacks;
  const read = new Map<string, string[]>();
  for (const row of rows) {
    if (row.known && row.dependsOn && !read.has(row.stackId)) read.set(row.stackId, row.dependsOn);
  }
  const { dependsOn, dropped } = withReadDependencies({
    configured: new Map([...stacks].map(([id, one]) => [id, one.dependsOn ?? []])),
    auto,
    read,
  });
  for (const { stackId: id, dependency } of dropped) {
    context.log.info(
      `${logGroupTitle(id)} reads ${logGroupTitle(dependency)} through its stack references, and ${logGroupTitle(dependency)} already depends on ${logGroupTitle(id)}. That would be a circle, so ${logGroupTitle(id)} does not wait on ${logGroupTitle(dependency)}.`,
    );
  }
  return new Map(
    [...stacks].map(([id, one]) => {
      const ids = dependsOn.get(id) ?? [];
      const { dependsOn: _, ...rest } = one;
      return [id, ids.length === 0 ? rest : { ...rest, dependsOn: ids }];
    }),
  );
}

// A `resolve` that no issue edit started: the one `settle` starts, the one a
// schedule starts, and any other dispatch of the workflow (records 0056, 0104
// and 0109). It reads the records of every environment the stacks use, one
// page each (record 0003), and hands two kinds of record to `apply`. An
// outside record (record 0109): one that names this run already and waits for
// nothing, which a writer other than Sluiceway opened before the run got
// here, so it goes on as it is. And every queued stack whose dependencies
// went out and whose deploy window is open, under a new record of this run,
// because `apply` deploys only a record of the run it is part of (record
// 0035). The approved hash and the ticker go on unchanged in both: the ticker
// was checked when the tick was made, or is the outside writer's word, and
// every record `apply` takes is trusted the same way. The old queued record
// ends as `inactive`, "started in a later run", which is no deploy fact.
async function startQueued(
  context: ResolveContext,
  repo: Repo,
  handOn: (entries: readonly MatrixEntry[]) => void,
  watch: Watch,
  report: RunReport,
): Promise<void> {
  const { log, github } = context;
  const config = repo.config();
  // A phase gives dependencies too (record 0067), and a deploy window makes
  // a record wait as well (record 0104), and so does a deploy freeze (record
  // 0115).
  const windowed =
    config.deployWindows.length > 0 ||
    config.freezes.length > 0 ||
    config.stacks.some(({ deployWindows }) => (deployWindows?.length ?? 0) > 0);
  const chained = config.stacks.some(
    ({ dependsOn, phase }) => dependsOn !== undefined || phase !== undefined,
  );
  const { stacks, ignored } = byId(await repo.stacks());
  const all = [...stacks.values()];
  // A stack with auto may depend on any stack, and only its row knows which
  // (record 0059). A record that may sit past the page is one of theirs: the
  // REST fall back asks for them (record 0003). An outside record is fresh
  // and on the page.
  const anyAuto = all.some(({ dependsOnAuto }) => dependsOnAuto);
  const involved =
    windowed || chained
      ? all.filter(
          ({ stack, dependsOn, deployWindows, freezes }) =>
            anyAuto ||
            dependsOn !== undefined ||
            deployWindows !== undefined ||
            freezes !== undefined ||
            all.some((other) => other.dependsOn?.includes(stackId(stack)) === true),
        )
      : [];
  const settled = await watch.time("records", async () =>
    settleEndedRuns(
      github,
      await readRecords(
        context,
        all.map(({ environment }) => environment),
        involved,
      ),
      context.repoUrl,
    ),
  );
  for (const { stackId: id } of settled.ended) {
    log.info(`Ended the open deployment of ${logGroupTitle(id)}: it can never start now.`);
  }

  // The outside records (record 0109): only one that a listed record writer
  // opened, as GitHub names the creator, goes on. One that nobody listed
  // opened, one of a stack discovery does not know, and one of a stack whose
  // newest record is another one are left alone. Each ends as any open
  // record of a run that is over does.
  const facts = deployFacts(settled.records);
  const writers = new Set(config.recordWriters);
  const outside: Started[] = [];
  for (const { id, stackId: stack } of deployableRecordsOfRun(settled.records, context.runId)) {
    const creator = settled.records.find((record) => record.id === id)?.creator;
    if (writers.size === 0) {
      log.info(
        `Deployment record ${id} names this run, and recordWriters names nobody, so it is left alone: only a record that a listed writer opened is deployed (record 0109).`,
      );
      continue;
    }
    if (creator === undefined || !writers.has(creator.toLowerCase())) {
      log.info(
        `Deployment record ${id} names this run, and ${creator === undefined ? "GitHub names nobody who opened it" : `${creator} opened it, who is not in recordWriters`}. It is left alone.`,
      );
      continue;
    }
    const known = stacks.get(stack);
    if (!known) {
      log.info(
        `Deployment record ${id} names this run, and discovery does not know its stack, ${logGroupTitle(stack)}. It is left alone, and it ends as every open record of a run that is over does (record 0003).`,
      );
      continue;
    }
    const newest = facts.byStack.get(stack);
    if (newest?.kind !== "open" || newest.deployment !== id) {
      log.info(
        newest?.kind === "open"
          ? `Deployment record ${id} names this run, and ${logGroupTitle(stack)} is deploying under record ${newest.deployment}. It is left alone.`
          : `Deployment record ${id} names this run, and a newer record of ${logGroupTitle(stack)} already ended. It is left alone.`,
      );
      continue;
    }
    // Nothing passes a deploy freeze (record 0115), an outside record
    // neither. It is left alone, and it ends as a record nobody handed on
    // does; its writer opens a new one after the freeze.
    const frozen = deployState([], known.freezes, clockOf(context)(), config.dashboard.timeZone);
    if (!frozen.open) {
      log.info(
        `Deployment record ${id} names this run, and a deploy freeze holds ${logGroupTitle(stack)} until ${frozen.freeze === undefined ? "later" : minuteAt(frozen.freeze.ends, config.dashboard.timeZone)}. Nothing passes a freeze, so it is left alone, and it ends as every open record of a run that is over does (record 0003).`,
      );
      continue;
    }
    outside.push({
      stackId: stack,
      environment: known.environment,
      deployment: id,
      ticker: newest.ticker,
      ...(newest.onMerge ? { onMerge: true } : {}),
    });
  }
  // A record that waited for a window or a freeze the repo has taken out
  // since is started all the same: the config of this moment lets it go.
  const leftWaiting = [...facts.byStack.values()].some(
    (fact) => fact.kind === "open" && fact.window === true,
  );
  if (outside.length === 0 && !windowed && !chained && !leftWaiting) {
    log.info(
      "The event that started this job is not about an issue, no open deployment record names this run, and no stack has dependsOn, a phase or a deploy window. Nothing to do.",
    );
    return;
  }

  const now = clockOf(context)();
  const { timeZone } = config.dashboard;
  const ready: { stackId: string; fact: OpenDeployment }[] = [];
  const waiting = [...facts.byStack]
    .flatMap(([id, fact]) =>
      fact.kind === "open" && (fact.behind || fact.window) && stacks.has(id) ? [{ id, fact }] : [],
    )
    .sort((a, b) => byCodeUnit(a.id, b.id));
  for (const { id, fact } of waiting) {
    // Behind stacks that are still going, or that did not go out, which
    // settleEndedRuns ended already: nothing to say.
    if (fact.behind && queueState(fact.behind, settled.records) !== "ready") continue;
    const stack = stacks.get(id);
    const window = deployState(stack?.deployWindows, stack?.freezes, now, timeZone);
    if (window.open) {
      ready.push({ stackId: id, fact });
      continue;
    }
    // A deploy freeze holds it (record 0115): the words of its row.
    if (window.freeze !== undefined) {
      log.info(
        `${logGroupTitle(id)}${fact.behind ? ": what it waited behind went out, and it" : ""} waits for ${windowWords({ opens: window.opens, freeze: window.freeze }, timeZone)}. Nothing starts it before then.`,
      );
      continue;
    }
    const opens =
      window.opens === undefined
        ? "no window of it opens within a week"
        : `which opens ${minuteAt(window.opens, timeZone)}`;
    log.info(
      fact.behind
        ? `${logGroupTitle(id)}: what it waited behind went out, and its deploy window ${window.opens === undefined ? "is closed, and " + opens : opens.replace("which opens", "opens")}. It starts in a run inside the window.`
        : `${logGroupTitle(id)} waits for its deploy window, ${opens}. Nothing starts it before then.`,
    );
  }
  if (ready.length === 0 && outside.length === 0) {
    log.info("No queued stack is ready to start. Nothing to do.");
    return;
  }

  // One cap and one order for both kinds (record 0035): stack id order, and
  // never more than one run can hold.
  type Start = { stackId: string; outside: Started } | { stackId: string; fact: OpenDeployment };
  const starts = capDeploys<Start>([
    ...outside.map((one) => ({ stackId: one.stackId, outside: one })),
    ...ready.map((one) => ({ stackId: one.stackId, fact: one.fact })),
  ]).start;
  const failures: string[] = [];
  const started: Started[] = [];
  for (const one of starts) {
    if ("outside" in one) {
      started.push(one.outside);
      report.outsideRecords++;
      log.info(
        `${logGroupTitle(one.stackId)}: deployment record ${one.outside.deployment} names this run and waits for nothing, and this run did not open it. It is handed to apply, which previews the stack again and deploys only on the hash the record carries (record 0109).`,
      );
      continue;
    }
    const { stackId: id, fact } = one;
    const stack = stacks.get(id);
    const queued = settled.records.find((record) => record.id === fact.deployment);
    if (!stack || !queued) continue;
    try {
      const record = await watch.time("opening", () =>
        startQueuedRecord(context, queued, {
          sha: context.sha,
          environment: stack.environment,
        }),
      );
      if (!record) continue;
      started.push({
        stackId: id,
        environment: stack.environment,
        deployment: record.deployment,
        ticker: record.ticker,
        ...(record.onMerge ? { onMerge: true } : {}),
      });
      if (record.unfinished !== undefined) throw record.unfinished;
      log.info(
        `${logGroupTitle(id)}: ${fact.behind ? "what it waited behind went out" : (stack.deployWindows ?? []).length > 0 ? "its deploy window is open" : "no deploy window or freeze holds it now"}, so it starts now. Deployment record ${record.deployment} is queued and takes over from record ${fact.deployment}.`,
      );
    } catch (error) {
      failures.push(
        `The deployment record of ${logGroupTitle(id)} could not be written: ${message(error)}. The resolve job needs the permission \`deployments: write\` (record 0003). No further deploy was started, and the queued stacks that are left wait for the next run.`,
      );
      break;
    }
  }
  handOn(
    started.map(({ stackId: stack, environment, deployment }) => ({
      stack,
      environment,
      deployment,
    })),
  );

  const dashboard =
    started.length > 0
      ? await watch.time("dashboard", () => findDashboard(github, config.dashboard.label))
      : undefined;
  if (dashboard) {
    try {
      const result = await watch.time("body", () =>
        swapRows(context, config, all, ignored, dashboard.number, {
          started,
          dropped: [],
          clear: new Map(),
        }),
      );
      log.info(
        result.written
          ? `Wrote the dashboard (#${dashboard.number}).`
          : `The dashboard (#${dashboard.number}) already says all of this. Nothing was written.`,
      );
    } catch (error) {
      failures.push(message(error));
    }
  }
  if (failures.length > 0) throw new Error(failures.join("\n"));
}
