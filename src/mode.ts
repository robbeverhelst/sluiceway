import { runScan } from "./modes/scan-job.ts";

export const MODES = ["scan", "resolve", "apply", "settle"] as const;

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

type Handler = () => Promise<void>;

function notImplemented(mode: Mode): Handler {
  return async () => {
    throw new NotImplementedError(mode);
  };
}

const handlers: Record<Mode, Handler> = {
  scan: runScan,
  resolve: notImplemented("resolve"),
  apply: notImplemented("apply"),
  settle: notImplemented("settle"),
};

export function run(mode: Mode): Promise<void> {
  return handlers[mode]();
}
