// The check as a step of a real job. It reads one variable and builds no
// process runner and no GitHub port (record 0042): the check takes no token,
// and a test proves this file cannot reach the code that builds either. The
// one exception is backend: true (record 0074): the caller hands in what asks
// the backend, and it is used only when the input says so.

import * as core from "@actions/core";
import { filesOnly } from "../adapters/files-only.ts";
import { loadEnvFile } from "../github/env-file.ts";
import { readBackend, readEnvFileInput, readPullRequestPreview } from "../github/inputs.ts";
import { actionsLog, type JobLog } from "../github/job-log.ts";
import { type CheckContext, check } from "./check.ts";

// What asks the backend, built from the environment of the job.
export type BackendFactory = (
  env: Record<string, string | undefined>,
) => NonNullable<CheckContext["backend"]>;

// What previews a pull request, built from the environment of the job and
// handed the job's log (record 0101). It reaches the port and the process
// runner, which is why it is handed in and never imported here.
export type PullRequestPreviewFactory = (
  env: Record<string, string | undefined>,
  log: JobLog,
) => NonNullable<CheckContext["pullRequestPreview"]>;

// Auto mode hands in the log of its one step, whose summary it shares with
// nothing else on a pull request (record 0077).
export async function runCheck(
  makeBackend?: BackendFactory,
  log?: JobLog,
  makePreview?: PullRequestPreviewFactory,
): Promise<void> {
  const root = process.env.GITHUB_WORKSPACE;
  if (!root) {
    throw new Error(
      "GITHUB_WORKSPACE is not set. Sluiceway runs as a step of a GitHub Actions job.",
    );
  }
  const asked = readBackend(core.getInput);
  if (asked && makeBackend === undefined) {
    throw new Error("backend: true needs a runner for the tool, and this check has none.");
  }
  const previews = readPullRequestPreview(core.getInput);
  if (previews && makePreview === undefined) {
    throw new Error(
      "pull-request-preview: true needs the GitHub port and a runner for the tool, and this check has neither.",
    );
  }
  const jobLog = log ?? actionsLog();
  // Only with backend: true or pull-request-preview: true does the check run
  // the tool, so only then is the env file read for it, once for both
  // (records 0100 and 0101).
  const env =
    asked || previews
      ? loadEnvFile({
          input: readEnvFileInput(core.getInput),
          root,
          env: { ...process.env },
          mask: (value) => core.setSecret(value),
          log: jobLog,
        })
      : undefined;
  const backend = asked && env !== undefined ? makeBackend?.(env) : undefined;
  const pullRequestPreview = previews && env !== undefined ? makePreview?.(env, jobLog) : undefined;
  await check({
    root,
    ...(backend === undefined ? {} : { backend }),
    ...(pullRequestPreview === undefined ? {} : { pullRequestPreview }),
    // Of every tool the check uses what reads files, and nothing that starts
    // it (records 0042, 0053, 0074 and 0092).
    adapter: filesOnly,
    log: jobLog,
  });
}
