// The pull request preview part of the check (record 0101), which the
// dispatcher hands the check job and the job uses only with
// pull-request-preview: true. It is the one place the check can reach the
// GitHub port and start a tool for a preview: everything the preview needs is
// built here from the environment of the job, once, the way the scan job
// builds it.

import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import * as core from "@actions/core";
import { getOctokit } from "@actions/github";
import { runProcess } from "../adapters/process.ts";
import { tools } from "../adapters/tools.ts";
import { poolSize } from "../core/pool.ts";
import { pullRequestOf, readEventPayload } from "../github/event.ts";
import { readJobId, readScanInputs } from "../github/inputs.ts";
import { readJob } from "../github/job.ts";
import { createOctokitPort } from "../github/octokit-port.ts";
import type { PullRequestPreviewFactory } from "./check-job.ts";
import { previewPullRequest } from "./pull-request-preview.ts";

// The cores this job may use, as the scan counts them (record 0085).
function machineCores(): number | undefined {
  try {
    return availableParallelism();
  } catch {
    return undefined;
  }
}

export const pullRequestPreviewContext: PullRequestPreviewFactory = (env, log, mask) => {
  // The same inputs a scan reads: the pool, the time limit and the token.
  const inputs = readScanInputs(core.getInput);
  const job = readJob(env);
  const payload = readEventPayload(env, (path) => readFileSync(path, "utf8"));
  const context = {
    root: job.root,
    env,
    mask,
    adapter: tools,
    run: runProcess,
    github: createOctokitPort(getOctokit(inputs.token), { owner: job.owner, repo: job.repo }),
    log,
    now: () => new Date(),
    pool: poolSize(inputs.concurrency, machineCores()),
    previewTimeoutMinutes: inputs.previewTimeoutMinutes,
    repoUrl: job.repoUrl,
    runId: job.runId,
    runAttempt: job.runAttempt,
    jobId: readJobId(core.getInput),
    event: { name: job.event, pullRequest: pullRequestOf(payload) },
  };
  return (repo) => previewPullRequest(context, repo);
};
