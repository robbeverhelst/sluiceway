// The command line (record 0094): `npx sluiceway init` and `npx sluiceway
// check`, run by a person where their repo is. It reads its arguments and
// nothing of the environment, and it can reach no process runner, no GitHub
// port and no sender, which a test walks its imports to prove. The modes that
// need a runner are refused, never half run.

import { statSync } from "node:fs";
import { resolve } from "node:path";
import { discoverAll } from "../adapters/discover-all.ts";
import { filesOnly } from "../adapters/files-only.ts";
import { check } from "../modes/check.ts";
import { init } from "../modes/init.ts";
import { DOCS } from "../render/docs-site.ts";
import { parseArgs } from "./args.ts";
import { refuseOldNode, terminalLog } from "./terminal.ts";

export interface CliIo {
  // Where the person stands. A path is read from here.
  cwd: string;
  // The version of the package, read at run time from its package.json.
  version: string;
  nodeVersion: string;
  out: (line: string) => void;
  err: (line: string) => void;
}

// A command that ran and failed, and a command line that was not understood.
const FAILED = 1;
const USAGE = 2;

export const HELP = `Usage:
  sluiceway init [--force] [path]
      Write .github/workflows/deploy-dashboard.yml and, when there is none,
      a first sluiceway.yaml, from the stacks it finds in the repo. It never
      overwrites a file. --force writes the workflow again.
  sluiceway check [path]
      Say which stacks it finds, and whether sluiceway.yaml and the
      workflow are right.
  sluiceway --version
  sluiceway --help

Both read the files at path, or where you stand, and nothing else: no
credentials, no token, no tool, no network. scan, resolve, apply and settle
run only in the workflow.

${DOCS.init}`;

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(argv);
  switch (parsed.command) {
    case "help":
      io.out(HELP);
      return 0;
    case "version":
      io.out(io.version);
      return 0;
    case "usage":
      if (argv.length === 0) {
        io.err(parsed.message);
        io.err("");
        io.err(HELP);
      } else {
        io.err(`${parsed.message} Run sluiceway --help to see the commands.`);
      }
      return USAGE;
    case "refused":
      io.err(
        `sluiceway ${parsed.mode} needs the run's identity and the workflow token, so it runs only in the workflow: ${DOCS.workflow}`,
      );
      return USAGE;
  }

  const log = terminalLog(io.out);
  try {
    refuseOldNode(io.nodeVersion, "sluiceway");
    const root = resolve(io.cwd, parsed.path ?? ".");
    if (!isDirectory(root)) throw new Error(`There is no directory at ${root}.`);
    if (parsed.command === "init") {
      await init({ root, adapter: { discover: discoverAll }, log, force: parsed.force });
    } else {
      await check({ root, adapter: filesOnly, log });
    }
    return 0;
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return FAILED;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
