import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProcessRunner, Run, RunResult } from "../../../src/adapters/process.ts";
import { pulumi } from "../../../src/adapters/pulumi/index.ts";
import type { Stack } from "../../../src/core/stack.ts";
import { answering, FIXTURES, readRecording, replay, ROOT, VERSIONS } from "./replay.ts";

// Slice 5.42, record 0107: a stack whose files exist and whose backend lacks
// it is created by the scan when its entry asks with createInBackend: true.
// The adapter gives one preparation per such stack: the list of the
// project's stacks, then `pulumi stack init` when the list lacks the stack.
// The tests replay what the real CLI printed. No test starts the tool.

const DEV: Stack = { path: "network", name: "dev", options: {} };
const PROD: Stack = { path: "network", name: "prod", options: {} };
const ENV = {
  INPUT_GITHUB_TOKEN: "ghs_never",
  PULUMI_BACKEND_URL: "file:///state",
  PULUMI_CONFIG_PASSPHRASE: "hunter2",
};

const context = (run: ProcessRunner) => ({ root: ROOT, env: ENV, run, timeoutMinutes: 7 });

const LS = ["pulumi", "stack", "ls", "--json", "--non-interactive", "--color", "never"];
const INIT = ["pulumi", "stack", "init", "prod", "--non-interactive", "--color", "never"];

// What one recorded command printed, for a runner that answers each command
// of the adapter from a recording of its own.
function recorded(version: string, scenario: string, id: string): RunResult {
  const command = readRecording(version, scenario).commands.find((one) => one.id === id);
  if (command === undefined) throw new Error(`${version}/${scenario} holds no ${id}.`);
  const dir = join(FIXTURES, version, scenario);
  return {
    status: "exited",
    exitCode: command.exitCode,
    stdout: readFileSync(join(dir, command.stdout), "utf8"),
    stderr: readFileSync(join(dir, command.stderr), "utf8"),
  };
}

function routing(table: Record<string, RunResult>) {
  const runs: Run[] = [];
  const run: ProcessRunner = async (asked) => {
    runs.push(asked);
    const answer = table[asked.argv[2] ?? ""];
    if (answer === undefined) throw new Error(`No answer for ${asked.argv.join(" ")}.`);
    return answer;
  };
  return { run, runs };
}

describe("what the Pulumi adapter prepares", () => {
  test("nothing, unless a stack is to be created", () => {
    expect(pulumi.prepare?.([DEV, PROD])).toEqual([]);
    expect(pulumi.prepare?.([DEV, PROD], { createInBackend: [] })).toEqual([]);
  });

  test("one preparation per stack to create, in stack id order, titled with the stack id", () => {
    const preparations = pulumi.prepare?.([DEV, PROD], { createInBackend: [PROD, DEV] }) ?? [];
    expect(preparations.map((one) => [one.title, one.stacks])).toEqual([
      ["the stack network:dev in the backend", [DEV]],
      ["the stack network:prod in the backend", [PROD]],
    ]);
  });
});

for (const version of VERSIONS) {
  describe(`creating a stack the backend lacks, replaying pulumi ${version}`, () => {
    test("the list first, then the init with the name and nothing about a secrets provider", async () => {
      const runner = replay(version, "create-stack");
      const [preparation] = pulumi.prepare?.([DEV, PROD], { createInBackend: [PROD] }) ?? [];
      const result = await preparation?.run(context(runner.run));

      expect(result).toEqual({
        ok: true,
        toolLog: expect.any(String),
        detail: [
          "The backend did not hold network:prod, so the stack was created. Its preview shows every resource as a create.",
        ],
      });
      expect(runner.runs.map((run) => run.argv)).toEqual([LS, INIT]);
      // Both in the stack's directory, with the stack's environment minus
      // the inputs (record 0013), the passphrase the job has among it, and
      // the stack's own time limit.
      for (const run of runner.runs) {
        expect(run.cwd).toBe(join(ROOT, "network"));
        expect(run.env.INPUT_GITHUB_TOKEN).toBeUndefined();
        expect(run.env.PULUMI_CONFIG_PASSPHRASE).toBe("hunter2");
        expect(run.timeoutMs).toBe(7 * 60_000);
      }
    });

    test("the preview after it shows every resource as a create", async () => {
      const runner = replay(version, "create-stack");
      const [preparation] = pulumi.prepare?.([PROD], { createInBackend: [PROD] }) ?? [];
      await preparation?.run(context(runner.run));
      const preview = await pulumi.preview(PROD, context(runner.run));
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(preview.diff.changes.length).toBeGreaterThan(0);
      expect(new Set(preview.diff.changes.map((change) => change.op))).toEqual(new Set(["create"]));
    });

    test("a stack the backend holds is left alone, and the group says so", async () => {
      const runner = replay(version, "create-stack");
      const [preparation] = pulumi.prepare?.([DEV], { createInBackend: [DEV] }) ?? [];
      const result = await preparation?.run(context(runner.run));
      expect(result).toEqual({
        ok: true,
        toolLog: expect.any(String),
        detail: ["The backend already holds network:dev. Nothing was created."],
      });
      expect(runner.runs.map((run) => run.argv)).toEqual([LS]);
    });

    test("an init the tool refuses is a preview failure of the stack, with the tool's words for the log alone", async () => {
      // The list says the stack is missing and the tool refuses to make it:
      // what a stack made elsewhere between the two would give. The refusal
      // is the tool's own, recorded after the stack was there.
      const runner = routing({
        ls: recorded(version, "stack-list-empty", "stack-ls"),
        init: recorded(version, "create-stack", "stack-init-again"),
      });
      const [preparation] = pulumi.prepare?.([PROD], { createInBackend: [PROD] }) ?? [];
      const result = await preparation?.run(context(runner.run));
      expect(result?.ok).toBe(false);
      if (result?.ok !== false) return;
      expect(result.reason).toEqual({ kind: "tool-error", exitCode: 1 });
      expect(result.toolLog).not.toBe("");
      expect(runner.runs.map((run) => run.argv)).toEqual([LS, INIT]);
    });
  });
}

describe("when the backend cannot be listed", () => {
  test("the stack is a preview failure with the reason, and nothing is created", async () => {
    const runner = answering({
      status: "exited",
      exitCode: 255,
      stdout: "",
      stderr:
        "\u001b[31merror: PULUMI_ACCESS_TOKEN must be set for login during non-interactive CLI sessions\u001b[0m\n",
    });
    const [preparation] = pulumi.prepare?.([PROD], { createInBackend: [PROD] }) ?? [];
    const result = await preparation?.run(context(runner.run));
    expect(result).toEqual({
      ok: false,
      reason: { kind: "tool-error", exitCode: 255 },
      toolLog:
        "error: PULUMI_ACCESS_TOKEN must be set for login during non-interactive CLI sessions\n",
    });
    expect(runner.runs.map((run) => run.argv)).toEqual([LS]);
  });

  test("a list that ran out of time", async () => {
    const runner = answering({ status: "timed-out", stdout: "", stderr: "" });
    const [preparation] = pulumi.prepare?.([PROD], { createInBackend: [PROD] }) ?? [];
    const result = await preparation?.run(context(runner.run));
    expect(result).toEqual({
      ok: false,
      reason: { kind: "timed-out", minutes: 7 },
      toolLog: "",
    });
  });

  test("output that is not the list", async () => {
    const runner = answering({ status: "exited", exitCode: 0, stdout: "not json", stderr: "" });
    const [preparation] = pulumi.prepare?.([PROD], { createInBackend: [PROD] }) ?? [];
    const result = await preparation?.run(context(runner.run));
    expect(result).toEqual({ ok: false, reason: { kind: "unreadable-output" }, toolLog: "" });
    expect(runner.runs.length).toBe(1);
  });
});
