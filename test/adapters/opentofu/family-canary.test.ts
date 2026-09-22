import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CANARY_SECRET, CANARY_VALUE } from "../../../scripts/fixtures/example.ts";
import {
  FIXTURE_CDKTF_VERSIONS,
  FIXTURE_TERRAFORM_VERSIONS,
  FIXTURE_TERRAGRUNT_VERSIONS,
} from "../../../scripts/fixtures/versions.ts";
import { opentofu } from "../../../src/adapters/opentofu/index.ts";
import { canonicalDiff } from "../../../src/core/diff-hash.ts";
import { previewFailureText } from "../../../src/core/failure-reason.ts";
import { type Stack, stackId } from "../../../src/core/stack.ts";
import { renderRow } from "../../../src/render/row.ts";
import { annex, rows } from "../canary-surfaces.ts";
import { ROOT, readRecording, replay, scenarioNames } from "./replay.ts";
import { DEV, PROD } from "./stacks.ts";

// The canary test of record 0021 for the Terraform family (record 0068).
// Every plan terraform, terragrunt and cdktf recorded goes through the
// adapter, the core and the renderers, and nothing that comes out may hold
// CANARY-VALUE, CANARY-SECRET or the tool's stand-in for a sensitive value.
// This test stays in the suite forever.

const FORBIDDEN = [CANARY_VALUE, CANARY_SECRET, "CANARY", "(sensitive value)"];
const leaks = (text: string) => FORBIDDEN.filter((word) => text.includes(word));

const FIXTURES = resolve(import.meta.dir, "../../fixtures");

type Command = ReturnType<typeof readRecording>["commands"][number];

// The tool's own arguments, behind terragrunt's when it is in front.
function args(command: Command): string[] {
  const at = command.argv.indexOf("--");
  return at < 0 ? command.argv.slice(1) : command.argv.slice(at + 1);
}
const isPlan = (command: Command) => args(command)[0] === "plan" && args(command).includes("-json");
const isToolDiff = (command: Command) =>
  args(command)[0] === "plan" && !args(command).includes("-json");

const withTool = (stack: Stack, tool: string): Stack => ({
  ...stack,
  options: { ...stack.options, tool },
});

const SETS: {
  name: string;
  dir: string;
  versions: string[];
  stackOf: (command: Command) => Stack;
  // A scenario whose saved plan holds both canaries, to show the test sees them.
  witness: string;
}[] = [
  {
    name: "terraform",
    dir: join(FIXTURES, "terraform"),
    versions: Object.values(FIXTURE_TERRAFORM_VERSIONS),
    stackOf: (command) => withTool(command.env?.TF_WORKSPACE === "prod" ? PROD : DEV, "terraform"),
    witness: "changed-secret",
  },
  {
    name: "terragrunt",
    dir: join(FIXTURES, "terragrunt"),
    versions: Object.values(FIXTURE_TERRAGRUNT_VERSIONS),
    stackOf: () => ({
      path: "live/dev",
      options: { tool: "opentofu", varFiles: [], wrapper: "terragrunt" },
    }),
    witness: "update",
  },
  {
    name: "cdktf",
    dir: join(FIXTURES, "cdktf"),
    versions: [...new Set(Object.values(FIXTURE_CDKTF_VERSIONS))],
    stackOf: (command) => ({
      path: ".",
      name: command.cwd.endsWith("prod") ? "prod" : "dev",
      options: { tool: "opentofu", varFiles: [], wrapper: "cdktf" },
    }),
    witness: "update",
  },
];

for (const set of SETS) {
  for (const version of set.versions) {
    describe(`no value leaves the adapter, replaying ${set.name} ${version}`, () => {
      test("the plan JSON holds the canary value and the sensitive one in plain text", () => {
        const raw = readFileSync(join(set.dir, version, set.witness, "show.stdout"), "utf8");
        expect(leaks(raw)).toEqual([CANARY_VALUE, CANARY_SECRET, "CANARY"]);
      });

      for (const scenario of scenarioNames(version, set.dir)) {
        const commands = readRecording(version, scenario, set.dir).commands;
        const plans = commands.filter(isPlan);
        const toolDiffs = commands.filter(isToolDiff);
        if (plans.length + toolDiffs.length === 0) continue;

        test(scenario, async () => {
          const runner = replay(version, scenario, ROOT, set.dir);
          const options = { root: ROOT, env: {}, run: runner.run, timeoutMinutes: 10 };
          for (const command of toolDiffs) {
            const result = await opentofu.toolDiff(set.stackOf(command), options);
            const { text: _text, ...rest } = result.ok ? result : { ...result, text: "" };
            expect(leaks(JSON.stringify(rest))).toEqual([]);
          }
          for (const command of plans) {
            const stack = set.stackOf(command);
            const result = await opentofu.preview(stack, { ...options, savePlan: true });
            const made = result.ok
              ? canonicalDiff(result.diff) + rows(result.diff) + annex(result.diff)
              : renderRow({
                  state: "preview-failed",
                  stackId: stackId(stack),
                  reason: previewFailureText(result.reason),
                  runUrl: "run-url",
                });
            expect(leaks(JSON.stringify(result) + made)).toEqual([]);
            if (result.ok && result.plan !== undefined) {
              if (commands.some((one) => args(one)[0] === "apply")) {
                const applied = await opentofu.apply(stack, options, result.plan);
                expect(leaks(JSON.stringify(applied))).toEqual([]);
              }
              await result.plan.dispose();
            }
          }
        });
      }
    });
  }
}
