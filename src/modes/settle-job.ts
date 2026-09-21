// `settle` as a step of a real job: everything the mode is handed in a test is
// made here from the runner's environment, once. No tool environment and no
// process runner are handed on, because this job never runs the tool (record
// 0014, promise 4).

import { readFileSync } from "node:fs";
import * as core from "@actions/core";
import { getOctokit } from "@actions/github";
import { pulumi } from "../adapters/pulumi/index.ts";
import { readEventPayload } from "../github/event.ts";
import { readToken } from "../github/inputs.ts";
import { readJob } from "../github/job.ts";
import { actionsLog } from "../github/job-log.ts";
import { createOctokitPort } from "../github/octokit-port.ts";
import { readWorkflowRef } from "../github/workflow-ref.ts";
import { settle } from "./settle.ts";

export async function runSettle(): Promise<void> {
  // The one read of the environment (build plan, section 5).
  const env = process.env;
  const token = readToken(core.getInput);
  const job = readJob(env);
  await settle({
    root: job.root,
    // The only adapter of v1. Only its discovery is used, which reads files.
    adapter: pulumi,
    github: createOctokitPort(getOctokit(token), { owner: job.owner, repo: job.repo }),
    log: actionsLog(),
    repoUrl: job.repoUrl,
    runId: job.runId,
    event: readEventPayload(env, (path) => readFileSync(path, "utf8")),
    workflow: readWorkflowRef(env),
  });
}
