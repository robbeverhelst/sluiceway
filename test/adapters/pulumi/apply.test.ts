import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CANARY_SECRET, CANARY_VALUE } from "../../../scripts/fixtures/example.ts";
import { pulumi } from "../../../src/adapters/pulumi/index.ts";
import type { Stack } from "../../../src/core/stack.ts";
import { answering, FIXTURES, ROOT, replay, VERSIONS } from "./replay.ts";

// The deploy (records 0001, 0013 and 0015): `pulumi up` on the stack whose
// fresh preview `apply` just compared. The tests replay what the real CLI
// printed in the two deploy scenarios. No test starts the tool.

const NETWORK_DEV: Stack = { path: "network", name: "dev", options: {} };

const UP = [
  "pulumi",
  "up",
  "--yes",
  "--skip-preview",
  "--suppress-outputs",
  "--non-interactive",
  "--color",
  "never",
  "--stack",
  "dev",
];

for (const version of VERSIONS) {
  describe(`a deploy, replaying pulumi ${version}`, () => {
    test("a deploy that went out is ok, and the tool's words are for the job log", async () => {
      const runner = replay(version, "deploy");
      const context = { root: ROOT, env: {}, run: runner.run };
      const previewed = await pulumi.preview(NETWORK_DEV, { ...context, timeoutMinutes: 10 });
      expect(previewed.ok).toBe(true);

      const result = await pulumi.apply(NETWORK_DEV, context);

      const stdout = readFileSync(join(FIXTURES, version, "deploy", "up.stdout"), "utf8");
      expect(result).toEqual({ ok: true, toolLog: stdout });
      expect(runner.runs.at(-1)).toMatchObject({ argv: UP, cwd: join(ROOT, "network") });
    });

    test("a deploy that failed half way gives the exit code", async () => {
      const runner = replay(version, "deploy-failed");
      const result = await pulumi.apply(NETWORK_DEV, { root: ROOT, env: {}, run: runner.run });

      expect(result.ok).toBe(false);
      expect(result).toMatchObject({ reason: { kind: "tool-error", exitCode: 1 } });
      expect(result.toolLog).toContain("error: update failed");
    });

    // The stack's outputs can be secrets (record 0021). The tool is told to
    // keep them to itself, and no value of the program is in its words.
    test("nothing the tool printed holds a value or an output", async () => {
      for (const scenario of ["deploy", "deploy-failed"]) {
        const runner = replay(version, scenario);
        const result = await pulumi.apply(NETWORK_DEV, { root: ROOT, env: {}, run: runner.run });
        const all = JSON.stringify(result);
        expect(all).not.toContain(CANARY_VALUE);
        expect(all).not.toContain(CANARY_SECRET);
        expect(all).not.toContain("networkName");
      }
    });
  });
}

describe("what a recording cannot hold", () => {
  test("the deploy has no time limit of Sluiceway's, and the tool gets no INPUT_* variable", async () => {
    const runner = answering({ status: "exited", exitCode: 0, stdout: "", stderr: "" });
    await pulumi.apply(NETWORK_DEV, {
      root: ROOT,
      env: { PATH: "/usr/bin", INPUT_GITHUB_TOKEN: "ghs_secret", PULUMI_BACKEND_URL: "file://x" },
      run: runner.run,
    });

    expect(runner.runs[0]?.timeoutMs).toBeUndefined();
    expect(runner.runs[0]?.env).toEqual({
      PATH: "/usr/bin",
      PULUMI_BACKEND_URL: "file://x",
      PULUMI_SKIP_UPDATE_CHECK: "true",
    });
  });

  test("a tool that could not be started is a tool error without an exit code", async () => {
    const runner = answering({ status: "not-started" });
    expect(await pulumi.apply(NETWORK_DEV, { root: ROOT, env: {}, run: runner.run })).toEqual({
      ok: false,
      reason: { kind: "tool-error", exitCode: null },
      toolLog: "",
    });
  });

  test("the tool's words lose their ANSI escapes, stdout first and then stderr", async () => {
    const runner = answering({
      status: "exited",
      exitCode: 255,
      stdout: "\u001b[31mUpdating (dev):\u001b[0m\n",
      stderr: "error: the stack is locked\n",
    });
    expect(await pulumi.apply(NETWORK_DEV, { root: ROOT, env: {}, run: runner.run })).toEqual({
      ok: false,
      reason: { kind: "tool-error", exitCode: 255 },
      toolLog: "Updating (dev):\nerror: the stack is locked\n",
    });
  });
});
