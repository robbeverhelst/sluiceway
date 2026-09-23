import { describe, expect, test } from "bun:test";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { handedOn, runApply } from "./apply-harness.ts";
import {
  change,
  dashboardBody,
  harness,
  inSync,
  pending,
  REPO_URL,
  tableAdapter,
} from "./harness.ts";

// Record 0089: `dashboard.timeZone`. Every writer shows the times of the body
// in the repo's zone, and every marker keeps UTC. The harness clock starts on
// 2026-09-21 06:00 UTC, 08:00 in Brussels.

const BRUSSELS = "dashboard:\n  timeZone: Europe/Brussels\n";

describe("a scan in Europe/Brussels", () => {
  test("writes the scan line, the failure line and the trail in the zone, and the markers in UTC", async () => {
    const { context, github } = harness(tableAdapter({ "a:prod": inSync("a:prod") }), {
      config: BRUSSELS,
    });
    github.seedDeployment({
      task: "sluiceway:a:prod",
      payload: { v: 1, hash: "2b44350653e84a11", ticker: "alice", run: "77" },
      createdAt: "2026-01-15T08:50:00Z",
      status: {
        state: "failure",
        description: "the tool exited with an error (exit code 255)",
        createdAt: "2026-01-15T08:52:10Z",
      },
    });

    await scan(context);

    const body = dashboardBody(github);
    expect(body).toContain(" on 2026-09-21 08:00 UTC+2 · ");
    expect(parseDashboard(body).rows[0]?.text).toContain(
      `:x: last deploy failed: the tool exited with an error (exit code 255) · ticked by alice · 2026-01-15 09:52 UTC+1 · [run](${REPO_URL}/actions/runs/77)`,
    );
    expect(body).toContain(
      `## Recently deployed\n\nTimes are in Europe/Brussels.\n\n- 🔴&nbsp;a:prod · failed · alice · 01-15 09:52 · [run](${REPO_URL}/actions/runs/77)`,
    );
    expect(parseDashboard(body).root?.scanAt).toBe("2026-09-21T06:00:00.000Z");
  });

  test("with no key writes UTC, as it always did", async () => {
    const { context, github } = harness(tableAdapter({ "a:prod": inSync("a:prod") }));
    await scan(context);
    expect(dashboardBody(github)).toContain(" on 2026-09-21 06:00 UTC · ");
  });
});

describe("apply in Europe/Brussels", () => {
  test("draws the body again in the zone", async () => {
    const h = await handedOn({ "a:prod": pending("a:prod", change("bucket")) }, ["a:prod"], {
      config: BRUSSELS,
    });

    await runApply(h);

    const body = h.github.issue(h.number).body;
    expect(body).toContain(" on 2026-09-21 08:00 UTC+2 · ");
    // The fake stamps the deploy's status at 2026-01-01 00:00 UTC, which is
    // 01:00 in a Brussels January.
    expect(body).toContain(
      "## Recently deployed\n\nTimes are in Europe/Brussels.\n\n- 🟢&nbsp;a:prod · alice · 01-01 01:00 · ",
    );
  });
});
