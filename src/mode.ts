import * as core from "@actions/core";
import { type GetInput, refuseDeploymentId, unusedNotifyInputs } from "./github/inputs.ts";
import { runApply } from "./modes/apply-job.ts";
import { backendContext } from "./modes/check-backend.ts";
import { runCheck } from "./modes/check-job.ts";
import { runInit } from "./modes/init-job.ts";
import { runResolve } from "./modes/resolve-job.ts";
import { runScan } from "./modes/scan-job.ts";
import { runSettle } from "./modes/settle-job.ts";

export const MODES = ["scan", "resolve", "apply", "settle", "check", "init"] as const;

export type Mode = (typeof MODES)[number];

export class NotImplementedError extends Error {
  constructor(mode: Mode) {
    super(`Mode "${mode}" is not implemented yet.`);
    this.name = "NotImplementedError";
  }
}

export function parseMode(input: string): Mode {
  const mode = input.trim();
  if (isMode(mode)) return mode;
  if (mode === "") {
    throw new Error(`The "mode" input is required. Use one of: ${MODES.join(", ")}.`);
  }
  throw new Error(`Unknown mode "${mode}". Use one of: ${MODES.join(", ")}.`);
}

function isMode(value: string): value is Mode {
  return (MODES as readonly string[]).includes(value);
}

// A handler is handed the directory the action was downloaded to, where its
// package.json is.
type Handler = (directory: string) => Promise<void>;

const handlers: Record<Mode, Handler> = {
  scan: runScan,
  resolve: runResolve,
  apply: runApply,
  settle: runSettle,
  // The check starts no tool unless backend: true (record 0074).
  check: () => runCheck(backendContext),
  init: runInit,
};

export async function run(
  mode: Mode,
  directory: string,
  getInput: GetInput = core.getInput,
  warn: (message: string, title: string) => void = (message, title) =>
    core.warning(message, { title }),
): Promise<void> {
  refuseDeploymentId(mode, getInput);
  // Only scan, resolve and apply send (record 0078). A channel on another
  // step is a warning, never an error, and its value is never read out.
  const unused = unusedNotifyInputs(mode, getInput);
  if (unused.length > 0) {
    warn(
      `${unused.map((name) => `"${name}"`).join(", ")} ${unused.length === 1 ? "is" : "are"} set on a step in ${mode} mode, which sends no notification. Only scan, resolve and apply do. Take ${unused.length === 1 ? "it" : "them"} out of this step.`,
      "Notification input not used",
    );
  }
  return handlers[mode](directory);
}
