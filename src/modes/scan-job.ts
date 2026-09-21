// The scan as a step of a real job: everything the scan mode is handed in a
// test is made here from the runner's environment, once.

import { readFileSync } from "node:fs";
import * as core from "@actions/core";
import { getOctokit } from "@actions/github";
import { runProcess } from "../adapters/process.ts";
import { pulumi } from "../adapters/pulumi/index.ts";
import { readActionRef } from "../github/action-ref.ts";
import { readJobId, readScanInputs } from "../github/inputs.ts";
import { readJob } from "../github/job.ts";
import { actionsLog } from "../github/job-log.ts";
import { createOctokitPort } from "../github/octokit-port.ts";
import { actionsOutputs } from "../github/outputs.ts";
import { countRequests } from "../github/request-count.ts";
import { scan } from "./scan.ts";

export async function runScan(): Promise<void> {
  // The one read of the environment (build plan, section 5).
  const env = process.env;
  const inputs = readScanInputs(core.getInput);
  const job = readJob(env);
  const octokit = getOctokit(inputs.token);
  await scan({
    root: job.root,
    env,
    // The only adapter of v1.
    adapter: pulumi,
    run: runProcess,
    github: createOctokitPort(octokit, { owner: job.owner, repo: job.repo }),
    requests: countRequests(octokit),
    log: actionsLog(),
    now: () => new Date(),
    concurrency: inputs.concurrency,
    previewTimeoutMinutes: inputs.previewTimeoutMinutes,
    repoUrl: job.repoUrl,
    runId: job.runId,
    runAttempt: job.runAttempt,
    jobId: readJobId(core.getInput),
    sha: job.sha,
    event: job.event,
    workflow: job.workflow,
    // A ref that can move, with no version to fall back on, fails the scan
    // here with its own message. It means the action's own files are broken,
    // and a dashboard without its version line would hide that.
    actionRef: readActionRef(env, (path) => readFileSync(path, "utf8")),
    outputs: actionsOutputs(env.RUNNER_TEMP),
  });
}
