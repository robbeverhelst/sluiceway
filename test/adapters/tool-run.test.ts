import { describe, expect, test } from "bun:test";
import type { Run, RunResult } from "../../src/adapters/process.ts";
import { type ExitCodes, runDeploy, runTool, stripAnsi } from "../../src/adapters/tool-run.ts";

// One run of a tool and what it came to, for every adapter at once. Each
// adapter's own tests hold what is about its tool: its command line, its
// exit codes and which of its words reach the job log.

function answering(result: RunResult) {
  const runs: Run[] = [];
  return {
    runs,
    run: async (asked: Run) => {
      runs.push(asked);
      return result;
    },
  };
}

const COMMAND = { argv: ["tool", "preview"], cwd: "/repo/stack", env: { PATH: "/usr/bin" } };

function exited(exitCode: number | null, stdout = "out\n", stderr = "err\n"): RunResult {
  return { status: "exited", exitCode, stdout, stderr };
}

describe("a run with a time limit", () => {
  test("starts the command as given, with the time limit in milliseconds", async () => {
    const runner = answering(exited(0));
    await runTool(runner.run, { ...COMMAND, timeoutMinutes: 7 });
    expect(runner.runs).toEqual([{ ...COMMAND, timeoutMs: 7 * 60 * 1000 }]);
  });

  test("exit code 0 gives the tool's output", async () => {
    const runner = answering(exited(0));
    expect(await runTool(runner.run, { ...COMMAND, timeoutMinutes: 1 })).toEqual({
      ok: true,
      exitCode: 0,
      stdout: "out\n",
      stderr: "err\n",
    });
  });

  test("output the runner cut says where", async () => {
    const runner = answering({
      status: "exited",
      exitCode: 0,
      stdout: "{",
      stderr: "",
      outputCutAt: 128 * 1024 * 1024,
    });
    expect(await runTool(runner.run, { ...COMMAND, timeoutMinutes: 1 })).toMatchObject({
      ok: true,
      outputCutAt: 128 * 1024 * 1024,
    });
  });

  test("a tool that could not be started is a tool error without an exit code, and printed nothing", async () => {
    const runner = answering({ status: "not-started" });
    expect(await runTool(runner.run, { ...COMMAND, timeoutMinutes: 1 })).toEqual({
      ok: false,
      reason: { kind: "tool-error", exitCode: null },
      stdout: "",
      stderr: "",
    });
  });

  test("a run that ran out of time says how long it had, and keeps what the tool printed", async () => {
    const runner = answering({ status: "timed-out", stdout: "part\n", stderr: "^C\n" });
    expect(await runTool(runner.run, { ...COMMAND, timeoutMinutes: 3 })).toEqual({
      ok: false,
      reason: { kind: "timed-out", minutes: 3 },
      stdout: "part\n",
      stderr: "^C\n",
    });
  });

  test("any other exit code is a tool error with the code", async () => {
    const runner = answering(exited(1));
    expect(await runTool(runner.run, { ...COMMAND, timeoutMinutes: 1 })).toEqual({
      ok: false,
      reason: { kind: "tool-error", exitCode: 1 },
      stdout: "out\n",
      stderr: "err\n",
    });
  });

  test("a tool that a signal ended is a tool error without an exit code", async () => {
    const runner = answering(exited(null));
    const result = await runTool(runner.run, {
      ...COMMAND,
      timeoutMinutes: 1,
      exitCodes: { success: [0, 1] },
    });
    expect(result).toMatchObject({ ok: false, reason: { kind: "tool-error", exitCode: null } });
  });

  const CODES: ExitCodes = { success: [0, 1], reasons: { 6: { kind: "stack-not-found" } } };

  test("a code the tool reads as success gives the output and says which code", async () => {
    const runner = answering(exited(1));
    expect(
      await runTool(runner.run, { ...COMMAND, timeoutMinutes: 1, exitCodes: CODES }),
    ).toMatchObject({ ok: true, exitCode: 1, stdout: "out\n" });
  });

  test("a code the tool documents gets its own reason, and the rest stay tool errors", async () => {
    const own = await runTool(answering(exited(6)).run, {
      ...COMMAND,
      timeoutMinutes: 1,
      exitCodes: CODES,
    });
    expect(own).toMatchObject({ ok: false, reason: { kind: "stack-not-found" } });
    const other = await runTool(answering(exited(2)).run, {
      ...COMMAND,
      timeoutMinutes: 1,
      exitCodes: CODES,
    });
    expect(other).toMatchObject({ ok: false, reason: { kind: "tool-error", exitCode: 2 } });
  });

  test("the reason comes from the code alone, never from what the tool printed", async () => {
    const runner = answering(exited(2, "", "error: stack does not exist\n"));
    const result = await runTool(runner.run, { ...COMMAND, timeoutMinutes: 1, exitCodes: CODES });
    expect(result).toMatchObject({ ok: false, reason: { kind: "tool-error", exitCode: 2 } });
  });
});

describe("a run that is part of a deploy", () => {
  test("has no time limit of Sluiceway's", async () => {
    const runner = answering(exited(0));
    await runDeploy(runner.run, COMMAND);
    expect(runner.runs).toEqual([COMMAND]);
    expect(runner.runs[0]?.timeoutMs).toBeUndefined();
  });

  test("exit code 0 gives the tool's output", async () => {
    expect(await runDeploy(answering(exited(0)).run, COMMAND)).toEqual({
      ok: true,
      stdout: "out\n",
      stderr: "err\n",
    });
  });

  test("keeps its exit code, whatever the tool documents for it", async () => {
    expect(await runDeploy(answering(exited(6)).run, COMMAND)).toEqual({
      ok: false,
      reason: { kind: "tool-error", exitCode: 6 },
      stdout: "out\n",
      stderr: "err\n",
    });
  });

  test("a tool that could not be started is a tool error without an exit code, and printed nothing", async () => {
    expect(await runDeploy(answering({ status: "not-started" }).run, COMMAND)).toEqual({
      ok: false,
      reason: { kind: "tool-error", exitCode: null },
      stdout: "",
      stderr: "",
    });
  });

  // `apply` handed in a runner with the deploy-timeout input's limit, and
  // says why itself.
  test("a run the runner stopped is a tool error without an exit code", async () => {
    const runner = answering({ status: "timed-out", stdout: "Updating\n", stderr: "" });
    expect(await runDeploy(runner.run, COMMAND)).toEqual({
      ok: false,
      reason: { kind: "tool-error", exitCode: null },
      stdout: "Updating\n",
      stderr: "",
    });
  });
});

describe("the tool's words", () => {
  test("lose their colour, cursor and title escapes", () => {
    expect(stripAnsi("\u001b[31mred\u001b[0m \u001b]0;title\u0007done\u001bM")).toBe("red done");
  });
});
