// Replays what the real helm and its diff plugin printed (records 0001 and
// 0058) through the process runner seam. No test starts the tool or reaches a
// cluster. A command the scenario did not record fails the test, so the
// adapter's command lines and working directories are held to the recorded
// ones.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { RECORDING_FILE, type Recording } from "../../../scripts/fixtures/recorder.ts";
import { FIXTURE_HELM_VERSIONS } from "../../../scripts/fixtures/versions.ts";
import type { ProcessRunner, Run, RunResult } from "../../../src/adapters/process.ts";

export const FIXTURES = resolve(import.meta.dir, "../../fixtures/helm");
export const VERSIONS = Object.values(FIXTURE_HELM_VERSIONS)
  .map(({ helm }) => helm)
  .sort();

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

// Commands are handed out in the order they were recorded: the first
// recording that fits the command line and the directory.
export function replay(version: string, scenario: string, root = ROOT): Replay {
  const dir = join(FIXTURES, version, scenario);
  const waiting = [...readRecording(version, scenario).commands];
  const runs: Run[] = [];
  const run = async (asked: Run): Promise<RunResult> => {
    runs.push(asked);
    const index = waiting.findIndex(
      (command) =>
        JSON.stringify(command.argv) === JSON.stringify(asked.argv) &&
        join(root, command.cwd) === asked.cwd,
    );
    const [command] = index < 0 ? [] : waiting.splice(index, 1);
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

// A runner that gives the answers in order, for what a recording cannot hold:
// a diff that ran out of time, a tool that is not there, output that moved.
export function answering(...results: RunResult[]): Replay {
  const runs: Run[] = [];
  return {
    runs,
    run: async (asked) => {
      runs.push(asked);
      const result = results[runs.length - 1] ?? results.at(-1);
      if (result === undefined) throw new Error("No answer left.");
      return result;
    },
  };
}

// The stdout of one recorded command, to build answers from.
export function recorded(version: string, scenario: string, id: string): string {
  const command = readRecording(version, scenario).commands.find((one) => one.id === id);
  if (command === undefined) throw new Error(`${version}/${scenario} has no command ${id}.`);
  return readFileSync(join(FIXTURES, version, scenario, command.stdout), "utf8");
}
