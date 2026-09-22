// init as a person starts it: from the action's bundle, in the top directory
// of their clone (record 0065). It builds no process runner and no GitHub
// port, and a test proves this file cannot reach the code that builds either.

import { discoverAll } from "../adapters/discover-all.ts";
import { actionsLog, type JobLog } from "../github/job-log.ts";
import { init } from "./init.ts";

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

// A runner starts the action on Node 24. A laptop can hold anything, and the
// code uses what Node 22 brought, so an older one stops here with words
// instead of a missing function.
export function refuseOldNode(version: string): void {
  const major = Number(version.split(".")[0]);
  if (major < 22) {
    throw new Error(`init needs Node 22 or newer, and this is Node ${version}.`);
  }
}

// Plain lines for a terminal, where a workflow command would show as text.
// init writes no summary, so there is none to write.
export function terminalLog(write: (line: string) => void = console.log): JobLog {
  return {
    info: write,
    group(title, lines) {
      write(title);
      for (const line of lines) write(`  ${line}`);
    },
    warning: (message, title) => write(`${title}: ${message}`),
    writeSummary: async () => {},
  };
}
