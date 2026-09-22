import { describe, expect, test } from "bun:test";
import { renderBody } from "../../src/render/body.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import {
  clearMergeTick,
  MERGE_DEPLOYING_NOTE,
  MERGE_DEPLOYS_OFF_NOTE,
  MERGE_FOLD_AFTER,
  MERGE_ORPHAN_NOTE,
  mergeBlock,
  renderMergeRow,
  tickedMergeBlock,
} from "../../src/render/merge-row.ts";

const HEAD = "0123456789abcdef0123456789abcdef01234567";

const UPDATE = {
  pr: 418,
  stackId: "apps/odoo:prod",
  head: HEAD,
  title: "Update Helm release odoo to v17.0.4",
  author: "renovate[bot]",
};

describe("a merge row", () => {
  test("names the stack, the bump from the title and the pull request, with a box", () => {
    expect(renderMergeRow(UPDATE)).toBe(
      `- [ ] **apps/odoo:prod** · Update Helm release odoo to v17.0.4 · #418 by renovate&#91;bot&#93; <!-- sluiceway:merge pr="418" stack="apps/odoo:prod" head="${HEAD}" -->`,
    );
  });

  test("escapes the title, which is text from outside, and keeps it on one line", () => {
    const row = renderMergeRow({ ...UPDATE, title: "Update *all* <deps>\n- [x] sneaky" });
    expect(row.split("\n")).toHaveLength(1);
    expect(row).toContain("Update &#42;all&#42; &lt;deps&gt; - &#91;x&#93; sneaky");
  });

  test("shortens a long title to 80 characters", () => {
    const row = renderMergeRow({ ...UPDATE, title: "a".repeat(200) });
    expect(row).toContain(` · ${"a".repeat(77)}... · #418`);
  });

  test("leaves the title out when redact is on, and keeps the marker", () => {
    expect(renderMergeRow(UPDATE, { redact: true })).toBe(
      `- [ ] **apps/odoo:prod** · #418 by renovate&#91;bot&#93; <!-- sluiceway:merge pr="418" stack="apps/odoo:prod" head="${HEAD}" -->`,
    );
  });

  test("reads back as a merge block with its facts", () => {
    const block = mergeBlock(UPDATE);
    expect(block).toEqual({
      pr: 418,
      stackId: "apps/odoo:prod",
      head: HEAD,
      ticked: false,
      text: renderMergeRow(UPDATE),
    });
  });

  test("a ticked one is read as ticked, and is not a row of a stack", () => {
    const parsed = parseDashboard(renderMergeRow(UPDATE).replace("- [ ] ", "- [x] "));
    expect(parsed.merges.map(({ pr, ticked }) => [pr, ticked])).toEqual([[418, true]]);
    expect(parsed.rows).toEqual([]);
  });

  test("a marker without a pull request number, a stack or a whole commit id is not read", () => {
    const lines = [
      `- [x] a <!-- sluiceway:merge stack="a" head="${HEAD}" -->`,
      `- [x] b <!-- sluiceway:merge pr="x1" stack="b" head="${HEAD}" -->`,
      `- [x] c <!-- sluiceway:merge pr="3" head="${HEAD}" -->`,
      `- [x] d <!-- sluiceway:merge pr="4" stack="d" head="abc" -->`,
    ];
    expect(parseDashboard(lines.join("\n")).merges).toEqual([]);
  });

  test("clearing its tick changes the box and nothing else", () => {
    const ticked = parseDashboard(renderMergeRow(UPDATE).replace("- [ ] ", "- [x] ")).merges[0];
    if (!ticked) throw new Error("no merge row");
    expect(clearMergeTick(ticked)).toEqual(mergeBlock(UPDATE));
  });
});

describe("a merge row whose tick was cleared without a comment (slice 4.13)", () => {
  function ticked() {
    const row = parseDashboard(renderMergeRow(UPDATE).replace("- [ ] ", "- [x] ")).merges[0];
    if (!row) throw new Error("no merge row");
    return row;
  }

  test("gets the note under its line, and reads back as one row, not ticked", () => {
    for (const [note, text] of [
      ["orphan", MERGE_ORPHAN_NOTE],
      ["deploying", MERGE_DEPLOYING_NOTE],
      ["deploys-off", MERGE_DEPLOYS_OFF_NOTE],
    ] as const) {
      const cleared = clearMergeTick(ticked(), { note });
      expect(cleared.text).toBe(`${mergeBlock(UPDATE).text}\n  ${text}`);
      expect(parseDashboard(cleared.text).merges).toEqual([cleared]);
      expect(cleared.ticked).toBe(false);
    }
  });

  test("the notes are fixed words that say why nothing was merged", () => {
    expect(MERGE_ORPHAN_NOTE).toBe(
      ":information_source: a tick on this row was not picked up. Tick again to merge.",
    );
    expect(MERGE_DEPLOYING_NOTE).toBe(
      ":information_source: this tick merged nothing: the stack has a deploy in progress. Tick again once it is over.",
    );
    expect(MERGE_DEPLOYS_OFF_NOTE).toBe(
      ":information_source: deploys are turned off in `sluiceway.yaml`, so this tick merged nothing.",
    );
  });

  test("a second clear keeps one note, and a tick on a row with a note keeps it", () => {
    const once = clearMergeTick(ticked(), { note: "orphan" });
    const again = tickedMergeBlock(once);
    expect(again.ticked).toBe(true);
    expect(again.text.split("\n")).toHaveLength(2);
    expect(clearMergeTick(again, { note: "orphan" }).text).toBe(once.text);
    expect(clearMergeTick(again, { note: "deploying" }).text).toBe(
      `${mergeBlock(UPDATE).text}\n  ${MERGE_DEPLOYING_NOTE}`,
    );
  });

  test("a body carries the note through a writer that reads it back", () => {
    const base = {
      root: { scanSha: HEAD, scanRun: "7", scanAt: "2026-09-22T08:00:00.000Z" },
      rows: [],
      recentlyDeployed: [],
      repoUrl: "https://github.com/acme/infra",
      actionRef: "v0.4.0",
      personality: false,
    };
    const body = renderBody({ ...base, merges: [clearMergeTick(ticked(), { note: "orphan" })] });
    expect(body).toContain(`${mergeBlock(UPDATE).text}\n  ${MERGE_ORPHAN_NOTE}`);
    expect(renderBody({ ...base, merges: parseDashboard(body).merges })).toBe(body);
  });
});

describe("the section in the body", () => {
  const base = {
    root: { scanSha: HEAD, scanRun: "7", scanAt: "2026-09-22T08:00:00.000Z" },
    rows: [],
    recentlyDeployed: [],
    repoUrl: "https://github.com/acme/infra",
    actionRef: "v0.4.0",
    personality: false,
  };

  test("sits above Pending, oldest pull request first", () => {
    const body = renderBody({
      ...base,
      merges: [mergeBlock({ ...UPDATE, pr: 420 }), mergeBlock(UPDATE)],
    });
    const section = body.slice(
      body.indexOf("## Updates waiting to merge"),
      body.indexOf("## Pending"),
    );
    expect(section).toBe(
      [
        "## Updates waiting to merge",
        "Tick a box to merge that pull request. Its stack is then previewed again and deployed as that preview shows it.",
        [mergeBlock(UPDATE).text, mergeBlock({ ...UPDATE, pr: 420 }).text].join("\n"),
        "",
      ].join("\n\n"),
    );
  });

  test("is left out when nothing waits", () => {
    expect(renderBody({ ...base, merges: [] })).not.toContain("Updates waiting to merge");
    expect(renderBody(base)).not.toContain("Updates waiting to merge");
  });

  test("folds the updates after the first ten (slice 4.13)", () => {
    expect(MERGE_FOLD_AFTER).toBe(10);
    const merges = Array.from({ length: 11 }, (_, index) =>
      mergeBlock({ ...UPDATE, pr: 401 + index }),
    );
    const body = renderBody({ ...base, merges });
    const section = body.slice(
      body.indexOf("## Updates waiting to merge"),
      body.indexOf("## Pending"),
    );
    expect(section).toBe(
      [
        "## Updates waiting to merge",
        "Tick a box to merge that pull request. Its stack is then previewed again and deployed as that preview shows it.",
        merges
          .slice(0, 10)
          .map((merge) => merge.text)
          .join("\n"),
        "<details><summary>1 more update waiting to merge</summary>",
        merges[10]?.text,
        "</details>",
        "",
      ].join("\n\n"),
    );
    // A tick in the fold is read as any other.
    const ticked = body.replace(
      "- [ ] **apps/odoo:prod** · Update Helm release odoo to v17.0.4 · #411",
      "- [x] **apps/odoo:prod** · Update Helm release odoo to v17.0.4 · #411",
    );
    expect(parseDashboard(ticked).merges.find((merge) => merge.pr === 411)?.ticked).toBe(true);
    expect(renderBody({ ...base, merges: parseDashboard(body).merges })).toBe(body);
  });

  test("shows ten without a fold, and names the count in the fold's title", () => {
    const ten = Array.from({ length: 10 }, (_, index) =>
      mergeBlock({ ...UPDATE, pr: 401 + index }),
    );
    expect(renderBody({ ...base, merges: ten })).not.toContain("<details><summary>");
    const fifteen = Array.from({ length: 15 }, (_, index) =>
      mergeBlock({ ...UPDATE, pr: 401 + index }),
    );
    expect(renderBody({ ...base, merges: fifteen })).toContain(
      "<details><summary>5 more updates waiting to merge</summary>",
    );
  });

  test("is carried by a writer that reads it back from the live body", () => {
    const body = renderBody({ ...base, merges: [mergeBlock(UPDATE)] });
    expect(renderBody({ ...base, merges: parseDashboard(body).merges })).toBe(body);
  });
});

test("a whole body with updates waiting to merge under the header", () => {
  const body = renderBody({
    root: { scanSha: HEAD, scanRun: "7", scanAt: "2026-09-22T08:00:00.000Z" },
    rows: [],
    recentlyDeployed: [],
    repoUrl: "https://github.com/acme/infra",
    actionRef: "v0.4.0",
    personality: true,
    merges: [
      mergeBlock(UPDATE),
      mergeBlock({
        ...UPDATE,
        pr: 421,
        stackId: "network:prod",
        title: "Update dependency @pulumi/aws to v7.9.0",
      }),
    ],
  });
  expect(body).toMatchSnapshot();
});
