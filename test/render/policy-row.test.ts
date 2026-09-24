import { describe, expect, test } from "bun:test";
import type { Change } from "../../src/core/diff.ts";
import type { PolicyOutcome } from "../../src/core/policy.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { type PendingRow, renderRow } from "../../src/render/row.ts";

// Slice 5.41 (record 0106): a policy that fails takes the box off the row and
// names the policy in its own words, escaped as untrusted text. A policy that
// could not run is a warning line, and the row keeps its box.

function change(name: string): Change {
  return {
    address: `urn:${name}`,
    type: "aws:s3/bucket:Bucket",
    name,
    op: "update",
    changedKeys: ["acl"],
    replaceKeys: [],
  };
}

const FAILED: PolicyOutcome = {
  kind: "failed",
  report: {
    failures: [
      { namespace: "main", message: "bucket uploads must not be public" },
      {
        namespace: "prod",
        message:
          "no deletes in prod <b>bold</b> *star* [link](https://example.com) line one\nline two",
      },
    ],
    warnings: [{ namespace: "main", message: "logs is replaced" }],
    passed: 3,
    namespaces: ["main", "prod"],
  },
};

function row(policies: PolicyOutcome | undefined, rest: Partial<PendingRow> = {}): PendingRow {
  return {
    state: "pending",
    diff: { stackId: "storage:prod", changes: [change("uploads")] },
    hash: "2b44350653e84a11",
    runUrl: "run-url",
    previewUrl: "page-url",
    attribution: { full: "from #12 by alice", counted: "from 1 pull request" },
    policies,
    ...rest,
  };
}

describe("a pending row whose change fails a policy", () => {
  test("has no box, says so, and lists each failure in the policy's own words, escaped", () => {
    expect(renderRow(row(FAILED))).toBe(
      [
        '- **storage:prod** · 1 update · [preview](page-url) <!-- sluiceway:row stack="storage:prod" state="pending" hash="2b44350653e84a11" policy="failed" -->',
        "  from #12 by alice",
        "  :no_entry: **2 policies failed**, so this change has no box until it passes:",
        "  :no_entry: <code>main</code> · bucket uploads must not be public",
        "  :no_entry: <code>prod</code> · no deletes in prod &lt;b&gt;bold&lt;/b&gt; &#42;star&#42; &#91;link&#93;(https://example.com) line one line two",
        "  <details><summary>1 change</summary>",
        "  <kbd>update</kbd> <code>aws:s3/bucket:Bucket</code> <b>uploads</b> · <code>acl</code><br>",
        "  </details>",
        "  <!-- /sluiceway:row -->",
      ].join("\n"),
    );
  });

  test("the marker says a policy failed, and the row holds no tick", () => {
    const [parsed] = parseDashboard(renderRow(row(FAILED))).rows;
    expect(parsed?.known && parsed.policyFailed).toBe(true);
    expect(parsed?.known && parsed.ticked).toBe(false);
    // A tick carried from the live row is not drawn: there is no box for it.
    const [ticked] = parseDashboard(renderRow(row(FAILED, { ticked: true }))).rows;
    expect(ticked?.known && ticked.ticked).toBe(false);
  });

  test("one failure reads in the singular", () => {
    const one: PolicyOutcome = {
      kind: "failed",
      report: { ...FAILED.report, failures: FAILED.report.failures.slice(0, 1) },
    };
    expect(renderRow(row(one)).split("\n")[2]).toBe(
      "  :no_entry: **1 policy failed**, so this change has no box until it passes:",
    );
  });

  test("names at most five failures, and counts the rest on the preview page", () => {
    const many: PolicyOutcome = {
      kind: "failed",
      report: {
        ...FAILED.report,
        failures: Array.from({ length: 7 }, (_, index) => ({
          namespace: "main",
          message: `rule ${index + 1}`,
        })),
      },
    };
    const lines = renderRow(row(many)).split("\n");
    expect(lines[2]).toBe(
      "  :no_entry: **7 policies failed**, so this change has no box until it passes:",
    );
    expect(lines.slice(3, 8).map((line) => line.trim())).toEqual([
      ":no_entry: <code>main</code> · rule 1",
      ":no_entry: <code>main</code> · rule 2",
      ":no_entry: <code>main</code> · rule 3",
      ":no_entry: <code>main</code> · rule 4",
      ":no_entry: <code>main</code> · rule 5",
    ]);
    expect(lines[8]).toBe("  :no_entry: and 2 more on the [preview](page-url)");
  });

  test("a long message is cut, so a policy cannot fill the dashboard", () => {
    const long: PolicyOutcome = {
      kind: "failed",
      report: { ...FAILED.report, failures: [{ namespace: "main", message: "x".repeat(400) }] },
    };
    const line = renderRow(row(long)).split("\n")[3] ?? "";
    expect(line).toBe(`  :no_entry: <code>main</code> · ${"x".repeat(200)}…`);
  });

  test("a redacted row names no policy: the count and the page", () => {
    expect(renderRow(row(FAILED), { redact: true }).split("\n").slice(2, 4)).toEqual([
      "  :no_entry: **2 policies failed**, so this change has no box until it passes. They are named on the [preview](page-url).",
      "  Changes are listed in the [summary](run-url)",
    ]);
  });

  test("a shortened row keeps the count and the page, and the lines go", () => {
    const lines = renderRow(row(FAILED), { level: 2 }).split("\n");
    expect(lines[2]).toBe(
      "  :no_entry: **2 policies failed**, so this change has no box until it passes. They are named on the [preview](page-url).",
    );
    expect(lines.some((line) => line.includes("must not be public"))).toBe(false);
  });

  test("without a page the link lands on the summary", () => {
    const lines = renderRow(row(FAILED, { previewUrl: undefined }), { level: 2 }).split("\n");
    expect(lines[2]).toContain("[preview](run-url)");
  });

  test("a read-only row says the same, and the namespace is escaped too", () => {
    const odd: PolicyOutcome = {
      kind: "failed",
      report: { ...FAILED.report, failures: [{ namespace: "a<b", message: "m" }] },
    };
    const lines = renderRow(row(odd), { readOnly: true }).split("\n");
    expect(lines[0]).toStartWith("- **storage:prod**");
    expect(lines[3]).toBe("  :no_entry: <code>a&lt;b</code> · m");
  });
});

describe("a pending row whose policies could not run", () => {
  test("keeps its box and carries a warning line with the reason, never the tool's words", () => {
    const notRun: PolicyOutcome = {
      kind: "not-run",
      reason: { kind: "tool-error", exitCode: 1 },
    };
    expect(renderRow(row(notRun)).split("\n").slice(0, 3)).toEqual([
      '- [ ] **storage:prod** · 1 update · [preview](page-url) <!-- sluiceway:row stack="storage:prod" state="pending" hash="2b44350653e84a11" -->',
      "  from #12 by alice",
      "  :warning: the policies did not run: conftest exited with an error (exit code 1). Nothing was checked, see the [run](run-url).",
    ]);
  });

  test("a redacted or shortened row says the same", () => {
    const notRun: PolicyOutcome = { kind: "not-run", reason: { kind: "tool-missing" } };
    for (const options of [{ redact: true }, { level: 3 as const }]) {
      expect(renderRow(row(notRun), options).split("\n")[2]).toBe(
        "  :warning: the policies did not run: conftest is not installed on the runner. Nothing was checked, see the [run](run-url).",
      );
    }
  });
});

describe("a pending row whose policies passed", () => {
  test("is byte for byte the row without policies", () => {
    const passed: PolicyOutcome = {
      kind: "passed",
      report: { failures: [], warnings: [], passed: 3, namespaces: ["main"] },
    };
    expect(renderRow(row(passed))).toBe(renderRow(row(undefined)));
  });
});
