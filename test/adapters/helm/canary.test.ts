import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CANARY_SECRET, CANARY_VALUE } from "../../../scripts/fixtures/example.ts";
import type { Adapter } from "../../../src/adapters/adapter.ts";
import { helm } from "../../../src/adapters/helm/index.ts";
import { parseEntries } from "../../../src/adapters/helm/schema.ts";
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
import { WEB, WEB_NEW_NAMESPACE, WORKER } from "./stacks.ts";

// The canary test of record 0021, for Helm (records 0058 and 0069). What helm renders
// holds every value in plain text: CANARY-VALUE in a ConfigMap and
// CANARY-SECRET in a Secret. The diff plugin's JSON holds the old and new
// value of every changed path, and for a Secret its own stand-in, which still
// tells the length of the value. The three-way diff of the drift check holds
// the values of the live objects too. Every recording goes through the adapter,
// the core and every renderer, and nothing that comes out may hold a value or
// the stand-in. This test stays in the suite forever.

const FORBIDDEN = [CANARY_VALUE, CANARY_SECRET, "CANARY", "bytes)", "REDACTED", "++++++++"];

function leaks(text: string): string[] {
  return FORBIDDEN.filter((word) => text.includes(word));
}

type Command = ReturnType<typeof readRecording>["commands"][number];

const isStructured = (command: Command) =>
  command.argv[1] === "diff" && command.argv.includes("--output=structured");
const isThreeWay = (command: Command) =>
  isStructured(command) && command.argv.includes("--three-way-merge");
const isDiff = (command: Command) => isStructured(command) && !isThreeWay(command);
const isToolDiff = (command: Command) =>
  command.argv[1] === "diff" && command.argv.includes("--output=diff");

const stackOf = (command: Command): Stack =>
  command.cwd === "worker"
    ? WORKER
    : command.argv.includes("--namespace=sluiceway-new")
      ? WEB_NEW_NAMESPACE
      : WEB;

describe("the check itself", () => {
  // Otherwise the tests below could pass on recordings that hold nothing.
  for (const version of VERSIONS) {
    test(`${version}: the render holds both canaries, and the diff a value and the stand-in`, () => {
      const dir = join(FIXTURES, version);
      const render = readFileSync(join(dir, "deploy", "render.stdout"), "utf8");
      expect(leaks(render)).toEqual([CANARY_VALUE, CANARY_SECRET, "CANARY"]);
      const secret = readFileSync(join(dir, "changed-secret", "diff.stdout"), "utf8");
      expect(leaks(secret)).toEqual(["bytes)", "++++++++"]);
      const update = readFileSync(join(dir, "mixed", "diff.stdout"), "utf8");
      expect(update).toContain("color=green");
      const live = readFileSync(join(dir, "drift", "three-way.stdout"), "utf8");
      expect(leaks(live)).toEqual([CANARY_VALUE, "CANARY"]);
    });
  }
});

for (const version of VERSIONS) {
  describe(`no value leaves the adapter, replaying helm ${version}`, () => {
    for (const scenario of scenarioNames(version)) {
      const commands = readRecording(version, scenario).commands;
      const diffs = commands.filter(isDiff);
      const toolDiffs = commands.filter(isToolDiff);
      if (diffs.length + toolDiffs.length === 0) continue;

      test(scenario, async () => {
        const runner = replay(version, scenario);
        const options = { root: ROOT, env: {}, run: runner.run, timeoutMinutes: 10 };
        // The tool's own diff holds values on purpose (record 0048). Only its
        // text may, and only the job log takes that.
        for (const command of toolDiffs) {
          const result = await helm.toolDiff(stackOf(command), options);
          const { text: _text, ...rest } = result.ok ? result : { ...result, text: "" };
          expect(leaks(JSON.stringify(rest))).toEqual([]);
        }
        const renders = commands.filter((command) => command.argv[1] === "template").length;
        for (const [index, command] of diffs.entries()) {
          const stack = stackOf(command);
          // The first diff of a deploy scenario is the fresh preview of
          // `apply`, which keeps its render.
          const savePlan = renders > 0 && index === 0;
          const result = await helm.preview(stack, { ...options, savePlan });
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
          // A deploy of the saved render hands over nothing with a value
          // either, and neither does the render it keeps.
          if (result.ok && result.plan !== undefined) {
            expect(leaks(JSON.stringify(result.plan))).toEqual([]);
            if (renders > 1) {
              // A deploy after a drift check puts the drift back (record 0069).
              const repairDrift = commands.some(isThreeWay);
              const applied = await helm.apply(stack, options, result.plan, { repairDrift });
              expect(leaks(JSON.stringify(applied))).toEqual([]);
            }
            await result.plan.dispose();
          }
        }
        // The drift check reads a plain diff and a three-way one, whose values
        // are the live objects', and hands over none (record 0069).
        const drifts = replay(version, scenario);
        for (const command of commands.filter(isThreeWay)) {
          const stack = stackOf(command);
          const result = await helm.detectDrift?.(stack, {
            ...options,
            run: drifts.run,
            showValues: ["data.*", "spec.ports[0].targetPort"],
          });
          const drift = result?.ok ? result.drift : [];
          const diff = { stackId: stackId(stack), changes: [], drift };
          const made = canonicalDiff(diff) + rows(diff) + annex(diff);
          expect(leaks(JSON.stringify(result) + made)).toEqual([]);
        }
        // What the schema lets through holds values only where the fold
        // reads them, and the fold hands over none.
        for (const command of commands.filter((one) => isStructured(one) && one.exitCode === 0)) {
          const stdout = readFileSync(join(FIXTURES, version, scenario, command.stdout), "utf8");
          const parsed = parseEntries(stdout);
          if (!parsed.ok) throw new Error("a recorded diff that does not parse");
          const kept = parsed.entries.map(({ apiVersion, kind, namespace, name, changeType }) => ({
            apiVersion,
            kind,
            namespace,
            name,
            changeType,
          }));
          expect(leaks(JSON.stringify(kept))).toEqual([]);
        }
      });
    }
  });

  // The worst list there is: every path that any recorded diff changes, and a
  // star under data. Values of a ConfigMap may then appear. Nothing of a
  // Secret ever does, not even the plugin's stand-in.
  describe(`a list that names every changed path, replaying helm ${version}`, () => {
    for (const scenario of scenarioNames(version)) {
      const diffs = readRecording(version, scenario).commands.filter(isDiff);
      if (diffs.length === 0) continue;
      test(scenario, async () => {
        for (const command of diffs) {
          const options = { root: ROOT, env: {}, timeoutMinutes: 10 };
          const first = await helm.preview(stackOf(command), {
            ...options,
            run: replay(version, scenario).run,
          });
          const every = first.ok ? first.diff.changes.flatMap((change) => change.changedKeys) : [];
          const result = await helm.preview(stackOf(command), {
            ...options,
            run: replay(version, scenario).run,
            showValues: [...every, "data.*"],
          });
          const made = result.ok ? rows(result.diff) + annex(result.diff) : "";
          const text = JSON.stringify(result) + made;
          expect(text).not.toContain(CANARY_SECRET);
          expect(text).not.toContain("bytes)");
          expect(text).not.toContain("++++++++");
        }
      });
    }
  });

  test(`a listed path shows its value and is hashed, replaying helm ${version}`, async () => {
    const result = await helm.preview(WEB, {
      root: ROOT,
      env: {},
      run: replay(version, "update").run,
      timeoutMinutes: 10,
      showValues: ['metadata.labels["app.kubernetes.io/version"]'],
    });
    if (!result.ok) throw new Error("expected a diff");
    expect(result.diff.changes[0]?.values).toEqual([
      { path: 'metadata.labels["app.kubernetes.io/version"]', old: "1.0.0", new: "1.0.1" },
    ]);
    expect(canonicalDiff(result.diff)).toContain('"new":"1.0.1"');
  });

  // Record 0048: with `scan.logDiff` on, the tool's own diff reaches the
  // stack's group of the job log and nothing else. The plugin redacts a
  // Secret's data there, and prints every other value as it is: the
  // ConfigMap's CANARY-VALUE reaches the group, and no other place.
  test(`with scan.logDiff on the tool's diff reaches the stack's log group and nothing else, replaying helm ${version}`, async () => {
    const root = repoRoot("scan:\n  logDiff: true\n");
    const adapter: Adapter = {
      ...helm,
      discover: async () => [WEB],
      checkVersion: async () => {},
      prepare: () => [],
    };
    const structured = replay(version, "changed-secret", root);
    const diff = replay(version, "log-diff", root);
    const { context, github, log } = harness(adapter, {
      root,
      run: async (asked) =>
        asked.argv.includes("--output=diff") ? diff.run(asked) : structured.run(asked),
    });
    const outputs = rememberingOutputs();
    await scan({ ...context, outputs });

    const group = log.groups.find(({ title }) => title === "web");
    expect(leaks((group?.verbatim ?? []).join("\n"))).toEqual([
      CANARY_VALUE,
      "CANARY",
      "bytes)",
      "++++++++",
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
    expect(elsewhere).toContain("web");
    expect(leaks(elsewhere)).toEqual([]);
  });
}

test("every scenario but the version check and the dependency builds is covered", () => {
  for (const version of VERSIONS) {
    const without = scenarioNames(version).filter((scenario) =>
      readRecording(version, scenario).commands.every(
        (command) => !isDiff(command) && !isToolDiff(command),
      ),
    );
    expect(without).toEqual(["dependencies-failed", "version"]);
  }
});
