// Auto mode as the one Sluiceway step of a real job (record 0077): the modes
// are the ones the split workflow runs as jobs of their own, built the same
// way, each handed the log and the outputs of this one step.

import { readFileSync } from "node:fs";
import * as core from "@actions/core";
import { readEventPayload } from "../github/event.ts";
import { readJob } from "../github/job.ts";
import { actionsLog } from "../github/job-log.ts";
import { actionsOutputs } from "../github/outputs.ts";
import { runApply } from "./apply-job.ts";
import { auto } from "./auto.ts";
import { backendContext } from "./check-backend.ts";
import { runCheck } from "./check-job.ts";
import { pullRequestPreviewContext } from "./check-pull-request.ts";
import { runResolve } from "./resolve-job.ts";
import { runScan } from "./scan-job.ts";
import { runSettle } from "./settle-job.ts";

// What the post step of action.yml reads back (see post-step.ts).
export const HANDED_ON_STATE = "sluiceway-handed-on";
export const SETTLED_STATE = "sluiceway-settled";

export async function runAuto(directory: string): Promise<void> {
  // The one read of the environment (build plan, section 5).
  const env = process.env;
  const job = readJob(env);
  await auto({
    root: job.root,
    eventName: job.event,
    event: readEventPayload(env, (path) => readFileSync(path, "utf8")),
    log: actionsLog(),
    notice: (line) => core.notice(line),
    outputs: actionsOutputs(env.RUNNER_TEMP),
    handedOn: () => core.saveState(HANDED_ON_STATE, "true"),
    settled: () => core.saveState(SETTLED_STATE, "true"),
    run: {
      scan: (step) => runScan(directory, step),
      resolve: (step) => runResolve(directory, step),
      apply: (deploymentId, step) => runApply(directory, { deploymentId, step }),
      settle: (step) => runSettle(directory, step),
      // The check starts no tool unless backend: true (record 0074) or
      // pull-request-preview: true (record 0101).
      check: (step) => runCheck(backendContext, step.log, pullRequestPreviewContext),
    },
  });
}
