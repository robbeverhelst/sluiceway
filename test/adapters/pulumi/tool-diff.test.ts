import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CANARY_SECRET, CANARY_VALUE } from "../../../scripts/fixtures/example.ts";
import type { ToolDiffResult } from "../../../src/adapters/adapter.ts";
import { pulumi } from "../../../src/adapters/pulumi/index.ts";
import type { Stack } from "../../../src/core/stack.ts";
import { answering, FIXTURES, type Replay, ROOT, replay, VERSIONS } from "./replay.ts";

// The tool's own diff (record 0045): the preview as the tool displays it,
// values included, for the job log of a repo that turned `scan.logDiff` on.
// It is a second run of the tool, with the same directory, environment and
// time limit as the preview.

const NETWORK_DEV: Stack = { path: "network", name: "dev", options: {} };

function toolDiffWith(stack: Stack, { run }: Replay, timeoutMinutes = 10): Promise<ToolDiffResult> {
  return pulumi.toolDiff(stack, {
    root: ROOT,
    env: { PATH: "/usr/bin", INPUT_GITHUB_TOKEN: "ghs_not-for-the-tool" },
    run,
    timeoutMinutes,
  });
}

function recorded(version: string, scenario: string, file: string): string {
  return readFileSync(join(FIXTURES, version, scenario, file), "utf8");
}

for (const version of VERSIONS) {
  describe(`the tool's own diff, replaying pulumi ${version}`, () => {
    // The replay only answers the recorded command line, so this also holds
    // the adapter to the command CI recorded.
    test("is what the tool displayed, with every value it does not hold as secret", async () => {
      const result = await toolDiffWith(NETWORK_DEV, replay(version, "log-diff-deploy"));

      expect(result).toEqual({
        ok: true,
        text: recorded(version, "log-diff-deploy", "diff.stdout"),
        toolLog: recorded(version, "log-diff-deploy", "diff.stderr"),
      });
      if (!result.ok) return;
      expect(result.text).toContain(CANARY_VALUE);
    });

    // What masks a secret there is the tool's own marking, and nothing
    // Sluiceway guesses (record 0045).
    test("a changed secret shows as changed, and the tool masks both of its values", async () => {
      const result = await toolDiffWith(NETWORK_DEV, replay(version, "log-diff-changed-secret"));

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.text).toContain("[secret] => [secret]");
      expect(result.text).not.toContain(CANARY_SECRET);
    });

    test("a run that fails gives a reason from the fixed list, and the tool's words", async () => {
      const result = await toolDiffWith(NETWORK_DEV, replay(version, "log-diff-missing-config"));

      expect(result).toEqual({
        ok: false,
        reason: { kind: "tool-error", exitCode: 1 },
        toolLog:
          recorded(version, "log-diff-missing-config", "diff.stdout") +
          recorded(version, "log-diff-missing-config", "diff.stderr"),
      });
    });
  });
}

describe("the tool's own diff, with no recording", () => {
  test("runs in the stack's directory, with the job's environment minus INPUT_* and the preview's time limit", async () => {
    const tool = answering({ status: "exited", exitCode: 0, stdout: "", stderr: "" });
    await toolDiffWith(NETWORK_DEV, tool, 7);

    expect(tool.runs).toEqual([
      {
        argv: [
          "pulumi",
          "preview",
          "--diff",
          "--suppress-outputs",
          "--non-interactive",
          "--color",
          "never",
          "--stack",
          "dev",
        ],
        cwd: join(ROOT, "network"),
        env: { PATH: "/usr/bin", PULUMI_SKIP_UPDATE_CHECK: "true" },
        timeoutMs: 7 * 60_000,
      },
    ]);
  });

  test("ANSI escapes are stripped, as from all of the tool's words", async () => {
    const tool = answering({
      status: "exited",
      exitCode: 0,
      stdout: "\u001b[32m+ create\u001b[0m\n",
      stderr: "",
    });
    expect(await toolDiffWith(NETWORK_DEV, tool)).toEqual({
      ok: true,
      text: "+ create\n",
      toolLog: "",
    });
  });

  test("a run that ran out of time says how long it had, and keeps what the tool printed", async () => {
    const tool = answering({
      status: "timed-out",
      stdout: "Previewing update (dev):\n",
      stderr: "",
    });
    expect(await toolDiffWith(NETWORK_DEV, tool, 3)).toEqual({
      ok: false,
      reason: { kind: "timed-out", minutes: 3 },
      toolLog: "Previewing update (dev):\n",
    });
  });

  test("a tool that could not be started is a tool error without an exit code", async () => {
    const tool = answering({ status: "not-started" });
    expect(await toolDiffWith(NETWORK_DEV, tool)).toEqual({
      ok: false,
      reason: { kind: "tool-error", exitCode: null },
      toolLog: "",
    });
  });

  test("exit code 6 is the stack missing from the backend, as on the preview", async () => {
    const tool = answering({
      status: "exited",
      exitCode: 6,
      stdout: "",
      stderr: "error: no stack\n",
    });
    expect(await toolDiffWith(NETWORK_DEV, tool)).toEqual({
      ok: false,
      reason: { kind: "stack-not-found" },
      toolLog: "error: no stack\n",
    });
  });
});
