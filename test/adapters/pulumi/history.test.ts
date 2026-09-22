import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CANARY_SECRET, CANARY_VALUE } from "../../../scripts/fixtures/example.ts";
import {
  HISTORY_AUTHOR,
  HISTORY_PAGE,
  OTHER_RUN,
  OWN_RUN,
} from "../../../scripts/fixtures/scenarios.ts";
import type { ProcessRunner } from "../../../src/adapters/process.ts";
import { pulumi } from "../../../src/adapters/pulumi/index.ts";
import type { Stack } from "../../../src/core/stack.ts";
import { answering, FIXTURES, ROOT, replay, VERSIONS } from "./replay.ts";

// The tool's history of a stack (record 0073), replayed from what the real CLI
// printed after a deploy from a laptop, Sluiceway's own deploy and one from
// another workflow inside GitHub Actions, a deploy that changed nothing, a
// refresh, a failed deploy and a destroy. No test starts the tool.

const NETWORK_DEV: Stack = { path: "network", name: "dev", options: {} };

const options = (run: ProcessRunner) => ({
  root: ROOT,
  env: { INPUT_GITHUB_TOKEN: "ghs_never", PULUMI_BACKEND_URL: "file:///state" },
  run,
  timeoutMinutes: 10,
  limit: HISTORY_PAGE,
});

// The commits the recording's git repo made, newest first, read from the
// recording itself because a commit id changes with every recording.
function commits(version: string): string[] {
  const raw = readFileSync(join(FIXTURES, version, "history", "history.stdout"), "utf8");
  const entries = JSON.parse(raw) as { environment: Record<string, string> }[];
  return [...new Set(entries.map((entry) => entry.environment["git.head"] ?? ""))];
}

for (const version of VERSIONS) {
  describe(`the tool's history, replaying pulumi ${version}`, () => {
    test("a stack that was never deployed has no deploys", async () => {
      const runner = replay(version, "history");
      const read = await pulumi.deployHistory?.(NETWORK_DEV, options(runner.run));
      expect(read).toEqual({ ok: true, deploys: [], toolLog: "" });
      expect(runner.runs[0]).toMatchObject({
        argv: [
          "pulumi",
          "stack",
          "history",
          "--json",
          "--page-size",
          String(HISTORY_PAGE),
          "--non-interactive",
          "--color",
          "never",
          "--stack",
          "dev",
        ],
        cwd: join(ROOT, "network"),
      });
      // The tool gets the job's environment without the INPUT_* variables
      // (record 0013).
      expect(runner.runs[0]?.env.INPUT_GITHUB_TOKEN).toBeUndefined();
      expect(runner.runs[0]?.env.PULUMI_BACKEND_URL).toBe("file:///state");
    });

    test("only deploys that went out and changed something, newest first", async () => {
      const runner = replay(version, "history");
      await pulumi.deployHistory?.(NETWORK_DEV, options(runner.run));
      const read = await pulumi.deployHistory?.(NETWORK_DEV, options(runner.run));
      const [third, second, first] = commits(version);
      if (!read?.ok) throw new Error("expected the history to read");
      // The destroy, the deploy from another workflow, Sluiceway's own deploy
      // and the deploy from a laptop. Not the deploy that changed nothing, the
      // refresh or the failed deploy.
      expect(read.deploys.map(({ endedAt: _, ...rest }) => rest)).toEqual([
        { kind: "destroy", commit: { sha: third ?? "", dirty: true } },
        { kind: "deploy", commit: { sha: third ?? "", dirty: false }, runId: OTHER_RUN },
        { kind: "deploy", commit: { sha: second ?? "", dirty: false }, runId: OWN_RUN },
        { kind: "deploy", commit: { sha: first ?? "", dirty: false } },
      ]);
      for (const deploy of read.deploys) {
        expect(deploy.endedAt.toISOString()).toMatch(/^2026-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/);
      }
      const times = read.deploys.map((deploy) => deploy.endedAt.getTime());
      expect(times).toEqual([...times].sort((a, b) => b - a));
    });

    // What leaves the adapter has no place for a config value, the message or
    // the people behind the commit (record 0073).
    test("no value, message, name or address leaves the adapter", async () => {
      const runner = replay(version, "history");
      await pulumi.deployHistory?.(NETWORK_DEV, options(runner.run));
      const read = await pulumi.deployHistory?.(NETWORK_DEV, options(runner.run));
      const raw = readFileSync(join(FIXTURES, version, "history", "history.stdout"), "utf8");
      for (const word of [CANARY_VALUE, HISTORY_AUTHOR.name, HISTORY_AUTHOR.email]) {
        expect(raw).toContain(word);
      }
      const out = JSON.stringify(read);
      for (const word of [
        CANARY_VALUE,
        CANARY_SECRET,
        "CANARY",
        HISTORY_AUTHOR.name,
        HISTORY_AUTHOR.email,
        "commit title",
        "example-org",
      ]) {
        expect(out).not.toContain(word);
      }
    });

    test("a stack the backend does not hold is a failure with a reason", async () => {
      const runner = replay(version, "history-missing-stack");
      const read = await pulumi.deployHistory?.(
        { path: "network", name: "ghost", options: {} },
        options(runner.run),
      );
      expect(read).toMatchObject({ ok: false, reason: { kind: "stack-not-found" } });
      expect(read?.toolLog).toContain("no stack named");
    });
  });
}

describe("the tool's history, when the tool does not answer as recorded", () => {
  const result = (stdout: string, exitCode = 0) =>
    pulumi.deployHistory?.(
      NETWORK_DEV,
      options(answering({ status: "exited", exitCode, stdout, stderr: "" }).run),
    );

  test("output that is not JSON names the place and never what was there", async () => {
    const read = await result(`not json ${CANARY_VALUE}`);
    expect(read).toMatchObject({ ok: false, reason: { kind: "unreadable-output" } });
    expect(JSON.stringify(read)).not.toContain(CANARY_VALUE);
  });

  test("an entry of a shape it does not know is unreadable, not skipped", async () => {
    const read = await result(JSON.stringify([{ kind: "update", result: "succeeded" }]));
    expect(read).toMatchObject({ ok: false, reason: { kind: "unreadable-output" } });
  });

  test("a commit or a run id that is not one is left out, never passed on", async () => {
    const read = await result(
      JSON.stringify([
        {
          kind: "update",
          result: "succeeded",
          endTime: "2026-09-21T18:11:10.000Z",
          resourceChanges: { update: 1 },
          environment: {
            "git.head": CANARY_VALUE,
            "ci.system": "GitHub Actions",
            "ci.build.id": CANARY_VALUE,
          },
        },
        {
          kind: "update",
          result: "succeeded",
          endTime: "2026-09-21T18:11:09.000Z",
          resourceChanges: { create: 1 },
          environment: { "ci.system": "GitLab CI/CD", "ci.build.id": "555" },
        },
      ]),
    );
    expect(read).toEqual({
      ok: true,
      deploys: [
        { kind: "deploy", endedAt: new Date("2026-09-21T18:11:10.000Z") },
        { kind: "deploy", endedAt: new Date("2026-09-21T18:11:09.000Z") },
      ],
      toolLog: "",
    });
  });

  test("a time limit that ran out is a failure that says so", async () => {
    const read = await pulumi.deployHistory?.(
      NETWORK_DEV,
      options(answering({ status: "timed-out", stdout: "", stderr: "" }).run),
    );
    expect(read).toMatchObject({ ok: false, reason: { kind: "timed-out", minutes: 10 } });
  });
});
