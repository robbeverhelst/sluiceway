// The check mode (record 0042). It reads the repo's files and nothing else:
// no tool, no credential, no GitHub call, no write but the job log and the
// summary. Its context has no process runner and no port, and of the adapter
// it takes discovery alone, so it has no way to reach either.

import type { Adapter, FileReference } from "../adapters/adapter.ts";
import type { ProcessRunner } from "../adapters/process.ts";
import { type BackendCheck, checkSetup } from "../core/check.ts";
import { ConfigError } from "../core/config.ts";
import { hasConfigFile, loadConfig } from "../core/config-file.ts";
import { DiscoveryError, type DiscoveryNote } from "../core/discovery.ts";
import { repoFiles } from "../core/repo-files.ts";
import { type Stack, stackId } from "../core/stack.ts";
import { checkWorkflows, readWorkflowFiles } from "../core/workflow-check.ts";
import type { JobLog } from "../github/job-log.ts";
import {
  backendPart,
  type CheckPart,
  checkParts,
  closingPart,
  renderCheckFailure,
  renderCheckSummary,
} from "../render/check.ts";

export interface CheckContext {
  // The directory of the checked-out repo.
  root: string;
  adapter: Pick<Adapter, "discover" | "readsFiles" | "explainDiscovery">;
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

export async function check(context: CheckContext): Promise<void> {
  const { log, root } = context;
  let config: ReturnType<typeof loadConfig>;
  let report: ReturnType<typeof checkSetup>;
  let discovery: DiscoveryNote[];
  try {
    // In the order a scan does it, so the first error is the one a scan
    // would stop at. Not through core/repo.ts: the check reads the files of
    // every stack discovery found, the ignored ones too, before config is
    // laid over them, and reports on each `ignore` entry.
    config = loadConfig(root);
    const found = await context.adapter.discover(root, config);
    // What discovery found without an entry, and what it left out (record
    // 0092).
    discovery = (await context.adapter.explainDiscovery?.(root, config)) ?? [];
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

  // The workflow files (record 0061).
  const workflows = checkWorkflows(readWorkflowFiles(root), config);
  const parts = checkParts({
    report,
    discovery,
    workflows,
    unrelated: config.scan.unrelated,
    hasConfigFile: hasConfigFile(root),
  });
  for (const part of parts) write(log, part);

  // What the files say is in the job log before the backend is asked, which
  // may take minutes.
  if (context.backend !== undefined) {
    const stacks = report.stacks.map(({ stack }) => stack);
    const { checks, toolLog } = await askBackend(context.backend, root, stacks);
    const backend = backendPart(checks, config.ignore, toolLog);
    write(log, backend);
    parts.push(backend);
  }

  const closing = closingPart(context.backend !== undefined);
  await summary(context, renderCheckSummary([...parts, closing]));
  write(log, closing);
}

// Asks the backend about every stack that has a row (record 0074).
async function askBackend(
  backend: NonNullable<CheckContext["backend"]>,
  root: string,
  stacks: Stack[],
): Promise<{ checks: BackendCheck[]; toolLog: string }> {
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
  return { checks, toolLog: result?.toolLog ?? "" };
}

function write(log: JobLog, { log: entries }: CheckPart): void {
  for (const entry of entries) {
    if ("info" in entry) log.info(entry.info);
    else if ("warning" in entry) log.warning(entry.warning, entry.title);
    else log.group(entry.group, entry.lines);
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
