// Replays what the real CLI printed (record 0001) through the process runner
// seam. No test starts the tool. A command the scenario did not record fails
// the test, so the adapter's command line and working directory are held to
// the recorded ones.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { RECORDING_FILE, type Recording } from "../../../scripts/fixtures/recorder.ts";
import { FIXTURE_CLI_VERSIONS } from "../../../scripts/fixtures/versions.ts";
import type { ProcessRunner, Run, RunResult } from "../../../src/adapters/process.ts";

export const FIXTURES = resolve(import.meta.dir, "../../fixtures/pulumi");
export const VERSIONS = Object.values(FIXTURE_CLI_VERSIONS).sort();

// Where the replayed repo pretends to be. Nothing is read from it.
export const ROOT = resolve("/replayed/repo");

export function scenarioNames(version: string): string[] {
  return readdirSync(join(FIXTURES, version)).sort();
}

export function readRecording(version: string, scenario: string): Recording {
  const file = join(FIXTURES, version, scenario, RECORDING_FILE);
  return JSON.parse(readFileSync(file, "utf8")) as Recording;
}

export interface Replay {
  run: ProcessRunner;
  // Every run the adapter asked for, in order.
  runs: Run[];
}

// Commands are handed out in the order they were recorded, so a scenario that
// holds the same command twice gives its first output first. `root` is where
// the replayed repo pretends to be, for a test that needs a real one there.
export function replay(version: string, scenario: string, root = ROOT): Replay {
  const dir = join(FIXTURES, version, scenario);
  const waiting = [...readRecording(version, scenario).commands];
  const runs: Run[] = [];
  const run = async (asked: Run): Promise<RunResult> => {
    runs.push(asked);
    const index = waiting.findIndex(
      (command) =>
        JSON.stringify(command.argv) === JSON.stringify(asked.argv) &&
        join(root, command.cwd) === asked.cwd &&
        // A variable the scenario set for this command has to be set the
        // same way by the adapter (record 0055).
        Object.entries(command.env ?? {}).every(([name, value]) => asked.env[name] === value),
    );
    const [command] = index < 0 ? [] : waiting.splice(index, 1);
    const history = command === undefined ? unrecordedHistory(version, asked) : undefined;
    if (history) return history;
    if (command === undefined) {
      throw new Error(
        `${version}/${scenario} holds no recording of "${asked.argv.join(" ")}" in ${asked.cwd}.`,
      );
    }
    return {
      status: "exited",
      exitCode: command.exitCode,
      stdout: readFileSync(join(dir, command.stdout), "utf8"),
      stderr: readFileSync(join(dir, command.stderr), "utf8"),
    };
  };
  return { run, runs };
}

// A full scan reads the tool's history of every stack (record 0073). A
// scenario that did not record one is answered with what the real CLI printed
// for a stack that was never deployed, from the history scenario of the same
// version, so a test about something else sees no deploy made outside.
export function unrecordedHistory(version: string, asked: Run): RunResult | undefined {
  if (asked.argv[1] !== "stack" || asked.argv[2] !== "history") return undefined;
  const command = readRecording(version, "history").commands.find(
    ({ id }) => id === "history-before",
  );
  if (command === undefined) throw new Error(`${version}/history holds no history-before.`);
  const dir = join(FIXTURES, version, "history");
  return {
    status: "exited",
    exitCode: command.exitCode,
    stdout: readFileSync(join(dir, command.stdout), "utf8"),
    stderr: readFileSync(join(dir, command.stderr), "utf8"),
  };
}

// A runner that gives one fixed answer, for what a recording cannot hold: a
// preview that ran out of time, a tool that is not there.
export function answering(result: RunResult): Replay {
  const runs: Run[] = [];
  return {
    runs,
    run: async (asked) => {
      runs.push(asked);
      return result;
    },
  };
}
