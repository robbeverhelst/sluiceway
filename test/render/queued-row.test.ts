import { describe, expect, test } from "bun:test";
import { renderBody, rowBlock } from "../../src/render/body.ts";
import { clearTick } from "../../src/render/clear-tick.ts";
import { dashboardFacts } from "../../src/render/dashboard-facts.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { dashboardCounts } from "../../src/render/result-file.ts";
import { type DeployingRow, dependencyNote, renderRow } from "../../src/render/row.ts";

// A queued row (records 0009 and 0056): a deploying row whose deployment
// record waits behind the stacks it depends on. Its marker says `queued`, the
// state record 0009 reserved for it.

const REPO_URL = "https://github.com/example-org/infra";
const RUN_URL = `${REPO_URL}/actions/runs/17034455121`;

const queued = (stackId: string, behind: string[], destroys = 0): DeployingRow => ({
  state: "deploying",
  stackId,
  ticker: "alice",
  runUrl: RUN_URL,
  waiting: true,
  behind,
  destroys,
});

describe("the queued row", () => {
  test("says what it waits behind, who ticked it and which run, with no box", () => {
    expect(renderRow(queued("site:prod", ["app:prod"]))).toBe(
      [
        `- **site:prod** · queued behind **app:prod** · ticked by alice · [run](${RUN_URL}) <!-- sluiceway:row stack="site:prod" state="queued" -->`,
        "  <!-- /sluiceway:row -->",
      ].join("\n"),
    );
  });

  test("names every stack it waits behind, in the order given, each escaped", () => {
    const first = renderRow(queued("site:prod", ["app:prod", "db_*:prod"])).split("\n")[0];
    expect(first).toContain("queued behind **app:prod** and **db&#95;&#42;:prod** ·");
  });

  test("carries its destroys on the marker, and reads back as a known row with no tick", () => {
    const [row] = parseDashboard(renderRow(queued("site:prod", ["app:prod"], 2))).rows;
    expect(row).toMatchObject({
      known: true,
      stackId: "site:prod",
      state: "queued",
      destroys: 2,
      ticked: false,
    });
  });

  test("an empty list is an ordinary deploying row", () => {
    expect(renderRow(queued("site:prod", []))).toContain('state="deploying"');
  });
});

describe("the body with a queued row", () => {
  const rows = [rowBlock(queued("site:prod", ["app:prod"], 1))];
  const body = renderBody({
    root: {
      scanSha: "8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c",
      scanRun: "17034455121",
      scanAt: "2026-09-21T10:02:41Z",
    },
    rows,
    recentlyDeployed: [],
    repoUrl: REPO_URL,
    actionRef: "v0.1.0",
    personality: true,
  });

  test("sits in the Deploying section and counts as deploying", () => {
    expect(body).toContain("## Deploying\n\n- **site:prod** · queued behind");
    expect(body).toContain("🔵&nbsp;1 deploying");
    expect(dashboardCounts(parseDashboard(body).rows)).toMatchObject({ deploying: 1 });
  });

  // Record 0075: a queued row with nothing deploying has a header state of
  // its own.
  test("makes the header queued, and its destroys turn a sign on", () => {
    const parsed = parseDashboard(body).rows;
    const { headerState, signs } = dashboardFacts(parsed);
    expect(headerState).toBe("queued");
    expect(signs.deletes || signs.replaces).toBe(true);
  });
});

describe("the note on a tick refused for a dependency", () => {
  const ticked = parseDashboard(
    '- [x] **app:prod** · 1 update · [preview](url) <!-- sluiceway:row stack="app:prod" state="pending" hash="aaaaaaaaaaaaaaaa" -->\n  <!-- /sluiceway:row -->',
  ).rows[0];

  test("clears the box and names the stack it waits on", () => {
    if (!ticked) throw new Error("no row");
    expect(clearTick(ticked, { note: { dependsOn: ["network:prod"] } }).text).toBe(
      [
        '- [ ] **app:prod** · 1 update · [preview](url) <!-- sluiceway:row stack="app:prod" state="pending" hash="aaaaaaaaaaaaaaaa" -->',
        "  :information_source: this tick started nothing: it depends on **network:prod**, which has a change waiting. Tick both to deploy them in order, or deploy **network:prod** first.",
        "  <!-- /sluiceway:row -->",
      ].join("\n"),
    );
  });

  test("several stacks are named together, each escaped", () => {
    expect(dependencyNote(["a:prod", "b_x:prod"])).toBe(
      ":information_source: this tick started nothing: it depends on **a:prod** and **b&#95;x:prod**, which have changes waiting. Tick them all to deploy them in order, or deploy **a:prod** and **b&#95;x:prod** first.",
    );
  });
});
