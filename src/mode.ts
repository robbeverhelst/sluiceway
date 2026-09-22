import * as core from "@actions/core";
import { type GetInput, refuseDeploymentId } from "./github/inputs.ts";
import { runApply } from "./modes/apply-job.ts";
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
  check: runCheck,
  init: runInit,
};

export async function run(
  mode: Mode,
  directory: string,
  getInput: GetInput = core.getInput,
): Promise<void> {
  refuseDeploymentId(mode, getInput);
  return handlers[mode](directory);
}
