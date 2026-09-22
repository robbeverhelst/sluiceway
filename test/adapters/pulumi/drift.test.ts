import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CANARY_SECRET, CANARY_VALUE } from "../../../scripts/fixtures/example.ts";
import type { ProcessRunner } from "../../../src/adapters/process.ts";
import { pulumi } from "../../../src/adapters/pulumi/index.ts";
import type { Stack } from "../../../src/core/stack.ts";
import { ROOT, replay, VERSIONS } from "./replay.ts";

// The drift check and the deploy that repairs drift (record 0055). The tests
// replay what the real CLI printed after a resource was changed behind its
// back in the example project. No test starts the tool.

const NETWORK_DEV: Stack = { path: "network", name: "dev", options: {} };
const SITE_PROD: Stack = { path: "site", name: "prod", options: {} };

const REFRESH = [
  "pulumi",
  "refresh",
  "--preview-only",
  "--json",
  "--non-interactive",
  "--color",
  "never",
  "--stack",
];

const options = (run: ProcessRunner) => ({
  root: ROOT,
  env: { INPUT_GITHUB_TOKEN: "ghs_never", PULUMI_BACKEND_URL: "file:///state" },
  run,
  timeoutMinutes: 10,
});

for (const version of VERSIONS) {
  describe(`the drift check, replaying pulumi ${version}`, () => {
    test("a file removed behind the tool's back is gone, and the preview sees nothing", async () => {
      const runner = replay(version, "drift-gone");
      const before = await pulumi.detectDrift?.(NETWORK_DEV, options(runner.run));
      expect(before).toMatchObject({ ok: true, drift: [] });

      const preview = await pulumi.preview(NETWORK_DEV, options(runner.run));
      expect(preview).toMatchObject({ ok: true, diff: { changes: [] } });

      const found = await pulumi.detectDrift?.(NETWORK_DEV, options(runner.run));
      expect(found).toMatchObject({
        ok: true,
        drift: [
          {
            address: "urn:pulumi:dev::network::local:index/file:File::notes",
            type: "local:index/file:File",
            name: "notes",
            op: "delete",
            changedKeys: [],
            replaceKeys: [],
          },
        ],
      });
      expect(runner.runs[0]).toMatchObject({
        argv: [...REFRESH, "dev"],
        cwd: join(ROOT, "network"),
      });
    });

    // The tool's one JSON document lists this as a plain refresh step. Only
    // its engine events name the resource (record 0055).
    test("a property changed behind the tool's back is changed", async () => {
      const runner = replay(version, "drift-changed");
      await pulumi.preview(SITE_PROD, options(runner.run));
      const found = await pulumi.detectDrift?.(SITE_PROD, options(runner.run));
      expect(found).toMatchObject({
        ok: true,
        drift: [
          {
            address: "urn:pulumi:prod::site::pulumi-nodejs:dynamic:Resource::note",
            type: "pulumi-nodejs:dynamic:Resource",
            name: "note",
            op: "update",
            changedKeys: [],
            replaceKeys: [],
          },
        ],
      });
    });

    test("the check gets the whole environment but the inputs, and the variable that streams events", async () => {
      const runner = replay(version, "drift-gone");
      await pulumi.detectDrift?.(NETWORK_DEV, options(runner.run));
      expect(runner.runs[0]?.env).toEqual({
        PULUMI_BACKEND_URL: "file:///state",
        PULUMI_SKIP_UPDATE_CHECK: "true",
        PULUMI_ENABLE_STREAMING_JSON_PREVIEW: "true",
      });
      expect(runner.runs[0]?.timeoutMs).toBe(600_000);
    });

    // From v3.229.0 a refresh that only previews takes no stack lock on a
    // file backend (record 0001). The scenario holds a lock the way a running
    // deploy does, and the check still runs.
    test("the check runs while a deploy holds the stack lock", async () => {
      const runner = replay(version, "drift-locked");
      const found = await pulumi.detectDrift?.(NETWORK_DEV, options(runner.run));
      expect(found).toMatchObject({ ok: true, drift: [{ op: "delete", name: "notes" }] });
    });

    test("a deploy in the same place fails on that lock, so the lock is real", async () => {
      const runner = replay(version, "drift-locked");
      await pulumi.detectDrift?.(NETWORK_DEV, options(runner.run));
      const deployed = await pulumi.apply(NETWORK_DEV, options(runner.run));
      expect(deployed.ok).toBe(false);
      expect(deployed.toolLog).toContain("the stack is currently locked");
    });

    test("a stack the backend does not hold fails the check with the reason a preview gets", async () => {
      const runner = replay(version, "drift-missing-stack");
      const ghost: Stack = { path: "network", name: "ghost", options: {} };
      const found = await pulumi.detectDrift?.(ghost, options(runner.run));
      expect(found).toMatchObject({ ok: false, reason: { kind: "stack-not-found" } });
      expect(found?.toolLog).toContain("no stack named 'ghost' found");
    });

    test("the deploy that repairs drift adds --refresh, and after it the check finds nothing", async () => {
      for (const [scenario, stack] of [
        ["drift-gone", NETWORK_DEV],
        ["drift-changed", SITE_PROD],
      ] as const) {
        const runner = replay(version, scenario);
        if (scenario === "drift-gone") await pulumi.detectDrift?.(stack, options(runner.run));
        await pulumi.preview(stack, options(runner.run));
        await pulumi.detectDrift?.(stack, options(runner.run));
        const deployed = await pulumi.apply(stack, options(runner.run), undefined, {
          repairDrift: true,
        });
        expect(deployed.ok).toBe(true);
        expect(runner.runs.at(-1)?.argv).toContain("--refresh");
        const after = await pulumi.detectDrift?.(stack, options(runner.run));
        expect(after).toMatchObject({ ok: true, drift: [] });
      }
    });

    // The engine events carry every property value of every resource, the
    // edited file's content among them. None of it leaves the adapter.
    test("no value reaches the result, and the tool's words hold no event", async () => {
      for (const [scenario, stack] of [
        ["drift-gone", NETWORK_DEV],
        ["drift-changed", SITE_PROD],
        ["drift-locked", NETWORK_DEV],
      ] as const) {
        const runner = replay(version, scenario);
        const results = [];
        for (let index = 0; index < 3; index++) {
          try {
            results.push(await pulumi.detectDrift?.(stack, options(runner.run)));
          } catch {
            break;
          }
        }
        const all = JSON.stringify(results);
        expect(all).not.toContain(CANARY_VALUE);
        expect(all).not.toContain(CANARY_SECRET);
        expect(all).not.toContain("resOutputsEvent");
      }
    });
  });
}

describe("output the check cannot read", () => {
  const answer = (stdout: string, exitCode = 0): ProcessRunner => {
    return async () => ({ status: "exited", exitCode, stdout, stderr: "" });
  };
  const event = (op: string, urn: string, extra: object = {}) =>
    JSON.stringify({ resOutputsEvent: { metadata: { op, urn, ...extra } } });
  const summary = (changes: Record<string, number>) =>
    JSON.stringify({ summaryEvent: { resourceChanges: changes } });
  const URN = "urn:pulumi:dev::network::random:index/randomPet:RandomPet::pet";

  test("paths come from detailedDiff, and fall back to diffs", async () => {
    const stdout = [
      event("update", URN, { detailedDiff: { "tags.owner": { kind: "update" } }, diffs: ["tags"] }),
      event("update", `${URN}2`, { diffs: ["length"] }),
      summary({ update: 2 }),
    ].join("\n");
    const found = await pulumi.detectDrift?.(NETWORK_DEV, options(answer(stdout)));
    expect(found).toMatchObject({
      ok: true,
      drift: [{ changedKeys: ["tags.owner"] }, { changedKeys: ["length"] }],
    });
  });

  test("a stream without its summary is cut short", async () => {
    const found = await pulumi.detectDrift?.(NETWORK_DEV, options(answer(event("delete", URN))));
    expect(found).toMatchObject({
      ok: false,
      reason: { kind: "unreadable-output" },
      detail: ["The tool's output: expected a summary event at the end."],
    });
  });

  test("a summary that counts drift the events do not name is not read", async () => {
    const stdout = [event("same", URN), summary({ update: 1, same: 1 })].join("\n");
    const found = await pulumi.detectDrift?.(NETWORK_DEV, options(answer(stdout)));
    expect(found).toMatchObject({
      ok: false,
      reason: { kind: "unreadable-output" },
      detail: [
        "The tool's output: expected an event for every change the summary counts, and 1 is missing.",
      ],
    });
  });

  test("an op the check does not know fails it, and names no value", async () => {
    const stdout = [event("create", URN), summary({ create: 1 })].join("\n");
    const found = await pulumi.detectDrift?.(NETWORK_DEV, options(answer(stdout)));
    expect(found).toMatchObject({
      ok: false,
      reason: { kind: "unknown-step" },
      detail: ["The tool's output, at event 1: expected a drift op that Sluiceway knows."],
    });
  });

  test("a line that is not JSON", async () => {
    const found = await pulumi.detectDrift?.(NETWORK_DEV, options(answer("oops CANARY-VALUE\n")));
    expect(found).toMatchObject({
      ok: false,
      reason: { kind: "unreadable-output" },
      detail: ["The tool's output, at line 1: expected one JSON document per line."],
    });
    expect(JSON.stringify(found)).not.toContain(CANARY_VALUE);
  });

  test("diagnostics are the tool's words, for the job log", async () => {
    const stdout = [
      JSON.stringify({ diagnosticEvent: { message: "warning: slow provider\n" } }),
      summary({ same: 0 }),
    ].join("\n");
    const found = await pulumi.detectDrift?.(NETWORK_DEV, options(answer(stdout)));
    expect(found).toEqual({ ok: true, drift: [], toolLog: "warning: slow provider\n" });
  });

  test("a check that ran out of time", async () => {
    const run: ProcessRunner = async () => ({ status: "timed-out", stdout: "", stderr: "late" });
    const found = await pulumi.detectDrift?.(NETWORK_DEV, options(run));
    expect(found).toMatchObject({ ok: false, reason: { kind: "timed-out", minutes: 10 } });
  });
});
