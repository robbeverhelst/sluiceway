import { spawn } from "node:child_process";

// The process runner: the one way an adapter starts a tool (build plan,
// section 5). Tests replay recorded output through this type.

export interface Run {
  // The command and its arguments. No shell reads them.
  argv: string[];
  cwd: string;
  // The whole environment of the child. Nothing is added to it.
  env: Record<string, string>;
  // No time limit when absent. Only a deploy runs without one: stopping it
  // half way would leave a stack half deployed.
  timeoutMs?: number | undefined;
  // Each line the tool writes to stderr, as it comes, for the job log while
  // the tool runs (slice 5.9). Never stdout, which holds values (record 0021).
  onStderrLine?: ((line: string) => void) | undefined;
}

// Set when a stream printed more than the runner holds, and the rest of it
// was dropped (slice 5.9): the limit it was cut at, in bytes.
type Cut = { outputCutAt?: number };

export type RunResult =
  // exitCode is null when a signal ended the tool that the runner did not send.
  | ({ status: "exited"; exitCode: number | null; stdout: string; stderr: string } & Cut)
  | ({ status: "timed-out"; stdout: string; stderr: string } & Cut)
  // The command could not be started, for one because it is not on PATH.
  | { status: "not-started" };

export type ProcessRunner = (run: Run) => Promise<RunResult>;

// How long a command that ran out of time gets to stop by itself.
const GRACE_MS = 5_000;

// The most one stream of one command may hold in memory (slice 5.9). 300
// resources are 1.5 MB of JSON, so this is far past any stack seen, and far
// below what a runner holds. The command is never stopped for it: the rest of
// the stream is dropped and the result says so.
export const OUTPUT_LIMIT_BYTES = 128 * 1024 * 1024;

// How long the pipes of a killed command may stay open. Only a process that
// left the group can hold them, and the runner does not wait for it.
const PIPES_MS = 1_000;

// Starts the command as the leader of a process group of its own, because a
// tool starts children (a language runtime, provider plugins) and the time
// limit has to end all of them. When the limit expires the whole group gets
// SIGINT, and SIGKILL when the grace period is over (record 0012). Output is
// held in memory, up to a limit per stream, and nothing is written to disk.
export function runProcess(
  run: Run,
  graceMs = GRACE_MS,
  limitBytes = OUTPUT_LIMIT_BYTES,
): Promise<RunResult> {
  const [command = "", ...args] = run.argv;
  return new Promise((done) => {
    const child = spawn(command, args, {
      cwd: run.cwd,
      env: run.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const { pid, stdout, stderr } = child;
    if (pid === undefined) {
      child.on("error", () => done({ status: "not-started" }));
      return;
    }

    let cut = false;
    const keep = (chunks: Buffer[]) => {
      let held = 0;
      return (chunk: Buffer) => {
        const room = limitBytes - held;
        if (chunk.length > room) cut = true;
        const kept = chunk.length > room ? chunk.subarray(0, Math.max(room, 0)) : chunk;
        if (kept.length === 0) return;
        chunks.push(kept);
        held += kept.length;
      };
    };
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    stdout.on("data", keep(out));
    stderr.on("data", keep(err));
    // Whole lines of stderr as they come. A line cut across two chunks waits
    // for its end, and the last one is handed over at the close.
    const { onStderrLine } = run;
    let partial = "";
    // A character cut across two chunks waits for its end too.
    const decoder = new TextDecoder();
    if (onStderrLine) {
      stderr.on("data", (chunk: Buffer) => {
        const parts = (partial + decoder.decode(chunk, { stream: true })).split(/\r?\n/);
        partial = parts.pop() ?? "";
        for (const line of parts) onStderrLine(line);
      });
    }

    const signalGroup = (signal: NodeJS.Signals): void => {
      try {
        process.kill(-pid, signal);
      } catch {
        // No such group: everything has ended, or the platform has no groups.
        child.kill(signal);
      }
    };

    let timedOut = false;
    let killing: ReturnType<typeof setTimeout> | undefined;
    let closing: ReturnType<typeof setTimeout> | undefined;
    const limit =
      run.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            signalGroup("SIGINT");
            killing = setTimeout(() => {
              signalGroup("SIGKILL");
              closing = setTimeout(() => {
                stdout.destroy();
                stderr.destroy();
              }, PIPES_MS);
            }, graceMs);
          }, run.timeoutMs);

    // An error after the start is a signal that could not be sent. The close
    // event still comes.
    child.on("error", () => {});
    child.on("close", (exitCode) => {
      for (const timer of [limit, killing, closing]) clearTimeout(timer);
      partial += decoder.decode();
      if (onStderrLine && partial !== "") onStderrLine(partial);
      const text = {
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        ...(cut ? { outputCutAt: limitBytes } : {}),
      };
      done(timedOut ? { status: "timed-out", ...text } : { status: "exited", exitCode, ...text });
    });
  });
}
