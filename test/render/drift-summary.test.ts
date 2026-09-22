import { describe, expect, test } from "bun:test";
import type { Change, Diff } from "../../src/core/diff.ts";
import { renderApplySummary } from "../../src/render/apply-summary.ts";
import { diffLogLines } from "../../src/render/log-text.ts";
import { renderSummary } from "../../src/render/summary.ts";

// Record 0055: a drifted row links to the summary, so the summary lists the
// drift of every stack in full, in the same words as the row. The job log
// holds it too. Never a value.

const gone: Change = {
  address: "urn:notes",
  type: "local:index/file:File",
  name: "notes",
  op: "delete",
  changedKeys: [],
  replaceKeys: [],
};
const changed: Change = {
  address: "urn:assets",
  type: "aws:s3/bucket:Bucket",
  name: "assets",
  op: "update",
  changedKeys: ["tags.owner"],
  replaceKeys: [],
};
const pet: Change = {
  address: "urn:pet",
  type: "random:Pet",
  name: "pet",
  op: "update",
  changedKeys: ["length"],
  replaceKeys: [],
};

const onlyDrift: Diff = { stackId: "site:prod", changes: [], drift: [gone, changed] };
const both: Diff = { stackId: "app:prod", changes: [pet], drift: [gone] };

describe("the summary", () => {
  const { text } = renderSummary([
    { kind: "diff", diff: onlyDrift },
    { kind: "diff", diff: both },
    { kind: "diff", diff: { stackId: "calm:prod", changes: [] } },
  ]);

  test("counts drifted stacks, and indexes them after the pending ones", () => {
    expect(text).toContain("3 stacks previewed: 1 pending, 1 drifted, 1 in sync.");
    expect(text).toContain(
      "- Pending: [app:prod](#user-content-sluiceway-app-3a-prod)\n- Drifted: [site:prod](#user-content-sluiceway-site-3a-prod)",
    );
  });

  test("a drifted stack has an entry of its own under Drifted, with every drift line", () => {
    expect(text).toContain(
      [
        "### Drifted",
        "",
        '#### <a id="sluiceway-site-3a-prod"></a>site:prod',
        "",
        "1 changed, 1 gone outside the code",
        "",
        "- <kbd>changed</kbd> <code>aws:s3/bucket:Bucket</code> <b>assets</b> · <code>tags.owner</code>",
        "- <kbd>gone</kbd> <code>local:index/file:File</code> <b>notes</b>",
      ].join("\n"),
    );
  });

  test("a pending stack with drift lists the drift after its changes", () => {
    expect(text).toContain(
      [
        "<details><summary>1 change</summary>",
        "",
        "- <kbd>update</kbd> <code>random:Pet</code> <b>pet</b> · <code>length</code>",
        "",
        "</details>",
        "",
        "1 gone outside the code:",
        "",
        "- <kbd>gone</kbd> <code>local:index/file:File</code> <b>notes</b>",
      ].join("\n"),
    );
  });

  test("a stack with nothing to deploy and no drift stays under In sync", () => {
    expect(text).toContain('### In sync\n\n- <a id="sluiceway-calm-3a-prod"></a>calm:prod');
  });
});

describe("the job log", () => {
  test("lists the drift after the changes, in Sluiceway's own words", () => {
    expect(diffLogLines(both)).toEqual([
      "1 update",
      "update random:Pet pet · length",
      "1 gone outside the code",
      "gone local:index/file:File notes",
    ]);
  });

  test("a stack with drift only has no changes and its drift", () => {
    expect(diffLogLines(onlyDrift)).toEqual([
      "no changes",
      "1 changed, 1 gone outside the code",
      "changed aws:s3/bucket:Bucket assets · tags.owner",
      "gone local:index/file:File notes",
    ]);
  });
});

describe("the summary of an apply", () => {
  test("a deploy that put drift back lists the drift under what went out", () => {
    const text = renderApplySummary({
      stackId: "site:prod",
      ticker: "alice",
      runUrl: "run-url",
      outcome: { kind: "deployed", diff: onlyDrift },
    });
    expect(text).toContain(
      [
        "### What went out",
        "",
        "1 changed, 1 gone outside the code:",
        "",
        "- <kbd>changed</kbd> <code>aws:s3/bucket:Bucket</code> <b>assets</b> · <code>tags.owner</code>",
        "- <kbd>gone</kbd> <code>local:index/file:File</code> <b>notes</b>",
      ].join("\n"),
    );
  });
});
