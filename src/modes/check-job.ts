// The check as a step of a real job. It reads one variable and builds no
// process runner and no GitHub port (record 0042): the check takes no token,
// and a test proves this file cannot reach the code that builds either.

import { pulumi } from "../adapters/pulumi/index.ts";
import { actionsLog } from "../github/job-log.ts";
import { check } from "./check.ts";

export async function runCheck(): Promise<void> {
  const root = process.env.GITHUB_WORKSPACE;
  if (!root) {
    throw new Error(
      "GITHUB_WORKSPACE is not set. Sluiceway runs as a step of a GitHub Actions job.",
    );
  }
  // The only adapter of v1. The check uses its discovery and nothing else.
  await check({ root, adapter: pulumi, log: actionsLog() });
}
