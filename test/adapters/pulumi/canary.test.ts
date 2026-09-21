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
import { renderBody, rowBlock } from "../../../src/render/body.ts";
import { fitBody } from "../../../src/render/budget.ts";
import { diffLogLines, logGroupTitle } from "../../../src/render/log-text.ts";
import { applyResultFile, scanResultFile } from "../../../src/render/result-file.ts";
import { renderRow } from "../../../src/render/row.ts";
import { renderSummary } from "../../../src/render/summary.ts";
import { harness, repoRoot } from "../../modes/harness.ts";
import { rememberingOutputs } from "../../modes/outputs-harness.ts";
import { FIXTURES, ROOT, readRecording, replay, scenarioNames, VERSIONS } from "./replay.ts";

// The canary test of record 0021 (build plan, section 6). Every program of
// the example sets one property to CANARY-VALUE, unmarked, and holds one
// secret config value. Every recorded preview goes through the adapter, and
// nothing that comes out may hold either, or the tool's stand-in for a secret.
// Later slices add the renderers and the log text to what is searched. This
// test stays in the suite forever.

const FORBIDDEN = [CANARY_VALUE, CANARY_SECRET, "CANARY", "[secret]"];

// The row of a diff at every level of the size budget, and redacted.
function rows(diff: Diff): string {
  const row = { state: "pending", diff, hash: diffHash(diff), runUrl: "run-url" } as const;
  return [
    ...([0, 1, 2, 3] as const).map((level) => renderRow(row, { level })),
    renderRow(row, { redact: true }),
    body(row),
    budgeted(row),
  ].join("\n");
}

// The whole body around that row, which is what reaches the issue.
function body(row: Parameters<typeof rowBlock>[0]): string {
  return renderBody({
    root: { scanSha: "sha", scanRun: "1", scanAt: "2026-09-21T10:02:41Z" },
    rows: [rowBlock(row)],
    recentlyDeployed: [],
    repoUrl: "repo-url",
    actionRef: "v0.1.0",
    personality: true,
  });
}

// The same body through the size budget, cut as far as it goes (record 0028).
function budgeted(row: Parameters<typeof rowBlock>[0]): string {
  return fitBody(
    {
      root: { scanSha: "sha", scanRun: "1", scanAt: "2026-09-21T10:02:41Z" },
      rows: [row],
      carried: [],
      recentlyDeployed: [],
      repoUrl: "repo-url",
      actionRef: "v0.1.0",
      personality: true,
    },
    { target: 0 },
  ).body;
}

// The summary in full and cut as far as it goes, the log text (record 0037),
// and the result files of a scan and of an apply (record 0041).
function annex(diff: Diff): string {
  const stack = { kind: "diff", diff } as const;
  const stacks = [stack];
  return [
    renderSummary(stacks).text,
    renderSummary(stacks, { budget: 0 }).text,
    logGroupTitle(diff.stackId),
    ...diffLogLines(diff),
    scanResultFile({ ...RESULT, stacks: [{ stack, milliseconds: 1 }] }),
    applyResultFile({ ...RESULT, ...APPLIED, applied: { kind: "deployed", diff } }),
    applyResultFile({
      ...RESULT,
      ...APPLIED,
      outcome: "failed",
      applied: {
        kind: "not-deployed",
        reason: "the tool exited with an error (exit code 1)",
        checked: { kind: "diff", diff },
        after: { kind: "diff", diff },
      },
    }),
  ].join("\n");
}

const RESULT = { run: "run-url", commit: "sha", milliseconds: 1 };
const APPLIED = { deployment: 1, outcome: "deployed", stack: "a", ticker: "alice" } as const;

type Command = ReturnType<typeof readRecording>["commands"][number];

// The preview whose document the adapter parses, and the second run of the
// tool that displays the diff for the job log (record 0045).
function isPreview(command: Command): boolean {
  return command.argv[1] === "preview" && command.argv.includes("--json");
}

function isToolDiff(command: Command): boolean {
  return command.argv[1] === "preview" && command.argv.includes("--diff");
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
      if (previews.length + toolDiffs.length === 0) continue;

      test(scenario, async () => {
        const runner = replay(version, scenario);
        // The tool's own diff holds values on purpose (record 0045). Only its
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
      });
    }
  });
}

test("every scenario but the version check is covered", () => {
  for (const version of VERSIONS) {
    const without = scenarioNames(version).filter((scenario) =>
      readRecording(version, scenario).commands.every(
        (command) => !isPreview(command) && !isToolDiff(command),
      ),
    );
    expect(without).toEqual(["version"]);
  }
});

// Record 0045: with `scan.logDiff` on, the canary value is in the tool's own
// diff on purpose. It reaches the stack's group of the job log, after the
// point where workflow commands stop, and nothing else: not the issue, the
// summary, the result file, an annotation, an output, another log line or any
// call to GitHub.
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
    expect(leaks(elsewhere)).toEqual([]);
  });
}
