#!/usr/bin/env node
// The entry of the command line, `npx sluiceway` (records 0094 and 0116). The
// action's entry is src/main.ts, and the two are built into two bundles.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./cli/run.ts";
import { type CommandRun, tokenStore } from "./cli/token-store.ts";

// A standalone binary has the version compiled in by the release, which
// builds it from the release tag (record 0116). The bundle on npm has none.
declare const SLUICEWAY_VERSION: string | undefined;

// The version is read at run time from the package.json one directory up,
// as the action reads its own (build plan, section 3): release-please changes
// package.json and cannot rebuild dist/.
function packageVersion(): string {
  if (typeof SLUICEWAY_VERSION === "string") return SLUICEWAY_VERSION;
  try {
    const file = fileURLToPath(new URL("../package.json", import.meta.url));
    return String(JSON.parse(readFileSync(file, "utf8")).version);
  } catch {
    return "unknown";
  }
}

// Where the operating system keeps a person's settings. This is where the
// token file goes when there is no keychain; the token itself never comes
// from the environment.
function configDir(): string {
  if (process.platform === "win32") {
    return process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg !== undefined && xdg !== "" ? xdg : join(homedir(), ".config");
}

// The keychain's own command, with the token on stdin.
const run: CommandRun = (command, args, input) => {
  const result = spawnSync(command, args, {
    input: input ?? "",
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
    timeout: 10_000,
  });
  if (result.error !== undefined || result.status === null) return undefined;
  return { code: result.status, stdout: result.stdout };
};

// The token: typed at a prompt that does not echo it, or piped in.
async function readToken(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  }
  process.stderr.write(prompt);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();
  return new Promise((resolve, reject) => {
    let typed = "";
    const done = (error?: Error) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
      if (error === undefined) resolve(typed);
      else reject(error);
    };
    const onData = (data: string) => {
      for (const char of data) {
        if (char === "\r" || char === "\n" || char === "\u0004") return done();
        if (char === "\u0003") return done(new Error("Stopped."));
        if (char === "\u007f" || char === "\b") typed = typed.slice(0, -1);
        else typed += char;
      }
    };
    stdin.on("data", onData);
  });
}

process.exitCode = await runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  version: packageVersion(),
  nodeVersion: process.versions.node,
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  fetch: globalThis.fetch,
  tokens: tokenStore({ platform: process.platform, configDir: configDir(), run }),
  readToken,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});
