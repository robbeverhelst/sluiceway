// The scan mode (records 0010, 0011 and 0012). It wires config, discovery, the
// scan plan, the adapter, the renderers and the GitHub port together and holds
// no rules of its own. A scan that follows a push is a narrowed scan: it
// previews the stacks the plan names and carries every other row through.
// Every other scan, and every narrowed scan that cannot trust its comparison,
// is a full scan.

import type { Adapter, PreviewResult } from "../adapters/adapter.ts";
import { ToolVersionError } from "../adapters/adapter.ts";
import type { ProcessRunner } from "../adapters/process.ts";
import { applyConfig, type ConfiguredStack } from "../core/config.ts";
import { loadConfig } from "../core/config-file.ts";
import { previewFailureText } from "../core/failure-reason.ts";
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
} from "../core/scan-plan.ts";
import { everyPreviewFailed } from "../core/scan-result.ts";
import { stackId } from "../core/stack.ts";
import { type DashboardResult, findDashboard, writeDashboard } from "../github/dashboard.ts";
import type { JobLog } from "../github/job-log.ts";
import type { GitHubPort } from "../github/port.ts";
import {
  BODY_LIMIT,
  type BudgetOptions,
  bodyDoesNotFitMessage,
  fitBody,
} from "../render/budget.ts";
import { diffLogLines, logGroupTitle } from "../render/log-text.ts";
import { MARKER_VERSION, type ParsedRow, parseDashboard } from "../render/marker.ts";
import { previewOutcome, previewRow, previewSummary } from "../render/preview-result.ts";
import { byCodeUnit, plural } from "../render/row.ts";
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
  // The commit the scan checked out.
  sha: string;
  // What started the run, as GitHub names it. Only "push" gives a narrowed
  // scan (record 0010).
  event: string;
  actionRef: string;
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
  milliseconds: number;
}

// Thrown by the builder of the body, at the late read: these stacks have to be
// previewed before the dashboard can be written. The scan previews them and
// returns to its late read (record 0011).
class PreviewFirst extends Error {
  constructor(
    readonly ids: string[],
    // Absent when the stacks simply have no row in the live body.
    readonly why?: FullScanReason,
  ) {
    super("More stacks have to be previewed before the dashboard can be written.");
    this.name = "PreviewFirst";
  }
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

export async function scan(context: ScanContext): Promise<void> {
  const { log, now } = context;
  const startedAt = now();
  const at = startedAt.toISOString();
  const runUrl = `${context.repoUrl}/actions/runs/${context.runId}`;

  // Config and discovery come first and cost no preview. An error in either
  // fails the job before the tool or GitHub is touched (record 0012). Every
  // scan runs discovery, a narrowed one too (record 0011).
  const config = loadConfig(context.root);
  const stacks = applyConfig(config, await context.adapter.discover(context.root)).sort((a, b) =>
    byCodeUnit(stackId(a.stack), stackId(b.stack)),
  );
  const ids = stacks.map(({ stack }) => stackId(stack));
  log.info(stacks.length === 0 ? "Found no stacks." : `Found ${plural(stacks.length, "stack")}.`);

  const plan = await makePlan(context, config, stacks);
  logPlan(context, plan, stacks.length);
  const planned = plan.kind === "full" ? undefined : new Set(plan.previews.map(({ id }) => id));
  let next = planned ? stacks.filter(({ stack }) => planned.has(stackId(stack))) : stacks;

  const previewed = new Map<string, Previewed>();
  let rounds = 0;
  let versionChecked = false;
  let composed: Composed | undefined;
  let written: DashboardResult;
  for (;;) {
    if (next.length > 0 && !versionChecked) {
      await checkVersion(context);
      versionChecked = true;
    }
    const round = await previewAll(context, next);
    for (const one of round) previewed.set(one.id, one);
    logResults(context, round);

    // The dashboard is the product and the summary is its annex: a summary
    // that cannot be written never stops the scan (record 0037). It holds
    // every stack this scan previewed, so a later round writes it again.
    const all = [...previewed.values()].sort((a, b) => byCodeUnit(a.id, b.id));
    if (round.length > 0 || rounds === 0) await writeSummary(context, all);
    rounds++;

    // All slow work is done. The body is built from the late read of the live
    // one: a fresh row for every previewed stack, the live row block for every
    // other, byte for byte (record 0011).
    const compose = (liveBody: string | undefined): Composed => {
      const live = liveBody === undefined ? undefined : parseDashboard(liveBody);
      // Rows under a root marker that is missing or of another version are not
      // rows this version can carry. Every stack then counts as having none,
      // which makes the scan a full one by itself (record 0011).
      const liveRows = new Map<string, ParsedRow>();
      if (live?.root?.version === MARKER_VERSION) {
        // One row per stack: of two blocks with one stack id the first stays.
        for (const row of live.rows) if (!liveRows.has(row.stackId)) liveRows.set(row.stackId, row);
      }
      const rule = oneRowPerStack(ids, new Set(previewed.keys()), [...liveRows.keys()]);
      if (rule.missing.length > 0) throw new PreviewFirst(rule.missing);

      const carried = rule.carried.flatMap((id) => liveRows.get(id) ?? []);
      // A scan that has a fresh row for every stack is a full scan, whatever
      // it set out as.
      const full = carried.length === 0;
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
          rows: all.map(({ id, result }) => previewRow(id, result, runUrl)),
          carried,
          redact: config.dashboard.redact,
          recentlyDeployed: [],
          repoUrl: context.repoUrl,
          actionRef: context.actionRef,
          personality: config.dashboard.personality,
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
        throw new PreviewFirst(rule.carried, { kind: "does-not-fit", carried: carried.length });
      }
      return { body: fitted.body, shortened: fitted.shortened, full, ...rule };
    };

    try {
      // With a fresh row for every stack the body does not depend on the live
      // one. A body that does not fit then fails the scan before any request.
      if (previewed.size === ids.length) compose(undefined);
      written = await writeDashboard(context.github, config.dashboard, (liveBody) => {
        composed = compose(liveBody);
        return composed.body;
      });
      break;
    } catch (error) {
      if (!(error instanceof PreviewFirst)) throw error;
      const late = new Set(error.ids);
      next = stacks.filter(({ stack }) => late.has(stackId(stack)));
      if (error.why) {
        log.info(
          `This scan falls back to a full scan: ${fullScanReasonText(error.why)}. Previewing the other ${plural(next.length, "stack")} now.`,
        );
      } else {
        for (const id of error.ids) {
          log.info(
            `${logGroupTitle(id)} is previewed now: the dashboard has no row for it any more.`,
          );
        }
      }
    }
  }

  reportDashboard(context, written, composed);

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
  carried: string[];
  dropped: string[];
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
    if (why.kind === "unclaimed") {
      log.group("Changed files that no stack claims", [
        ...why.files.map((file) => `unclaimed: ${fileName(file)}`),
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
async function previewAll(context: ScanContext, stacks: ConfiguredStack[]): Promise<Previewed[]> {
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
    const started = now().getTime();
    const result = await adapter.preview(configured.stack, {
      ...tool,
      timeoutMinutes: configured.previewTimeout ?? context.previewTimeoutMinutes,
    });
    const milliseconds = now().getTime() - started;
    log.info(
      `Previewed ${logGroupTitle(id)} in ${seconds(milliseconds)}: ${previewOutcome(result)}`,
    );
    return { id, result, milliseconds };
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
  for (const { id, result } of previewed) {
    const words = lines(result.toolLog);
    log.group(logGroupTitle(id), [
      ...(result.ok
        ? diffLogLines(result.diff)
        : [`preview failed: ${previewFailureText(result.reason)}`, ...result.detail]),
      ...(words.length > 0 ? ["The tool's own words:", ...words] : []),
    ]);
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

async function writeSummary(context: ScanContext, previewed: Previewed[]): Promise<void> {
  const { log } = context;
  const summary = renderSummary(
    previewed.map(({ id, result }) => previewSummary(id, result)),
    { budget: context.limits?.summaryBudget },
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
