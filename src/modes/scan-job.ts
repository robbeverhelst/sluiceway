// The scan as a step of a real job: everything the scan mode is handed in a
// test is made here from the runner's environment, once.

import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import * as core from "@actions/core";
import { runProcess } from "../adapters/process.ts";
import { tools } from "../adapters/tools.ts";
import { poolSize } from "../core/pool.ts";
import { readActionRef } from "../github/action-ref.ts";
import { createGitHubClient } from "../github/client.ts";
import { loadEnvFile } from "../github/env-file.ts";
import {
  mergedBeforeDispatch,
  mergedBy,
  publicRepo,
  readEventPayload,
  startedByPerson,
} from "../github/event.ts";
import { readEnvFileInput, readJobId, readScanInputs } from "../github/inputs.ts";
import { readJob } from "../github/job.ts";
import { actionsLog } from "../github/job-log.ts";
import { createOctokitPort } from "../github/octokit-port.ts";
import { actionsOutputs } from "../github/outputs.ts";
import { countRequests } from "../github/request-count.ts";
import { stepNotifier } from "../notify/step.ts";
import type { AutoStep } from "./auto.ts";
import { scan } from "./scan.ts";

// The cores this job may use. Node counts the ones the process may run on and
// takes a container's CPU limit into account, and says 1 at the least. A
// runtime that cannot say gives undefined, and the pool is 1 (record 0085).
function machineCores(): number | undefined {
  try {
    return availableParallelism();
  } catch {
    return undefined;
  }
}

// Auto mode hands in the log and the outputs of its one step (record 0077).
export async function runScan(directory: string, step?: AutoStep): Promise<void> {
  // The one read of the environment (build plan, section 5).
  const env = process.env;
  const inputs = readScanInputs(core.getInput);
  const job = readJob(env);
  const log = step?.log ?? actionsLog();
  const octokit = createGitHubClient(inputs.token);
  const payload = readEventPayload(env, (path) => readFileSync(path, "utf8"));
  await scan({
    root: job.root,
    // The tool's environment: the job's, with the env file on top (record
    // 0100). Every value is masked before anything else is printed. What
    // Sluiceway reads for itself came from `env` above, never from the file.
    env: loadEnvFile({
      input: readEnvFileInput(core.getInput),
      root: job.root,
      env,
      mask: (value) => core.setSecret(value),
      log,
    }),
    // The values of the env file a stack names are masked the same way
    // (record 0103).
    mask: (value) => core.setSecret(value),
    // Every tool, each stack to the adapter of its own (record 0053).
    adapter: tools,
    run: runProcess,
    github: createOctokitPort(octokit, { owner: job.owner, repo: job.repo }),
    requests: countRequests(octokit),
    log,
    now: () => new Date(),
    pool: poolSize(inputs.concurrency, machineCores()),
    previewTimeoutMinutes: inputs.previewTimeoutMinutes,
    strict: inputs.strict,
    repoUrl: job.repoUrl,
    runId: job.runId,
    runAttempt: job.runAttempt,
    jobId: readJobId(core.getInput),
    sha: job.sha,
    event: job.event,
    afterMerge: mergedBeforeDispatch(payload),
    workflow: job.workflow,
    // A ref that can move, with no version to fall back on, fails the scan
    // here with its own message. It means the action's own files are broken,
    // and a dashboard without its version line would hide that.
    actionRef: readActionRef(env, directory, (path) => readFileSync(path, "utf8")),
    outputs: step?.outputs ?? actionsOutputs(env.RUNNER_TEMP),
    notifier: stepNotifier(core.getInput, log, core.setSecret),
    publicRepo: publicRepo(payload),
    startedByPerson: startedByPerson(payload),
    mergedBy: mergedBy(job.event, payload),
  });
}
