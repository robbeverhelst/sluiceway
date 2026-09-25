// `settle` as a step of a real job: everything the mode is handed in a test is
// made here from the runner's environment, once. No tool environment and no
// process runner are handed on, because this job never runs the tool (record
// 0014, promise 4).

import { readFileSync } from "node:fs";
import * as core from "@actions/core";
import { tools } from "../adapters/tools.ts";
import { createGitHubClient } from "../github/client.ts";
import { readEventPayload } from "../github/event.ts";
import { readToken } from "../github/inputs.ts";
import { readJob } from "../github/job.ts";
import { actionsLog } from "../github/job-log.ts";
import { createOctokitPort } from "../github/octokit-port.ts";
import { actionsOutputs } from "../github/outputs.ts";
import { readWorkflowRef } from "../github/workflow-ref.ts";
import type { AutoStep } from "./auto.ts";
import { settle } from "./settle.ts";

// Auto mode hands in the log and the outputs of its one step (record 0077).
export async function runSettle(step?: AutoStep): Promise<void> {
  // The one read of the environment (build plan, section 5).
  const env = process.env;
  const token = readToken(core.getInput);
  const job = readJob(env);
  await settle({
    root: job.root,
    // Every tool, each stack to the adapter of its own (record 0053).
    adapter: tools,
    github: createOctokitPort(createGitHubClient(token), { owner: job.owner, repo: job.repo }),
    log: step?.log ?? actionsLog(),
    repoUrl: job.repoUrl,
    runId: job.runId,
    event: readEventPayload(env, (path) => readFileSync(path, "utf8")),
    workflow: readWorkflowRef(env),
    outputs: step?.outputs ?? actionsOutputs(env.RUNNER_TEMP),
  });
}
