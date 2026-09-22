// Record 0050: the preview page of a pending stack is a check run on the
// scanned commit, and its output is Sluiceway's own diff of that stack. It
// shows what a row shows, with every path whole, and never a value.

import { describe, expect, test } from "bun:test";
import type { Change, Diff } from "../../src/core/diff.ts";
import {
  PREVIEW_PAGE_FIELD_LIMIT,
  type PreviewPageLinks,
  previewPageName,
  renderPreviewPage,
} from "../../src/render/preview-page.ts";

const REPO_URL = "https://github.com/example-org/infra";
const LINKS: PreviewPageLinks = {
  dashboard: `${REPO_URL}/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22sluiceway%22`,
  summary: `${REPO_URL}/actions/runs/4242/attempts/1`,
  log: `${REPO_URL}/actions/runs/4242/job/106502264185`,
};

function change(op: Change["op"], type: string, name: string, rest: Partial<Change> = {}): Change {
  return { address: `${type}::${name}`, type, name, op, changedKeys: [], replaceKeys: [], ...rest };
}

// The diff of the worked example of record 0027, handed over out of order.
const BUCKETS: Diff = {
  stackId: "storage/buckets:prod",
  changes: [
    change("create", "aws:s3/bucketVersioning:BucketVersioning", "uploads"),
    change("replace", "aws:s3/bucket:Bucket", "uploads", {
      changedKeys: ["tags", "bucket"],
      replaceKeys: ["bucket"],
    }),
    change("delete", "aws:s3/bucketPolicy:BucketPolicy", "uploads-public-read"),
    change("update", "kubernetes:helm.sh/v3:Release", "arc", {
      changedKeys: ["values.controller.image.tag", 'values.labels["app.kubernetes.io/name"]'],
    }),
  ],
};

const ENCODER = new TextEncoder();

function bytes(text: string): number {
  return ENCODER.encode(text).length;
}

describe("the name of a preview page", () => {
  test("is sluiceway, a slash and the stack id, so the next scan finds it again", () => {
    expect(previewPageName("storage/buckets:prod")).toBe("sluiceway / storage/buckets:prod");
  });
});

describe("the output of a preview page", () => {
  test("the title names the stack and its counts, in plain text", () => {
    expect(renderPreviewPage(BUCKETS, LINKS).title).toBe(
      "storage/buckets:prod: 1 create, 1 update, 1 replace, 1 delete",
    );
  });

  test("the summary has the counts, the destroy warning and the links", () => {
    expect(renderPreviewPage(BUCKETS, LINKS).summary).toBe(
      [
        "**storage/buckets:prod** · 1 create, 1 update, **1 replace**, **1 delete**",
        ":warning: **This deploy deletes 1, replaces 1.**",
        "Sluiceway's own diff of this stack: what a deploy would change, never what it changes to. It is the diff the stack's row on the [dashboard](https://github.com/example-org/infra/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22sluiceway%22) shows, with every property path whole.",
        "Every stack this scan previewed is in the [summary](https://github.com/example-org/infra/actions/runs/4242/attempts/1) of the scan, and the tool's own words are in the [job log](https://github.com/example-org/infra/actions/runs/4242/job/106502264185), in the group <code>storage/buckets:prod</code>.",
      ].join("\n\n"),
    );
  });

  test("the text lists every change, destroys first, with every path whole", () => {
    expect(renderPreviewPage(BUCKETS, LINKS).text).toBe(
      [
        "- :warning: <kbd>DELETE</kbd> <code>aws:s3/bucketPolicy:BucketPolicy</code> <b>uploads-public-read</b>",
        "- :warning: <kbd>REPLACE</kbd> <code>aws:s3/bucket:Bucket</code> <b>uploads</b> · forced by <code>bucket</code> · also changes <code>tags</code>",
        "- <kbd>create</kbd> <code>aws:s3/bucketVersioning:BucketVersioning</code> <b>uploads</b>",
        "- <kbd>update</kbd> <code>kubernetes:helm.sh/v3:Release</code> <b>arc</b> · <code>values.controller.image.tag</code>, <code>values.labels&#91;&quot;app.kubernetes.io/name&quot;&#93;</code>",
        "",
      ].join("\n"),
    );
  });

  test("a stack without destroys gets no warning", () => {
    const diff: Diff = { stackId: "app:prod", changes: [change("update", "t", "n")] };
    expect(renderPreviewPage(diff, LINKS).summary).not.toContain(":warning:");
  });

  test("with the tool's own diff in the job log, the summary says where it is", () => {
    expect(renderPreviewPage(BUCKETS, LINKS, { toolDiffInLog: true }).summary).toEndWith(
      "The tool's own diff of this stack, values included, is in the [job log](https://github.com/example-org/infra/actions/runs/4242/job/106502264185), in the group <code>storage/buckets:prod</code>. It is not on this page.",
    );
  });

  test("without the job's id the job log is named and not linked", () => {
    const { summary } = renderPreviewPage(BUCKETS, { ...LINKS, log: undefined });
    expect(summary).toContain("the tool's own words are in the job log of the scan");
    expect(summary).not.toContain("[job log]");
  });

  test("a name from outside is never markup", () => {
    const diff: Diff = {
      stackId: "a<b>:c",
      changes: [change("update", "t", "<img src=x>", { changedKeys: ["*x*"] })],
    };
    const page = renderPreviewPage(diff, LINKS);
    expect(page.summary + page.text).not.toContain("<img");
    expect(page.summary).toContain("**a&lt;b&gt;:c**");
    expect(page.text).toContain("<code>&#42;x&#42;</code>");
  });
});

// GitHub refuses a summary or a text over 65,535 characters, a summary over
// 65,535 bytes too, and cuts a text over 65,535 bytes silently (research,
// preview-page.md). So the text is cut here, on a line, with a pointer.
describe("the limit of a field", () => {
  test("is 65,535", () => {
    expect(PREVIEW_PAGE_FIELD_LIMIT).toBe(65_535);
  });

  // A diff whose text is exactly `size` bytes: many small updates, and the
  // name of the last one padded to reach it.
  function sized(size: number, pad = "a"): Diff {
    const changes = Array.from({ length: 600 }, (_, i) =>
      change("update", "aws:s3/bucket:Bucket", `bucket-${String(i).padStart(3, "0")}`, {
        changedKeys: ["tags"],
      }),
    );
    const base: Diff = { stackId: "app:prod", changes };
    const length = bytes(renderPreviewPage(base, LINKS, { limit: Infinity }).text);
    const last = changes.at(-1) as Change;
    const room = size - length;
    const padding = pad.repeat(Math.floor(room / bytes(pad)));
    changes[changes.length - 1] = { ...last, name: `${last.name}${padding}` };
    return base;
  }

  test("a text of exactly 65,535 bytes is sent whole", () => {
    const diff = sized(PREVIEW_PAGE_FIELD_LIMIT);
    const page = renderPreviewPage(diff, LINKS);
    expect(bytes(page.text)).toBe(PREVIEW_PAGE_FIELD_LIMIT);
    expect(page.unlisted).toBe(0);
    expect(page.text).not.toContain("not listed here");
  });

  test("one byte more is cut on a line, with a pointer to the summary and the job log", () => {
    const diff = sized(PREVIEW_PAGE_FIELD_LIMIT + 1);
    const page = renderPreviewPage(diff, LINKS);
    expect(bytes(page.text)).toBeLessThanOrEqual(PREVIEW_PAGE_FIELD_LIMIT);
    expect(page.unlisted).toBeGreaterThan(0);
    const lines = page.text.trimEnd().split("\n");
    // Every line but the pointer is a whole change line.
    for (const line of lines.slice(0, -2)) expect(line).toStartWith("- <kbd>update</kbd>");
    expect(lines.at(-1)).toBe(
      `**${page.unlisted} more ${page.unlisted === 1 ? "change is" : "changes are"} not listed here**: a preview page holds at most 65,535 bytes. Every change is in the [job log](${LINKS.log}), in the group <code>app:prod</code>, and in the [summary](${LINKS.summary}) of the scan when it fits there.`,
    );
    expect(lines.length - 2 + page.unlisted).toBe(600);
  });

  test("a text of characters that take more than one byte stays inside the limit of both", () => {
    const diff = sized(3 * PREVIEW_PAGE_FIELD_LIMIT, "é");
    const page = renderPreviewPage(diff, LINKS);
    expect(bytes(page.text)).toBeLessThanOrEqual(PREVIEW_PAGE_FIELD_LIMIT);
    expect(page.text.length).toBeLessThanOrEqual(PREVIEW_PAGE_FIELD_LIMIT);
    expect(page.unlisted).toBeGreaterThan(0);
  });

  test("destroys are listed first, so they are cut last", () => {
    const changes = [
      ...Array.from({ length: 2000 }, (_, i) =>
        change("update", "aws:s3/bucket:Bucket", `bucket-${i}`, { changedKeys: ["tags"] }),
      ),
      change("delete", "aws:s3/bucket:Bucket", "precious"),
    ];
    const page = renderPreviewPage({ stackId: "app:prod", changes }, LINKS);
    expect(page.unlisted).toBeGreaterThan(0);
    expect(page.text.split("\n")[0]).toContain("<b>precious</b>");
  });
});

// Slice 4.7 (record 0059): drift is listed on the page like a pending row's
// changes, and a drifted stack, with nothing to deploy from its code, gets a
// page of its own.
describe("a preview page with drift", () => {
  const gone = change("delete", "local:index/file:File", "notes");
  const changed = change("update", "aws:s3/bucket:Bucket", "logs", { changedKeys: ["tags.owner"] });

  test("of a drifted stack lists what changed outside the code, with every path whole", () => {
    const page = renderPreviewPage(
      { stackId: "network:dev", changes: [], drift: [gone, changed] },
      LINKS,
    );
    expect(page.title).toBe("network:dev: 1 changed, 1 gone outside the code");
    expect(page.summary).toBe(
      [
        "**network:dev** · 1 changed, 1 gone outside the code",
        "Sluiceway's own list of what changed in real infrastructure outside the code, never what it changed to. The code has nothing to deploy, and a deploy puts these back as the code says. It is the drift the stack's row on the [dashboard](https://github.com/example-org/infra/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22sluiceway%22) shows, with every property path whole.",
        "Every stack this scan previewed is in the [summary](https://github.com/example-org/infra/actions/runs/4242/attempts/1) of the scan, and the tool's own words are in the [job log](https://github.com/example-org/infra/actions/runs/4242/job/106502264185), in the group <code>network:dev</code>.",
      ].join("\n\n"),
    );
    expect(page.text).toBe(
      [
        "- <kbd>changed</kbd> <code>aws:s3/bucket:Bucket</code> <b>logs</b> · <code>tags.owner</code>",
        "- <kbd>gone</kbd> <code>local:index/file:File</code> <b>notes</b>",
        "",
      ].join("\n"),
    );
  });

  test("of a pending stack lists the drift after the changes, and says a deploy puts it back", () => {
    const page = renderPreviewPage({ ...BUCKETS, drift: [gone] }, LINKS);
    expect(page.title).toBe(
      "storage/buckets:prod: 1 create, 1 update, 1 replace, 1 delete, 1 gone outside the code",
    );
    expect(page.summary.split("\n\n").slice(0, 3)).toEqual([
      "**storage/buckets:prod** · 1 create, 1 update, **1 replace**, **1 delete** · 1 gone outside the code",
      ":warning: **This deploy deletes 1, replaces 1.**",
      "Sluiceway's own diff of this stack: what a deploy would change, never what it changes to. It is the diff the stack's row on the [dashboard](https://github.com/example-org/infra/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22sluiceway%22) shows, with every property path whole. The deploy also puts back what changed outside the code, listed last.",
    ]);
    expect(page.text.split("\n").at(-2)).toBe(
      "- <kbd>gone</kbd> <code>local:index/file:File</code> <b>notes</b>",
    );
  });
});
