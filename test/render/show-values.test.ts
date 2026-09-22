import { describe, expect, test } from "bun:test";
import type { Change, Diff } from "../../src/core/diff.ts";
import { diffLogLines } from "../../src/render/log-text.ts";
import { renderPreviewPage } from "../../src/render/preview-page.ts";
import { applyResultFile, scanResultFile } from "../../src/render/result-file.ts";
import { changeLine, renderRow } from "../../src/render/row.ts";
import { renderSummary } from "../../src/render/summary.ts";

// Record 0052: a value that the adapter handed over, because its path is on
// `dashboard.showValues`, appears as `old → new` after the path everywhere
// the path does, and nowhere under redact.

const RELEASE: Change = {
  address: "urn:odoo",
  type: "kubernetes:helm.sh/v3:Release",
  name: "odoo-release",
  op: "update",
  changedKeys: ["values.githubConfigSecret.github_token", "values.image.tag", "version"],
  replaceKeys: [],
  values: [
    { path: "values.image.tag", old: "17.0.3-r1", new: "17.0.4-r1" },
    { path: "version", old: "17.0.3", new: "17.0.4" },
  ],
};

const DIFF: Diff = { stackId: "apps:prod", changes: [RELEASE] };
const LINKS = { dashboard: "dashboard-url", summary: "summary-url", log: "log-url" };

function row(diff: Diff, options: Parameters<typeof renderRow>[1] = {}): string {
  return renderRow(
    { state: "pending", diff, hash: "00000000000000aa", runUrl: "run-url" },
    options,
  );
}

describe("a change line", () => {
  test("shows old → new after a listed path, and only the path of the others", () => {
    expect(changeLine(RELEASE)).toBe(
      "<kbd>update</kbd> <code>kubernetes:helm.sh/v3:Release</code> <b>odoo-release</b> · " +
        "<code>values.githubConfigSecret.github&#95;token</code>, " +
        "<code>values.image.tag</code> <code>17.0.3-r1</code> → <code>17.0.4-r1</code>, " +
        "<code>version</code> <code>17.0.3</code> → <code>17.0.4</code>",
    );
  });

  test("a change without values reads as before", () => {
    const { values: _values, ...without } = RELEASE;
    expect(changeLine(without)).toBe(
      "<kbd>update</kbd> <code>kubernetes:helm.sh/v3:Release</code> <b>odoo-release</b> · " +
        "<code>values.githubConfigSecret.github&#95;token</code>, <code>values.image.tag</code>, <code>version</code>",
    );
  });

  test("a side that is not there reads nothing", () => {
    const added: Change = {
      ...RELEASE,
      changedKeys: ["environment.STAGE"],
      values: [{ path: "environment.STAGE", new: "second" }],
    };
    const removed: Change = {
      ...RELEASE,
      changedKeys: ["environment.STAGE"],
      values: [{ path: "environment.STAGE", old: "second" }],
    };
    expect(changeLine(added)).toEndWith(
      "<code>environment.STAGE</code> nothing → <code>second</code>",
    );
    expect(changeLine(removed)).toEndWith(
      "<code>environment.STAGE</code> <code>second</code> → nothing",
    );
  });

  test("a value is escaped like every other text from outside", () => {
    const odd: Change = {
      ...RELEASE,
      changedKeys: ["tag"],
      values: [{ path: "tag", old: "<b>*x*</b>", new: "a|b`c" }],
    };
    expect(changeLine(odd)).toEndWith(
      "<code>tag</code> <code>&lt;b&gt;&#42;x&#42;&lt;/b&gt;</code> → <code>a&#124;b&#96;c</code>",
    );
  });

  test("a replace shows the values of the keys that forced it", () => {
    const replace: Change = {
      ...RELEASE,
      op: "replace",
      changedKeys: ["chart", "version"],
      replaceKeys: ["chart"],
      values: [{ path: "chart", old: "odoo", new: "odoo-ee" }],
    };
    expect(changeLine(replace)).toBe(
      "<kbd>REPLACE</kbd> <code>kubernetes:helm.sh/v3:Release</code> <b>odoo-release</b> · " +
        "forced by <code>chart</code> <code>odoo</code> → <code>odoo-ee</code> · also changes <code>version</code>",
    );
  });
});

describe("where values appear", () => {
  test("on the row, with the path shortened and the value as the adapter gave it", () => {
    const text = row(DIFF);
    expect(text).toContain("<code>version</code> <code>17.0.3</code> → <code>17.0.4</code>");
  });

  test("nowhere on a redacted row", () => {
    const text = row(DIFF, { redact: true });
    expect(text).not.toContain("17.0.");
  });

  test("in the summary", () => {
    const { text } = renderSummary([{ kind: "diff", diff: DIFF }]);
    expect(text).toContain("<code>version</code> <code>17.0.3</code> → <code>17.0.4</code>");
  });

  test("on the preview page, which says the values come from the list", () => {
    const page = renderPreviewPage(DIFF, LINKS);
    expect(page.text).toContain("<code>version</code> <code>17.0.3</code> → <code>17.0.4</code>");
    expect(page.summary).toContain("dashboard.showValues");
    expect(page.summary).not.toContain("never what it changes to");
  });

  test("a page without values says as before that it shows none", () => {
    const { values: _values, ...without } = RELEASE;
    const page = renderPreviewPage({ stackId: "apps:prod", changes: [without] }, LINKS);
    expect(page.summary).toContain("never what it changes to");
  });

  test("in the job log", () => {
    expect(diffLogLines(DIFF)).toContain(
      "update kubernetes:helm.sh/v3:Release odoo-release · values.githubConfigSecret.github_token, values.image.tag 17.0.3-r1 → 17.0.4-r1, version 17.0.3 → 17.0.4",
    );
  });

  test("in the result files, next to the paths", () => {
    const stack = { kind: "diff", diff: DIFF } as const;
    const scan = JSON.parse(
      scanResultFile({
        run: "r",
        commit: "c",
        milliseconds: 1,
        stacks: [{ stack, milliseconds: 1 }],
      }),
    );
    expect(scan.stacks[0].changes[0].values).toEqual(RELEASE.values);

    const apply = JSON.parse(
      applyResultFile({
        run: "r",
        commit: "c",
        deployment: 1,
        outcome: "deployed",
        stack: "apps:prod",
        ticker: "alice",
        milliseconds: 1,
        applied: { kind: "deployed", diff: DIFF },
      }),
    );
    expect(apply.preview.changes[0].values).toEqual(RELEASE.values);
  });

  test("a result file without values has no values field", () => {
    const { values: _values, ...without } = RELEASE;
    const diff: Diff = { stackId: "a", changes: [without] };
    const stack = { kind: "diff", diff } as const;
    const scan = JSON.parse(
      scanResultFile({
        run: "r",
        commit: "c",
        milliseconds: 1,
        stacks: [{ stack, milliseconds: 1 }],
      }),
    );
    expect(Object.keys(scan.stacks[0].changes[0])).not.toContain("values");
  });
});
