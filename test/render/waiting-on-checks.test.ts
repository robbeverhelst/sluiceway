import { describe, expect, test } from "bun:test";
import { renderBody } from "../../src/render/body.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { mergeBlock } from "../../src/render/merge-row.ts";
import { renderWaitingLine, waitingBlock } from "../../src/render/waiting-line.ts";

// Slice 5.17, record 0081: a pull request that qualifies in every way but its
// checks, which have not all finished, gets a line with no box under the merge
// section.

const HEAD = "0123456789abcdef0123456789abcdef01234567";

const WAITING = {
  pr: 1137,
  stackIds: ["apps/odoo:prod"],
  title: "Update Helm release odoo to v17.0.4",
  author: "renovate[bot]",
};

const UPDATE = { ...WAITING, pr: 418, head: HEAD };

describe("a line of an update waiting on its checks", () => {
  test("names the stack, the title and the pull request with its author, says it waits, and has no box", () => {
    expect(renderWaitingLine(WAITING)).toBe(
      '- **apps/odoo:prod** · Update Helm release odoo to v17.0.4 · #1137 by renovate&#91;bot&#93; · waits on its checks <!-- sluiceway:waiting pr="1137" stack="apps/odoo:prod" -->',
    );
  });

  test("names every stack of a pull request that several stacks claim", () => {
    expect(
      renderWaitingLine({ ...WAITING, stackIds: ["apps/api:prod", "apps/odoo:prod"] }),
    ).toStartWith("- **apps/api:prod**, **apps/odoo:prod** · ");
  });

  test("escapes the title, keeps it on one line and shortens it, as a merge row does", () => {
    const line = renderWaitingLine({
      ...WAITING,
      title: `Update *all* <deps>\n- [x] ${"a".repeat(200)}`,
    });
    expect(line.split("\n")).toHaveLength(1);
    expect(line).toContain("Update &#42;all&#42; &lt;deps&gt; - &#91;x&#93; aaa");
    expect(line).toContain("... · #1137");
  });

  test("leaves the title out when redact is on", () => {
    expect(renderWaitingLine(WAITING, { redact: true })).toBe(
      '- **apps/odoo:prod** · #1137 by renovate&#91;bot&#93; · waits on its checks <!-- sluiceway:waiting pr="1137" stack="apps/odoo:prod" -->',
    );
  });

  test("reads back as a waiting line, and never as a merge row that could be ticked", () => {
    const text = renderWaitingLine(WAITING);
    expect(waitingBlock(WAITING)).toEqual({ pr: 1137, stackIds: ["apps/odoo:prod"], text });
    const boxed = text.replace("- **", "- [x] **");
    expect(parseDashboard(boxed).merges).toEqual([]);
  });
});

describe("the merge section with updates waiting on their checks", () => {
  const base = {
    root: { scanSha: HEAD, scanRun: "7", scanAt: "2026-09-22T08:00:00.000Z" },
    rows: [],
    recentlyDeployed: [],
    repoUrl: "https://github.com/acme/infra",
    actionRef: "v0.4.0",
    personality: false,
  };
  const section = (body: string) =>
    body.slice(body.indexOf("## Updates waiting to merge"), body.indexOf("## Pending"));

  test("shows the section for waiting lines alone, with a line that says no box comes yet", () => {
    const body = renderBody({ ...base, waiting: [waitingBlock(WAITING)] });
    expect(section(body)).toBe(
      [
        "## Updates waiting to merge",
        "These wait on their own checks. Each gets a box here once its checks are green.",
        waitingBlock(WAITING).text,
        "",
      ].join("\n\n"),
    );
  });

  test("puts them under the updates waiting to merge, oldest first, outside the fold", () => {
    const merges = Array.from({ length: 11 }, (_, index) =>
      mergeBlock({ ...UPDATE, pr: 401 + index }),
    );
    const body = renderBody({
      ...base,
      merges,
      waiting: [waitingBlock({ ...WAITING, pr: 1140 }), waitingBlock(WAITING)],
    });
    expect(section(body)).toBe(
      [
        "## Updates waiting to merge",
        "Tick a box to merge that pull request. Its stack is then previewed again and deployed as that preview shows it.",
        merges
          .slice(0, 10)
          .map((merge) => merge.text)
          .join("\n"),
        // The fold counts the updates that can be merged, and only those.
        "<details><summary>1 more update waiting to merge</summary>",
        merges[10]?.text,
        "</details>",
        "These wait on their own checks. Each gets a box here once its checks are green.",
        [waitingBlock(WAITING).text, waitingBlock({ ...WAITING, pr: 1140 }).text].join("\n"),
        "",
      ].join("\n\n"),
    );
  });

  test("never shows a pull request twice: a merge row wins over a waiting line", () => {
    const body = renderBody({
      ...base,
      merges: [mergeBlock({ ...UPDATE, pr: 1137 })],
      waiting: [waitingBlock(WAITING), waitingBlock(WAITING)],
    });
    expect(body).not.toContain("sluiceway:waiting");
    expect(body).not.toContain("These wait on their own checks");
  });

  test("is left out when nothing waits at all", () => {
    expect(renderBody({ ...base, merges: [], waiting: [] })).not.toContain(
      "## Updates waiting to merge",
    );
  });

  test("is carried by a writer that reads it back from the live body", () => {
    const body = renderBody({
      ...base,
      merges: [mergeBlock(UPDATE)],
      waiting: [waitingBlock(WAITING)],
    });
    const live = parseDashboard(body);
    expect(live.waiting.map(({ pr }) => pr)).toEqual([1137]);
    expect(renderBody({ ...base, merges: live.merges, waiting: live.waiting })).toBe(body);
  });
});
