import { describe, expect, test } from "bun:test";
import type { OutsideDeploy } from "../../src/core/outside-deploy.ts";
import { type BodyInput, type RecentDeploy, renderBody, rowBlock } from "../../src/render/body.ts";

// Slice 5.10 (owner, 2026-09-22, on his real dashboard: the trail lines are
// too long and take two lines each). A line of the trail fits on one line at
// GitHub's issue width for a stack id of about 40 characters. The stack id is
// written whole, so the rest is short: a short result word or none, the
// ticker's login alone, the time without the year of the scan and without
// `UTC`, and the run link. The line under the heading says the times are UTC.

const REPO_URL = "https://github.com/example-org/infra";
const SHA = "59ff6e77e502bf395aae44f33ec3e94bc2897d02";
// 40 characters, the width the slice is measured against.
const LONG_ID = "workspaces/proxmox/platform/storage:prod";

function input(overrides: Partial<BodyInput> = {}): BodyInput {
  return {
    root: {
      scanSha: "8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c",
      scanRun: "17034455121",
      scanAt: "2026-09-22T14:30:00Z",
    },
    rows: [rowBlock({ state: "in-sync", stackId: "apps/auth:prod" })],
    recentlyDeployed: [],
    repoUrl: REPO_URL,
    actionRef: "v0.1.0",
    personality: true,
    ...overrides,
  };
}

function section(body: string): string[] {
  const all = body.split("\n\n");
  const at = all.indexOf("## Recently deployed");
  return at === -1 ? [] : all.slice(at + 1, at + 3);
}

const trail = (body: string): string[] => section(body)[1]?.split("\n") ?? [];

const deploy = (over: Partial<RecentDeploy> = {}): RecentDeploy => ({
  stackId: "workspaces/proxmox/core:prod",
  ticker: "robbeverhelst",
  at: new Date(Date.UTC(2026, 8, 22, 14, 16)),
  runUrl: `${REPO_URL}/actions/runs/1`,
  ...over,
});

const line = (over: Partial<RecentDeploy> = {}, overrides: Partial<BodyInput> = {}) =>
  trail(renderBody(input({ recentlyDeployed: [deploy(over)], ...overrides })))[0];

describe("a line of the trail", () => {
  test("a drift repair is the owner's target line", () => {
    expect(line({ result: "drift-repaired" })).toBe(
      `- 🟢&nbsp;workspaces/proxmox/core:prod · drift fixed · robbeverhelst · 09-22 14:16 · [run](${REPO_URL}/actions/runs/1)`,
    );
  });

  test("a plain deploy has no result word", () => {
    expect(line()).toBe(
      `- 🟢&nbsp;workspaces/proxmox/core:prod · robbeverhelst · 09-22 14:16 · [run](${REPO_URL}/actions/runs/1)`,
    );
  });

  test("an empty fresh preview says no changes", () => {
    expect(line({ result: "in-sync" })).toStartWith(
      "- ⚪&nbsp;workspaces/proxmox/core:prod · no changes · robbeverhelst · 09-22 14:16 · ",
    );
  });

  test("a drift repair with nothing left to deploy says drift gone, white like no changes", () => {
    expect(line({ result: "drift-gone" })).toStartWith(
      "- ⚪&nbsp;workspaces/proxmox/core:prod · drift gone · robbeverhelst · 09-22 14:16 · ",
    );
  });

  test("a rehearsal says rehearsed", () => {
    expect(line({ result: "rehearsed" })).toStartWith(
      "- 🟣&nbsp;workspaces/proxmox/core:prod · rehearsed · robbeverhelst · 09-22 14:16 · ",
    );
  });

  test("a failed deploy says failed, and its reason stays on the row's failure line", () => {
    expect(line({ result: "failed", reason: "the tool exited with an error" })).toBe(
      `- 🔴&nbsp;workspaces/proxmox/core:prod · failed · robbeverhelst · 09-22 14:16 · [run](${REPO_URL}/actions/runs/1)`,
    );
  });

  test("without a header the words are the same, with no dot", () => {
    expect(line({ result: "drift-repaired" }, { personality: false })).toBe(
      `- workspaces/proxmox/core:prod · drift fixed · robbeverhelst · 09-22 14:16 · [run](${REPO_URL}/actions/runs/1)`,
    );
  });

  test("the ticker is escaped like every other text", () => {
    expect(line({ ticker: "a*b" })).toContain(" · a&#42;b · ");
  });
});

describe("the time of a line", () => {
  test("keeps the year when it is not the year of the scan", () => {
    expect(line({ at: new Date(Date.UTC(2025, 11, 31, 23, 59)) })).toContain(
      " · robbeverhelst · 2025-12-31 23:59 · ",
    );
  });

  test("keeps the year when the scan time does not parse", () => {
    const body = renderBody(
      input({
        root: { scanSha: "8c41f0e", scanRun: "1", scanAt: "not a time" },
        recentlyDeployed: [deploy()],
      }),
    );
    expect(trail(body)[0]).toContain(" · robbeverhelst · 2026-09-22 14:16 · ");
  });

  test("never says UTC, the line under the heading does", () => {
    const body = renderBody(input({ recentlyDeployed: [deploy()] }));
    expect(section(body)[0]).toBe("Times are in UTC.");
    expect(trail(body).join("\n")).not.toContain("UTC");
  });
});

describe("a deploy made outside the dashboard", () => {
  const outside = (over: Partial<OutsideDeploy> = {}): OutsideDeploy => ({
    stackId: "network:dev",
    kind: "deploy",
    at: new Date(Date.UTC(2026, 9, 1, 18, 11, 10)),
    commit: SHA,
    ...over,
  });

  test("names its commit without the word commit, and its time the short way", () => {
    const [first] = trail(renderBody(input({ outsideDeploys: [outside()] })));
    expect(first).toStartWith(
      `- 🟢&nbsp;network:dev · deployed outside the dashboard, from [\`59ff6e7\`](${REPO_URL}/commit/${SHA}) · 10-01 18:11 <!-- sluiceway:outside `,
    );
  });

  test("keeps the year of another year", () => {
    const at = new Date(Date.UTC(2025, 0, 2, 3, 4));
    const [first] = trail(renderBody(input({ outsideDeploys: [outside({ at })] })));
    expect(first).toContain(" · 2025-01-02 03:04 <!-- sluiceway:outside ");
  });
});

// What a person sees of a line: the link texts, the non-breaking space as
// one space, no marker. GitHub's issue page gives a list item 846 pixels at a
// 1280 pixel wide window, about 110 characters of its font (7.7 pixels a
// character, measured). 105 leaves a little room for wider letters.
function visible(markdown: string): string {
  return markdown
    .replace(/ <!-- .* -->$/, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replaceAll("&nbsp;", " ")
    .replaceAll("`", "")
    .replace(/^- /, "");
}

describe("with a stack id of 40 characters", () => {
  test.each([
    ["a deploy", {}],
    ["a drift repair", { result: "drift-repaired" as const }],
    ["an empty fresh preview", { result: "in-sync" as const }],
    ["a drift repair with the drift gone", { result: "drift-gone" as const }],
    ["a rehearsal", { result: "rehearsed" as const }],
    ["a failed deploy", { result: "failed" as const, reason: "the tool exited with an error" }],
  ])("%s fits on one line", (_, over) => {
    const text = visible(line({ stackId: LONG_ID, ...over }) ?? "");
    expect(text).toContain(LONG_ID);
    expect(text.length).toBeLessThanOrEqual(105);
  });

  test.each([
    ["deploy", "deploy" as const],
    ["destroy", "destroy" as const],
  ])("an outside %s fits on one line", (_, kind) => {
    const [first] = trail(
      renderBody(
        input({
          outsideDeploys: [
            { stackId: LONG_ID, kind, at: new Date(Date.UTC(2026, 8, 22, 1, 2)), commit: SHA },
          ],
        }),
      ),
    );
    expect(visible(first ?? "").length).toBeLessThanOrEqual(105);
  });
});
