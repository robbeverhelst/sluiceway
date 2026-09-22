import { describe, expect, test } from "bun:test";
import type { Change, Diff } from "../../src/core/diff.ts";
import { ALREADY_ENDED, renderApplySummary } from "../../src/render/apply-summary.ts";

// The summary of an `apply` (record 0021): the stack, the result, the counts by
// op, the changes as a row shows them, and the run. Never a value and never a
// stack output, because the diff has no field for either. It needs no budget
// (record 0037).

const RUN = "https://github.com/acme/infra/actions/runs/5151";

function change(name: string, op: Change["op"], keys: string[] = []): Change {
  return {
    address: `urn:${name}`,
    type: "aws:s3/bucket:Bucket",
    name,
    op,
    changedKeys: keys,
    replaceKeys: op === "replace" ? keys : [],
  };
}

const DIFF: Diff = {
  stackId: "storage/buckets:prod",
  changes: [
    change("uploads", "update", ["tags"]),
    change("archive", "delete"),
    change("logs", "create"),
  ],
};

describe("the summary of an apply", () => {
  // Slice 2.20 (record 0051).
  test("an empty fresh preview says there was nothing to deploy", () => {
    expect(
      renderApplySummary({
        stackId: "storage/buckets:prod",
        ticker: "alice",
        runUrl: RUN,
        outcome: { kind: "in-sync" },
      }),
    ).toBe(
      [
        "## Sluiceway apply",
        "",
        `**storage/buckets:prod** · nothing to deploy, already in sync · ticked by alice · [run](${RUN})`,
        "",
        "The fresh preview shows no change, so nothing was deployed. The stack is already as its code says, most likely from a deploy outside the dashboard.",
        "",
      ].join("\n"),
    );
  });

  test("a deploy that went out says so and lists what went out", () => {
    expect(
      renderApplySummary({
        stackId: "storage/buckets:prod",
        ticker: "alice",
        runUrl: RUN,
        outcome: { kind: "deployed", diff: DIFF },
      }),
    ).toBe(
      [
        "## Sluiceway apply",
        "",
        `**storage/buckets:prod** · deployed · ticked by alice · [run](${RUN})`,
        "",
        "### What went out",
        "",
        "1 create, 1 update, **1 delete**",
        "",
        "- :warning: <kbd>DELETE</kbd> <code>aws:s3/bucket:Bucket</code> <b>archive</b>",
        "",
        "<details><summary>2 other changes</summary>",
        "",
        "- <kbd>create</kbd> <code>aws:s3/bucket:Bucket</code> <b>logs</b>",
        "- <kbd>update</kbd> <code>aws:s3/bucket:Bucket</code> <b>uploads</b> · <code>tags</code>",
        "",
        "</details>",
        "",
      ].join("\n"),
    );
  });

  test("a moved change shows the fresh diff, which is what the row shows now", () => {
    const text = renderApplySummary({
      stackId: "storage/buckets:prod",
      ticker: "alice",
      runUrl: RUN,
      outcome: {
        kind: "not-deployed",
        reason: "the change moved since the tick",
        checked: { kind: "diff", diff: DIFF },
      },
    });
    expect(text).toStartWith(
      [
        "## Sluiceway apply",
        "",
        `**storage/buckets:prod** · not deployed: the change moved since the tick · ticked by alice · [run](${RUN})`,
        "",
        "Nothing was deployed from this deployment record, and nothing will be. The job log of this run holds the tool's own words. A fresh tick on the dashboard tries again.",
        "",
        "### What the fresh preview showed",
        "",
        "1 create, 1 update, **1 delete**",
      ].join("\n"),
    );
  });

  test("a deploy that failed half way shows what it tried, and what is pending after it", () => {
    const after: Diff = { stackId: DIFF.stackId, changes: [change("logs", "create")] };
    const text = renderApplySummary({
      stackId: "storage/buckets:prod",
      ticker: "alice",
      runUrl: RUN,
      outcome: {
        kind: "not-deployed",
        reason: "the tool exited with an error (exit code 1)",
        checked: { kind: "diff", diff: DIFF },
        after: { kind: "diff", diff: after },
      },
    });
    expect(text).toContain("### What the fresh preview showed");
    expect(text).toContain(
      "### What is pending now\n\n1 create\n\n<details><summary>1 change</summary>",
    );
  });

  test("a preview that failed gives its reason and no diff", () => {
    const text = renderApplySummary({
      stackId: "net:dev",
      ticker: "alice",
      runUrl: RUN,
      outcome: {
        kind: "not-deployed",
        reason: "the preview before the deploy failed: the tool exited with an error",
        checked: { kind: "preview-failed", reason: "the tool exited with an error" },
      },
    });
    expect(text).toContain(
      "### What the fresh preview showed\n\nThe preview failed: the tool exited with an error.",
    );
  });

  test("a stack in sync after the deploy says nothing is pending", () => {
    const text = renderApplySummary({
      stackId: "net:dev",
      ticker: "alice",
      runUrl: RUN,
      outcome: {
        kind: "not-deployed",
        reason: "the tool exited with an error (exit code 1)",
        after: { kind: "diff", diff: { stackId: "net:dev", changes: [] } },
      },
    });
    expect(text).toContain("### What is pending now\n\nNothing. The stack is in sync.");
  });

  test("names come from code and are escaped, never trusted as markup", () => {
    const text = renderApplySummary({
      stackId: "a<b>:dev",
      ticker: "alice",
      runUrl: RUN,
      outcome: { kind: "deployed", diff: { stackId: "a<b>:dev", changes: [] } },
    });
    expect(text).toContain("**a&lt;b&gt;:dev** · deployed");
    expect(text).toContain("### What went out\n\nNo changes.");
  });
});

describe("the summary of a deploy that already ended", () => {
  test("is the sentence of record 0019 and nothing else", () => {
    expect(ALREADY_ENDED).toBe(
      "This deploy already ended. Tick the box on the dashboard to try again.",
    );
  });
});
