// The check mode (record 0042). It reads the repo's files and nothing else:
// no tool, no credential, no GitHub call, no write but the job log and the
// summary. Its context has no process runner and no port, and of the adapter
// it takes discovery alone, so it has no way to reach either.

import type { Adapter, FileReference } from "../adapters/adapter.ts";
import type { ProcessRunner } from "../adapters/process.ts";
import { type BackendCheck, checkSetup } from "../core/check.ts";
import { ConfigError, type IgnoreEntry } from "../core/config.ts";
import { hasConfigFile, loadConfig } from "../core/config-file.ts";
import { DiscoveryError } from "../core/discovery.ts";
import { repoFiles } from "../core/repo-files.ts";
import { type Stack, stackId } from "../core/stack.ts";
import { checkWorkflows, readWorkflowFiles, type WorkflowReport } from "../core/workflow-check.ts";
import type { JobLog } from "../github/job-log.ts";
import {
  ALL_IN_BACKEND,
  BACKEND_OFF,
  BACKEND_PASTE_NOTE,
  BACKEND_PASTE_TITLE,
  BACKEND_TITLE,
  backendText,
  CANNOT_TELL,
  CANNOT_TELL_WITH_BACKEND,
  COULD_NOT_ASK_TITLE,
  couldNotAskText,
  foundText,
  ignoreBlock,
  ignoreText,
  inputsBlock,
  NO_CONFIG_FILE,
  NO_SCAN_WORKFLOW,
  NOT_IN_BACKEND_TITLE,
  NOTHING_MISSING,
  notInBackendText,
  phaseLines,
  READ_WARNING_TITLE,
  READS_NOTE,
  READS_PASTE_TITLE,
  READS_TITLE,
  readText,
  readWarningText,
  renderCheckFailure,
  renderCheckSummary,
  scansSomewhere,
  settingsText,
  unclaimedText,
  unmatchedText,
  unrelatedBlock,
  VALID,
  WORKFLOW_WARNING_TITLE,
  whereFilesBelong,
  workflowJobText,
  workflowNoteText,
  workflowWarningText,
} from "../render/check.ts";
import { logGroupTitle } from "../render/log-text.ts";

export interface CheckContext {
  // The directory of the checked-out repo.
  root: string;
  adapter: Pick<Adapter, "discover" | "readsFiles">;
  log: JobLog;
  // Only with backend: true (record 0074): the one thing the check asks a
  // tool, with the environment of its job, which holds the credentials the
  // workflow loaded. Without it the check starts nothing.
  backend?: {
    adapter: Pick<Adapter, "findInBackend">;
    env: Record<string, string | undefined>;
    run: ProcessRunner;
  };
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
    // What each stack's own files name as read (record 0074).
    const references = new Map<string, FileReference[]>();
    const readsFiles = context.adapter.readsFiles;
    if (readsFiles !== undefined) {
      for (const stack of found) references.set(stackId(stack), await readsFiles(root, stack));
    }
    report = checkSetup(config, found, await repoFiles(root), references);
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
    log.info(whereFilesBelong(report.shared));
    if (report.suggested.length > 0) {
      log.group(
        "Ready to paste into sluiceway.yaml",
        unrelatedBlock(config.scan.unrelated, report.suggested).map(line),
      );
    }
  }

  if (report.reads.length > 0) {
    log.group(
      READS_TITLE,
      report.reads.map((read) => line(readText(read))),
    );
    for (const read of report.reads.filter((one) => one.missed)) {
      log.warning(line(readWarningText(read)), READ_WARNING_TITLE);
    }
    log.info(READS_NOTE);
    log.group(READS_PASTE_TITLE, inputsBlock(report.inputs).map(line));
  }

  // The workflow files (record 0061). What they lack is a warning, never a
  // red job: GitHub is the one that validates and runs them.
  const workflows = checkWorkflows(readWorkflowFiles(root), config);
  logWorkflows(log, workflows);

  const backend =
    context.backend === undefined
      ? undefined
      : await askBackend(
          context.backend,
          root,
          report.stacks.map(({ stack }) => stack),
          config.ignore,
          log,
        );

  await summary(
    context,
    renderCheckSummary({
      report,
      workflows,
      unrelated: config.scan.unrelated,
      hasConfigFile: configFile,
      backend: backend === undefined ? undefined : { checks: backend, ignore: config.ignore },
    }),
  );
  log.info(VALID);
  if (backend === undefined) {
    log.info(CANNOT_TELL);
    log.info(BACKEND_OFF);
  } else {
    log.info(CANNOT_TELL_WITH_BACKEND);
  }
}

// Asks the backend about every stack that has a row (record 0074). What it
// finds is a warning: the job's red stays the verdict of record 0042.
async function askBackend(
  backend: NonNullable<CheckContext["backend"]>,
  root: string,
  stacks: Stack[],
  ignore: IgnoreEntry[],
  log: JobLog,
): Promise<BackendCheck[]> {
  const result = await backend.adapter.findInBackend?.(stacks, {
    root,
    env: backend.env,
    run: backend.run,
  });
  const answers = new Map((result?.answers ?? []).map((answer) => [stackId(answer.stack), answer]));
  const checks = stacks.map((stack): BackendCheck => {
    const id = stackId(stack);
    const answer = answers.get(id);
    if (answer === undefined) return { stackId: id, found: "unchecked" };
    return answer.found === "unknown"
      ? { stackId: id, found: "unknown", reason: answer.reason }
      : { stackId: id, found: answer.found };
  });

  if (result !== undefined && result.toolLog !== "") {
    log.group("The tool's own words", result.toolLog.replace(/\n$/, "").split("\n"));
  }
  log.group(
    BACKEND_TITLE,
    checks.map((check) => line(backendText(check))),
  );
  for (const check of checks) {
    if (check.found === "unknown") log.warning(line(couldNotAskText(check)), COULD_NOT_ASK_TITLE);
    if (check.found === false)
      log.warning(line(notInBackendText(check.stackId)), NOT_IN_BACKEND_TITLE);
  }
  const missing = checks.filter((check) => check.found === false).map((check) => check.stackId);
  if (missing.length > 0) {
    log.info(BACKEND_PASTE_NOTE);
    log.group(BACKEND_PASTE_TITLE, ignoreBlock(ignore, missing).map(line));
  } else if (checks.some((check) => check.found === true)) {
    log.info(ALL_IN_BACKEND);
  }
  return checks;
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
