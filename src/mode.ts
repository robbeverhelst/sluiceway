import * as core from "@actions/core";
import { isMode, MODES, type Mode } from "./core/auto-mode.ts";
import {
  type GetInput,
  refuseDeploymentId,
  unusedEnvFileInput,
  unusedNotifyInputs,
} from "./github/inputs.ts";
import { runApply } from "./modes/apply-job.ts";
import { HANDED_ON_STATE, runAuto, SETTLED_STATE } from "./modes/auto-job.ts";
import { backendContext } from "./modes/check-backend.ts";
import { runCheck } from "./modes/check-job.ts";
import { pullRequestPreviewContext } from "./modes/check-pull-request.ts";
import { runInit } from "./modes/init-job.ts";
import { runResolve } from "./modes/resolve-job.ts";
import { runScan } from "./modes/scan-job.ts";
import { runSettle } from "./modes/settle-job.ts";

export { MODES, type Mode };

export class NotImplementedError extends Error {
  constructor(mode: Mode) {
    super(`Mode "${mode}" is not implemented yet.`);
    this.name = "NotImplementedError";
  }
}

export function parseMode(input: string): Mode {
  const mode = input.trim();
  if (isMode(mode)) return mode;
  // No mode is auto mode: the step picks from the event (record 0077).
  if (mode === "") return "auto";
  throw new Error(`Unknown mode "${mode}". Use one of: ${MODES.join(", ")}.`);
}

// A handler is handed the directory the action was downloaded to, where its
// package.json is.
type Handler = (directory: string) => Promise<void>;

const handlers: Record<Mode, Handler> = {
  auto: runAuto,
  scan: runScan,
  // What resolve tells auto mode is for auto mode alone (record 0109).
  resolve: async (directory) => void (await runResolve(directory)),
  apply: runApply,
  settle: (directory) => runSettle(directory),
  // The check starts no tool unless backend: true (record 0074) or
  // pull-request-preview: true (record 0101).
  check: () => runCheck(backendContext, undefined, pullRequestPreviewContext),
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
  // Only the modes that run the tool read the env file (record 0100). On
  // any other step the input is a warning, and the file is never opened.
  const envFile = unusedEnvFileInput(mode, getInput);
  if (envFile !== undefined) warn(envFile, "Env file input not used");
  return handlers[mode](directory);
}

// The post step of action.yml (record 0077). The split workflow ends the
// records of a cancelled deploy in a settle job with if: always(). One job
// has no job after it, so an auto step that handed a deploy on and was
// stopped before it settled settles here. The states come from the main
// step. Where the runner kept none, nothing runs, and the next render ends
// an open record whose run is over (record 0003).
export async function post(
  mode: Mode,
  getState: (name: string) => string,
  settle: () => Promise<void>,
): Promise<void> {
  if (mode !== "auto") return;
  if (getState(HANDED_ON_STATE) !== "true" || getState(SETTLED_STATE) === "true") return;
  await settle();
}
