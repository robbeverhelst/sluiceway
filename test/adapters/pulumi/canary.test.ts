import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CANARY_SECRET, CANARY_VALUE } from "../../../scripts/fixtures/example.ts";
import type { Adapter } from "../../../src/adapters/adapter.ts";
import { pulumi } from "../../../src/adapters/pulumi/index.ts";
import { parsePreview } from "../../../src/adapters/pulumi/schema.ts";
import type { Diff } from "../../../src/core/diff.ts";
import { canonicalDiff, diffHash } from "../../../src/core/diff-hash.ts";
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

// The canary test of record 0021 (build plan, section 6). Every program of
// the example sets one property to CANARY-VALUE, unmarked, and holds one
// secret config value. Every recorded preview goes through the adapter, and
// nothing that comes out may hold either, or the tool's stand-in for a secret.
// Later slices add the renderers and the log text to what is searched. This
// test stays in the suite forever.

const FORBIDDEN = [CANARY_VALUE, CANARY_SECRET, "CANARY", "[secret]"];

type Command = ReturnType<typeof readRecording>["commands"][number];

// The preview whose document the adapter parses, and the second run of the
// tool that displays the diff for the job log (record 0048).
function isPreview(command: Command): boolean {
  return command.argv[1] === "preview" && command.argv.includes("--json");
}

function isToolDiff(command: Command): boolean {
  return command.argv[1] === "preview" && command.argv.includes("--diff");
}

// The drift check (record 0055), whose engine events hold every value.
function isDriftCheck(command: Command): boolean {
  return command.argv[1] === "refresh" && command.argv.includes("--preview-only");
}

// The list of the stacks the backend holds, for the check with backend: true
// (record 0074).
function isStackList(command: Command): boolean {
  return command.argv[1] === "stack" && command.argv[2] === "ls";
}

function stackOf(command: Command): Stack {
  const name = command.argv[command.argv.indexOf("--stack") + 1];
  return { path: command.cwd, options: {}, ...(name ? { name } : {}) };
}

function leaks(text: string): string[] {
  return FORBIDDEN.filter((word) => text.includes(word));
}

describe("the check itself", () => {
  test("finds a value that rides along", () => {
    const change = { address: "a", op: "update", changedKeys: ["environment"], was: CANARY_VALUE };

    expect(leaks(JSON.stringify(change))).toEqual([CANARY_VALUE, "CANARY"]);
    expect(leaks(JSON.stringify({ token: "[secret]" }))).toEqual(["[secret]"]);
  });

  // Otherwise the test below could pass on recordings that hold nothing.
  test("the recordings hold the canary value and the tool's stand-in for the secret", () => {
    for (const version of VERSIONS) {
      const raw = readFileSync(join(FIXTURES, version, "update", "preview.stdout"), "utf8");
      expect(leaks(raw)).toEqual([CANARY_VALUE, "CANARY", "[secret]"]);
    }
  });
});

for (const version of VERSIONS) {
  describe(`no value leaves the adapter, replaying pulumi ${version}`, () => {
    for (const scenario of scenarioNames(version)) {
      const commands = readRecording(version, scenario).commands;
      const previews = commands.filter(isPreview);
      const toolDiffs = commands.filter(isToolDiff);
      const driftChecks = commands.filter(isDriftCheck);
      const stackLists = commands.filter(isStackList);
      if (previews.length + toolDiffs.length + driftChecks.length + stackLists.length === 0) {
        continue;
      }

      test(scenario, async () => {
        const runner = replay(version, scenario);
        // The tool's own diff holds values on purpose (record 0048). Only its
        // text may, and only the job log takes that. What else the adapter
        // hands over holds none.
        for (const command of toolDiffs) {
          const result = await pulumi.toolDiff(stackOf(command), {
            root: ROOT,
            env: {},
            run: runner.run,
            timeoutMinutes: 10,
          });
          const { text: _text, ...rest } = result.ok ? result : { ...result, text: "" };
          expect(leaks(JSON.stringify(rest))).toEqual([]);
        }
        for (const command of previews) {
          const stack = stackOf(command);
          const result = await pulumi.preview(stack, {
            root: ROOT,
            env: {},
            run: runner.run,
            timeoutMinutes: 10,
          });

          // Everything the adapter hands over, the tool's words included, and
          // what the core and the row renderer make of it.
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

          // What the schema lets through has no place for a value at all.
          const stdout = readFileSync(join(FIXTURES, version, scenario, command.stdout), "utf8");
          expect(leaks(JSON.stringify(parsePreview(stdout)))).toEqual([]);
        }
        // What the drift check hands over, and what a drifted row, the hash,
        // the summary and the log make of it.
        for (const command of driftChecks) {
          const stack = stackOf(command);
          const result = await pulumi.detectDrift?.(stack, {
            root: ROOT,
            env: {},
            run: runner.run,
            timeoutMinutes: 10,
          });
          if (result === undefined) throw new Error("Pulumi always checks drift.");
          const drift = {
            stackId: stackId(stack),
            changes: [],
            drift: result.ok ? result.drift : [],
          };
          const made = canonicalDiff(drift) + rows(drift) + annex(drift);
          expect(leaks(JSON.stringify(result) + made)).toEqual([]);
        }
        // What the backend says about the stacks of the directory.
        for (const command of stackLists) {
          const stacks = ["dev", "prod"].map((name) => ({ path: command.cwd, name, options: {} }));
          const result = await pulumi.findInBackend?.(stacks, {
            root: ROOT,
            env: {},
            run: runner.run,
          });
          expect(leaks(JSON.stringify(result))).toEqual([]);
        }
      });
    }
  });
}

test("every scenario but the version check is covered", () => {
  for (const version of VERSIONS) {
    const without = scenarioNames(version).filter((scenario) =>
      readRecording(version, scenario).commands.every(
        (command) =>
          !isPreview(command) &&
          !isToolDiff(command) &&
          !isDriftCheck(command) &&
          !isStackList(command),
      ),
    );
    expect(without).toEqual(["version"]);
  }
});

// Record 0048: with `scan.logDiff` on, the canary value is in the tool's own
// diff on purpose. It reaches the stack's group of the job log, after the
// point where workflow commands stop, and nothing else: not the issue, the
// summary, the result file, an annotation, an output, another log line or any
// call to GitHub, the preview page of record 0050 included.
for (const version of VERSIONS) {
  test(`with scan.logDiff on the value reaches the stack's log group and nothing else, replaying pulumi ${version}`, async () => {
    const root = repoRoot("scan:\n  logDiff: true\n");
    const adapter: Adapter = {
      ...pulumi,
      discover: async () => [{ path: "network", name: "dev", options: {} }],
      checkVersion: async () => {},
    };
    const { context, github, log } = harness(adapter, {
      root,
      run: replay(version, "log-diff-deploy", root).run,
    });
    const sent: string[] = [];
    const port = new Proxy(github, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          sent.push(`${String(key)} ${JSON.stringify(args)}`);
          return value.apply(target, args);
        };
      },
    });
    const outputs = rememberingOutputs();
    await scan({ ...context, github: port, outputs });

    const group = log.groups.find(({ title }) => title === "network:dev");
    expect(leaks((group?.verbatim ?? []).join("\n"))).toEqual([CANARY_VALUE, "CANARY", "[secret]"]);
    const elsewhere = [
      ...sent,
      github.issue(1).body,
      ...(group?.lines ?? []),
      ...log.groups.filter((one) => one !== group).map((one) => JSON.stringify(one)),
      ...log.lines,
      ...log.summaries,
      ...log.warnings.map(({ title, message }) => `${title} ${message}`),
      JSON.stringify(outputs.calls),
      JSON.stringify(outputs.resultFile("scan")),
    ].join("\n");
    expect(elsewhere).toContain("network:dev");
    // The stack is pending, so the scan wrote its preview page.
    expect(sent.filter((call) => call.startsWith("createCheckRun "))).toHaveLength(1);
    expect(leaks(elsewhere)).toEqual([]);
  });
}

// Record 0052: `dashboard.showValues` lets a value through at a listed path,
// and only there. The recorded nested change holds the canary value at two
// paths: one on the Deployment and one on the ConfigMap.
const LISTED = "spec.template.spec.containers[0].env[0].value";
const NESTED: Stack = { path: "generated/nested", name: "dev", options: {} };

for (const version of VERSIONS) {
  describe(`dashboard.showValues, replaying pulumi ${version}`, () => {
    async function listing(showValues: string[]): Promise<Diff> {
      const result = await pulumi.preview(NESTED, {
        root: ROOT,
        env: {},
        run: replay(version, "nested-paths").run,
        timeoutMinutes: 10,
        showValues,
      });
      if (!result.ok) throw new Error("expected a diff");
      return result.diff;
    }

    test("the canary value on an unlisted path appears nowhere", async () => {
      const diff = await listing(["spec.template.spec.containers[0].image"]);
      expect(leaks(JSON.stringify(diff) + rows(diff) + annex(diff))).toEqual([]);
    });

    // The listed value is hashed, as a row shows it (records 0008 and 0052),
    // so a tick approves it. The unlisted one is in nothing, the hash included.
    test("the canary value on a listed path appears and is hashed, the one on the unlisted path is in nothing", async () => {
      const diff = await listing([LISTED]);
      const made = JSON.stringify(diff) + rows(diff) + annex(diff);

      expect(made).toContain(`${CANARY_VALUE}-2`);
      expect(made).not.toContain(`${CANARY_VALUE}-3`);
      expect(canonicalDiff(diff)).toContain(`${CANARY_VALUE}-2`);
      expect(canonicalDiff(diff)).not.toContain(`${CANARY_VALUE}-3`);
      expect(diffHash(diff)).not.toBe(diffHash(await listing([])));
      // A redacted row shows no value, whatever the diff holds.
      const row = { state: "pending", diff, hash: diffHash(diff), runUrl: "run-url" } as const;
      expect(leaks(renderRow(row, { redact: true }))).toEqual([]);
    });
  });

  // The worst list there is: every path that any recorded preview changes.
  // Values of the program may then appear. A secret never does, and neither
  // does the tool's stand-in for one.
  describe(`a list that names every changed path, replaying pulumi ${version}`, () => {
    for (const scenario of scenarioNames(version)) {
      const previews = readRecording(version, scenario).commands.filter(isPreview);
      if (previews.length === 0) continue;
      test(scenario, async () => {
        for (const command of previews) {
          const options = { root: ROOT, env: {}, timeoutMinutes: 10 };
          const first = await pulumi.preview(stackOf(command), {
            ...options,
            run: replay(version, scenario).run,
          });
          const every = first.ok ? first.diff.changes.flatMap((change) => change.changedKeys) : [];
          const result = await pulumi.preview(stackOf(command), {
            ...options,
            run: replay(version, scenario).run,
            showValues: every,
          });
          const made = result.ok ? rows(result.diff) + annex(result.diff) : "";
          const text = JSON.stringify(result) + made;
          expect(text).not.toContain(CANARY_SECRET);
          expect(text).not.toContain("[secret]");
        }
      });
    }
  });
}
