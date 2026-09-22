// The scan mode (records 0010, 0011 and 0012). It wires config, discovery, the
// scan plan, the adapter, the renderers and the GitHub port together and holds
// no rules of its own. A scan that follows a push is a narrowed scan: it
// previews the stacks the plan names and carries every other row through.
// Every other scan, and every narrowed scan that cannot trust its comparison,
// is a full scan.

import type { Adapter, PreviewResult, ToolDiffResult } from "../adapters/adapter.ts";
import { ToolVersionError } from "../adapters/adapter.ts";
import type { ProcessRunner } from "../adapters/process.ts";
import type { Attribution } from "../core/attribution.ts";
import { applyConfig, type ConfiguredStack } from "../core/config.ts";
import { loadConfig } from "../core/config-file.ts";
import {
  type DeployFact,
  type DeployFacts,
  deployFacts,
  lastDeployedCommit,
  type PreviewFirstWhy,
  rowAtLateRead,
} from "../core/deployment.ts";
import { previewFailureText } from "../core/failure-reason.ts";
import { resolveOnItsWay, type TickAtLateRead, tickAtLateRead } from "../core/orphan-tick.ts";
import { runPool } from "../core/pool.ts";
import {
  changedPaths,
  comparisonBase,
  type FullScanReason,
  fullScanReasonText,
  narrowsOn,
  oneRowPerStack,
  type PreviewWhy,
  planScan,
  type ScanPlan,
  unclaimedToPlace,
} from "../core/scan-plan.ts";
import { everyPreviewFailed } from "../core/scan-result.ts";
import { stackId } from "../core/stack.ts";
import { attributionSource } from "../github/attribution.ts";
import { type DashboardResult, findDashboard, writeDashboard } from "../github/dashboard.ts";
import { readDeploymentRecords, settleEndedRuns } from "../github/deployments.ts";
import type { JobLog } from "../github/job-log.ts";
import { dashboardUrl, type StepOutputs, writeResultFile } from "../github/outputs.ts";
import type { GitHubPort } from "../github/port.ts";
import {
  type PreviewPages,
  type PreviewPageToWrite,
  previewPages,
} from "../github/preview-pages.ts";
import {
  BODY_LIMIT,
  type BudgetOptions,
  bodyDoesNotFitMessage,
  fitBody,
} from "../render/budget.ts";
import { dashboardSearchUrl, type RunLinks, runLinks } from "../render/links.ts";
import {
  diffLogLines,
  logGroupTitle,
  PUBLIC_LOG_DIFF,
  toolDiffLogLines,
} from "../render/log-text.ts";
import { MARKER_VERSION, type ParsedRow, parseDashboard } from "../render/marker.ts";
import { renderPreviewPage } from "../render/preview-page.ts";
import { previewOutcome, previewRow, previewSummary } from "../render/preview-result.ts";
import { type DashboardCounts, dashboardCounts, scanResultFile } from "../render/result-file.ts";
import { byCodeUnit, type FailureLine, isDestroy, plural, type Row } from "../render/row.ts";
import { renderSummary } from "../render/summary.ts";

// Everything a scan needs, handed in as data and seams (build plan, section
// 5): the port, the process runner, the clock and the environment.
export interface ScanContext {
  // The directory of the checked-out repo.
  root: string;
  // The environment of the job, read once by the glue. The scan never looks
  // inside. The adapter hands it to the tool (record 0013).
  env: Record<string, string | undefined>;
  adapter: Adapter;
  run: ProcessRunner;
  github: GitHubPort;
  log: JobLog;
  now: () => Date;
  // The `concurrency` input: the size of the pool.
  concurrency: number;
  // The `preview-timeout` input, in whole minutes.
  previewTimeoutMinutes: number;
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
  // scan (record 0010).
  event: string;
  // The file name of the running workflow. The orphan tick sweep asks for the
  // runs of it that an issue edit started (record 0025).
  workflow: string;
  actionRef: string;
  // The step outputs and the result file (record 0041). A test that does not
  // look at them leaves them out.
  outputs?: StepOutputs | undefined;
  // How many requests the port has made so far, counted on the wire. The
  // scan logs it last, so the API budget of record 0017 can be read from a
  // real run. A test that does not look at it leaves it out.
  requests?: (() => number) | undefined;
  // Whether the repo is public, from the payload of the event. Absent when
  // the payload does not say (record 0048).
  publicRepo?: boolean | undefined;
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

interface Previewed {
  id: string;
  result: PreviewResult;
  // When the preview started. A deploy that ended after it is fresher than
  // the preview (record 0004).
  startedAt: Date;
  milliseconds: number;
  // The tool's own diff, for the stack's group of the job log and nothing
  // else (record 0048). Only a pending stack of a scan with `scan.logDiff` on
  // has one.
  toolDiff?: ToolDiffResult | undefined;
}

// Thrown by the builder of the body, at the late read: these stacks have to be
// previewed before the dashboard can be written. The scan previews them and
// returns to its late read (record 0011).
class PreviewFirst extends Error {
  constructor(
    readonly stacks: { id: string; why: LateWhy }[],
    // Set when the scan falls back to a full scan as a whole.
    readonly why?: FullScanReason,
  ) {
    super("More stacks have to be previewed before the dashboard can be written.");
    this.name = "PreviewFirst";
  }
}

// Why a stack is previewed at the late read: for its deployment records
// (record 0004), or because its row holds an orphan tick and only a fresh row
// can carry the note (record 0025).
type LateWhy = PreviewFirstWhy | "orphan-tick";

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
}

export async function scan(context: ScanContext): Promise<void> {
  // The defaults of the build plan, section 3: a scan that fails before it
  // writes the dashboard still hands a notify step numbers it can read.
  context.outputs?.set("pending", "0");
  context.outputs?.set("preview-failed", "0");
  context.outputs?.set("in-sync", "0");
  context.outputs?.set("dashboard-changed", "false");
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
    run: runUrlOf(context, context.runId),
    commit: context.sha,
    milliseconds: context.now().getTime() - startedAt.getTime(),
    dashboard,
    stacks: previewed.map(({ id, result, milliseconds }) => ({
      // The same stacks as the summary, made the same way (record 0041).
      stack: previewSummary(id, result),
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

  // Config and discovery come first and cost no preview. An error in either
  // fails the job before the tool or GitHub is touched (record 0012). Every
  // scan runs discovery, a narrowed one too (record 0011).
  const config = loadConfig(context.root);
  const stacks = applyConfig(config, await context.adapter.discover(context.root)).sort((a, b) =>
    byCodeUnit(stackId(a.stack), stackId(b.stack)),
  );
  const ids = stacks.map(({ stack }) => stackId(stack));
  log.info(stacks.length === 0 ? "Found no stacks." : `Found ${plural(stacks.length, "stack")}.`);
  const { logDiff } = config.scan;
  if (logDiff && context.publicRepo) {
    log.warning(PUBLIC_LOG_DIFF.message, PUBLIC_LOG_DIFF.title);
  }

  const plan = await makePlan(context, config, stacks);
  logPlan(context, plan, stacks.length);
  const planned = plan.kind === "full" ? undefined : new Set(plan.previews.map(({ id }) => id));
  let next = planned ? stacks.filter(({ stack }) => planned.has(stackId(stack))) : stacks;

  // Attribution (record 0026): walked once per job, shared by every stack,
  // and it never blocks.
  const attribution = attributionSource(
    context.github,
    {
      stacks: stacks.map(({ stack, inputs }) => ({ id: stackId(stack), path: stack.path, inputs })),
      unrelated: config.scan.unrelated,
      repoUrl: context.repoUrl,
      scanSha: context.sha,
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
  let versionChecked = false;
  let composed: Composed | undefined;
  let written: DashboardResult;
  // Stacks this scan previewed a second time for a deploy that ended under it.
  const again = new Set<string>();
  for (;;) {
    if (next.length > 0 && !versionChecked) {
      await checkVersion(context);
      versionChecked = true;
    }
    const round = await previewAll(context, next, logDiff);
    for (const one of round) previewed.set(one.id, one);
    logResults(context, round);

    // The dashboard is the product and the summary is its annex: a summary
    // that cannot be written never stops the scan (record 0037). It holds
    // every stack this scan previewed, so a later round writes it again.
    const all = [...previewed.values()].sort((a, b) => byCodeUnit(a.id, b.id));
    if (round.length > 0 || rounds === 0) {
      await writeSummary(context, all, logDiff);
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
    const compose = (
      liveBody: string | undefined,
      deploys: LateDeploys,
      // A run that an issue edit started is queued or in progress.
      waits: boolean,
      lines: Attributed,
    ): Composed => {
      const live = liveBody === undefined ? undefined : parseDashboard(liveBody);
      // Rows under a root marker that is missing or of another version are not
      // rows this version can carry. Every stack then counts as having none,
      // which makes the scan a full one by itself (record 0011).
      const liveRows = new Map<string, ParsedRow>();
      if (live?.root?.version === MARKER_VERSION) {
        // One row per stack: of two blocks with one stack id the first stays.
        for (const row of live.rows) if (!liveRows.has(row.stackId)) liveRows.set(row.stackId, row);
      }
      const { dropped } = oneRowPerStack(ids, new Set(previewed.keys()), [...liveRows.keys()]);
      // A tick is read whatever the version of the body: a scan that writes
      // the body again in its own version clears the ticks it meets with the
      // note (record 0009). Of two blocks for one stack the first counts.
      const liveTicks = new Map<string, string | undefined>();
      const seen = new Set<string>();
      // On a read-only dashboard no row has a box, so a tick left from before
      // the switch goes with the box, with no note and nobody asked (slice
      // 2.17). The switch changes the config file, so this scan is full.
      for (const row of config.dashboard.readOnly ? [] : (live?.rows ?? [])) {
        if (seen.has(row.stackId)) continue;
        seen.add(row.stackId);
        if (row.known && row.ticked) liveTicks.set(row.stackId, row.hash);
      }

      const rows: Row[] = [];
      const carried: ParsedRow[] = [];
      const first: { id: string; why: LateWhy }[] = [];
      const deploying: string[] = [];
      const deferred: string[] = [];
      const ticks: Composed["ticks"] = [];
      for (const id of ids) {
        const mine = previewed.get(id);
        const liveRow = liveRows.get(id);
        const fact = deploys.facts.byStack.get(id);
        const decided = rowAtLateRead({
          previewedAt: mine?.startedAt,
          liveState: liveRow?.state,
          fact,
          settledHere: deploys.settled.has(id),
          again: again.has(id),
        });
        // A stack with an open deployment gets the deploying row below, so a
        // tick only matters on the two branches that write a box.
        const ticked = liveTicks.has(id);
        if (decided.row === "preview-first") first.push({ id, why: decided.why });
        else if (decided.row === "fresh" && mine) {
          const fresh = previewRow(id, mine.result, links, failureLine(context, fact), {
            toolDiffInLog: logDiff,
            pageUrl: pageUrls.get(id),
          });
          const row =
            fresh.state === "pending" ? { ...fresh, attribution: lines.get(id)?.lines } : fresh;
          if (!ticked) {
            rows.push(row);
            continue;
          }
          // Only a pending row has a box, for a tick or for the note.
          const box = row.state === "pending";
          const carry =
            tickAtLateRead({
              liveHash: liveTicks.get(id),
              writes: { row: "fresh", hash: box ? row.hash : undefined },
              resolveOnItsWay: waits,
            }) === "carry";
          ticks.push({ id, tick: carry ? "carry" : "sweep", box });
          rows.push(!box ? row : carry ? { ...row, ticked: true } : { ...row, orphanTick: true });
        } else if (
          decided.row === "deploying" &&
          decided.from === "record" &&
          fact?.kind === "open"
        ) {
          deploying.push(id);
          rows.push({
            state: "deploying",
            stackId: id,
            ticker: fact.ticker,
            runUrl: runUrlOf(context, fact.run),
            waiting: fact.waiting,
            destroys: destroysOf(mine, liveRow),
            attribution: lines.get(id)?.lines,
          });
        } else if (liveRow) {
          if (ticked && decided.row === "live") {
            const tick = tickAtLateRead({
              liveHash: liveTicks.get(id),
              writes: { row: "live", previewed: mine !== undefined },
              resolveOnItsWay: waits,
            });
            if (tick === "preview-first") {
              first.push({ id, why: "orphan-tick" });
              continue;
            }
            ticks.push({ id, tick, box: true });
          }
          if (decided.row === "deploying") deploying.push(id);
          else if (mine) deferred.push(id);
          carried.push(liveRow);
        }
      }
      if (first.length > 0) throw new PreviewFirst(first);

      // A full scan is a scan that previews every stack, whatever row each
      // stack then gets.
      const full = ids.every((id) => previewed.has(id));
      const fitted = fitBody(
        {
          root: {
            scanSha: context.sha,
            scanRun: context.runId,
            scanAt: at,
            // Written by a full scan, carried through by every other writer.
            fullScanAt: full ? at : live?.root?.fullScanAt,
            fullScanRun: full ? context.runId : live?.root?.fullScanRun,
          },
          rows,
          carried,
          redact: config.dashboard.redact,
          recentlyDeployed: deploys.facts.succeeded.map(
            ({ stackId: id, ticker, run, at: when }) => ({
              stackId: id,
              ticker,
              at: when,
              runUrl: runUrlOf(context, run),
            }),
          ),
          repoUrl: context.repoUrl,
          actionRef: context.actionRef,
          personality: config.dashboard.personality,
          readOnly: config.dashboard.readOnly,
        },
        // A writer that swaps rows aims at the hard limit, because the room
        // between the target and the limit exists for that writer (0028).
        full ? context.limits?.body : { ...context.limits?.body, target: Number.POSITIVE_INFINITY },
      );
      if (!fitted.fits) {
        // A body over the hard limit is never handed to a writer (record
        // 0028). Only a fresh row can be shortened, so a scan that carries
        // rows previews those too and can then shorten everything.
        if (full) throw new ScanFailedError(bodyDoesNotFitMessage(fitted.size));
        throw new PreviewFirst(
          ids.filter((id) => !previewed.has(id)).map((id) => ({ id, why: "no-row" })),
          { kind: "does-not-fit", carried: carried.length },
        );
      }
      return {
        body: fitted.body,
        shortened: fitted.shortened,
        full,
        carried: carried.map((row) => row.stackId).filter((id) => !previewed.has(id)),
        dropped,
        deploying,
        deferred,
        ticks,
        resolveWaits: waits,
        unread: deploys.facts.unread,
      };
    };

    try {
      // With a fresh row for every stack the body depends on the live one only
      // through the deployment records, which change a few lines. A body that
      // does not fit on its own fails the scan before any request.
      if (previewed.size === ids.length) compose(undefined, NO_DEPLOYS, false, new Map());
      written = await writeDashboard(context.github, config.dashboard, async (liveBody) => {
        const deploys = await lateDeploys(context, stacks, previewed, liveBody);
        attributed = await attribution.attribute(startingCommits(deploys.facts, previewed));
        composed = compose(
          liveBody,
          deploys,
          !config.dashboard.readOnly && (await resolveWaits(context, liveBody, deploys)),
          attributed,
        );
        return composed.body;
      });
      break;
    } catch (error) {
      if (!(error instanceof PreviewFirst)) throw error;
      const late = new Set(error.stacks.map(({ id }) => id));
      next = stacks.filter(({ stack }) => late.has(stackId(stack)));
      if (error.why) {
        log.info(
          `This scan falls back to a full scan: ${fullScanReasonText(error.why)}. Previewing the other ${plural(next.length, "stack")} now.`,
        );
      } else {
        for (const { id, why } of error.stacks) {
          if (why === "deploy-ended") again.add(id);
          log.info(`${logGroupTitle(id)} ${PREVIEW_FIRST[why]}`);
        }
      }
    }
  }

  reportDashboard(context, written, composed);
  report.dashboard = {
    url: dashboardUrl(context.repoUrl, written.number),
    changed: written.written,
    // The counts line of the body as written, from its row markers.
    counts: dashboardCounts(parseDashboard(written.body).rows),
  };

  // The summary was written before the late read, which is where the commit
  // of a stack's last deploy comes from. Now that it is known, the summary is
  // written once more with the pull requests of every previewed stack.
  if ([...attributed.values()].some(({ merges }) => merges.length > 0)) {
    const all = [...previewed.values()].sort((a, b) => byCodeUnit(a.id, b.id));
    await writeSummary(context, all, logDiff, attributed);
  }

  const failed = [...previewed.values()].filter(({ result }) => !result.ok);
  if (everyPreviewFailed(previewed.size, failed.length)) {
    throw new ScanFailedError(
      `Every preview failed (${failed.length} of ${previewed.size}). That nearly always means the environment is broken, such as missing credentials or a backend that cannot be reached. The dashboard was written first and shows a preview failure on every row of a previewed stack, which is true: nothing can be deployed either. The job log holds what the tool printed, in the group of each stack.`,
    );
  }
}

// What the builder of the body made on its last try.
interface Composed {
  body: string;
  shortened: number;
  full: boolean;
  // Stacks this scan did not preview, whose live row stays as it is.
  carried: string[];
  dropped: string[];
  // Stacks with an open deployment.
  deploying: string[];
  // Previewed stacks that keep their live row, because a deploy of them ended
  // after the preview started.
  deferred: string[];
  // What became of every tick the scan met on a stack with no open deployment
  // (record 0025). `box` says whether the row it wrote has a box.
  ticks: { id: string; tick: Exclude<TickAtLateRead, "preview-first">; box: boolean }[];
  // A run that an issue edit started was queued or in progress.
  resolveWaits: boolean;
  // Deployment records with a payload this version cannot read.
  unread: number;
}

const PREVIEW_FIRST: Record<LateWhy, string> = {
  "no-row": "is previewed now: the dashboard has no row for it any more.",
  "no-open-deployment": "is previewed now: its row says deploying and no deployment is open.",
  "deploy-ended": "is previewed again: a deploy of it ended after its preview started.",
  "orphan-tick":
    "is previewed now: its row holds an orphan tick, and only a fresh row can ask for a fresh tick.",
};

// The deploy facts of one late read (record 0003).
interface LateDeploys {
  facts: DeployFacts;
  // Stacks whose open deployment this scan ended, because its run was over.
  settled: Set<string>;
}

const NO_DEPLOYS: LateDeploys = {
  facts: { byStack: new Map(), succeeded: [], unread: 0 },
  settled: new Set(),
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

function runUrlOf(context: ScanContext, run: string): string {
  return `${context.repoUrl}/actions/runs/${run}`;
}

// A deploy fact from the deployment record, never from the old row.
function failureLine(context: ScanContext, fact: DeployFact | undefined): FailureLine | undefined {
  if (fact?.kind !== "failed") return undefined;
  return {
    reason: fact.reason,
    ticker: fact.ticker,
    at: fact.at,
    runUrl: runUrlOf(context, fact.run),
  };
}

// The header and the counts line need to know whether a deploying stack
// destroys something (record 0027). The preview knows. Without one, the
// marker of the row that is replaced does.
function destroysOf(mine: Previewed | undefined, liveRow: ParsedRow | undefined): number {
  if (mine?.result.ok) return mine.result.diff.changes.filter(isDestroy).length;
  return liveRow?.known ? liveRow.destroys : 0;
}

// The late read of the deployment records: bounded reads, then every open
// deployment whose run is over gets its result (record 0003). It runs inside
// the builder of the write loop, so every try sees the records as they are.
async function lateDeploys(
  context: ScanContext,
  stacks: ConfiguredStack[],
  previewed: ReadonlyMap<string, Previewed>,
  liveBody: string,
): Promise<LateDeploys> {
  const { log, github } = context;
  const liveStates = new Map(
    parseDashboard(liveBody).rows.map((row) => [row.stackId, row.state] as const),
  );
  // In sync stacks need no lookup (record 0003). A pending stack does, and so
  // does a stack whose live row says deploying.
  const fallBack = stacks
    .map(({ stack, environment }) => ({ stackId: stackId(stack), environment }))
    .filter(({ stackId: id }) => {
      const result = previewed.get(id)?.result;
      return (
        (result?.ok === true && result.diff.changes.length > 0) ||
        liveStates.get(id) === "deploying"
      );
    });
  try {
    const records = await readDeploymentRecords(
      github,
      stacks.map(({ environment }) => environment),
      fallBack,
    );
    const before = deployFacts(records).byStack;
    const settled = await settleEndedRuns(github, records, context.repoUrl);
    for (const id of settled.stackIds) {
      const fact = before.get(id);
      log.info(
        `Ended the open deployment of ${logGroupTitle(id)}: run ${fact?.kind === "open" ? fact.run : ""} is over and never reported a result.`,
      );
    }
    return { facts: deployFacts(settled.records), settled: new Set(settled.stackIds) };
  } catch (error) {
    throw new Error(
      `The deployment records could not be read: ${error instanceof Error ? error.message : error}. The scan job needs the permissions \`deployments: write\` and \`actions: read\` next to \`contents: read\` and \`issues: write\` (record 0003).`,
    );
  }
}

// The other half of the orphan tick rule (record 0025): whether a run that an
// issue edit started is queued or in progress. Any `resolve` run handles every
// tick, so while one is on its way the scan keeps its hands off. Only a late
// read that meets a tick on a stack with no open deployment pays for the
// lookup, which is one request.
async function resolveWaits(
  context: ScanContext,
  liveBody: string,
  deploys: LateDeploys,
): Promise<boolean> {
  const met = parseDashboard(liveBody).rows.some(
    (row) => row.known && row.ticked && deploys.facts.byStack.get(row.stackId)?.kind !== "open",
  );
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
  config: ReturnType<typeof loadConfig>,
  stacks: ConfiguredStack[],
): Promise<ScanPlan> {
  const { log } = context;
  const full = (why: FullScanReason): ScanPlan => ({ kind: "full", why });

  // Only a scan that may narrow pays for the first read.
  const dashboard = narrowsOn(context.event)
    ? await findDashboard(context.github, config.dashboard.label)
    : undefined;
  const live = dashboard && parseDashboard(dashboard.body);
  const base = comparisonBase(context.event, live, MARKER_VERSION);
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
  const changed = changedPaths(comparison);
  if (changed.kind !== "changed") return full(changed);
  log.info(
    `${plural(comparison.files.length, "file")} changed between ${short(base.from)}, the commit of the last scan, and ${short(context.sha)}.`,
  );

  return planScan(
    stacks.map(({ stack, inputs }) => ({ id: stackId(stack), path: stack.path, inputs })),
    changed.paths,
    config.scan.unrelated,
    live?.rows ?? [],
  );
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
      `This is a full scan. A push gives a narrowed scan, and this one fell back to a full scan: ${fullScanReasonText(safe)}.`,
    );
    const toPlace = why.kind === "unclaimed" ? unclaimedToPlace(why.files) : [];
    if (toPlace.length > 0) {
      log.group("Changed files that no stack claims", [
        ...toPlace.map((file) => `unclaimed: ${fileName(file)}`),
        "A file that some stacks read belongs under the inputs of those stacks in sluiceway.yaml. A file that no stack reads can be listed under scan.unrelated.",
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

async function checkVersion(context: ScanContext): Promise<void> {
  try {
    await context.adapter.checkVersion({ root: context.root, env: context.env, run: context.run });
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
async function previewAll(
  context: ScanContext,
  stacks: ConfiguredStack[],
  logDiff: boolean,
): Promise<Previewed[]> {
  const { log, now, adapter } = context;
  // Nothing to preview, so a repo without stacks needs no tool, and neither
  // does a narrowed scan that keeps every row.
  if (stacks.length === 0) return [];
  const tool = { root: context.root, env: context.env, run: context.run };

  log.info(
    `Previewing ${plural(stacks.length, "stack")} with a pool of ${context.concurrency} and a time limit of ${minutes(context.previewTimeoutMinutes)} for each preview.`,
  );
  const poolStarted = now().getTime();
  const previewed = await runPool(stacks, context.concurrency, async (configured) => {
    const id = stackId(configured.stack);
    const startedAt = now();
    const started = startedAt.getTime();
    const options = {
      ...tool,
      timeoutMinutes: configured.previewTimeout ?? context.previewTimeoutMinutes,
    };
    const result = await adapter.preview(configured.stack, options);
    const milliseconds = now().getTime() - started;
    log.info(
      `Previewed ${logGroupTitle(id)} in ${seconds(milliseconds)}: ${previewOutcome(result)}`,
    );
    // The second run of the tool takes the same slot of the pool and the same
    // time limit, and only a pending stack gets one (record 0048).
    if (!logDiff || !result.ok || result.diff.changes.length === 0) {
      return { id, result, startedAt, milliseconds };
    }
    const toolDiffStarted = now().getTime();
    const toolDiff = await adapter.toolDiff(configured.stack, options);
    log.info(
      `Ran the tool's own diff of ${logGroupTitle(id)} in ${seconds(now().getTime() - toolDiffStarted)}${toolDiff.ok ? "" : `: ${previewFailureText(toolDiff.reason)}`}.`,
    );
    return { id, result, startedAt, milliseconds, toolDiff };
  });
  const total = now().getTime() - poolStarted;

  const addedUp = previewed.reduce((sum, { milliseconds }) => sum + milliseconds, 0);
  const slowest = previewed.reduce((a, b) => (b.milliseconds > a.milliseconds ? b : a));
  log.info(
    `Previewed ${plural(previewed.length, "stack")} in ${seconds(total)} with a pool of ${context.concurrency}. Added up, the previews took ${seconds(addedUp)}. The slowest was ${logGroupTitle(slowest.id)} with ${seconds(slowest.milliseconds)}.`,
  );
  return previewed;
}

// The tool's own words and every diff in full go to the job log, grouped per
// stack, on every scan (records 0022 and 0037). A preview failure is a warning
// on the run as well (record 0012).
function logResults(context: ScanContext, previewed: Previewed[]): void {
  const { log } = context;
  for (const { id, result, toolDiff } of previewed) {
    const words = lines(result.toolLog + (toolDiff?.toolLog ?? ""));
    const own = [
      ...(result.ok
        ? diffLogLines(result.diff)
        : [`preview failed: ${previewFailureText(result.reason)}`, ...result.detail]),
      ...toolDiffLogLines(toolDiff),
      ...(words.length > 0 ? ["The tool's own words:", ...words] : []),
    ];
    if (toolDiff?.ok) log.group(logGroupTitle(id), own, lines(toolDiff.text));
    else log.group(logGroupTitle(id), own);
  }
  for (const { id, result } of previewed) {
    if (!result.ok) {
      log.warning(
        `The preview of ${logGroupTitle(id)} failed: ${previewFailureText(result.reason)}.`,
        "Preview failed",
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
    if (!result.ok || result.diff.changes.length === 0) continue;
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
      `Wrote the preview pages of ${plural(written.urls.size, "pending stack")} on ${short(context.sha)}: ${written.created} created, ${written.updated} updated.`,
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
      `GitHub answered "${refused.message}" while the preview pages were written. No more pages are written in this scan, and the preview links of ${plural(written.skipped.length, "pending stack")} land on ${fallBack}.`,
    );
  }
}

async function writeSummary(
  context: ScanContext,
  previewed: Previewed[],
  logDiff: boolean,
  attributed: Attributed = new Map(),
): Promise<void> {
  const { log } = context;
  const summary = renderSummary(
    previewed.map(({ id, result }) => previewSummary(id, result, attributed.get(id)?.merges)),
    {
      budget: context.limits?.summaryBudget,
      jobLogUrl: context.jobId === undefined ? undefined : runLinks(context).log,
      toolDiffInLog: logDiff,
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
  written: DashboardResult,
  composed: Composed | undefined,
): void {
  const { log } = context;
  const shortened = composed?.shortened ?? 0;
  const size = `${written.body.length.toLocaleString("en-US")} of ${BODY_LIMIT.toLocaleString("en-US")} characters`;
  log.info(`${FOUND[written.found]}: ${context.repoUrl}/issues/${written.number} (${size}).`);
  if (written.tries > 1) log.info(`The write took ${written.tries} tries.`);
  if (shortened > 0) log.info(`${plural(shortened, "row")} shortened to fit the size budget.`);
  if (composed && composed.carried.length > 0) {
    log.info(
      `Carried ${plural(composed.carried.length, "row")} through as ${composed.carried.length === 1 ? "it was" : "they were"}, for the stacks this scan did not preview.`,
    );
  }
  for (const id of composed?.dropped ?? []) {
    log.info(`Dropped the row of ${logGroupTitle(id)}: discovery knows no such stack.`);
  }
  for (const id of composed?.deploying ?? []) {
    log.info(
      `${logGroupTitle(id)} has an open deployment, so its row says deploying and has no box, whatever the preview says.`,
    );
  }
  for (const id of composed?.deferred ?? []) {
    log.info(
      `Kept the live row of ${logGroupTitle(id)}: a deploy of it ended after its preview started.`,
    );
  }
  for (const { id, tick, box } of composed?.ticks ?? []) {
    log.info(tickText(logGroupTitle(id), tick, box, composed?.resolveWaits ?? false));
  }
  const unread = composed?.unread ?? 0;
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
  if (written.pin === "failed") {
    log.warning(
      `The new dashboard (#${written.number}) could not be pinned. A repo holds at most three pinned issues. Pin it by hand if you want it at the top of the issue list.`,
      "Dashboard not pinned",
    );
  }
}
