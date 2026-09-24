// The check mode (record 0042). It reads the repo's files and nothing else:
// no tool, no credential, no GitHub call, no write but the job log and the
// summary. Its context has no process runner and no port, and of the adapter
// it takes discovery alone, so it has no way to reach either.

import type { Adapter, BackendAnswer, FileReference } from "../adapters/adapter.ts";
import type { ProcessRunner } from "../adapters/process.ts";
import { type BackendCheck, checkSetup } from "../core/check.ts";
import { type Config, ConfigError, type ConfiguredStack } from "../core/config.ts";
import { hasConfigFile, loadConfig } from "../core/config-file.ts";
import { judgeJobs, type StackNeeds } from "../core/credentials.ts";
import { DiscoveryError, type DiscoveryNote } from "../core/discovery.ts";
import type { StackEnvLoader } from "../core/env-file.ts";
import { repoFiles } from "../core/repo-files.ts";
import { stackId } from "../core/stack.ts";
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
  adapter: Pick<Adapter, "discover" | "readsFiles" | "explainDiscovery" | "credentialNeeds">;
  log: JobLog;
  // Only with backend: true (record 0074): the one thing the check asks a
  // tool, with the environment of its job, which holds the credentials the
  // workflow loaded. Without it the check starts nothing.
  backend?: {
    adapter: Pick<Adapter, "findInBackend">;
    env: Record<string, string | undefined>;
    // The env file of each stack on top of it (record 0103), read and masked
    // by the glue that hands this in: the check itself reads no such file.
    stackEnvs: StackEnvLoader;
    run: ProcessRunner;
  };
  // Only with pull-request-preview: true (record 0101): the preview of the
  // stacks the pull request claims, with the credentials of its job, handed
  // in by the dispatcher the way the backend is. It gets the config and the
  // stacks the check found, and gives back its part of the log and the
  // summary. Without it the check previews nothing.
  pullRequestPreview?: (repo: { config: Config; stacks: ConfiguredStack[] }) => Promise<CheckPart>;
}

export async function check(context: CheckContext): Promise<void> {
  const { log, root } = context;
  let config: ReturnType<typeof loadConfig>;
  let report: ReturnType<typeof checkSetup>;
  let discovery: DiscoveryNote[];
  const needs: StackNeeds[] = [];
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
    // What each stack's own files say its tool will want (record 0099), for
    // the stacks that have a row.
    const credentialNeeds = context.adapter.credentialNeeds;
    if (credentialNeeds !== undefined) {
      for (const { stack, envFile } of report.stacks) {
        needs.push({
          stackId: stackId(stack),
          needs: await credentialNeeds(root, stack),
          // Its env file provides the names it lists (record 0103).
          ...(envFile === undefined ? {} : { envFile }),
        });
      }
    }
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
    credentials: { stacks: needs, jobs: judgeJobs(needs, workflows.workflows, root) },
    unrelated: config.scan.unrelated,
    hasConfigFile: hasConfigFile(root),
  });
  for (const part of parts) write(log, part);

  // What the files say is in the job log before the backend is asked, which
  // may take minutes.
  if (context.backend !== undefined) {
    const { checks, toolLog } = await askBackend(context.backend, root, report.stacks);
    const backend = backendPart(checks, config.ignore, toolLog);
    write(log, backend);
    parts.push(backend);
  }

  // The pull request preview, last of the slow work (record 0101).
  if (context.pullRequestPreview !== undefined) {
    const preview = await context.pullRequestPreview({ config, stacks: report.stacks });
    write(log, preview);
    parts.push(preview);
  }

  const closing = closingPart(
    context.backend !== undefined,
    context.pullRequestPreview !== undefined,
  );
  await summary(context, renderCheckSummary([...parts, closing]));
  write(log, closing);
}

// Asks the backend about every stack that has a row (record 0074), one env
// file at a time, with the environment of the stacks it asks about (record
// 0103). A stack whose file could not be loaded is not asked.
async function askBackend(
  backend: NonNullable<CheckContext["backend"]>,
  root: string,
  stacks: ConfiguredStack[],
): Promise<{ checks: BackendCheck[]; toolLog: string }> {
  const envs = backend.stackEnvs(
    stacks.map(({ stack, envFile }) => ({ id: stackId(stack), envFile })),
  );
  const answers = new Map<string, BackendAnswer>();
  const logs: string[] = [];
  for (const group of Map.groupBy(stacks, (one) => one.envFile).values()) {
    const first = group[0];
    if (first === undefined) continue;
    const own = envs.get(stackId(first.stack));
    if (own?.ok === false) {
      for (const { stack } of group) {
        answers.set(stackId(stack), {
          stack,
          found: "unknown",
          reason: { kind: "env-file-not-loaded" },
        });
      }
      continue;
    }
    const result = await backend.adapter.findInBackend?.(
      group.map(({ stack }) => stack),
      { root, env: own?.ok ? own.env : backend.env, run: backend.run },
    );
    for (const answer of result?.answers ?? []) answers.set(stackId(answer.stack), answer);
    if (result !== undefined && result.toolLog !== "") logs.push(result.toolLog);
  }
  const checks = stacks.map(({ stack, createInBackend }): BackendCheck => {
    const id = stackId(stack);
    const answer = answers.get(id);
    // Whether the first scan creates the stack (record 0107) rides along.
    const creates = createInBackend === undefined ? {} : { createInBackend };
    if (answer === undefined) return { stackId: id, ...creates, found: "unchecked" };
    return answer.found === "unknown"
      ? { stackId: id, ...creates, found: "unknown", reason: answer.reason }
      : { stackId: id, ...creates, found: answer.found };
  });
  return { checks, toolLog: logs.join("") };
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
