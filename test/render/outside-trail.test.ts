import { describe, expect, test } from "bun:test";
import type { OutsideDeploy } from "../../src/core/outside-deploy.ts";
import { type BodyInput, type RecentDeploy, renderBody, rowBlock } from "../../src/render/body.ts";
import { parseDashboard } from "../../src/render/marker.ts";

// Slice 5.6 (record 0073): a deploy made outside the dashboard is a line of
// the trail, with when and from which commit, and never who. Its facts ride
// on a marker at the end of the line, so every writer carries it.

const REPO_URL = "https://github.com/example-org/infra";
const SHA = "59ff6e77e502bf395aae44f33ec3e94bc2897d02";

function input(overrides: Partial<BodyInput> = {}): BodyInput {
  return {
    root: {
      scanSha: "8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c",
      scanRun: "17034455121",
      scanAt: "2026-09-21T10:02:41Z",
    },
    rows: [rowBlock({ state: "in-sync", stackId: "network:dev" })],
    recentlyDeployed: [],
    repoUrl: REPO_URL,
    actionRef: "v0.1.0",
    personality: false,
    ...overrides,
  };
}

function trail(body: string): string[] {
  const all = body.split("\n\n");
  const at = all.indexOf("## Recently deployed");
  return at === -1 ? [] : (all[at + 2]?.split("\n") ?? []);
}

const outside = (day: number, over: Partial<OutsideDeploy> = {}): OutsideDeploy => ({
  stackId: "network:dev",
  kind: "deploy",
  at: new Date(Date.UTC(2026, 8, day, 18, 11, 10)),
  commit: SHA,
  ...over,
});

const own = (day: number): RecentDeploy => ({
  stackId: "network:dev",
  ticker: "alice",
  at: new Date(Date.UTC(2026, 8, day, 9, 41)),
  runUrl: `${REPO_URL}/actions/runs/${day}`,
});

describe("a deploy made outside the dashboard", () => {
  test("says so, links the commit, and carries its facts in a marker", () => {
    const body = renderBody(input({ outsideDeploys: [outside(21)] }));
    expect(trail(body)).toEqual([
      `- network:dev · deployed outside the dashboard, from [\`59ff6e7\`](${REPO_URL}/commit/${SHA}) · 09-21 18:11 <!-- sluiceway:outside stack="network:dev" kind="deploy" at="2026-09-21T18:11:10.000Z" commit="${SHA}" -->`,
    ]);
  });

  test("a tree with changes in no commit says so", () => {
    const [line] = trail(renderBody(input({ outsideDeploys: [outside(21, { dirty: true })] })));
    expect(line).toContain(
      `from [\`59ff6e7\`](${REPO_URL}/commit/${SHA}) with uncommitted changes · `,
    );
    expect(line).toContain(' dirty="true" -->');
  });

  test("a destroy says destroyed, and a deploy with no commit says no more than it knows", () => {
    const lines = trail(
      renderBody(
        input({
          outsideDeploys: [outside(21, { kind: "destroy" }), outside(20, { commit: undefined })],
        }),
      ),
    );
    expect(lines[0]).toStartWith("- network:dev · destroyed outside the dashboard, from ");
    expect(lines[1]).toStartWith(
      "- network:dev · deployed outside the dashboard · 09-20 18:11 <!-- sluiceway:outside ",
    );
  });

  test("never names anybody", () => {
    const lines = trail(
      renderBody(input({ recentlyDeployed: [own(20)], outsideDeploys: [outside(21)] })),
    );
    expect(lines[0]).toContain("outside the dashboard");
    expect(lines[0]).not.toContain("alice");
  });

  test("sits in its place by time among the dashboard's own, and counts toward the length", () => {
    const lines = trail(
      renderBody(
        input({
          recentlyDeployed: [own(20), own(22)],
          outsideDeploys: [outside(21), outside(19)],
          recentLength: 3,
        }),
      ),
    );
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain(" · alice · 09-22 ");
    expect(lines[1]).toContain("outside the dashboard");
    expect(lines[2]).toContain(" · alice · 09-20 ");
  });

  test("under a header it has the green dot of a deploy that went out", () => {
    const body = renderBody(input({ personality: true, outsideDeploys: [outside(21)] }));
    expect(trail(body)[0]).toStartWith("- 🟢&nbsp;network:dev · deployed outside the dashboard");
  });

  test("the list is there with outside deploys alone, and 0 leaves it out", () => {
    expect(trail(renderBody(input({ outsideDeploys: [outside(21)] })))).toHaveLength(1);
    expect(renderBody(input({ outsideDeploys: [outside(21)], recentLength: 0 }))).not.toContain(
      "Recently deployed",
    );
  });

  test("a stack id is escaped like every other on the trail", () => {
    const [line] = trail(
      renderBody(input({ outsideDeploys: [outside(21, { stackId: "a_*b*" })] })),
    );
    expect(line).toStartWith("- a&#95;&#42;b&#42; · deployed");
  });
});

describe("the marker of an outside deploy", () => {
  test("reads back as the facts it was written from", () => {
    const facts = [
      outside(21, { dirty: true }),
      outside(20, { kind: "destroy", commit: undefined }),
    ];
    const body = renderBody(input({ outsideDeploys: facts }));
    expect(parseDashboard(body).outside).toEqual(facts);
  });

  test("is the same body when every writer carries it again", () => {
    const body = renderBody(input({ outsideDeploys: [outside(21)] }));
    const again = renderBody(input({ outsideDeploys: parseDashboard(body).outside }));
    expect(again).toBe(body);
  });

  test("a line whose marker lacks a stack, a kind or a time, or has a bad commit, is not one", () => {
    const lines = [
      '- x <!-- sluiceway:outside kind="deploy" at="2026-09-21T18:11:10.000Z" -->',
      '- x <!-- sluiceway:outside stack="a" kind="launch" at="2026-09-21T18:11:10.000Z" -->',
      '- x <!-- sluiceway:outside stack="a" kind="deploy" at="yesterday" -->',
      '- x <!-- sluiceway:outside stack="a" kind="deploy" at="2026-09-21T18:11:10.000Z" commit="main" -->',
    ];
    expect(parseDashboard(lines.join("\n")).outside).toEqual([]);
  });

  test("two lines of one deploy are listed once", () => {
    const body = renderBody(input({ outsideDeploys: [outside(21), outside(21)] }));
    expect(trail(body)).toHaveLength(1);
  });
});
