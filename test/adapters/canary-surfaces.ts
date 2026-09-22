// Every place a diff can reach, rendered, for the canary tests of record 0021:
// the Pulumi one and the OpenTofu one (record 0053) search the same surfaces.
import type { Diff } from "../../src/core/diff.ts";
import { diffHash } from "../../src/core/diff-hash.ts";
import { renderBody, rowBlock } from "../../src/render/body.ts";
import { fitBody } from "../../src/render/budget.ts";
import { diffLogLines, logGroupTitle } from "../../src/render/log-text.ts";
import { renderPreviewPage } from "../../src/render/preview-page.ts";
import { applyResultFile, scanResultFile } from "../../src/render/result-file.ts";
import { renderRow } from "../../src/render/row.ts";
import { renderSummary } from "../../src/render/summary.ts";

// The row of a diff at every level of the size budget, and redacted.
export function rows(diff: Diff): string {
  const row = { state: "pending", diff, hash: diffHash(diff), runUrl: "run-url" } as const;
  return [
    ...([0, 1, 2, 3] as const).map((level) => renderRow(row, { level })),
    renderRow(row, { redact: true }),
    body(row),
    budgeted(row),
    // A diff with drift is also a drifted row (record 0055).
    ...((diff.drift ?? []).length > 0 ? drifted(diff) : []),
  ].join("\n");
}

function drifted(diff: Diff): string[] {
  const row = { state: "drift", diff, hash: diffHash(diff), runUrl: "run-url" } as const;
  return [
    ...([0, 2] as const).map((level) => renderRow(row, { level })),
    renderRow(row, { redact: true }),
    body(row),
    budgeted(row),
  ];
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
// the result files of a scan and of an apply (record 0041), and the preview
// page in full and cut as far as it goes (record 0050).
export function annex(diff: Diff): string {
  const stack = { kind: "diff", diff } as const;
  const stacks = [stack];
  return [
    renderSummary(stacks).text,
    renderSummary(stacks, { budget: 0 }).text,
    JSON.stringify(renderPreviewPage(diff, PAGE_LINKS, { toolDiffInLog: true })),
    JSON.stringify(renderPreviewPage(diff, PAGE_LINKS, { limit: 0 })),
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

export const RESULT = { run: "run-url", commit: "sha", milliseconds: 1 };
const PAGE_LINKS = { dashboard: "dashboard-url", summary: "summary-url", log: "log-url" };
const APPLIED = { deployment: 1, outcome: "deployed", stack: "a", ticker: "alice" } as const;
