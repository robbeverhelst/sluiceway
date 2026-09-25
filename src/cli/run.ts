// The command line (records 0094 and 0116): `npx sluiceway init` and `npx
// sluiceway check`, run by a person where their repo is, and the commands
// that talk to the app with the person's token. It reads its arguments and
// nothing of the environment, and it can reach no process runner, no GitHub
// port and no sender, which a test walks its imports to prove. init and the
// check make no network call; the app's commands call the app alone. The
// modes that need a runner are refused, never half run.

import { statSync } from "node:fs";
import { resolve } from "node:path";
import { discoverAll } from "../adapters/discover-all.ts";
import { filesOnly } from "../adapters/files-only.ts";
import { check } from "../modes/check.ts";
import { init } from "../modes/init.ts";
import { DOCS } from "../render/docs-site.ts";
import { type AppIo, runAppCommand } from "./app-commands.ts";
import { DEFAULT_APP, parseArgs } from "./args.ts";
import { EXIT } from "./exit.ts";
import { refuseOldNode, terminalLog } from "./terminal.ts";

export interface CliIo extends AppIo {
  // Where the person stands. A path is read from here.
  cwd: string;
  // The version of the package, read at run time from its package.json.
  version: string;
  nodeVersion: string;
}

const FAILED = EXIT.failed;
const USAGE = EXIT.usage;

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

${DOCS.init}

With the Sluiceway app, as the person whose token it is:
  sluiceway login          Paste a token from the app, or pipe it in.
  sluiceway logout
  sluiceway status [repo]  The org's stacks, or a repo's, by state.
  sluiceway stack <repo> <stack id>
                           A stack's row and its preview page.
  sluiceway tick <repo> <stack id> [--yes]
                           Tick it. A destroy needs --yes. Prints the
                           deployment record once it waits to start.
  sluiceway rescan <repo>  Ask GitHub for a full scan.
  sluiceway settings <repo> [set <key>=<value> ...]
                           Read the keys, or open a pull request that
                           sets them.

These call the app alone, over HTTPS, and never GitHub. --json answers in
JSON, and --app <address> names another app than ${DEFAULT_APP}.
Exit codes: 0 done, 1 failed, 2 not understood, 3 not signed in, 4 not
found, 5 refused, 6 try again later.`;

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
    case "login":
    case "logout":
    case "status":
    case "stack":
    case "tick":
    case "rescan":
    case "settings":
      return runAppCommand(parsed, io);
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
