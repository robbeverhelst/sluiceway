import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  FIXTURE_CDKTF_VERSIONS,
  FIXTURE_TERRAFORM_VERSIONS,
  FIXTURE_TERRAGRUNT_VERSIONS,
  FIXTURE_TOFU_VERSIONS,
} from "../../../scripts/fixtures/versions.ts";
import type { PreviewResult } from "../../../src/adapters/adapter.ts";
import { opentofu } from "../../../src/adapters/opentofu/index.ts";
import type { Stack } from "../../../src/core/stack.ts";
import { answering, ROOT, readRecording, replay, scenarioNames } from "./replay.ts";
import { DEV, PROD } from "./stacks.ts";

// The Terraform family behind the OpenTofu adapter (record 0068), replayed
// from what the real terraform, terragrunt and cdktf printed. The plan JSON is
// the one the OpenTofu adapter reads, so the diff of a scenario is the diff
// tofu gave for it, and what these tests add is the command lines, the
// working directories and the preparations of each.

const FIXTURES = resolve(import.meta.dir, "../../fixtures");
const TERRAFORM = `${FIXTURES}/terraform`;
const TERRAGRUNT = `${FIXTURES}/terragrunt`;
const CDKTF = `${FIXTURES}/cdktf`;
const TOFU = `${FIXTURES}/opentofu`;

const context = (run: Parameters<typeof opentofu.checkVersion>[0]["run"]) => ({
  root: ROOT,
  env: { PATH: "/usr/bin", INPUT_GITHUB_TOKEN: "ghs_secret" },
  run,
});

const terraform = (stack: Stack): Stack => ({
  ...stack,
  options: { ...stack.options, tool: "terraform" },
});
const UNIT: Stack = {
  path: "live/dev",
  options: { tool: "opentofu", varFiles: [], wrapper: "terragrunt" },
};
const APP_DEV: Stack = {
  path: ".",
  name: "dev",
  options: { tool: "opentofu", varFiles: [], wrapper: "cdktf" },
};
const APP_PROD: Stack = { ...APP_DEV, name: "prod" };

// The diff without the stack id, which differs by stack.
function changesOf(result: PreviewResult) {
  if (!result.ok) return { failed: result.reason };
  return result.diff.changes;
}

async function previewOf(stack: Stack, version: string, scenario: string, fixtures: string) {
  const { run, runs } = replay(version, scenario, ROOT, fixtures);
  // Setup steps are not recorded, so only the recorded commands are replayed.
  const recorded = readRecording(version, scenario, fixtures).commands;
  const planned = recorded.some((command) => command.id === "plan");
  if (!planned) throw new Error(`${scenario} holds no plan.`);
  const result = await opentofu.preview(stack, { ...context(run), timeoutMinutes: 3 });
  return { result, runs };
}

const TERRAFORM_VERSIONS = Object.values(FIXTURE_TERRAFORM_VERSIONS).sort();
const TOFU_NEWEST = FIXTURE_TOFU_VERSIONS.newest;

describe("terraform", () => {
  for (const version of TERRAFORM_VERSIONS) {
    describe(version, () => {
      for (const scenario of scenarioNames(version, TERRAFORM)) {
        const commands = readRecording(version, scenario, TERRAFORM).commands;
        if (!commands.some((command) => command.id === "plan")) continue;
        const stack = commands.some((command) => command.env?.TF_WORKSPACE === "prod") ? PROD : DEV;
        test(`${scenario}: the same diff tofu gave, from terraform's own command lines`, async () => {
          const { result, runs } = await previewOf(terraform(stack), version, scenario, TERRAFORM);
          const tofu = await previewOf(stack, TOFU_NEWEST, scenario, TOFU);
          expect(changesOf(result)).toEqual(changesOf(tofu.result));
          expect(runs.every((one) => one.argv[0] === "terraform")).toBe(true);
          expect(runs.every((one) => one.env.INPUT_GITHUB_TOKEN === undefined)).toBe(true);
        });
      }

      test("init with terraform in the directory, as the preparation", async () => {
        const { run, runs } = replay(version, "new-stack", ROOT, TERRAFORM);
        const [init] = opentofu.prepare?.([terraform(DEV)]) ?? [];
        const result = await init?.run({ ...context(run), timeoutMinutes: 3 });
        expect(result?.ok).toBe(true);
        expect(runs[0]?.argv).toEqual(["terraform", "init", "-input=false", "-no-color"]);
        expect(result?.toolLog).toContain("Terraform has been successfully initialized!");
      });

      test("the deploy of exactly the saved plan", async () => {
        const { run, runs, plans } = replay(version, "deploy", ROOT, TERRAFORM);
        const previewed = await opentofu.preview(terraform(DEV), {
          ...context(run),
          timeoutMinutes: 3,
          savePlan: true,
        });
        if (!previewed.ok || previewed.plan === undefined) throw new Error("No plan.");
        const applied = await opentofu.apply(terraform(DEV), context(run), previewed.plan);
        await previewed.plan.dispose();
        expect(applied.ok).toBe(true);
        expect(runs.map((one) => one.argv.slice(0, 2))).toEqual([
          ["terraform", "plan"],
          ["terraform", "show"],
          ["terraform", "apply"],
        ]);
        expect(new Set(plans).size).toBe(1);
      });

      test("a plan the state moved away from is refused by terraform", async () => {
        const { run } = replay(version, "stale-plan", ROOT, TERRAFORM);
        const previewed = await opentofu.preview(terraform(DEV), {
          ...context(run),
          timeoutMinutes: 3,
          savePlan: true,
        });
        if (!previewed.ok || previewed.plan === undefined) throw new Error("No plan.");
        const applied = await opentofu.apply(terraform(DEV), context(run), previewed.plan);
        await previewed.plan.dispose();
        expect(applied.ok).toBe(false);
      });
    });
  }
});

const PREFIX = [
  "terragrunt",
  "run",
  "--tf-forward-stdout",
  "--no-color",
  "--no-auto-init",
  "--tf-path",
  "tofu",
  "--",
];

describe("the terragrunt wrapper", () => {
  for (const version of Object.values(FIXTURE_TERRAGRUNT_VERSIONS).sort()) {
    describe(version, () => {
      test("init runs through terragrunt in the unit, as the preparation", async () => {
        const { run, runs } = replay(version, "new-stack", ROOT, TERRAGRUNT);
        const [init] = opentofu.prepare?.([UNIT]) ?? [];
        const result = await init?.run({ ...context(run), timeoutMinutes: 3 });
        expect(result?.ok).toBe(true);
        expect(runs[0]?.argv).toEqual([...PREFIX, "init", "-input=false", "-no-color"]);
        expect(runs[0]?.cwd).toBe(`${ROOT}/live/dev`);
        expect(result?.toolLog).toContain("has been successfully initialized");
      });

      test("a failed init is a tool error", async () => {
        const { run } = replay(version, "init-failed", ROOT, TERRAGRUNT);
        const [init] = opentofu.prepare?.([UNIT]) ?? [];
        const result = await init?.run({ ...context(run), timeoutMinutes: 3 });
        expect(result?.ok).toBe(false);
      });

      for (const [scenario, ops] of [
        ["new-stack", ["create", "create"]],
        ["no-changes", []],
        ["update", ["update"]],
      ] as const) {
        test(`${scenario}: the plan through terragrunt reads as the tool's own`, async () => {
          const { result, runs } = await previewOf(UNIT, version, scenario, TERRAGRUNT);
          if (!result.ok) throw new Error(`The preview failed: ${JSON.stringify(result.reason)}`);
          expect(result.diff.stackId).toBe("live/dev");
          expect(result.diff.changes.map((change) => change.op)).toEqual([...ops]);
          expect(runs.map((one) => one.argv.slice(0, PREFIX.length + 1))).toEqual([
            [...PREFIX, "plan"],
            [...PREFIX, "show"],
          ]);
        });
      }

      test("a program error is a tool error with the tool's words for the job log", async () => {
        const { result } = await previewOf(UNIT, version, "program-error", TERRAGRUNT);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toEqual({ kind: "tool-error", exitCode: 1 });
        expect(result.toolLog).toContain("Error:");
      });

      test("the deploy of the saved plan goes through terragrunt too", async () => {
        const { run, runs } = replay(version, "deploy", ROOT, TERRAGRUNT);
        const previewed = await opentofu.preview(UNIT, {
          ...context(run),
          timeoutMinutes: 3,
          savePlan: true,
        });
        if (!previewed.ok || previewed.plan === undefined) throw new Error("No plan.");
        const applied = await opentofu.apply(UNIT, context(run), previewed.plan);
        await previewed.plan.dispose();
        expect(applied.ok).toBe(true);
        expect(runs.at(-1)?.argv.slice(0, PREFIX.length + 1)).toEqual([...PREFIX, "apply"]);
      });

      test("the tool's own diff through terragrunt", async () => {
        const { run } = replay(version, "log-diff-changed-secret", ROOT, TERRAGRUNT);
        const result = await opentofu.toolDiff(UNIT, { ...context(run), timeoutMinutes: 3 });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.text).toContain("(sensitive value)");
      });
    });
  }
});

describe("the cdktf wrapper", () => {
  for (const version of [...new Set(Object.values(FIXTURE_CDKTF_VERSIONS))]) {
    describe(version, () => {
      test("one preparation per app: synth, then init in the directory of each stack", async () => {
        const [app] = opentofu.prepare?.([APP_PROD, APP_DEV]) ?? [];
        expect(app?.title).toBe(".");
        expect(app?.stacks).toEqual([APP_PROD, APP_DEV]);
        const { run, runs } = replay(version, "new-stack", ROOT, CDKTF);
        const result = await opentofu.prepare?.([APP_DEV])[0]?.run({
          ...context(run),
          timeoutMinutes: 3,
        });
        expect(result?.ok).toBe(true);
        expect(runs.map((one) => [one.argv, one.cwd])).toEqual([
          [["cdktf", "synth", "--output", "cdktf.out"], ROOT],
          [["tofu", "init", "-input=false", "-no-color"], `${ROOT}/cdktf.out/stacks/dev`],
        ]);
      });

      test("an app that throws: the synth fails, and no init runs", async () => {
        const { run, runs } = replay(version, "program-error", ROOT, CDKTF);
        const result = await opentofu.prepare?.([APP_DEV])[0]?.run({
          ...context(run),
          timeoutMinutes: 3,
        });
        expect(result?.ok).toBe(false);
        expect(runs).toHaveLength(1);
      });

      for (const [scenario, stack, ops] of [
        ["new-stack", APP_DEV, ["create"]],
        ["other-stack", APP_PROD, ["create"]],
        ["no-changes", APP_DEV, []],
        ["update", APP_DEV, ["update"]],
      ] as const) {
        test(`${scenario}: the plan of the synthesized stack ${stack.name}`, async () => {
          const { result, runs } = await previewOf(stack, version, scenario, CDKTF);
          if (!result.ok) throw new Error(`The preview failed: ${JSON.stringify(result.reason)}`);
          expect(result.diff.stackId).toBe(`.:${stack.name}`);
          expect(result.diff.changes.map((change) => change.op)).toEqual([...ops]);
          expect(runs.every((one) => one.cwd === `${ROOT}/cdktf.out/stacks/${stack.name}`)).toBe(
            true,
          );
        });
      }

      test("the deploy of the saved plan, in the stack's directory", async () => {
        const { run, runs } = replay(version, "deploy", ROOT, CDKTF);
        const previewed = await opentofu.preview(APP_DEV, {
          ...context(run),
          timeoutMinutes: 3,
          savePlan: true,
        });
        if (!previewed.ok || previewed.plan === undefined) throw new Error("No plan.");
        const applied = await opentofu.apply(APP_DEV, context(run), previewed.plan);
        await previewed.plan.dispose();
        expect(applied.ok).toBe(true);
        expect(runs.at(-1)?.argv.slice(0, 2)).toEqual(["tofu", "apply"]);
        expect(runs.at(-1)?.cwd).toBe(`${ROOT}/cdktf.out/stacks/dev`);
      });
    });
  }
});

describe("a plan terraform could not finish", () => {
  // Terraform writes `complete: false` when it deferred changes it could not
  // plan yet (its docs, "JSON Output Format"). Such a plan shows part of
  // what a deploy would change, so it is never a diff, and never in sync.
  test("is output Sluiceway cannot read", async () => {
    const recorded = readFileSync(
      join(TERRAFORM, FIXTURE_TERRAFORM_VERSIONS.newest, "update", "show.stdout"),
      "utf8",
    );
    const partial = JSON.stringify({ ...JSON.parse(recorded), complete: false });
    const { run } = answering(
      { status: "exited", exitCode: 0, stdout: "", stderr: "" },
      { status: "exited", exitCode: 0, stdout: partial, stderr: "" },
    );
    const result = await opentofu.preview(terraform(DEV), { ...context(run), timeoutMinutes: 3 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toEqual({ kind: "unreadable-output" });
    expect(result.detail).toEqual([
      "The tool's output, at complete: expected a plan that holds every change, not one with changes left for later.",
    ]);
  });
});
