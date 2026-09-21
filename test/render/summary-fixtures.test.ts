import { describe, expect, test } from "bun:test";
import { diffLogLines } from "../../src/render/log-text.ts";
import type { Row } from "../../src/render/row.ts";
import { renderSummary, type SummaryMerge, type SummaryStack } from "../../src/render/summary.ts";
import { rows58, rows100 } from "./fixtures.ts";

const REPO_URL = "https://github.com/example-org/infra";

// What the core will hand over for a stack (record 0026, slice 2.8). Made up
// here, with a title that needs escaping.
const MERGES: SummaryMerge[] = [
  {
    kind: "pull-request",
    number: 433,
    title: "Rename the uploads bucket to `uploads_v2`",
    url: `${REPO_URL}/pull/433`,
    author: "alice",
  },
  {
    kind: "pull-request",
    number: 429,
    title: "chore(deps): update the provider",
    url: `${REPO_URL}/pull/429`,
    author: "renovate[bot]",
  },
  {
    kind: "push",
    sha: "3fa9c1e2aabbccdd3fa9c1e2aabbccdd3fa9c1e2",
    message: "Fix the lifecycle rule\n\nThe body of the message is not shown.",
    url: `${REPO_URL}/commit/3fa9c1e2aabbccdd3fa9c1e2aabbccdd3fa9c1e2`,
  },
];

// A scan previews every stack but the ones that are deploying. Every third
// pending stack gets the list of what it claims.
function previewedStack(row: Row, withMerges: boolean): SummaryStack | undefined {
  switch (row.state) {
    case "pending":
      return { kind: "diff", diff: row.diff, merges: withMerges ? MERGES : undefined };
    case "in-sync":
      return { kind: "diff", diff: { stackId: row.stackId, changes: [] } };
    case "preview-failed":
      return { kind: "preview-failed", stackId: row.stackId, reason: row.reason };
    case "deploying":
      return undefined;
  }
}

function previewed(rows: Row[]): SummaryStack[] {
  let pending = 0;
  return rows
    .map((row) => previewedStack(row, row.state === "pending" && pending++ % 3 === 0))
    .filter((stack) => stack !== undefined);
}

// The anchor in front of a stack's heading or list line (record 0044).
const ANCHOR = /<a id="sluiceway-[a-z0-9-]+"><\/a>/;

describe("snapshots", () => {
  test("the summary of the 58 stack fixture, in full", () => {
    const summary = renderSummary(previewed(rows58()));

    expect(summary.shortened).toBe(0);
    expect(summary.text).toMatchSnapshot();
  });

  // The real budget holds the 100 stack fixture several times over, so this
  // one is far smaller. It shows every level next to each other.
  test("the summary of the 100 stack fixture over a budget of 60,000 bytes", () => {
    const summary = renderSummary(previewed(rows100()), { budget: 60_000 });

    expect(summary.fits).toBe(true);
    expect(summary.bytes).toBeLessThanOrEqual(60_000);
    expect(summary.text).toMatchSnapshot();
  });
});

describe("the summary of the fixtures", () => {
  test("the 100 stack fixture fits the real budget in full (record 0037)", () => {
    const summary = renderSummary(previewed(rows100()));

    expect(summary.shortened).toBe(0);
    expect(summary.bytes).toBeLessThan(500_000);
  });

  // Record 0044: the summary has an index at its top, in the order of the
  // dashboard, and one anchor per stack for it to land on.
  test("every link of the index lands on the one anchor of its stack, in the order of the dashboard", () => {
    const stacks = previewed(rows100());
    for (const budget of [Infinity, 60_000]) {
      const { text } = renderSummary(stacks, { budget });
      const [, pendingLine = "", failedLine = ""] =
        text.match(/\n- Pending: (.*)\n- Preview failed: (.*)\n/) ?? [];
      const targets = [
        ...`${pendingLine} · ${failedLine}`.matchAll(/\(#user-content-([^)]+)\)/g),
      ].map((match) => match[1]);
      const anchors = [...text.matchAll(/<a id="([^"]+)"><\/a>/g)].map((match) => match[1]);
      // Every pending stack and every preview failure is in the index, and
      // the index follows the sections: pending first, then the failures.
      const indexed = anchors.slice(0, targets.length);
      expect(targets).toEqual(indexed);
      expect(targets.length).toBe(
        stacks.filter((stack) => stack.kind === "preview-failed" || stack.diff.changes.length > 0)
          .length,
      );
      expect(new Set(anchors).size).toBe(stacks.length);
    }
  });

  test("the same input gives the same bytes", () => {
    const render = () => renderSummary(previewed(rows100()), { budget: 60_000 }).text;
    expect(render()).toBe(render());
  });

  test("names every previewed stack once, whatever the budget", () => {
    const stacks = previewed(rows100());
    for (const budget of [Infinity, 200_000, 60_000, 1_000]) {
      const { text } = renderSummary(stacks, { budget });
      for (const stack of stacks) {
        const id = stack.kind === "diff" ? stack.diff.stackId : stack.stackId;
        const lines = text.split("\n").filter(
          (line) =>
            line
              .replace(ANCHOR, "")
              .replace(/^(#### |- (\*\*)?)/, "")
              .replace(/\*\* · .*$/, "") === id,
        );
        expect(lines).toHaveLength(1);
      }
    }
  });

  test("a stack keeps all of its delete and replace lines or none of them", () => {
    const stacks = previewed(rows100());
    const { text } = renderSummary(stacks, { budget: 60_000 });
    const blocks = text.split("\n#### ").slice(1);

    let listed = 0;
    let counted = 0;
    for (const stack of stacks) {
      if (stack.kind !== "diff") continue;
      const destroys = stack.diff.changes.filter(
        (change) => change.op === "delete" || change.op === "replace",
      ).length;
      if (destroys === 0) continue;
      const block =
        blocks.find((candidate) =>
          candidate.replace(ANCHOR, "").startsWith(`${stack.diff.stackId}\n`),
        ) ?? "";
      const lines = block.match(/^- :warning: /gm)?.length ?? 0;
      expect([0, destroys]).toContain(lines);
      expect(block.includes("too many to list here")).toBe(lines === 0);
      if (lines === 0) counted++;
      else listed++;
    }
    // The budget was picked so that both happen.
    expect(listed).toBeGreaterThan(0);
    expect(counted).toBeGreaterThan(0);
  });

  test("a shortened stack always has a full version in the log text", () => {
    for (const stack of previewed(rows100())) {
      if (stack.kind !== "diff" || stack.diff.changes.length === 0) continue;
      expect(diffLogLines(stack.diff)).toHaveLength(stack.diff.changes.length + 1);
    }
  });
});
