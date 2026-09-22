import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkRecording,
  type Run,
  type RunResult,
  recordScenario,
  type Scenario,
} from "../../scripts/fixtures/recorder.ts";

// The recorder is tested through recordScenario with a process runner that
// replays canned answers, the same seam the adapter will use (build plan,
// section 5). No test here starts the tool.

let root: string;
let example: string;
let work: string;
let out: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sluiceway-recorder-"));
  example = join(root, "example");
  work = join(root, "work");
  out = join(root, "out");
  mkdirSync(join(example, "network"), { recursive: true });
  writeFileSync(join(example, "network", "Pulumi.yaml"), "name: network\nprefix: net\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function replay(answers: Record<string, Partial<RunResult>>): { runs: Run[]; runner: typeof run } {
  const runs: Run[] = [];
  async function run(next: Run): Promise<RunResult> {
    runs.push(next);
    const answer = answers[next.argv.slice(0, 2).join(" ")] ?? {};
    return { stdout: "", stderr: "", exitCode: 0, ...answer };
  }
  return { runs, runner: run };
}

function record(scenario: Scenario, runner: (run: Run) => Promise<RunResult>, parentEnv = {}) {
  return recordScenario(scenario, {
    exampleDir: example,
    workDir: work,
    outDir: out,
    cliVersion: "v3.229.0",
    parentEnv,
    runner,
  });
}

const PREVIEW = ["pulumi", "preview", "--json", "--stack", "dev"];

describe("recording one scenario", () => {
  test("saves what the tool printed and its exit code, in a directory named after the scenario", async () => {
    const { runner } = replay({
      "pulumi preview": { stdout: '{"steps":[]}\n', stderr: "warning: old\n", exitCode: 0 },
    });
    await record(
      {
        name: "no-changes",
        description: "Nothing to deploy.",
        steps: [{ kind: "record", id: "preview", cwd: "network", argv: PREVIEW, stdout: "json" }],
      },
      runner,
    );

    const dir = join(out, "no-changes");
    expect(readFileSync(join(dir, "preview.stdout"), "utf8")).toBe('{"steps":[]}\n');
    expect(readFileSync(join(dir, "preview.stderr"), "utf8")).toBe("warning: old\n");
    expect(JSON.parse(readFileSync(join(dir, "recording.json"), "utf8"))).toEqual({
      scenario: "no-changes",
      description: "Nothing to deploy.",
      cliVersion: "v3.229.0",
      commands: [
        {
          id: "preview",
          argv: PREVIEW,
          cwd: "network",
          exitCode: 0,
          stdout: "preview.stdout",
          stderr: "preview.stderr",
          stdoutFormat: "json",
        },
      ],
    });
  });

  test("an edit changes the copy, and the example project stays as it was", async () => {
    const seen: string[] = [];
    await record(
      {
        name: "replace",
        description: "A new prefix.",
        steps: [
          {
            kind: "edit",
            file: "network/Pulumi.yaml",
            find: "prefix: net",
            replace: "prefix: lan",
          },
          { kind: "record", id: "preview", cwd: "network", argv: PREVIEW, stdout: "json" },
        ],
      },
      async (run) => {
        seen.push(readFileSync(join(run.cwd, "Pulumi.yaml"), "utf8"));
        writeFileSync(join(run.cwd, "Pulumi.dev.yaml"), "written by the tool\n");
        return { stdout: "{}", stderr: "", exitCode: 0 };
      },
    );

    expect(seen).toEqual(["name: network\nprefix: lan\n"]);
    expect(readFileSync(join(example, "network", "Pulumi.yaml"), "utf8")).toContain("prefix: net");
    expect(existsSync(join(example, "network", "Pulumi.dev.yaml"))).toBe(false);
  });

  test("an edit whose text is not in the file stops the scenario", async () => {
    const { runner } = replay({});
    const scenario: Scenario = {
      name: "replace",
      description: "A new prefix.",
      steps: [
        { kind: "edit", file: "network/Pulumi.yaml", find: "prefix: wan", replace: "prefix: lan" },
      ],
    };
    await expect(record(scenario, runner)).rejects.toThrow(
      'Scenario "replace": expected to find "prefix: wan" once in network/Pulumi.yaml, found it 0 times.',
    );
  });

  test("a setup command that fails stops the scenario, and is not saved when it works", async () => {
    const scenario: Scenario = {
      name: "update",
      description: "One changed property.",
      steps: [
        { kind: "setup", cwd: "network", argv: ["pulumi", "up", "--yes"] },
        { kind: "record", id: "preview", cwd: "network", argv: PREVIEW, stdout: "json" },
      ],
    };

    const recording = await record(scenario, replay({}).runner);
    expect(recording.commands.map((command) => command.id)).toEqual(["preview"]);

    const failing = replay({ "pulumi up": { exitCode: 4, stderr: "error: boom" } });
    await expect(record(scenario, failing.runner)).rejects.toThrow(
      'Scenario "update": setup command "pulumi up --yes" ended with exit code 4.',
    );
    expect(failing.runs).toHaveLength(1);
  });

  test("every scenario gets a fresh file backend of its own inside the work directory", async () => {
    const { runs, runner } = replay({});
    const steps: Scenario["steps"] = [
      { kind: "record", id: "preview", cwd: "network", argv: PREVIEW, stdout: "json" },
    ];
    await record({ name: "one", description: "", steps }, runner);
    await record({ name: "two", description: "", steps }, runner);

    const backends = runs.map((run) => run.env.PULUMI_BACKEND_URL ?? "");
    expect(backends[0]).toStartWith(`file://${work}/`);
    expect(backends[1]).toStartWith(`file://${work}/`);
    expect(backends[0]).not.toBe(backends[1]);
    expect(runs[0]?.env.PULUMI_HOME).toStartWith(`${work}/`);
    expect(runs[0]?.cwd).toStartWith(`${work}/`);
  });

  test("the tool gets a short fixed environment, so it can never reach a real backend or account", async () => {
    const { runs, runner } = replay({});
    await record(
      {
        name: "one",
        description: "",
        steps: [{ kind: "record", id: "preview", cwd: "network", argv: PREVIEW, stdout: "json" }],
      },
      runner,
      {
        PATH: "/usr/bin",
        HOME: "/home/someone",
        USER: "someone",
        PULUMI_ACCESS_TOKEN: "pul-real",
        PULUMI_BACKEND_URL: "s3://real-state",
        PULUMI_HOME: "/home/someone/.pulumi",
        AWS_ACCESS_KEY_ID: "real",
        GITHUB_TOKEN: "real",
      },
    );

    expect(runs[0]?.env).toEqual({
      PATH: "/usr/bin",
      HOME: join(work, "home"),
      USER: "sluiceway",
      PULUMI_BACKEND_URL: `file://${join(work, "scenarios", "one", "backend")}`,
      PULUMI_HOME: join(work, "pulumi-home"),
      PULUMI_CONFIG_PASSPHRASE: "sluiceway-example",
      PULUMI_SKIP_UPDATE_CHECK: "true",
      NO_COLOR: "1",
    });
  });
});

describe("changing things behind the tool's back (slice 4.3)", () => {
  test("a remove step deletes a file of the copy, and the example project keeps it", async () => {
    writeFileSync(join(example, "network", "notes.txt"), "managed\n");
    const { runner } = replay({});
    await record(
      {
        name: "drift",
        description: "",
        steps: [{ kind: "remove", file: "network/notes.txt" }],
      },
      runner,
    );
    expect(existsSync(join(work, "scenarios", "drift", "project", "network", "notes.txt"))).toBe(
      false,
    );
    expect(existsSync(join(example, "network", "notes.txt"))).toBe(true);
  });

  test("a remove step whose file is not there stops the scenario", async () => {
    const { runner } = replay({});
    await expect(
      record(
        { name: "drift", description: "", steps: [{ kind: "remove", file: "network/gone.txt" }] },
        runner,
      ),
    ).rejects.toThrow('Scenario "drift": expected network/gone.txt to be there, and it is not.');
  });

  test("a backend step writes a file into the scenario's own backend", async () => {
    const { runner } = replay({});
    await record(
      {
        name: "locked",
        description: "",
        steps: [{ kind: "backend", file: ".pulumi/locks/one.json", content: "{}\n" }],
      },
      runner,
    );
    expect(
      readFileSync(join(work, "scenarios", "locked", "backend", ".pulumi/locks/one.json"), "utf8"),
    ).toBe("{}\n");
  });

  test("a recorded command may add variables to the tool's environment, and the recording names them", async () => {
    const { runs, runner } = replay({});
    await record(
      {
        name: "drift",
        description: "",
        steps: [
          {
            kind: "record",
            id: "drift",
            cwd: "network",
            argv: PREVIEW,
            env: { PULUMI_ENABLE_STREAMING_JSON_PREVIEW: "true" },
            stdout: "jsonl",
          },
        ],
      },
      runner,
    );
    expect(runs[0]?.env.PULUMI_ENABLE_STREAMING_JSON_PREVIEW).toBe("true");
    expect(runs[0]?.env.PULUMI_SKIP_UPDATE_CHECK).toBe("true");
    const recording = JSON.parse(readFileSync(join(out, "drift", "recording.json"), "utf8"));
    expect(recording.commands[0].env).toEqual({ PULUMI_ENABLE_STREAMING_JSON_PREVIEW: "true" });
  });
});

describe("checking a recording of JSON lines", () => {
  const scenario: Scenario = {
    name: "drift",
    description: "",
    steps: [
      {
        kind: "record",
        id: "drift",
        cwd: "network",
        argv: PREVIEW,
        env: { PULUMI_ENABLE_STREAMING_JSON_PREVIEW: "true" },
        stdout: "jsonl",
        expect: { exit: "zero", ops: ["delete"] },
      },
    ],
  };
  const event = (op: string) => JSON.stringify({ resOutputsEvent: { metadata: { op } } });

  async function problemsFor(stdout: string, checked = scenario): Promise<string[]> {
    await record(scenario, replay({ "pulumi preview": { stdout } }).runner);
    return checkRecording(join(out, "drift"), checked);
  }

  test("every line parses and the op the scenario is for is there", async () => {
    expect(await problemsFor(`${event("same")}\n${event("delete")}\n`)).toEqual([]);
  });

  test("a line that does not parse", async () => {
    expect(await problemsFor(`${event("delete")}\nwarning: not JSON\n`)).toEqual([
      "drift/drift.stdout: expected one JSON document per line, and line 2 does not parse.",
    ]);
  });

  test("no line at all is not JSON lines", async () => {
    expect(await problemsFor("")).toEqual([
      "drift/drift.stdout: expected one JSON document per line, and there is none.",
    ]);
  });

  test("the op the scenario is for is not among the events", async () => {
    expect(await problemsFor(`${event("same")}\n`)).toEqual([
      'drift/drift.stdout: expected a step with op "delete", found only: same.',
    ]);
  });

  test("a recording made without the variable is stale", async () => {
    const changed: Scenario = {
      ...scenario,
      steps: scenario.steps.map((step) => (step.kind === "record" ? { ...step, env: {} } : step)),
    };
    expect(await problemsFor(`${event("delete")}\n`, changed)).toEqual([
      "drift/drift: the scenario now runs a different command. Record the fixtures again.",
    ]);
  });
});

describe("checking a recording against its scenario", () => {
  const scenario: Scenario = {
    name: "replace",
    description: "A new prefix.",
    steps: [
      { kind: "setup", cwd: "network", argv: ["pulumi", "up", "--yes"] },
      {
        kind: "record",
        id: "preview",
        cwd: "network",
        argv: PREVIEW,
        stdout: "json",
        expect: { exit: "zero", ops: ["replace"] },
      },
    ],
  };
  const good = JSON.stringify({ steps: [{ op: "same" }, { op: "replace" }] });

  async function problemsFor(answer: Partial<RunResult>, checked = scenario): Promise<string[]> {
    await record(scenario, replay({ "pulumi preview": answer }).runner);
    return checkRecording(join(out, "replace"), checked);
  }

  test("a recording that shows what the scenario is for has no problems", async () => {
    expect(await problemsFor({ stdout: good })).toEqual([]);
  });

  test("stdout that should be JSON and is not", async () => {
    expect(await problemsFor({ stdout: "Previewing update (dev):" })).toEqual([
      "replace/preview.stdout: expected JSON, and it does not parse.",
    ]);
  });

  test("an empty stdout is not JSON", async () => {
    expect(await problemsFor({ stdout: "" })).toEqual([
      "replace/preview.stdout: expected JSON, and it does not parse.",
    ]);
  });

  test("the op the scenario is for is not among the steps", async () => {
    expect(await problemsFor({ stdout: JSON.stringify({ steps: [{ op: "update" }] }) })).toEqual([
      'replace/preview.stdout: expected a step with op "replace", found only: update.',
    ]);
  });

  test("a preview that failed where it should have worked", async () => {
    expect(await problemsFor({ stdout: good, exitCode: 255 })).toEqual([
      "replace/preview: expected exit code 0, got 255.",
    ]);
  });

  test("a failure scenario whose command worked", async () => {
    const failure: Scenario = {
      name: "replace",
      description: "",
      steps: [
        {
          kind: "record",
          id: "preview",
          cwd: "network",
          argv: PREVIEW,
          stdout: "text",
          expect: { exit: "nonzero" },
        },
      ],
    };
    await record(failure, replay({}).runner);
    expect(checkRecording(join(out, "replace"), failure)).toEqual([
      "replace/preview: expected an exit code other than 0, got 0.",
    ]);
  });

  test("a recording made from an older form of the scenario is stale", async () => {
    const changed: Scenario = {
      ...scenario,
      steps: [
        {
          kind: "record",
          id: "preview",
          cwd: "network",
          argv: [...PREVIEW, "--diff"],
          stdout: "json",
        },
      ],
    };
    expect(await problemsFor({ stdout: good }, changed)).toEqual([
      "replace/preview: the scenario now runs a different command. Record the fixtures again.",
    ]);
  });

  test("a directory without a recording", () => {
    expect(checkRecording(join(out, "replace"), scenario)).toEqual([
      "replace: no recording.json. Record the fixtures again.",
    ]);
  });

  test("a saved file that is gone", async () => {
    await record(scenario, replay({ "pulumi preview": { stdout: good } }).runner);
    rmSync(join(out, "replace", "preview.stderr"));
    expect(checkRecording(join(out, "replace"), scenario)).toEqual([
      "replace/preview.stderr: the file is missing.",
    ]);
  });
});
