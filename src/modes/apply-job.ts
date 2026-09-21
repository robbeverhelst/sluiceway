// `apply` as a step of a real job: everything the mode is handed in a test is
// made here from the runner's environment, once.

import { readFileSync } from "node:fs";
import * as core from "@actions/core";
import { getOctokit } from "@actions/github";
import { runProcess } from "../adapters/process.ts";
import { pulumi } from "../adapters/pulumi/index.ts";
import { readActionRef } from "../github/action-ref.ts";
import { readEventPayload } from "../github/event.ts";
import { readApplyInputs } from "../github/inputs.ts";
import { readJob } from "../github/job.ts";
import { actionsLog } from "../github/job-log.ts";
import { createOctokitPort } from "../github/octokit-port.ts";
import { actionsOutputs } from "../github/outputs.ts";
import { apply } from "./apply.ts";

export async function runApply(): Promise<void> {
  // The one read of the environment (build plan, section 5).
  const env = process.env;
  const inputs = readApplyInputs(core.getInput);
  const job = readJob(env);
  await apply({
    root: job.root,
    env,
    // The only adapter of v1.
    adapter: pulumi,
    run: runProcess,
    github: createOctokitPort(getOctokit(inputs.token), { owner: job.owner, repo: job.repo }),
    log: actionsLog(),
    previewTimeoutMinutes: inputs.previewTimeoutMinutes,
    repoUrl: job.repoUrl,
    runId: job.runId,
    sha: job.sha,
    actionRef: readActionRef(env, (path) => readFileSync(path, "utf8")),
    deploymentId: inputs.deploymentId,
    event: readEventPayload(env, (path) => readFileSync(path, "utf8")),
    outputs: actionsOutputs(env.RUNNER_TEMP),
  });
}
