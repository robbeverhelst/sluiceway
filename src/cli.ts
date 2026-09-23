#!/usr/bin/env node
// The entry of the command line, `npx sluiceway` (record 0094). The action's
// entry is src/main.ts, and the two are built into two bundles.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runCli } from "./cli/run.ts";

// The version is read at run time from the package.json one directory up,
// as the action reads its own (build plan, section 3): release-please changes
// package.json and cannot rebuild dist/.
function packageVersion(): string {
  try {
    const file = fileURLToPath(new URL("../package.json", import.meta.url));
    return String(JSON.parse(readFileSync(file, "utf8")).version);
  } catch {
    return "unknown";
  }
}

process.exitCode = await runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  version: packageVersion(),
  nodeVersion: process.versions.node,
  out: (line) => console.log(line),
  err: (line) => console.error(line),
});
