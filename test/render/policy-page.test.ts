import { describe, expect, test } from "bun:test";
import type { Change, Diff } from "../../src/core/diff.ts";
import type { PolicyOutcome } from "../../src/core/policy.ts";
import {
  PREVIEW_PAGE_FIELD_LIMIT,
  type PreviewPageLinks,
  renderPreviewPage,
} from "../../src/render/preview-page.ts";

// Slice 5.41 (record 0106): the preview page shows what the row shows (record
// 0050), so it names every failed policy, whole and escaped, before the
// changes, and says when the policies could not run.

const REPO_URL = "https://github.com/example-org/infra";
const LINKS: PreviewPageLinks = {
  dashboard: `${REPO_URL}/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22sluiceway%22`,
  summary: `${REPO_URL}/actions/runs/4242/attempts/1`,
  log: `${REPO_URL}/actions/runs/4242/job/106502264185`,
};

function change(op: Change["op"], type: string, name: string, rest: Partial<Change> = {}): Change {
  return { address: `${type}::${name}`, type, name, op, changedKeys: [], replaceKeys: [], ...rest };
}

const DIFF: Diff = {
  stackId: "storage:prod",
  changes: [change("update", "aws:s3/bucket:Bucket", "uploads", { changedKeys: ["acl"] })],
};

const FAILED: PolicyOutcome = {
  kind: "failed",
  report: {
    failures: [
      { namespace: "main", message: "bucket uploads must not be public" },
      { namespace: "prod", message: `<b>bold</b> *star* ${"x".repeat(300)}` },
    ],
    warnings: [{ namespace: "main", message: "logs is replaced" }],
    passed: 3,
    namespaces: ["main", "prod"],
  },
};

describe("the page of a stack a policy stopped", () => {
  test("the summary says the row has no box, and the title is unchanged", () => {
    const page = renderPreviewPage(DIFF, LINKS, { policies: FAILED });
    expect(page.title).toBe("storage:prod: 1 update");
    expect(page.summary.split("\n\n")[1]).toBe(
      ":no_entry: **2 policies failed**, so the row has no box until the change or the policies change. They are named first below, in the policies' own words.",
    );
  });

  test("the text lists every failure whole and escaped, then the warnings, then the changes", () => {
    const { text } = renderPreviewPage(DIFF, LINKS, { policies: FAILED });
    expect(text).toBe(
      [
        "- :no_entry: <code>main</code> · bucket uploads must not be public",
        `- :no_entry: <code>prod</code> · &lt;b&gt;bold&lt;/b&gt; &#42;star&#42; ${"x".repeat(300)}`,
        "- :warning: <code>main</code> · logs is replaced",
        "",
        "- <kbd>update</kbd> <code>aws:s3/bucket:Bucket</code> <b>uploads</b> · <code>acl</code>",
        "",
      ].join("\n"),
    );
  });

  test("the policy lines are never cut: the changes give way first", () => {
    const many: Diff = {
      stackId: "storage:prod",
      changes: Array.from({ length: 2000 }, (_, index) =>
        change("update", "aws:s3/bucket:Bucket", `bucket-${index}`, { changedKeys: ["acl"] }),
      ),
    };
    const page = renderPreviewPage(many, LINKS, { policies: FAILED, limit: 4000 });
    expect(page.text).toStartWith("- :no_entry: <code>main</code>");
    expect(page.unlisted).toBeGreaterThan(0);
    expect(new TextEncoder().encode(page.text).length).toBeLessThanOrEqual(4000);
    expect(PREVIEW_PAGE_FIELD_LIMIT).toBe(65_535);
  });
});

describe("the page of a stack whose policies passed or could not run", () => {
  test("says every policy passed, and lists a warning", () => {
    const passed: PolicyOutcome = {
      kind: "passed",
      report: {
        failures: [],
        warnings: [{ namespace: "main", message: "logs is replaced" }],
        passed: 3,
        namespaces: ["main", "prod"],
      },
    };
    const page = renderPreviewPage(DIFF, LINKS, { policies: passed });
    expect(page.summary.split("\n\n")[1]).toBe(
      "Every policy passed: 3 rules in main and prod, with 1 warning, named first below.",
    );
    expect(page.text).toStartWith("- :warning: <code>main</code> · logs is replaced\n\n");
  });

  test("says the policies did not run, and why, in Sluiceway's words", () => {
    const notRun: PolicyOutcome = {
      kind: "not-run",
      reason: { kind: "path-missing", path: "policies/prod" },
    };
    const page = renderPreviewPage(DIFF, LINKS, { policies: notRun });
    expect(page.summary.split("\n\n")[1]).toBe(
      ":warning: The policies did not run: the policy path policies/prod is not in the repo. Nothing was checked, and the row keeps its box.",
    );
    expect(page.text).toStartWith("- <kbd>update</kbd>");
  });

  test("without policies the page is what it was", () => {
    expect(renderPreviewPage(DIFF, LINKS, {})).toEqual(renderPreviewPage(DIFF, LINKS));
  });
});
