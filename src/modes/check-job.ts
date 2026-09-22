// The check as a step of a real job. It reads one variable and builds no
// process runner and no GitHub port (record 0042): the check takes no token,
// and a test proves this file cannot reach the code that builds either. The
// one exception is backend: true (record 0074): the caller hands in what asks
// the backend, and it is used only when the input says so.

import * as core from "@actions/core";
import { discoverAll } from "../adapters/discover-all.ts";
import { readsFiles } from "../adapters/file-references.ts";
import { readBackend } from "../github/inputs.ts";
import { actionsLog, type JobLog } from "../github/job-log.ts";
import { type CheckContext, check } from "./check.ts";

// What asks the backend, built from the environment of the job.
export type BackendFactory = (
  env: Record<string, string | undefined>,
) => NonNullable<CheckContext["backend"]>;

// Auto mode hands in the log of its one step, whose summary it shares with
// nothing else on a pull request (record 0077).
export async function runCheck(makeBackend?: BackendFactory, log?: JobLog): Promise<void> {
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
  const backend = asked ? makeBackend?.({ ...process.env }) : undefined;
  await check({
    root,
    ...(backend === undefined ? {} : { backend }),
    // Of every tool the check uses discovery and what its files name as read,
    // and nothing that starts it (records 0042, 0053 and 0074).
    adapter: { discover: discoverAll, readsFiles },
    log: log ?? actionsLog(),
  });
}
