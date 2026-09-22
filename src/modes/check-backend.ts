// The backend part of the check (record 0074), which the dispatcher hands the
// check job and the job uses only with backend: true. It is the one place the
// check can start a tool:
// the adapters' own question to the backend, with the whole environment of
// the job but its inputs (record 0013). Nothing here talks to GitHub.

import { runProcess } from "../adapters/process.ts";
import { tools } from "../adapters/tools.ts";
import type { BackendFactory } from "./check-job.ts";

export const backendContext: BackendFactory = (env) => {
  return { adapter: tools, env, run: (run) => runProcess(run) };
};
