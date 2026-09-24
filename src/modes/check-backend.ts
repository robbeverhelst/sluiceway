// The backend part of the check (record 0074), which the dispatcher hands the
// check job and the job uses only with backend: true. It is the one place the
// check can start a tool:
// the adapters' own question to the backend, with the whole environment of
// the job but its inputs (record 0013), and the env file of a stack on top
// (record 0103). Nothing here talks to GitHub.

import { runProcess } from "../adapters/process.ts";
import { tools } from "../adapters/tools.ts";
import { stackEnvFiles } from "../github/env-file.ts";
import type { BackendFactory } from "./check-job.ts";

export const backendContext: BackendFactory = (env, glue) => {
  return {
    adapter: tools,
    env,
    stackEnvs: stackEnvFiles({ ...glue, env }),
    run: (run) => runProcess(run),
  };
};
