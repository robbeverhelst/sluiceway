// What a person's terminal needs: plain lines, and a Node version the code
// can run on. Shared by the command line (record 0094) and by init started
// from the action's bundle (record 0065).

import type { JobLog } from "../github/job-log.ts";

// A runner starts the action on Node 24. A laptop can hold anything, and the
// code uses what Node 22 brought, so an older one stops here with words
// instead of a missing function.
export function refuseOldNode(version: string, who = "init"): void {
  const major = Number(version.split(".")[0]);
  if (major < 22) {
    throw new Error(`${who} needs Node 22 or newer, and this is Node ${version}.`);
  }
}

// Plain lines for a terminal, where a workflow command would show as text.
// There is no summary page, and the lines hold everything a summary would.
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
