import { describe, expect, test } from "bun:test";
import { type BodyInput, type RecentDeploy, renderBody, rowBlock } from "../../src/render/body.ts";
import type { Row } from "../../src/render/row.ts";

// Slice 4.11 (record 0062): the trail of recently deployed lists failed
// deploys too, and its length is a setting. Written out by hand from the
// record. Without a header, so the lines are the words alone.

const REPO_URL = "https://github.com/example-org/infra";

function input(overrides: Partial<BodyInput> = {}): BodyInput {
  const rows: Row[] = [{ state: "in-sync", stackId: "apps/auth:prod" }];
  return {
    root: {
      scanSha: "8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c",
      scanRun: "17034455121",
      scanAt: "2026-09-21T10:02:41Z",
    },
    rows: rows.map((row) => rowBlock(row)),
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

const deploy = (stackId: string, day: number, over: Partial<RecentDeploy> = {}): RecentDeploy => ({
  stackId,
  ticker: "alice",
  at: new Date(Date.UTC(2026, 8, day, 9, 41)),
  runUrl: `${REPO_URL}/actions/runs/${day}`,
  ...over,
});

describe("a failed deploy in the trail", () => {
  test("is listed as failed, in its place by time", () => {
    const body = renderBody(
      input({
        recentlyDeployed: [
          deploy("apps/auth:prod", 20),
          deploy("apps/auth:prod", 21, {
            result: "failed",
            reason: "the tool exited with an error",
          }),
        ],
      }),
    );
    expect(trail(body)).toEqual([
      `- apps/auth:prod · failed · alice · 09-21 09:41 · [run](${REPO_URL}/actions/runs/21)`,
      `- apps/auth:prod · alice · 09-20 09:41 · [run](${REPO_URL}/actions/runs/20)`,
    ]);
  });

  // Slice 5.10: the reason stays on the row's failure line, so the trail
  // line fits on one line.
  test("the reason is not on the line", () => {
    const body = renderBody(
      input({ recentlyDeployed: [deploy("a", 21, { result: "failed", reason: "<b>*x*</b>" })] }),
    );
    expect(trail(body)[0]).toBe(
      `- a · failed · alice · 09-21 09:41 · [run](${REPO_URL}/actions/runs/21)`,
    );
  });
});

describe("the length of the trail", () => {
  const many = Array.from({ length: 30 }, (_, index) => deploy(`stack-${index}`, index + 1));

  test("is 10 when nothing sets it", () => {
    expect(trail(renderBody(input({ recentlyDeployed: many })))).toHaveLength(10);
  });

  test("is the setting, newest first", () => {
    const lines = trail(renderBody(input({ recentlyDeployed: many, recentLength: 3 })));
    expect(lines).toHaveLength(3);
    expect(lines.map((line) => line.split(" · ")[0])).toEqual([
      "- stack-29",
      "- stack-28",
      "- stack-27",
    ]);
  });

  test("0 leaves the section out, heading and all", () => {
    const body = renderBody(input({ recentlyDeployed: many, recentLength: 0 }));
    expect(body).not.toContain("## Recently deployed");
  });

  test("a failed deploy takes a place like any other line", () => {
    const lines = trail(
      renderBody(
        input({
          recentlyDeployed: [
            deploy("a", 1),
            deploy("b", 2, { result: "failed", reason: "the deploy failed" }),
          ],
          recentLength: 1,
        }),
      ),
    );
    expect(lines).toEqual([
      `- b · failed · alice · 09-02 09:41 · [run](${REPO_URL}/actions/runs/2)`,
    ]);
  });
});

// Slice 4.5's result dots, under a header: a failed deploy is red.
test("under a header a failed deploy gets the red dot", () => {
  const body = renderBody(
    input({
      personality: true,
      recentlyDeployed: [deploy("a", 2, { result: "failed", reason: "the deploy failed" })],
    }),
  );
  expect(trail(body)).toEqual([
    `- 🔴&nbsp;a · failed · alice · 09-02 09:41 · [run](${REPO_URL}/actions/runs/2)`,
  ]);
});

// Slice 5.5 (record 0072): a deploy that went out says what it shipped, on
// its own line under it, as a row says where its change came from.
describe("what a deploy shipped", () => {
  const shipped = {
    full: "shipped #102 by dave, #101 by carol · [compare](compare-url)",
    counted: "shipped 2 pull requests · [compare](compare-url)",
  };

  test("sits on the line under the deploy, inside its list item", () => {
    const body = renderBody(
      input({
        recentlyDeployed: [deploy("apps/auth:prod", 21, { shipped }), deploy("apps/web:prod", 20)],
      }),
    );
    expect(trail(body)).toEqual([
      `- apps/auth:prod · alice · 09-21 09:41 · [run](${REPO_URL}/actions/runs/21)`,
      "  shipped #102 by dave, #101 by carol · [compare](compare-url)",
      `- apps/web:prod · alice · 09-20 09:41 · [run](${REPO_URL}/actions/runs/20)`,
    ]);
  });

  test("is a count when the budget asks for a shorter trail", () => {
    const body = renderBody(
      input({ recentlyDeployed: [deploy("apps/auth:prod", 21, { shipped })], shortTrail: true }),
    );
    expect(trail(body)[1]).toBe("  shipped 2 pull requests · [compare](compare-url)");
  });
});
