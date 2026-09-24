import { describe, expect, test } from "bun:test";
import type { Change } from "../../src/core/diff.ts";
import type { PolicyOutcome } from "../../src/core/policy.ts";
import { renderSummary, type SummaryStack } from "../../src/render/summary.ts";

// Slice 5.41 (record 0106): the summary shows the same kind of facts as a
// row, so a stack a policy stopped says so there too, with every failure.

function change(op: Change["op"], type: string, name: string, rest: Partial<Change> = {}): Change {
  return { address: `${type}::${name}`, type, name, op, changedKeys: [], replaceKeys: [], ...rest };
}

const FAILED: PolicyOutcome = {
  kind: "failed",
  report: {
    failures: [
      { namespace: "main", message: "bucket uploads must not be public" },
      { namespace: "prod", message: "<b>bold</b>" },
    ],
    warnings: [{ namespace: "main", message: "logs is replaced" }],
    passed: 3,
    namespaces: ["main", "prod"],
  },
};

function stack(policies: PolicyOutcome | undefined): SummaryStack {
  return {
    kind: "diff",
    diff: {
      stackId: "storage:prod",
      changes: [change("update", "aws:s3/bucket:Bucket", "uploads", { changedKeys: ["acl"] })],
    },
    policies,
  };
}

describe("the summary of a stack a policy stopped", () => {
  test("names every failure under the counts, escaped, and the warnings", () => {
    const { text } = renderSummary([stack(FAILED)]);
    expect(text).toContain(
      [
        "1 update",
        "",
        ":no_entry: **2 policies failed**, so the row has no box until it passes:",
        "- :no_entry: <code>main</code> · bucket uploads must not be public",
        "- :no_entry: <code>prod</code> · &lt;b&gt;bold&lt;/b&gt;",
        "- :warning: <code>main</code> · logs is replaced",
        "",
        "<details><summary>1 change</summary>",
      ].join("\n"),
    );
  });

  test("says when the policies did not run", () => {
    const notRun: PolicyOutcome = { kind: "not-run", reason: { kind: "tool-missing" } };
    expect(renderSummary([stack(notRun)]).text).toContain(
      "\n\n:warning: The policies did not run: conftest is not installed on the runner. Nothing was checked, and the row keeps its box.\n\n",
    );
  });

  test("a pass with no warning adds nothing", () => {
    const passed: PolicyOutcome = {
      kind: "passed",
      report: { failures: [], warnings: [], passed: 3, namespaces: ["main"] },
    };
    expect(renderSummary([stack(passed)]).text).toBe(renderSummary([stack(undefined)]).text);
  });
});
