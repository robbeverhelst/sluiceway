// `resolve` as a step of a real job: everything the mode is handed in a test
// is made here from the runner's environment, once. No tool environment and no
// process runner are handed on, because this job never runs the tool (record
// 0014, promise 4).

import { readFileSync } from "node:fs";
import * as core from "@actions/core";
import { getOctokit } from "@actions/github";
import { tools } from "../adapters/tools.ts";
import { readActionRef } from "../github/action-ref.ts";
import { readEventPayload } from "../github/event.ts";
import { readToken } from "../github/inputs.ts";
import { readJob } from "../github/job.ts";
import { actionsLog } from "../github/job-log.ts";
import { createOctokitPort } from "../github/octokit-port.ts";
import type { OutputName } from "../github/outputs.ts";
import { readWorkflowRef } from "../github/workflow-ref.ts";
import { stepNotifier } from "../notify/step.ts";
import type { AutoStep } from "./auto.ts";
import { type ResolveOutcome, resolve } from "./resolve.ts";

// Auto mode hands in the log and the outputs of its one step (record 0077).
export async function runResolve(directory: string, step?: AutoStep): Promise<ResolveOutcome> {
  // For the timing line (slice 5.23): the process started this long ago.
  const startup = process.uptime() * 1000;
  // The one read of the environment (build plan, section 5).
  const env = process.env;
  const read = (path: string) => readFileSync(path, "utf8");
  const token = readToken(core.getInput);
  const job = readJob(env);
  const log = step?.log ?? actionsLog();
  return await resolve({
    root: job.root,
    // Every tool, each stack to the adapter of its own (record 0053).
    adapter: tools,
    github: createOctokitPort(getOctokit(token), { owner: job.owner, repo: job.repo }),
    log,
    repoUrl: job.repoUrl,
    runId: job.runId,
    runAttempt: job.runAttempt,
    sha: job.sha,
    actionRef: readActionRef(env, directory, read),
    event: readEventPayload(env, read),
    workflow: readWorkflowRef(env),
    setOutput: (name, value) =>
      step ? step.outputs.set(name as OutputName, value) : core.setOutput(name, value),
    notifier: stepNotifier(core.getInput, log, core.setSecret),
    now: () => new Date(),
    startup,
  });
}
