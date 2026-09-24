// `apply` as a step of a real job: everything the mode is handed in a test is
// made here from the runner's environment, once.

import { readFileSync } from "node:fs";
import * as core from "@actions/core";
import { getOctokit } from "@actions/github";
import { runProcess } from "../adapters/process.ts";
import { tools } from "../adapters/tools.ts";
import { readActionRef } from "../github/action-ref.ts";
import { loadEnvFile } from "../github/env-file.ts";
import { readEventPayload } from "../github/event.ts";
import { readApplyInputs, readEnvFileInput, readJobId } from "../github/inputs.ts";
import { readJob } from "../github/job.ts";
import { actionsLog } from "../github/job-log.ts";
import { createOctokitPort } from "../github/octokit-port.ts";
import { actionsOutputs } from "../github/outputs.ts";
import { stepNotifier } from "../notify/step.ts";
import { apply } from "./apply.ts";
import type { AutoStep } from "./auto.ts";

// Auto mode hands in the record resolve or the scan handed on, and the log
// and the outputs of its one step (record 0077). Every other input is the
// step's own, dry-run and deploy-timeout included.
export async function runApply(
  directory: string,
  handed?: { deploymentId: number; step: AutoStep },
): Promise<void> {
  // The one read of the environment (build plan, section 5).
  const env = process.env;
  const inputs = readApplyInputs((name) =>
    handed && name === "deployment-id" ? String(handed.deploymentId) : core.getInput(name),
  );
  const job = readJob(env);
  const log = handed?.step.log ?? actionsLog();
  await apply({
    root: job.root,
    // The tool's environment: the job's, with the env file on top (record
    // 0100), masked before anything else is printed.
    env: loadEnvFile({
      input: readEnvFileInput(core.getInput),
      root: job.root,
      env,
      mask: (value) => core.setSecret(value),
      log,
    }),
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
    outputs: handed?.step.outputs ?? actionsOutputs(env.RUNNER_TEMP),
    notifier: stepNotifier(core.getInput, log, core.setSecret),
  });
}
