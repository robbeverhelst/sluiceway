import { describe, expect, test } from "bun:test";
import type { Change } from "../../src/core/diff.ts";
import {
  renderSummary,
  SUMMARY_BUDGET,
  type SummaryMerge,
  type SummaryStack,
} from "../../src/render/summary.ts";

const REPO_URL = "https://github.com/example-org/infra";

function change(op: Change["op"], type: string, name: string, rest: Partial<Change> = {}): Change {
  return { address: `${type}::${name}`, type, name, op, changedKeys: [], replaceKeys: [], ...rest };
}

// The diff of the worked example of record 0027, handed over out of order,
// with the pull requests and the direct push its attribution line names.
const BUCKETS: SummaryStack = {
  kind: "diff",
  diff: {
    stackId: "storage/buckets:prod",
    changes: [
      change("create", "aws:s3/bucketVersioning:BucketVersioning", "uploads"),
      change("replace", "aws:s3/bucket:Bucket", "uploads", {
        changedKeys: ["tags", "bucket"],
        replaceKeys: ["bucket"],
      }),
      change("none", "aws:s3/bucket:Bucket", "archive", {
        tracking: "move",
        previousAddress: "aws:s3/bucket:Bucket::old-archive",
      }),
      change("delete", "aws:s3/bucketPolicy:BucketPolicy", "uploads-public-read"),
      change("update", "aws:s3/bucketLifecycleConfiguration:BucketLifecycleConfiguration", "logs", {
        changedKeys: ["rules"],
      }),
    ],
  },
  merges: [
    {
      kind: "pull-request",
      number: 433,
      title: "Rename the uploads bucket",
      url: `${REPO_URL}/pull/433`,
      author: "alice",
    },
    {
      kind: "push",
      sha: "3fa9c1e2aabbccdd3fa9c1e2aabbccdd3fa9c1e2",
      message: "Fix the lifecycle rule",
      url: `${REPO_URL}/commit/3fa9c1e2aabbccdd3fa9c1e2aabbccdd3fa9c1e2`,
      author: "bob",
    },
  ],
};

describe("the summary of a scan", () => {
  test("one pending stack, in full", () => {
    expect(renderSummary([BUCKETS]).text).toBe(
      [
        "## Sluiceway scan",
        "",
        "1 stack previewed: 1 pending.",
        "",
        "### Pending",
        "",
        "#### storage/buckets:prod",
        "",
        "1 create, 1 update, **1 replace**, **1 delete**, 1 tracking only",
        "",
        "- :warning: <kbd>DELETE</kbd> <code>aws:s3/bucketPolicy:BucketPolicy</code> <b>uploads-public-read</b>",
        "- :warning: <kbd>REPLACE</kbd> <code>aws:s3/bucket:Bucket</code> <b>uploads</b> · forced by <code>bucket</code> · also changes <code>tags</code>",
        "",
        "<details><summary>3 other changes</summary>",
        "",
        "- <kbd>move</kbd> <code>aws:s3/bucket:Bucket</code> <b>archive</b>",
        "- <kbd>update</kbd> <code>aws:s3/bucketLifecycleConfiguration:BucketLifecycleConfiguration</code> <b>logs</b> · <code>rules</code>",
        "- <kbd>create</kbd> <code>aws:s3/bucketVersioning:BucketVersioning</code> <b>uploads</b>",
        "",
        "</details>",
        "",
        "From 1 pull request and 1 direct push:",
        "",
        "- [#433 Rename the uploads bucket](https://github.com/example-org/infra/pull/433) by alice",
        "- [3fa9c1e Fix the lifecycle rule](https://github.com/example-org/infra/commit/3fa9c1e2aabbccdd3fa9c1e2aabbccdd3fa9c1e2) by bob",
        "",
      ].join("\n"),
    );
  });

  function diff(stackId: string, changes: Change[], rest: object = {}): SummaryStack {
    return { kind: "diff", diff: { stackId, changes }, ...rest };
  }

  test("pending stacks, preview failures and stacks in sync, each sorted by stack id", () => {
    const { text } = renderSummary([
      diff("b:prod", []),
      {
        kind: "preview-failed",
        stackId: "z:prod",
        reason: "the preview timed out after 10 minutes",
      },
      diff("b:dev", [change("create", "t", "n")]),
      diff("a:prod", []),
      diff("B:dev", [change("update", "t", "n", { changedKeys: ["k"] })]),
      { kind: "preview-failed", stackId: "c:prod", reason: "the tool's output could not be read" },
    ]);

    expect(text).toBe(
      [
        "## Sluiceway scan",
        "",
        "6 stacks previewed: 2 pending, 2 preview failed, 2 in sync.",
        "",
        "### Pending",
        "",
        "#### B:dev",
        "",
        "1 update",
        "",
        "<details><summary>1 change</summary>",
        "",
        "- <kbd>update</kbd> <code>t</code> <b>n</b> · <code>k</code>",
        "",
        "</details>",
        "",
        "#### b:dev",
        "",
        "1 create",
        "",
        "<details><summary>1 change</summary>",
        "",
        "- <kbd>create</kbd> <code>t</code> <b>n</b>",
        "",
        "</details>",
        "",
        "### Preview failed",
        "",
        "- **c:prod** · the tool's output could not be read",
        "- **z:prod** · the preview timed out after 10 minutes",
        "",
        "### In sync",
        "",
        "- a:prod",
        "- b:prod",
        "",
      ].join("\n"),
    );
  });

  test("a scan that previewed nothing says so", () => {
    expect(renderSummary([]).text).toBe("## Sluiceway scan\n\nNo stacks previewed.\n");
  });

  test("text from outside is escaped, and a direct push shows the first line of its message", () => {
    const { text } = renderSummary([
      diff("a_b:prod", [change("create", "t", "n")], {
        merges: [
          {
            kind: "pull-request",
            number: 7,
            title: "Add [click](https://evil.example) <img src=x> *now*",
            url: `${REPO_URL}/pull/7`,
            author: "renovate[bot]",
          },
          {
            kind: "push",
            sha: "0123456789abcdef0123456789abcdef01234567",
            message: "Fix the thing\r\n\r\n- [x] **a:prod** fake row\n## Pending",
            url: `${REPO_URL}/commit/0123456`,
          },
        ],
      }),
      { kind: "preview-failed", stackId: "<b>:prod", reason: "made *up*" },
    ]);

    expect(text).toContain("#### a&#95;b:prod\n");
    expect(text).toContain(
      `- [#7 Add &#91;click&#93;(https://evil.example) &lt;img src=x&gt; &#42;now&#42;](${REPO_URL}/pull/7) by renovate&#91;bot&#93;\n`,
    );
    expect(text).toContain(`- [0123456 Fix the thing](${REPO_URL}/commit/0123456)\n`);
    expect(text).not.toContain("fake row");
    expect(text).toContain("- **&lt;b&gt;:prod** · made &#42;up&#42;\n");
  });

  test("several direct pushes and no pull request", () => {
    const push = (sha: string): SummaryMerge => ({
      kind: "push",
      sha,
      message: "Tidy up",
      url: `${REPO_URL}/commit/${sha}`,
    });
    const { text } = renderSummary([
      diff("a:prod", [change("create", "t", "n")], {
        merges: [push("aaaaaaa1"), push("bbbbbbb2")],
      }),
    ]);

    expect(text).toContain("From 2 direct pushes:\n\n- [aaaaaaa Tidy up]");
  });
});

const bytes = (text: string) => new TextEncoder().encode(text).length;

const merges = (count: number): SummaryMerge[] =>
  Array.from({ length: count }, (_, index) => ({
    kind: "pull-request" as const,
    number: 100 + index,
    title: `Pull request ${index}`,
    url: `${REPO_URL}/pull/${100 + index}`,
    author: "alice",
  }));

function stack(stackId: string, changes: Change[], mergeCount = 0): SummaryStack {
  return { kind: "diff", diff: { stackId, changes }, merges: merges(mergeCount) };
}

const creates = (count: number) =>
  Array.from({ length: count }, (_, index) => change("create", "t", `n${index}`));
const deletes = (count: number) =>
  Array.from({ length: count }, (_, index) => change("delete", "t", `d${index}`));

describe("the budget of the summary", () => {
  test("is 1,000,000 bytes (record 0037)", () => {
    expect(SUMMARY_BUDGET).toBe(1_000_000);
  });

  test("a summary that fits is not shortened and has no note", () => {
    const summary = renderSummary([BUCKETS]);

    expect(summary.shortened).toBe(0);
    expect(summary.fits).toBe(true);
    expect(summary.bytes).toBe(bytes(summary.text));
    expect(summary.text.startsWith("## Sluiceway scan\n")).toBe(true);
    expect(summary.text).not.toContain("shortened");
  });

  // One byte under what the text needs, so the smallest cut that fits is the
  // one that has to happen.
  const full = (stacks: SummaryStack[]) => renderSummary(stacks, { budget: Infinity });

  test("the list of pull requests is cut before any change line, biggest stack first", () => {
    const stacks = [
      stack("small:prod", creates(2), 8),
      stack("big:prod", [...deletes(1), ...creates(9)], 10),
    ];
    // Either list alone would pay for the note. The bigger stack gives way.
    const summary = renderSummary(stacks, { budget: full(stacks).bytes - 1 });

    expect(summary.fits).toBe(true);
    expect(summary.shortened).toBe(1);
    expect(summary.bytes).toBe(bytes(summary.text));
    expect(summary.text).toContain("From 10 pull requests, not listed here.\n");
    expect(summary.text).toContain("From 8 pull requests:\n\n- [#100 Pull request 0]");
    // Every change line of both stacks is still there.
    expect(summary.text.match(/<kbd>/g)?.length).toBe(12);
  });

  test("the note at the top says how many stacks are shortened and where nothing is cut", () => {
    const stacks = [stack("small:prod", creates(2), 2), stack("big:prod", creates(9), 3)];
    const one = renderSummary(stacks, { budget: full(stacks).bytes - 1 });
    // The note costs more than the bigger list saves, so the smaller one goes too.
    const both = renderSummary(stacks, { budget: full(stacks).bytes - 75 });

    expect(one.text.split("\n").slice(0, 3)).toEqual([
      "## Sluiceway scan",
      "",
      "> **This summary is shortened: 1 of 2 pending stacks shows less than its whole diff.** Every diff is in full in the job log of this run, in the group that has the stack id as its title. Deletes and replaces are cut last.",
    ]);
    expect(both.shortened).toBe(2);
    expect(both.text).toContain("2 of 2 pending stacks show less than their whole diff.**");
  });

  test("then the changes that destroy nothing become one line with their count", () => {
    const stacks = [
      stack("big:prod", [...deletes(2), ...creates(40)], 1),
      stack("plain:prod", creates(30), 1),
      stack("small:prod", creates(2), 1),
    ];
    // Both big stacks have to lose their fold, and the small one keeps its own.
    const summary = renderSummary(stacks, { budget: full(stacks).bytes - 2500 });

    expect(summary.fits).toBe(true);
    expect(summary.text).toContain(
      [
        "#### big:prod",
        "",
        "40 creates, **2 deletes**",
        "",
        "- :warning: <kbd>DELETE</kbd> <code>t</code> <b>d0</b>",
        "- :warning: <kbd>DELETE</kbd> <code>t</code> <b>d1</b>",
        "",
        "40 other changes not listed here, see the job log.",
        "",
        "From 1 pull request, not listed here.",
        "",
      ].join("\n"),
    );
    expect(summary.text).toContain("30 changes not listed here, see the job log.\n");
    expect(summary.text).toContain("<details><summary>2 changes</summary>");
    expect(summary.shortened).toBe(2);
  });

  test("destroys are cut last, all or none, and the warning carries the full count", () => {
    const stacks = [
      stack("teardown:prod", [
        ...deletes(60),
        change("replace", "t", "r", { changedKeys: ["k"], replaceKeys: ["k"] }),
        ...creates(3),
      ]),
      stack("plain:prod", creates(50)),
    ];
    // More than both folds hold, so the delete lines have to go as well.
    const summary = renderSummary(stacks, { budget: full(stacks).bytes - 3500 });

    expect(summary.fits).toBe(true);
    expect(summary.text).toContain(
      [
        "#### teardown:prod",
        "",
        "3 creates, **1 replace**, **60 deletes**",
        "",
        ":warning: **deletes 60, replaces 1, too many to list here.** Read the job log before you tick.",
        "",
      ].join("\n"),
    );
    expect(summary.text).not.toContain("<kbd>DELETE</kbd>");
    expect(summary.text).not.toContain("<kbd>REPLACE</kbd>");
  });

  test("once the biggest stack gave way, the small stacks get back what fits", () => {
    const small = ["a", "b", "c", "d"].map((name) => stack(`${name}:prod`, creates(2), 3));
    const stacks = [...small, stack("huge:prod", creates(300), 1)];
    // Every list of pull requests together is not enough, the fold of the huge
    // stack alone is far more than enough.
    const summary = renderSummary(stacks, { budget: full(stacks).bytes - 2000 });

    expect(summary.fits).toBe(true);
    expect(summary.shortened).toBe(1);
    expect(summary.text).toContain("300 changes not listed here, see the job log.\n");
    expect(summary.text.match(/From 3 pull requests:\n/g)?.length).toBe(4);
  });

  test("ties are broken by stack id, so the order of the input does not matter", () => {
    const a = stack("a:prod", creates(3), 6);
    const b = stack("b:prod", creates(3), 6);
    const budget = full([a, b]).bytes - 1;
    const summary = renderSummary([b, a], { budget });

    expect(summary.shortened).toBe(1);
    expect(summary.text).toContain("#### b:prod\n\n3 creates\n\n<details>");
    expect(summary.text.indexOf("not listed here")).toBeLessThan(
      summary.text.indexOf("#### b:prod"),
    );
    expect(renderSummary([a, b], { budget }).text).toBe(summary.text);
  });

  test("the budget is counted in UTF-8 bytes on the final text, not in characters", () => {
    const wide = (index: number) =>
      stack(
        `wide-${String(index).padStart(2, "0")}:prod`,
        Array.from({ length: 100 }, (_, n) => change("create", "t", `${"\u00fc".repeat(100)}${n}`)),
      );
    const stacks = Array.from({ length: 45 }, (_, index) => wide(index));
    const whole = full(stacks);
    const summary = renderSummary(stacks);

    expect(whole.text.length).toBeLessThan(SUMMARY_BUDGET);
    expect(whole.bytes).toBeGreaterThan(SUMMARY_BUDGET);
    expect(summary.fits).toBe(true);
    expect(summary.shortened).toBeGreaterThan(0);
    expect(summary.bytes).toBe(bytes(summary.text));
    expect(summary.bytes).toBeLessThanOrEqual(SUMMARY_BUDGET);
    // As little as possible is cut: one more stack in full would not fit.
    expect(summary.bytes).toBeGreaterThan(SUMMARY_BUDGET - 25_000);
  });

  test("a summary that cannot fit says so, with every stack cut as far as it goes", () => {
    const stacks = [
      stack("a:prod", [...deletes(3), ...creates(3)], 2),
      stack("b:prod", creates(3)),
    ];
    const summary = renderSummary(stacks, { budget: 100 });

    expect(summary.fits).toBe(false);
    expect(summary.shortened).toBe(2);
    expect(summary.text).not.toContain("<kbd>");
    expect(summary.text).toContain("**deletes 3, too many to list here.**");
  });
});
