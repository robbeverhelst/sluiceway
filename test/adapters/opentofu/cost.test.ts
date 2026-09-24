import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { FIXTURE_INFRACOST_VERSIONS } from "../../../scripts/fixtures/versions.ts";
import type { PreviewResult } from "../../../src/adapters/adapter.ts";
import { opentofu } from "../../../src/adapters/opentofu/index.ts";
import type { ProcessRunner } from "../../../src/adapters/process.ts";
import type { Stack } from "../../../src/core/stack.ts";
import { ROOT, replay } from "./replay.ts";
import { DEV } from "./stacks.ts";

// The cost estimate of an OpenTofu preview (record 0105): after `tofu show
// -json`, the plan's JSON is written next to the plan file and the Infracost
// CLI's `diff` reads it there, so the estimate never runs the tool again and
// never reads the checkout. Every expected number is worked out by hand from
// the price list of the recorder's fake pricing API: an instance hour at
// 0.0416 for 730 hours a month, and a unit of anything else at 0.1.

const FIXTURES = resolve(import.meta.dir, "../../fixtures/infracost");
const VERSIONS = [...new Set(Object.values(FIXTURE_INFRACOST_VERSIONS))].sort();

// The root module the scenarios write into a copy of the example.
const COMPUTE: Stack = { path: "compute", options: { tool: "opentofu", varFiles: [] } };

async function previewOf(
  version: string,
  scenario: string,
  stack = COMPUTE,
  extra: { cost?: boolean; run?: ProcessRunner } = {},
) {
  const replayed = replay(version, scenario, ROOT, FIXTURES);
  const result = await opentofu.preview(stack, {
    root: ROOT,
    env: { PATH: "/usr/bin", INPUT_GITHUB_TOKEN: "ghs_secret", INFRACOST_API_KEY: "ico-test" },
    run: extra.run ?? replayed.run,
    timeoutMinutes: 10,
    cost: extra.cost ?? true,
  });
  return { result, ...replayed };
}

function costOf(result: PreviewResult) {
  if (!result.ok) throw new Error(`The preview failed: ${JSON.stringify(result.reason)}`);
  return result.cost;
}

for (const version of VERSIONS) {
  describe(`infracost ${version}: the cost of a change`, () => {
    test("a create costs the instance's hours and its volume a month", async () => {
      const { result } = await previewOf(version, "create");
      // 0.0416 * 730 hours + 20 GB * 0.1
      expect(costOf(result)).toEqual({ ok: true, estimate: { monthly: 32.368, currency: "USD" } });
      expect(result.ok && result.diff.changes.map((change) => change.op)).toEqual(["create"]);
    });

    test("an update in place costs what it adds", async () => {
      const { result } = await previewOf(version, "update");
      // 20 GB more at 0.1
      expect(costOf(result)).toEqual({ ok: true, estimate: { monthly: 2, currency: "USD" } });
    });

    test("a delete saves what the resource cost, as a negative delta", async () => {
      const { result } = await previewOf(version, "delete");
      expect(costOf(result)).toEqual({ ok: true, estimate: { monthly: -32.368, currency: "USD" } });
    });

    test("a change of resources the pricing API has no price for costs about the same", async () => {
      const { result } = await previewOf(version, "free", DEV);
      expect(costOf(result)).toEqual({ ok: true, estimate: { monthly: 0, currency: "USD" } });
    });

    test("the CLI runs in the plan's directory on the plan's JSON, with the settings that keep it to the pricing API", async () => {
      const { runs, plans } = await previewOf(version, "create");
      expect(runs.map(({ argv }) => argv[0])).toEqual(["tofu", "tofu", "infracost"]);
      const [plan = ""] = plans;
      const diff = runs[2];
      expect(diff?.argv).toEqual([
        "infracost",
        "diff",
        "--path",
        "plan.json",
        "--format",
        "json",
        "--no-color",
      ]);
      expect(diff?.cwd).toBe(dirname(plan));
      expect(diff?.env).toEqual({
        PATH: "/usr/bin",
        INFRACOST_API_KEY: "ico-test",
        INFRACOST_SKIP_UPDATE_CHECK: "true",
        INFRACOST_ENABLE_CLOUD: "false",
      });
      expect(diff?.timeoutMs).toBe(600_000);
      // The plan's directory, JSON and all, goes with the preview.
      expect(existsSync(dirname(plan))).toBe(false);
    });

    test("a key the pricing API refuses is a failed estimate with the exit code, and the CLI's words go to the log", async () => {
      const { result } = await previewOf(version, "refused");
      expect(costOf(result)).toEqual({
        ok: false,
        reason: { kind: "exited", exitCode: 1 },
        detail: [],
      });
      expect(result.toolLog).toContain("Invalid API Key");
      expect(result.ok).toBe(true);
    });

    test("a pricing API the CLI could not reach is a failed estimate, read from the CLI's own data", async () => {
      const { result } = await previewOf(version, "unreachable");
      expect(costOf(result)).toEqual({
        ok: false,
        reason: { kind: "reported-error" },
        detail: [
          "The Infracost CLI's output reports 1 error for the plan. Its words are in the log below.",
        ],
      });
      expect(result.toolLog).toContain("giving up after");
    });

    test("the CLI's output never reaches the log: it can hold values", async () => {
      const { result } = await previewOf(version, "create");
      expect(result.toolLog).not.toContain("diffTotalMonthlyCost");
      expect(result.toolLog).not.toContain("ami-0123456789abcdef0");
    });

    test("without the option nothing is estimated and the CLI never runs", async () => {
      const { result, runs } = await previewOf(version, "create", COMPUTE, { cost: false });
      expect(runs.map(({ argv }) => argv[0])).toEqual(["tofu", "tofu"]);
      expect(costOf(result)).toBeUndefined();
    });
  });
}

describe("the Infracost CLI that is not there", () => {
  test("is a failed estimate that says so, and the preview itself is fine", async () => {
    const [version = ""] = VERSIONS;
    const replayed = replay(version, "create", ROOT, FIXTURES);
    const run: ProcessRunner = async (asked) =>
      asked.argv[0] === "infracost" ? { status: "not-started" } : replayed.run(asked);
    const { result } = await previewOf(version, "create", COMPUTE, { run });
    expect(costOf(result)).toEqual({
      ok: false,
      reason: { kind: "not-started" },
      detail: [
        "The Infracost CLI could not be started. Add a workflow step that installs it before the step that runs Sluiceway, or turn cost.enabled off.",
      ],
    });
  });

  test("a CLI that ran out of time is a failed estimate with the limit", async () => {
    const [version = ""] = VERSIONS;
    const replayed = replay(version, "create", ROOT, FIXTURES);
    const run: ProcessRunner = async (asked) =>
      asked.argv[0] === "infracost"
        ? { status: "timed-out", stdout: "", stderr: "still pricing\n" }
        : replayed.run(asked);
    const { result } = await previewOf(version, "create", COMPUTE, { run });
    expect(costOf(result)).toEqual({
      ok: false,
      reason: { kind: "timed-out", minutes: 10 },
      detail: [],
    });
    expect(result.toolLog).toContain("still pricing");
  });

  test("output that is not the CLI's JSON is a failed estimate that says what was expected", async () => {
    const [version = ""] = VERSIONS;
    const replayed = replay(version, "create", ROOT, FIXTURES);
    const run: ProcessRunner = async (asked) =>
      asked.argv[0] === "infracost"
        ? { status: "exited", exitCode: 0, stdout: '{"version":"0.2"}', stderr: "" }
        : replayed.run(asked);
    const { result } = await previewOf(version, "create", COMPUTE, { run });
    expect(costOf(result)).toEqual({
      ok: false,
      reason: { kind: "unreadable-output" },
      detail: [
        "Expected the JSON of infracost diff --format json with currency, diffTotalMonthlyCost and projects, and the output does not fit.",
      ],
    });
  });
});
