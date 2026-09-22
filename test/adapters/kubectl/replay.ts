// Replays what the real kubectl printed (records 0001 and 0060) through the
// process runner seam. No test starts the tool or reaches a cluster. A command
// the scenario did not record fails the test, so the adapter's command lines,
// working directories and diff program are held to the recorded ones. The
// recordings write the rendered set as {plan}, and the replay takes whatever
// path the adapter chose, and keeps what the adapter wrote there.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PLAN_FILE, RECORDING_FILE, type Recording } from "../../../scripts/fixtures/recorder.ts";
import { FIXTURE_KUBECTL_VERSIONS } from "../../../scripts/fixtures/versions.ts";
import type { ProcessRunner, Run, RunResult } from "../../../src/adapters/process.ts";

export const FIXTURES = resolve(import.meta.dir, "../../fixtures/kubectl");
export const VERSIONS = Object.values(FIXTURE_KUBECTL_VERSIONS).sort();

// Where the replayed repo pretends to be. It is the example project, because
// the adapter reads a directory of manifests itself.
export const ROOT = resolve(import.meta.dir, "../../../examples/kubernetes-basic");

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
  // The rendered set each run that named one was handed: its path, and what
  // the file held when the run was asked for.
  sets: { path: string; text: string }[];
}

function setPath(recorded: string, asked: string): string | undefined | false {
  if (recorded !== PLAN_FILE) return recorded === asked ? undefined : false;
  return asked.endsWith("/manifests.yaml") ? asked : false;
}

function fits(recorded: string[], asked: string[]): { set?: string } | undefined {
  if (recorded.length !== asked.length) return undefined;
  let set: string | undefined;
  for (const [index, arg] of recorded.entries()) {
    const found = setPath(arg, asked[index] ?? "");
    if (found === false) return undefined;
    if (found !== undefined) set = found;
  }
  return set === undefined ? {} : { set };
}

// Commands are handed out in the order they were recorded. The diff program
// is part of the command: a recorded KUBECTL_EXTERNAL_DIFF must be what the
// adapter set, and a command recorded without one must get none.
export function replay(version: string, scenario: string, root = ROOT): Replay {
  const dir = join(FIXTURES, version, scenario);
  const waiting = [...readRecording(version, scenario).commands];
  const runs: Run[] = [];
  const sets: Replay["sets"] = [];
  const run = async (asked: Run): Promise<RunResult> => {
    runs.push(asked);
    let set: string | undefined;
    const index = waiting.findIndex((command) => {
      const fit = fits(command.argv, asked.argv);
      if (fit === undefined || join(root, command.cwd) !== asked.cwd) return false;
      if (asked.env.KUBECTL_EXTERNAL_DIFF !== command.env?.KUBECTL_EXTERNAL_DIFF) return false;
      set = fit.set;
      return true;
    });
    const [command] = index < 0 ? [] : waiting.splice(index, 1);
    if (command === undefined) {
      throw new Error(
        `${version}/${scenario} holds no recording of "${asked.argv.join(" ")}" in ${asked.cwd} with KUBECTL_EXTERNAL_DIFF=${asked.env.KUBECTL_EXTERNAL_DIFF ?? "(none)"}.`,
      );
    }
    if (set !== undefined) sets.push({ path: set, text: readFileSync(set, "utf8") });
    return {
      status: "exited",
      exitCode: command.exitCode,
      stdout: readFileSync(join(dir, command.stdout), "utf8"),
      stderr: readFileSync(join(dir, command.stderr), "utf8"),
    };
  };
  return { run, runs, sets };
}

// A runner that gives the answers in order, for what a recording cannot hold:
// a diff that ran out of time, a tool that is not there, output that moved.
export function answering(...results: RunResult[]): Omit<Replay, "sets"> {
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
