// Replays what the real tofu printed (records 0001 and 0053), or terraform,
// terragrunt or cdktf with tofu behind them (record 0068), through the
// process runner seam. No test starts the tool. A command the scenario did not
// record fails the test, so the adapter's command lines, working directories
// and workspaces are held to the recorded ones. The recordings write the plan
// file as {plan}, and the replay takes whatever path the adapter chose.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PLAN_FILE, RECORDING_FILE, type Recording } from "../../../scripts/fixtures/recorder.ts";
import { FIXTURE_TOFU_VERSIONS } from "../../../scripts/fixtures/versions.ts";
import type { ProcessRunner, Run, RunResult } from "../../../src/adapters/process.ts";

export const FIXTURES = resolve(import.meta.dir, "../../fixtures/opentofu");
export const VERSIONS = Object.values(FIXTURE_TOFU_VERSIONS).sort();

// Where the replayed repo pretends to be. Nothing is read from it.
export const ROOT = resolve("/replayed/repo");

export function scenarioNames(version: string, fixtures = FIXTURES): string[] {
  return readdirSync(join(fixtures, version)).sort();
}

export function readRecording(version: string, scenario: string, fixtures = FIXTURES): Recording {
  const file = join(fixtures, version, scenario, RECORDING_FILE);
  return JSON.parse(readFileSync(file, "utf8")) as Recording;
}

export interface Replay {
  run: ProcessRunner;
  // Every run the adapter asked for, in order.
  runs: Run[];
  // The plan file of each run that named one.
  plans: string[];
}

// The path the adapter put where the recording has {plan}, or undefined when
// the argument does not fit.
function planPath(recorded: string, asked: string): string | undefined | false {
  const at = recorded.indexOf(PLAN_FILE);
  if (at < 0) return recorded === asked ? undefined : false;
  const before = recorded.slice(0, at);
  if (!asked.startsWith(before) || !asked.endsWith("/tfplan")) return false;
  return asked.slice(before.length);
}

function fits(recorded: string[], asked: string[]): { plan?: string } | undefined {
  if (recorded.length !== asked.length) return undefined;
  let plan: string | undefined;
  for (const [index, arg] of recorded.entries()) {
    const found = planPath(arg, asked[index] ?? "");
    if (found === false) return undefined;
    if (found !== undefined) plan = found;
  }
  return plan === undefined ? {} : { plan };
}

// Commands are handed out in the order they were recorded. The workspace is
// part of the command: a recorded TF_WORKSPACE must be what the adapter set,
// and a command recorded without one must get none from the adapter.
export function replay(
  version: string,
  scenario: string,
  root = ROOT,
  fixtures = FIXTURES,
): Replay {
  const dir = join(fixtures, version, scenario);
  const waiting = [...readRecording(version, scenario, fixtures).commands];
  const runs: Run[] = [];
  const plans: string[] = [];
  const run = async (asked: Run): Promise<RunResult> => {
    runs.push(asked);
    let plan: string | undefined;
    const index = waiting.findIndex((command) => {
      const fit = fits(command.argv, asked.argv);
      if (fit === undefined || join(root, command.cwd) !== asked.cwd) return false;
      if (asked.env.TF_WORKSPACE !== command.env?.TF_WORKSPACE) return false;
      plan = fit.plan;
      return true;
    });
    const [command] = index < 0 ? [] : waiting.splice(index, 1);
    if (command === undefined) {
      throw new Error(
        `${version}/${scenario} holds no recording of "${asked.argv.join(" ")}" in ${asked.cwd} with TF_WORKSPACE=${asked.env.TF_WORKSPACE ?? "(none)"}.`,
      );
    }
    if (plan !== undefined) plans.push(plan);
    return {
      status: "exited",
      exitCode: command.exitCode,
      stdout: readFileSync(join(dir, command.stdout), "utf8"),
      stderr: readFileSync(join(dir, command.stderr), "utf8"),
    };
  };
  return { run, runs, plans };
}

// A runner that gives the answers in order, for what a recording cannot hold:
// a plan that ran out of time, a tool that is not there, output that moved.
export function answering(...results: RunResult[]): Omit<Replay, "plans"> {
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
