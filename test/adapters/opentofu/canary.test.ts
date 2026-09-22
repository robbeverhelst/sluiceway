import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CANARY_SECRET, CANARY_VALUE } from "../../../scripts/fixtures/example.ts";
import type { Adapter } from "../../../src/adapters/adapter.ts";
import { opentofu } from "../../../src/adapters/opentofu/index.ts";
import { parsePlan } from "../../../src/adapters/opentofu/schema.ts";
import { canonicalDiff } from "../../../src/core/diff-hash.ts";
import { previewFailureText } from "../../../src/core/failure-reason.ts";
import { type Stack, stackId } from "../../../src/core/stack.ts";
import { scan } from "../../../src/modes/scan.ts";
import { scanResultFile } from "../../../src/render/result-file.ts";
import { renderRow } from "../../../src/render/row.ts";
import { renderSummary } from "../../../src/render/summary.ts";
import { harness, repoRoot } from "../../modes/harness.ts";
import { rememberingOutputs } from "../../modes/outputs-harness.ts";
import { annex, RESULT, rows } from "../canary-surfaces.ts";
import { FIXTURES, ROOT, readRecording, replay, scenarioNames, VERSIONS } from "./replay.ts";
import { DEV, DNS, PROD } from "./stacks.ts";

// The canary test of record 0021, for OpenTofu (record 0053). The plan JSON
// holds every value in plain text, the sensitive ones included: CANARY-VALUE
// in the code and CANARY-SECRET in a sensitive variable. Every recorded plan
// goes through the adapter, the core and every renderer, and nothing that
// comes out may hold either, or the tool's stand-in for a sensitive value.
// This test stays in the suite forever.

const FORBIDDEN = [CANARY_VALUE, CANARY_SECRET, "CANARY", "(sensitive value)"];

function leaks(text: string): string[] {
  return FORBIDDEN.filter((word) => text.includes(word));
}

type Command = ReturnType<typeof readRecording>["commands"][number];

const isPlan = (command: Command) => command.argv[1] === "plan" && command.argv.includes("-json");
const isToolDiff = (command: Command) =>
  command.argv[1] === "plan" && !command.argv.includes("-json");
const isShow = (command: Command) => command.argv[1] === "show";

function stackOf(command: Command): Stack {
  if (command.cwd === "dns") return DNS;
  return command.env?.TF_WORKSPACE === "prod" ? PROD : DEV;
}

describe("the check itself", () => {
  // Otherwise the tests below could pass on recordings that hold nothing.
  test("the plan JSON holds the canary value and the sensitive one in plain text", () => {
    for (const version of VERSIONS) {
      const raw = readFileSync(join(FIXTURES, version, "changed-secret", "show.stdout"), "utf8");
      expect(leaks(raw)).toEqual([CANARY_VALUE, CANARY_SECRET, "CANARY"]);
    }
  });
});

for (const version of VERSIONS) {
  describe(`no value leaves the adapter, replaying tofu ${version}`, () => {
    for (const scenario of scenarioNames(version)) {
      const commands = readRecording(version, scenario).commands;
      const plans = commands.filter(isPlan);
      const toolDiffs = commands.filter(isToolDiff);
      if (plans.length + toolDiffs.length === 0) continue;

      test(scenario, async () => {
        const runner = replay(version, scenario);
        const options = { root: ROOT, env: {}, run: runner.run, timeoutMinutes: 10 };
        // The tool's own diff holds values on purpose (record 0048). Only its
        // text may, and only the job log takes that.
        for (const command of toolDiffs) {
          const result = await opentofu.toolDiff(stackOf(command), options);
          const { text: _text, ...rest } = result.ok ? result : { ...result, text: "" };
          expect(leaks(JSON.stringify(rest))).toEqual([]);
        }
        for (const command of plans) {
          const stack = stackOf(command);
          const result = await opentofu.preview(stack, { ...options, savePlan: true });
          const failed = {
            kind: "preview-failed",
            stackId: stackId(stack),
            reason: result.ok ? "" : previewFailureText(result.reason),
          } as const;
          const made = result.ok
            ? canonicalDiff(result.diff) + rows(result.diff) + annex(result.diff)
            : renderSummary([failed]).text +
              scanResultFile({ ...RESULT, stacks: [{ stack: failed, milliseconds: 1 }] }) +
              renderRow({
                state: "preview-failed",
                stackId: stackId(stack),
                reason: previewFailureText(result.reason),
                runUrl: "run-url",
              });
          expect(leaks(JSON.stringify(result) + made)).toEqual([]);
          // A deploy of the saved plan hands over nothing with a value either.
          if (result.ok && result.plan !== undefined) {
            if (commands.some((one) => one.argv[1] === "apply")) {
              const applied = await opentofu.apply(stack, options, result.plan);
              expect(leaks(JSON.stringify(applied))).toEqual([]);
            }
            await result.plan.dispose();
          }
        }
        // What the schema lets through holds values only where the fold
        // reads them, and the fold hands over none.
        for (const command of commands.filter(isShow)) {
          const stdout = readFileSync(join(FIXTURES, version, scenario, command.stdout), "utf8");
          const parsed = parsePlan(stdout);
          if (parsed.ok) {
            const kept = parsed.changes.map(({ address, mode, type, name, change }) => ({
              address,
              mode,
              type,
              name,
              actions: change.actions,
            }));
            expect(leaks(JSON.stringify(kept))).toEqual([]);
          }
        }
      });
    }
  });

  // The worst list there is: every path that any recorded plan changes.
  // Values of the code may then appear. A sensitive value never does, and
  // neither does the tool's stand-in for one.
  describe(`a list that names every changed path, replaying tofu ${version}`, () => {
    for (const scenario of scenarioNames(version)) {
      const plans = readRecording(version, scenario).commands.filter(isPlan);
      if (plans.length === 0) continue;
      test(scenario, async () => {
        for (const command of plans) {
          const options = { root: ROOT, env: {}, timeoutMinutes: 10 };
          const first = await opentofu.preview(stackOf(command), {
            ...options,
            run: replay(version, scenario).run,
          });
          const every = first.ok ? first.diff.changes.flatMap((change) => change.changedKeys) : [];
          const result = await opentofu.preview(stackOf(command), {
            ...options,
            run: replay(version, scenario).run,
            showValues: every,
          });
          const made = result.ok ? rows(result.diff) + annex(result.diff) : "";
          const text = JSON.stringify(result) + made;
          expect(text).not.toContain(CANARY_SECRET);
          expect(text).not.toContain("(sensitive value)");
        }
      });
    }
  });

  test(`a listed path shows its value and is hashed, replaying tofu ${version}`, async () => {
    const result = await opentofu.preview(DEV, {
      root: ROOT,
      env: {},
      run: replay(version, "update").run,
      timeoutMinutes: 10,
      showValues: ["input.greeting", "output", "input.secret"],
    });
    if (!result.ok) throw new Error("expected a diff");
    expect(result.diff.changes[0]?.values).toEqual([
      { path: "input.greeting", old: "hello", new: "hi" },
    ]);
    expect(canonicalDiff(result.diff)).toContain('"new":"hi"');
  });

  // Record 0048: with `scan.logDiff` on, the tool's own diff reaches the
  // stack's group of the job log and nothing else. The recording shows why
  // that is a risk a repo takes on knowingly: terraform_data copies the
  // sensitive input to its output unmarked, so tofu prints CANARY-SECRET
  // there in plain text. It still reaches no other place.
  test(`with scan.logDiff on the tool's diff reaches the stack's log group and nothing else, replaying tofu ${version}`, async () => {
    const root = repoRoot("scan:\n  logDiff: true\n");
    const adapter: Adapter = {
      ...opentofu,
      discover: async () => [DEV],
      checkVersion: async () => {},
      prepare: () => [],
    };
    const recorded = replay(version, "changed-secret", root);
    const diff = replay(version, "log-diff-changed-secret", root);
    const { context, github, log } = harness(adapter, {
      root,
      run: async (asked) =>
        asked.argv.includes("-json") || asked.argv[1] === "show"
          ? recorded.run(asked)
          : diff.run(asked),
    });
    const outputs = rememberingOutputs();
    await scan({ ...context, outputs });

    const group = log.groups.find(({ title }) => title === "network:dev");
    expect(leaks((group?.verbatim ?? []).join("\n"))).toEqual([
      CANARY_VALUE,
      CANARY_SECRET,
      "CANARY",
      "(sensitive value)",
    ]);
    const elsewhere = [
      github.issue(1).body,
      ...(group?.lines ?? []),
      ...log.groups.filter((one) => one !== group).map((one) => JSON.stringify(one)),
      ...log.lines,
      ...log.summaries,
      ...log.warnings.map(({ title, message }) => `${title} ${message}`),
      JSON.stringify(outputs.calls),
      JSON.stringify(outputs.resultFile("scan")),
      JSON.stringify(github.checkRuns(context.sha)),
    ].join("\n");
    expect(elsewhere).toContain("network:dev");
    expect(leaks(elsewhere)).toEqual([]);
  });
}

test("every scenario but the version check and the inits is covered", () => {
  for (const version of VERSIONS) {
    const without = scenarioNames(version).filter((scenario) =>
      readRecording(version, scenario).commands.every(
        (command) => !isPlan(command) && !isToolDiff(command),
      ),
    );
    expect(without).toEqual(["init-failed", "version"]);
  }
});
