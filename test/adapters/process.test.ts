import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProcess } from "../../src/adapters/process.ts";

// The real process runner, against small shell commands. The tool itself is
// never started by a test.

const dir = realpathSync(mkdtempSync(join(tmpdir(), "sluiceway-process-")));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const PATH = process.env.PATH ?? "";

function sh(script: string, timeoutMs = 20_000, graceMs = 200) {
  return runProcess({ argv: ["sh", "-c", script], cwd: dir, env: { PATH }, timeoutMs }, graceMs);
}

async function goneWithin(pid: number, ms: number): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(20)) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
  }
  return false;
}

describe("the process runner", () => {
  test("gives what the command printed and its exit code", async () => {
    expect(await sh("echo out; echo err >&2; exit 3")).toEqual({
      status: "exited",
      exitCode: 3,
      stdout: "out\n",
      stderr: "err\n",
    });
  });

  // A deploy has no time limit of Sluiceway's: stopping one half way leaves a
  // stack half deployed. The job's own time limit is the user's.
  test("a run without a time limit is never stopped by the runner", async () => {
    expect(
      await runProcess({
        argv: ["sh", "-c", "sleep 0.3; echo done"],
        cwd: dir,
        env: { PATH },
        timeoutMs: undefined,
      }),
    ).toEqual({ status: "exited", exitCode: 0, stdout: "done\n", stderr: "" });
  });

  test("runs the command in the working directory it was given", async () => {
    expect(await sh("pwd")).toMatchObject({ exitCode: 0, stdout: `${dir}\n` });
  });

  // Nothing of the runner's own environment reaches the child, so what the
  // adapter took out stays out (record 0013).
  test("the child gets the environment it was given and nothing else", async () => {
    process.env.INPUT_SLUICEWAY_TEST_TOKEN = "must not reach the child";
    try {
      const result = await runProcess({
        argv: ["/usr/bin/env"],
        cwd: dir,
        env: { ONLY: "this" },
        timeoutMs: 20_000,
      });

      expect(result).toMatchObject({ exitCode: 0, stdout: "ONLY=this\n" });
    } finally {
      delete process.env.INPUT_SLUICEWAY_TEST_TOKEN;
    }
  });

  test("no shell reads the arguments", async () => {
    const result = await runProcess({
      argv: ["echo", "$PATH; echo second"],
      cwd: dir,
      env: { PATH },
      timeoutMs: 20_000,
    });

    expect(result).toMatchObject({ exitCode: 0, stdout: "$PATH; echo second\n" });
  });

  test("keeps output of several megabytes whole", async () => {
    const result = await sh("head -c 3000000 /dev/zero | tr '\\0' x");

    expect(result.status === "exited" && result.stdout.length).toBe(3_000_000);
  });

  test("a command that is not there was not started", async () => {
    const result = await runProcess({
      argv: ["sluiceway-no-such-command"],
      cwd: dir,
      env: { PATH },
      timeoutMs: 20_000,
    });

    expect(result).toEqual({ status: "not-started" });
  });

  test("a signal from elsewhere leaves no exit code", async () => {
    expect(await sh("kill -TERM $$")).toMatchObject({ status: "exited", exitCode: null });
  });
});

describe("the time limit", () => {
  // The tool stops a preview cleanly on the first SIGINT.
  test("interrupts first, so the command can stop by itself", async () => {
    const started = Date.now();
    const result = await sh('trap "echo interrupted; exit 0" INT; sleep 30 & wait', 300);

    expect(result).toEqual({ status: "timed-out", stdout: "interrupted\n", stderr: "" });
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  // A shell starts a background command with SIGINT ignored, which makes it a
  // child that only SIGKILL ends. It is not the process the runner started, so
  // only a signal to the whole group reaches it (record 0012).
  test("kills the whole process group when the grace period is over", async () => {
    const started = Date.now();
    const result = await sh("sleep 30 & echo $!; wait", 300);

    expect(result.status).toBe("timed-out");
    const pid = Number(result.status === "timed-out" && result.stdout.trim());
    expect(pid).toBeGreaterThan(1);
    expect(await goneWithin(pid, 5_000)).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  test("a command that ends in time did not time out", async () => {
    expect(await sh("sleep 0.2; echo done", 5_000)).toMatchObject({
      status: "exited",
      exitCode: 0,
      stdout: "done\n",
    });
  });
});
