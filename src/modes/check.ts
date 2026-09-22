// The check mode (record 0042). It reads the repo's files and nothing else:
// no tool, no credential, no GitHub call, no write but the job log and the
// summary. Its context has no process runner and no port, and of the adapter
// it takes discovery alone, so it has no way to reach either.

import type { Adapter } from "../adapters/adapter.ts";
import { checkSetup } from "../core/check.ts";
import { ConfigError } from "../core/config.ts";
import { hasConfigFile, loadConfig } from "../core/config-file.ts";
import { DiscoveryError } from "../core/discovery.ts";
import { repoFiles } from "../core/repo-files.ts";
import { stackId } from "../core/stack.ts";
import { checkWorkflows, readWorkflowFiles, type WorkflowReport } from "../core/workflow-check.ts";
import type { JobLog } from "../github/job-log.ts";
import {
  CANNOT_TELL,
  foundText,
  ignoreText,
  NO_CONFIG_FILE,
  NO_SCAN_WORKFLOW,
  NOTHING_MISSING,
  phaseLines,
  renderCheckFailure,
  renderCheckSummary,
  scansSomewhere,
  settingsText,
  unclaimedText,
  unmatchedText,
  unrelatedBlock,
  VALID,
  WHERE_FILES_BELONG,
  WORKFLOW_WARNING_TITLE,
  workflowJobText,
  workflowNoteText,
  workflowWarningText,
} from "../render/check.ts";
import { logGroupTitle } from "../render/log-text.ts";

export interface CheckContext {
  // The directory of the checked-out repo.
  root: string;
  adapter: Pick<Adapter, "discover">;
  log: JobLog;
}

// A name from the repo never starts a line of its own in the job log.
const line = logGroupTitle;

export async function check(context: CheckContext): Promise<void> {
  const { log, root } = context;
  let config: ReturnType<typeof loadConfig>;
  let report: ReturnType<typeof checkSetup>;
  try {
    // In the order a scan does it, so the first error is the one a scan
    // would stop at.
    config = loadConfig(root);
    const found = await context.adapter.discover(root, config);
    report = checkSetup(config, found, await repoFiles(root));
  } catch (error) {
    // The job goes red only here: the config is not valid or discovery
    // failed (record 0042). The message is the same a scan gives.
    if (error instanceof ConfigError || error instanceof DiscoveryError) {
      await summary(
        context,
        renderCheckFailure(error instanceof ConfigError ? "config" : "discovery", error.problems),
      );
    }
    throw error;
  }

  const configFile = hasConfigFile(root);
  if (!configFile) log.info(NO_CONFIG_FILE);

  log.info(foundText(report.stacks.length));
  if (report.stacks.length > 0) {
    log.group(
      "Stacks",
      report.stacks.map((configured) =>
        line(`${stackId(configured.stack)}: ${settingsText(configured, report.phases)}`),
      ),
    );
  }
  if (report.phases.length > 0) log.group("Phases", phaseLines(report.phases).map(line));

  for (const entry of report.ignore) {
    if (entry.stacks.length > 0) log.info(line(ignoreText(entry)));
    else log.warning(line(unmatchedText(entry)), "An ignore glob matches no stack");
  }

  const unclaimed = report.unclaimed.flatMap((group) => group.files);
  if (unclaimed.length > 0) {
    log.info(unclaimedText(unclaimed.length));
    log.group("Files that no stack claims", unclaimed.map(line));
    log.info(WHERE_FILES_BELONG);
    if (report.suggested.length > 0) {
      log.group(
        "Ready to paste into sluiceway.yaml",
        unrelatedBlock(config.scan.unrelated, report.suggested).map(line),
      );
    }
  }

  // The workflow files (record 0061). What they lack is a warning, never a
  // red job: GitHub is the one that validates and runs them.
  const workflows = checkWorkflows(readWorkflowFiles(root), config);
  logWorkflows(log, workflows);

  await summary(
    context,
    renderCheckSummary({
      report,
      workflows,
      unrelated: config.scan.unrelated,
      hasConfigFile: configFile,
    }),
  );
  log.info(VALID);
  log.info(CANNOT_TELL);
}

function logWorkflows(log: JobLog, workflows: WorkflowReport): void {
  if (workflows.workflows.length > 0) {
    log.group(
      "Workflows",
      workflows.workflows.flatMap(({ path, jobs }) =>
        jobs.map((job) => line(workflowJobText(path, job))),
      ),
    );
  }
  if (!scansSomewhere(workflows)) log.info(NO_SCAN_WORKFLOW);
  for (const warning of workflows.warnings) {
    log.warning(line(workflowWarningText(warning)), WORKFLOW_WARNING_TITLE);
  }
  for (const note of workflows.notes) log.info(line(workflowNoteText(note)));
  if (workflows.workflows.length > 0 && workflows.warnings.length === 0) {
    log.info(NOTHING_MISSING);
  }
}

// The job log holds everything the summary holds, so a summary that cannot be
// written costs nothing but the page.
async function summary(context: CheckContext, text: string): Promise<void> {
  try {
    await context.log.writeSummary(text);
  } catch (error) {
    context.log.info(
      `Writing the summary failed: ${error instanceof Error ? error.message : error}`,
    );
  }
}
