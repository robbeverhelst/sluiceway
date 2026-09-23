// init as a person starts it: from the action's bundle, in the top directory
// of their clone (record 0065). It builds no process runner and no GitHub
// port, and a test proves this file cannot reach the code that builds either.

import { discoverAll } from "../adapters/discover-all.ts";
import { refuseOldNode, terminalLog } from "../cli/terminal.ts";
import { actionsLog } from "../github/job-log.ts";
import { init } from "./init.ts";

export { refuseOldNode, terminalLog };

export async function runInit(): Promise<void> {
  refuseOldNode(process.versions.node);
  // In a job, the checkout. On a laptop, where the person stands.
  const root = process.env.GITHUB_WORKSPACE || process.cwd();
  await init({
    root,
    adapter: { discover: discoverAll },
    log: process.env.GITHUB_ACTIONS === "true" ? actionsLog() : terminalLog(),
  });
}
