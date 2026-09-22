// The check as a step of a real job. It reads one variable and builds no
// process runner and no GitHub port (record 0042): the check takes no token,
// and a test proves this file cannot reach the code that builds either.

import { discoverAll } from "../adapters/discover-all.ts";
import { actionsLog } from "../github/job-log.ts";
import { check } from "./check.ts";

export async function runCheck(): Promise<void> {
  const root = process.env.GITHUB_WORKSPACE;
  if (!root) {
    throw new Error(
      "GITHUB_WORKSPACE is not set. Sluiceway runs as a step of a GitHub Actions job.",
    );
  }
  await check({
    root,
    // Of every tool the check uses discovery and nothing else (records 0042
    // and 0053).
    adapter: { discover: discoverAll },
    log: actionsLog(),
  });
}
