// The scan as a step of a real job: everything the scan mode is handed in a
// test is made here from the runner's environment, once.

import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import * as core from "@actions/core";
import { getOctokit } from "@actions/github";
import { runProcess } from "../adapters/process.ts";
import { tools } from "../adapters/tools.ts";
import { poolSize } from "../core/pool.ts";
import { readActionRef } from "../github/action-ref.ts";
import {
  mergedBeforeDispatch,
  publicRepo,
  readEventPayload,
  startedByPerson,
} from "../github/event.ts";
import { readJobId, readScanInputs } from "../github/inputs.ts";
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
  const octokit = getOctokit(inputs.token);
  const payload = readEventPayload(env, (path) => readFileSync(path, "utf8"));
  await scan({
    root: job.root,
    env,
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
  });
}
