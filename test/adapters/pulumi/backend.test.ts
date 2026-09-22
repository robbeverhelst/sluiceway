import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { ProcessRunner } from "../../../src/adapters/process.ts";
import { pulumi } from "../../../src/adapters/pulumi/index.ts";
import type { Stack } from "../../../src/core/stack.ts";
import { answering, ROOT, replay, VERSIONS } from "./replay.ts";

// Slice 5.7, record 0074: with backend: true the check asks the backend which
// stacks it holds, one `pulumi stack ls` per project directory. The tests
// replay what the real CLI printed. No test starts the tool.

const DEV: Stack = { path: "network", name: "dev", options: {} };
const PROD: Stack = { path: "network", name: "prod", options: {} };

const context = (run: ProcessRunner) => ({
  root: ROOT,
  env: { INPUT_GITHUB_TOKEN: "ghs_never", PULUMI_BACKEND_URL: "file:///state" },
  run,
});

for (const version of VERSIONS) {
  describe(`the stacks in the backend, replaying pulumi ${version}`, () => {
    test("a stack the backend holds is found, one it does not hold is not", async () => {
      const runner = replay(version, "stack-list");
      const result = await pulumi.findInBackend?.([DEV, PROD], context(runner.run));
      expect(result?.answers).toEqual([
        { stack: DEV, found: true },
        { stack: PROD, found: false },
      ]);
      // One question per directory, with the environment of the job minus the
      // inputs, in the stack's directory.
      expect(runner.runs.length).toBe(1);
      expect(runner.runs[0]?.cwd).toBe(join(ROOT, "network"));
      expect(runner.runs[0]?.env.INPUT_GITHUB_TOKEN).toBeUndefined();
      expect(runner.runs[0]?.env.PULUMI_BACKEND_URL).toBe("file:///state");
      expect(runner.runs[0]?.timeoutMs).toBe(10 * 60_000);
    });

    test("a project with no stacks in the backend", async () => {
      const runner = replay(version, "stack-list-empty");
      const result = await pulumi.findInBackend?.([DEV, PROD], context(runner.run));
      expect(result?.answers).toEqual([
        { stack: DEV, found: false },
        { stack: PROD, found: false },
      ]);
    });
  });
}

describe("when the backend cannot be asked", () => {
  test("the tool exits with an error: every stack of the directory is unknown", async () => {
    const runner = answering({
      status: "exited",
      exitCode: 255,
      stdout: "",
      stderr:
        "\u001b[31merror: PULUMI_ACCESS_TOKEN must be set for login during non-interactive CLI sessions\u001b[0m\n",
    });
    const result = await pulumi.findInBackend?.([DEV, PROD], context(runner.run));
    expect(result?.answers).toEqual([
      { stack: DEV, found: "unknown", reason: { kind: "tool-error", exitCode: 255 } },
      { stack: PROD, found: "unknown", reason: { kind: "tool-error", exitCode: 255 } },
    ]);
    // The tool's words are for the job log, without escapes.
    expect(result?.toolLog).toBe(
      "error: PULUMI_ACCESS_TOKEN must be set for login during non-interactive CLI sessions\n",
    );
  });

  test("output that is not the list", async () => {
    const runner = answering({ status: "exited", exitCode: 0, stdout: "{}", stderr: "" });
    const result = await pulumi.findInBackend?.([DEV], context(runner.run));
    expect(result?.answers).toEqual([
      { stack: DEV, found: "unknown", reason: { kind: "unreadable-output" } },
    ]);
  });

  test("the tool is not there, or ran out of time", async () => {
    const missing = await pulumi.findInBackend?.(
      [DEV],
      context(answering({ status: "not-started" }).run),
    );
    expect(missing?.answers).toEqual([
      { stack: DEV, found: "unknown", reason: { kind: "tool-error", exitCode: null } },
    ]);
    const slow = await pulumi.findInBackend?.(
      [DEV],
      context(answering({ status: "timed-out", stdout: "", stderr: "" }).run),
    );
    expect(slow?.answers).toEqual([
      { stack: DEV, found: "unknown", reason: { kind: "timed-out", minutes: 10 } },
    ]);
  });

  test("a stack named with an organization and a project, as another backend may list it", async () => {
    const runner = answering({
      status: "exited",
      exitCode: 0,
      stdout: JSON.stringify([{ name: "acme/network/dev" }, { name: "acme/prod-old" }]),
      stderr: "",
    });
    const result = await pulumi.findInBackend?.([DEV, PROD], context(runner.run));
    expect(result?.answers).toEqual([
      { stack: DEV, found: true },
      { stack: PROD, found: false },
    ]);
  });
});
