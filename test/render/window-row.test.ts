import { describe, expect, test } from "bun:test";
import { renderBody, rowBlock } from "../../src/render/body.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { type DeployingRow, renderRow } from "../../src/render/row.ts";

// A row that waits for the deploy window (record 0104): a queued row whose
// record waits for a time and not for a stack. It says when the window
// opens, in the dashboard zone (record 0089), has no box, and its marker
// says `queued`.

const REPO_URL = "https://github.com/example-org/infra";
const RUN_URL = `${REPO_URL}/actions/runs/17034455121`;
const MONDAY_NINE = new Date("2026-09-28T07:00:00Z");

const waiting = (overrides: Partial<DeployingRow> = {}): DeployingRow => ({
  state: "deploying",
  stackId: "site:prod",
  ticker: "alice",
  runUrl: RUN_URL,
  waiting: true,
  window: { opens: MONDAY_NINE },
  ...overrides,
});

describe("a row that waits for the deploy window", () => {
  test("says when the window opens in the dashboard zone, who ticked it and which run, with no box", () => {
    expect(renderRow(waiting(), { timeZone: "Europe/Brussels" })).toBe(
      [
        `- **site:prod** · queued for the deploy window, which opens 2026-09-28 09:00 UTC+2 · ticked by alice · [run](${RUN_URL}) <!-- sluiceway:row stack="site:prod" state="queued" -->`,
        "  <!-- /sluiceway:row -->",
      ].join("\n"),
    );
  });

  test("in UTC the time says UTC, as every time that stands alone does", () => {
    expect(renderRow(waiting()).split("\n")[0]).toContain(
      "queued for the deploy window, which opens 2026-09-28 07:00 UTC ·",
    );
  });

  test("a window that is open now says so, and that the next run starts it", () => {
    expect(renderRow(waiting({ window: { opens: undefined } })).split("\n")[0]).toContain(
      "· queued for the deploy window, which is open: the next scheduled run starts it · ticked by alice ·",
    );
  });

  test("a stack behind another that also waits for the window says both, and its marker names the stack", () => {
    const first = renderRow(waiting({ behind: ["app:prod"] }), {
      timeZone: "Europe/Brussels",
    }).split("\n")[0];
    expect(first).toContain(
      "· queued behind **app:prod**, and for the deploy window, which opens 2026-09-28 09:00 UTC+2 · ticked by alice ·",
    );
    expect(first).toEndWith('state="queued" behind="app:prod" -->');
  });

  // Record 0110: the window is not a stack, so a row that waits for it alone
  // has nothing behind on its marker.
  test("a row that waits for the window alone has nothing behind on its marker", () => {
    expect(renderRow(waiting()).split("\n")[0]).toEndWith('state="queued" -->');
  });

  test("a deploy on merge that waits for the window says merged by", () => {
    expect(renderRow(waiting({ onMerge: true })).split("\n")[0]).toContain(
      "which opens 2026-09-28 07:00 UTC · merged by alice ·",
    );
  });

  test("reads back as a queued row with no tick, and counts as deploying", () => {
    const [row] = parseDashboard(renderRow(waiting())).rows;
    expect(row).toMatchObject({
      known: true,
      stackId: "site:prod",
      state: "queued",
      ticked: false,
    });
    const body = renderBody({
      root: {
        scanSha: "8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c",
        scanRun: "17034455121",
        scanAt: "2026-09-21T10:02:41Z",
      },
      rows: [rowBlock(waiting())],
      recentlyDeployed: [],
      repoUrl: REPO_URL,
      actionRef: "v0.1.0",
      personality: true,
    });
    expect(body).toContain("## Deploying\n\n- **site:prod** · queued for the deploy window");
    expect(body).toContain("🔵&nbsp;1 deploying");
  });

  test("a queued row with no window is byte for byte what it was", () => {
    expect(renderRow(waiting({ window: undefined, behind: ["app:prod"] })).split("\n")[0]).toBe(
      `- **site:prod** · queued behind **app:prod** · ticked by alice · [run](${RUN_URL}) <!-- sluiceway:row stack="site:prod" state="queued" behind="app:prod" -->`,
    );
  });
});
