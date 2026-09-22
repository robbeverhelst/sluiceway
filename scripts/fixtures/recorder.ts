// Records what the tool prints for one scenario. The tool only ever runs in a
// fresh copy of the example project, against a fresh file backend inside the
// work directory. Nothing here knows Pulumi beyond the names of the variables
// that keep it there, and OpenTofu gets its own through RecordOptions.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { EXAMPLE_PASSPHRASE } from "./example.ts";

export interface Run {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type Runner = (run: Run) => Promise<RunResult>;

export type StdoutFormat = "json" | "text";

export type Step =
  // Replaces text in a file of the copy. The text must be there exactly once.
  | { kind: "edit"; file: string; find: string; replace: string }
  | { kind: "write"; file: string; content: string }
  // Runs a command to get the stack where the scenario needs it. Not saved.
  | { kind: "setup"; cwd: string; argv: string[]; env?: Record<string, string> }
  // Runs a command and saves what it printed.
  | {
      kind: "record";
      id: string;
      cwd: string;
      argv: string[];
      stdout: StdoutFormat;
      expect?: Expectation;
      // Variables this one command gets on top of the scenario's environment,
      // such as the workspace an OpenTofu stack selects.
      env?: Record<string, string>;
    };

// Stands for the path of the plan file in an argument, so that a recording
// holds no path of the machine that made it. The recorder puts a real path in
// its place when it runs the command, and a replay puts the adapter's.
export const PLAN_FILE = "{plan}";

// What a recorded command has to show for the scenario to be worth keeping. A
// scenario named "replace" whose preview holds no replace is a lie in waiting.
export interface Expectation {
  exit: "zero" | "nonzero";
  // Ops that at least one step must have. Only read when stdout is JSON.
  ops?: string[];
}

export interface Scenario {
  name: string;
  description: string;
  steps: Step[];
}

export interface RecordedCommand {
  id: string;
  argv: string[];
  // Relative to the root of the example project.
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  stdoutFormat: StdoutFormat;
  // Only when the step sets any.
  env?: Record<string, string>;
}

export interface Recording {
  scenario: string;
  description: string;
  cliVersion: string;
  commands: RecordedCommand[];
}

export interface RecordOptions {
  exampleDir: string;
  workDir: string;
  // The directory of one CLI version. The scenario gets its own directory in it.
  outDir: string;
  cliVersion: string;
  parentEnv: Record<string, string | undefined>;
  runner: Runner;
  // The environment of the tool, built from nothing. Pulumi's when absent.
  environment?: (options: RecordOptions, backend: string) => Record<string, string>;
}

export const RECORDING_FILE = "recording.json";

export async function recordScenario(
  scenario: Scenario,
  options: RecordOptions,
): Promise<Recording> {
  const scenarioWork = join(options.workDir, "scenarios", scenario.name);
  const project = join(scenarioWork, "project");
  const backend = join(scenarioWork, "backend");
  rmSync(scenarioWork, { recursive: true, force: true });
  mkdirSync(backend, { recursive: true });
  cpSync(options.exampleDir, project, { recursive: true });

  const target = join(options.outDir, scenario.name);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });

  const env = (options.environment ?? toolEnvironment)(options, backend);
  const commands: RecordedCommand[] = [];
  const planFile = join(scenarioWork, "plan", "tfplan");
  mkdirSync(join(planFile, ".."), { recursive: true });
  const argvOf = (argv: string[]) => argv.map((arg) => arg.replace(PLAN_FILE, planFile));

  for (const step of scenario.steps) {
    if (step.kind === "edit") {
      const file = join(project, step.file);
      writeFileSync(file, replaceOnce(readFileSync(file, "utf8"), step, scenario.name));
    } else if (step.kind === "write") {
      const file = join(project, step.file);
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, step.content);
    } else if (step.kind === "setup") {
      const result = await options.runner({
        argv: argvOf(step.argv),
        cwd: join(project, step.cwd),
        env: { ...env, ...step.env },
      });
      if (result.exitCode !== 0) {
        throw new Error(
          `Scenario "${scenario.name}": setup command "${step.argv.join(" ")}" ended with exit code ${result.exitCode}.\n${result.stderr}`,
        );
      }
    } else {
      const result = await options.runner({
        argv: argvOf(step.argv),
        cwd: join(project, step.cwd),
        env: { ...env, ...step.env },
      });
      const command: RecordedCommand = {
        id: step.id,
        argv: step.argv,
        cwd: step.cwd,
        exitCode: result.exitCode,
        stdout: `${step.id}.stdout`,
        stderr: `${step.id}.stderr`,
        stdoutFormat: step.stdout,
        ...(step.env === undefined ? {} : { env: step.env }),
      };
      writeFileSync(join(target, command.stdout), result.stdout);
      writeFileSync(join(target, command.stderr), result.stderr);
      commands.push(command);
    }
  }

  const recording: Recording = {
    scenario: scenario.name,
    description: scenario.description,
    cliVersion: options.cliVersion,
    commands,
  };
  writeFileSync(join(target, RECORDING_FILE), `${JSON.stringify(recording, null, 2)}\n`);
  return recording;
}

// Says what is wrong with the recording in one scenario directory. An empty
// list means it is good. It reads the saved files only, so it works the same on
// a fresh recording and on the fixtures in the repo.
export function checkRecording(
  dir: string,
  scenario: Scenario,
  ops: (document: unknown) => string[] = opsOf,
): string[] {
  const name = basename(dir);
  const manifest = join(dir, RECORDING_FILE);
  if (!existsSync(manifest)) return [`${name}: no ${RECORDING_FILE}. Record the fixtures again.`];
  const recording = JSON.parse(readFileSync(manifest, "utf8")) as Recording;

  const problems: string[] = [];
  const steps = scenario.steps.filter((step) => step.kind === "record");
  const recorded = new Map(recording.commands.map((command) => [command.id, command]));

  for (const step of steps) {
    const command = recorded.get(step.id);
    const where = `${name}/${step.id}`;
    if (
      command === undefined ||
      command.cwd !== step.cwd ||
      command.stdoutFormat !== step.stdout ||
      JSON.stringify(command.argv) !== JSON.stringify(step.argv) ||
      JSON.stringify(command.env) !== JSON.stringify(step.env)
    ) {
      problems.push(
        `${where}: the scenario now runs a different command. Record the fixtures again.`,
      );
      continue;
    }

    const missing = [command.stdout, command.stderr].filter((file) => !existsSync(join(dir, file)));
    for (const file of missing) problems.push(`${name}/${file}: the file is missing.`);
    if (missing.length > 0) continue;

    if (step.expect?.exit === "zero" && command.exitCode !== 0) {
      problems.push(`${where}: expected exit code 0, got ${command.exitCode}.`);
    }
    if (step.expect?.exit === "nonzero" && command.exitCode === 0) {
      problems.push(`${where}: expected an exit code other than 0, got 0.`);
    }
    if (step.stdout !== "json") continue;

    let document: unknown;
    try {
      document = JSON.parse(readFileSync(join(dir, command.stdout), "utf8"));
    } catch {
      problems.push(`${name}/${command.stdout}: expected JSON, and it does not parse.`);
      continue;
    }
    const found = ops(document);
    for (const op of step.expect?.ops ?? []) {
      if (found.includes(op)) continue;
      const seen = found.length > 0 ? [...new Set(found)].sort().join(", ") : "none";
      problems.push(
        `${name}/${command.stdout}: expected a step with op "${op}", found only: ${seen}.`,
      );
    }
  }

  if (recording.commands.length !== steps.length) {
    problems.push(`${name}: the scenario now runs other commands. Record the fixtures again.`);
  }
  return problems;
}

function opsOf(document: unknown): string[] {
  if (typeof document !== "object" || document === null) return [];
  const steps = (document as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((step) =>
    typeof step === "object" && step !== null && typeof step.op === "string" ? [step.op] : [],
  );
}

function replaceOnce(
  text: string,
  step: { file: string; find: string; replace: string },
  scenario: string,
): string {
  const count = text.split(step.find).length - 1;
  if (count !== 1) {
    throw new Error(
      `Scenario "${scenario}": expected to find ${JSON.stringify(step.find)} once in ${step.file}, found it ${count} times. The example project and the scenario have moved apart.`,
    );
  }
  return text.replace(step.find, () => step.replace);
}

// Built from nothing, not from the environment of whoever runs the recorder.
// Only PATH comes through, so the tool can be found. A token, a real backend
// URL or cloud credentials in the parent environment never reach the tool, and
// HOME points into the work directory so no file of the user is read either.
function toolEnvironment(options: RecordOptions, backend: string): Record<string, string> {
  return {
    PATH: options.parentEnv.PATH ?? "",
    HOME: join(options.workDir, "home"),
    // The tool asks for the current user. A fixed name keeps a real one out of the fixtures.
    USER: "sluiceway",
    PULUMI_BACKEND_URL: `file://${backend}`,
    PULUMI_HOME: join(options.workDir, "pulumi-home"),
    PULUMI_CONFIG_PASSPHRASE: EXAMPLE_PASSPHRASE,
    PULUMI_SKIP_UPDATE_CHECK: "true",
    NO_COLOR: "1",
  };
}
