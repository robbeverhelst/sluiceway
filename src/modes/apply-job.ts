// `apply` as a step of a real job: everything the mode is handed in a test is
// made here from the runner's environment, once.

import { readFileSync } from "node:fs";
import * as core from "@actions/core";
import { getOctokit } from "@actions/github";
import { runProcess } from "../adapters/process.ts";
import { tools } from "../adapters/tools.ts";
import { readActionRef } from "../github/action-ref.ts";
import { readEventPayload } from "../github/event.ts";
import { readApplyInputs, readJobId } from "../github/inputs.ts";
import { readJob } from "../github/job.ts";
import { actionsLog } from "../github/job-log.ts";
import { createOctokitPort } from "../github/octokit-port.ts";
import { actionsOutputs } from "../github/outputs.ts";
import { stepNotifier } from "../notify/step.ts";
import { apply } from "./apply.ts";

export async function runApply(directory: string): Promise<void> {
  // The one read of the environment (build plan, section 5).
  const env = process.env;
  const inputs = readApplyInputs(core.getInput);
  const job = readJob(env);
  const log = actionsLog();
  await apply({
    root: job.root,
    env,
    // Every tool, each stack to the adapter of its own (record 0053).
    adapter: tools,
    run: runProcess,
    github: createOctokitPort(getOctokit(inputs.token), { owner: job.owner, repo: job.repo }),
    log,
    previewTimeoutMinutes: inputs.previewTimeoutMinutes,
    deployTimeoutMinutes: inputs.deployTimeoutMinutes,
    now: () => new Date(),
    repoUrl: job.repoUrl,
    runId: job.runId,
    runAttempt: job.runAttempt,
    jobId: readJobId(core.getInput),
    sha: job.sha,
    actionRef: readActionRef(env, directory, (path) => readFileSync(path, "utf8")),
    deploymentId: inputs.deploymentId,
    dryRun: inputs.dryRun,
    event: readEventPayload(env, (path) => readFileSync(path, "utf8")),
    outputs: actionsOutputs(env.RUNNER_TEMP),
    notifier: stepNotifier(core.getInput, log, core.setSecret),
  });
}
