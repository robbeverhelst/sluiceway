import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CANARY_SECRET, CANARY_VALUE } from "../../../scripts/fixtures/example.ts";
import { pulumi } from "../../../src/adapters/pulumi/index.ts";
import { parsePreview } from "../../../src/adapters/pulumi/schema.ts";
import type { Diff } from "../../../src/core/diff.ts";
import { canonicalDiff, diffHash } from "../../../src/core/diff-hash.ts";
import { previewFailureText } from "../../../src/core/failure-reason.ts";
import { type Stack, stackId } from "../../../src/core/stack.ts";
import { renderBody, rowBlock } from "../../../src/render/body.ts";
import { fitBody } from "../../../src/render/budget.ts";
import { diffLogLines, logGroupTitle } from "../../../src/render/log-text.ts";
import { renderRow } from "../../../src/render/row.ts";
import { renderSummary } from "../../../src/render/summary.ts";
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

// The summary in full and cut as far as it goes, and the log text (record 0037).
function annex(diff: Diff): string {
  const stacks = [{ kind: "diff", diff } as const];
  return [
    renderSummary(stacks).text,
    renderSummary(stacks, { budget: 0 }).text,
    logGroupTitle(diff.stackId),
    ...diffLogLines(diff),
  ].join("\n");
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
      const previews = readRecording(version, scenario).commands.filter(
        (command) => command.argv[1] === "preview",
      );
      if (previews.length === 0) continue;

      test(scenario, async () => {
        const runner = replay(version, scenario);
        for (const command of previews) {
          const name = command.argv[command.argv.indexOf("--stack") + 1];
          const stack: Stack = { path: command.cwd, options: {}, ...(name ? { name } : {}) };
          const result = await pulumi.preview(stack, {
            root: ROOT,
            env: {},
            run: runner.run,
            timeoutMinutes: 10,
          });

          // Everything the adapter hands over, the tool's words included, and
          // what the core and the row renderer make of it.
          const made = result.ok
            ? canonicalDiff(result.diff) + rows(result.diff) + annex(result.diff)
            : renderSummary([
                {
                  kind: "preview-failed",
                  stackId: stackId(stack),
                  reason: previewFailureText(result.reason),
                },
              ]).text +
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
      readRecording(version, scenario).commands.every((command) => command.argv[1] !== "preview"),
    );
    expect(without).toEqual(["version"]);
  }
});
