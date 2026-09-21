// The scan mode (records 0011 and 0012). It wires config, discovery, the
// adapter, the renderers and the GitHub port together and holds no rules of
// its own. Until the narrowed scan of record 0010 is built, every scan is a
// full scan: it previews every stack and replaces every row.

import type { Adapter, PreviewResult } from "../adapters/adapter.ts";
import { ToolVersionError } from "../adapters/adapter.ts";
import type { ProcessRunner } from "../adapters/process.ts";
import { applyConfig, type ConfiguredStack } from "../core/config.ts";
import { loadConfig } from "../core/config-file.ts";
import { previewFailureText } from "../core/failure-reason.ts";
import { runPool } from "../core/pool.ts";
import { everyPreviewFailed } from "../core/scan-result.ts";
import { stackId } from "../core/stack.ts";
import { type DashboardResult, writeDashboard } from "../github/dashboard.ts";
import type { GitHubPort } from "../github/port.ts";
import {
  BODY_LIMIT,
  type BudgetOptions,
  bodyDoesNotFitMessage,
  fitBody,
} from "../render/budget.ts";
import { diffLogLines, logGroupTitle } from "../render/log-text.ts";
import { previewOutcome, previewRow, previewSummary } from "../render/preview-result.ts";
import { byCodeUnit, plural } from "../render/row.ts";
import { renderSummary } from "../render/summary.ts";

// The job log, the annotations and the summary of the run. The glue writes
// them through @actions/core, a test remembers them.
export interface ScanLog {
  info(line: string): void;
  // A foldable group of lines under a title.
  group(title: string, lines: string[]): void;
  // A warning annotation on the run (record 0012). Sluiceway's own words only,
  // because annotations show on the run's summary page (record 0022).
  warning(message: string, title: string): void;
  writeSummary(text: string): Promise<void>;
}

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
  log: ScanLog;
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

export async function scan(context: ScanContext): Promise<void> {
  const { log, now } = context;
  const startedAt = now();
  const runUrl = `${context.repoUrl}/actions/runs/${context.runId}`;

  // Config and discovery come first and cost no preview. An error in either
  // fails the job before the tool or GitHub is touched (record 0012).
  const config = loadConfig(context.root);
  const stacks = applyConfig(config, await context.adapter.discover(context.root)).sort((a, b) =>
    byCodeUnit(stackId(a.stack), stackId(b.stack)),
  );

  const previewed = await previewAll(context, stacks);
  const failed = previewed.filter(({ result }) => !result.ok);

  // The tool's own words and every diff in full go to the job log, grouped
  // per stack, on every scan (records 0022 and 0037). A preview failure is a
  // warning on the run as well (record 0012).
  for (const { id, result } of previewed) {
    const words = lines(result.toolLog);
    log.group(logGroupTitle(id), [
      ...(result.ok
        ? diffLogLines(result.diff)
        : [`preview failed: ${previewFailureText(result.reason)}`, ...result.detail]),
      ...(words.length > 0 ? ["The tool's own words:", ...words] : []),
    ]);
  }
  for (const { id, result } of failed) {
    if (!result.ok) {
      log.warning(
        `The preview of ${logGroupTitle(id)} failed: ${previewFailureText(result.reason)}.`,
        "Preview failed",
      );
    }
  }

  // The dashboard is the product and the summary is its annex: a summary that
  // cannot be written never stops the scan (record 0037).
  await writeSummary(context, previewed);

  // All slow work is done. A full scan has a fresh row for every stack and
  // carries nothing, so the body does not depend on the live one.
  const at = startedAt.toISOString();
  const fitted = fitBody(
    {
      root: {
        scanSha: context.sha,
        scanRun: context.runId,
        scanAt: at,
        fullScanAt: at,
        fullScanRun: context.runId,
      },
      rows: previewed.map(({ id, result }) => previewRow(id, result, runUrl)),
      carried: [],
      redact: config.dashboard.redact,
      recentlyDeployed: [],
      repoUrl: context.repoUrl,
      actionRef: context.actionRef,
      personality: config.dashboard.personality,
    },
    context.limits?.body,
  );
  // A body over the hard limit is never handed to a writer (record 0028).
  if (!fitted.fits) throw new ScanFailedError(bodyDoesNotFitMessage(fitted.size));

  const written = await writeDashboard(context.github, config.dashboard, () => fitted.body);
  reportDashboard(context, written, fitted.shortened);

  if (everyPreviewFailed(previewed.length, failed.length)) {
    throw new ScanFailedError(
      `Every preview failed (${failed.length} of ${previewed.length}). That nearly always means the environment is broken, such as missing credentials or a backend that cannot be reached. The dashboard was written first and shows a preview failure on every row, which is true: nothing can be deployed either. The job log holds what the tool printed, in the group of each stack.`,
    );
  }
}

// Previews through the pool, in stack id order (record 0012). How long each
// preview took and the total go to the job log, because the right pool size
// and time limit for a runner are read from those numbers.
async function previewAll(context: ScanContext, stacks: ConfiguredStack[]): Promise<Previewed[]> {
  const { log, now, adapter } = context;
  if (stacks.length === 0) {
    // Nothing to preview, so a repo without stacks needs no tool.
    log.info("Found no stacks.");
    return [];
  }
  const tool = { root: context.root, env: context.env, run: context.run };
  try {
    await adapter.checkVersion(tool);
  } catch (error) {
    // The message is Sluiceway's own and fails the job. What the tool printed
    // stays in the job log (record 0022).
    if (error instanceof ToolVersionError && error.toolLog !== "") {
      log.group("The tool's own words", lines(error.toolLog));
    }
    throw error;
  }

  log.info(
    `Found ${plural(stacks.length, "stack")}. Previewing with a pool of ${context.concurrency} and a time limit of ${minutes(context.previewTimeoutMinutes)} for each preview.`,
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

function reportDashboard(context: ScanContext, written: DashboardResult, shortened: number): void {
  const { log } = context;
  const size = `${written.body.length.toLocaleString("en-US")} of ${BODY_LIMIT.toLocaleString("en-US")} characters`;
  log.info(`${FOUND[written.found]}: ${context.repoUrl}/issues/${written.number} (${size}).`);
  if (written.tries > 1) log.info(`The write took ${written.tries} tries.`);
  if (shortened > 0) log.info(`${plural(shortened, "row")} shortened to fit the size budget.`);
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
