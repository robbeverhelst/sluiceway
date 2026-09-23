import { describe, expect, test } from "bun:test";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { change, dashboardBody, harness, pending, REPO_URL, tableAdapter } from "./harness.ts";

// Record 0086: a scan that finds a run of its own workflow queued for ten
// minutes or more says so under the scan line. The harness's scan starts at
// 2026-09-21 06:00 UTC as run 4242.

const TABLE = { "app:prod": pending("app:prod", change("bucket")) };
const LINE = `[A run of this dashboard's workflow](${REPO_URL}/actions/runs/900) has been waiting for a runner for 20 minutes, since 2026-09-21 05:40 UTC.`;

function setup() {
  return harness(tableAdapter(TABLE));
}

describe("a run of the workflow that waits for a runner", () => {
  test("queued for 20 minutes: the line under the scan line, and a line in the job log", async () => {
    const { context, github, log } = setup();
    github.seedWorkflowRun("sluiceway.yml", {
      id: "900",
      status: "queued",
      since: "2026-09-21T05:40:00Z",
    });

    await scan(context);

    const body = dashboardBody(github);
    const paragraphs = body.split("\n\n");
    const at = paragraphs.findIndex((one) => one.startsWith("Scanned ["));
    expect(paragraphs[at + 1]).toBe(LINE);
    expect(parseDashboard(body).root?.waitingRun).toEqual({
      run: "900",
      since: "2026-09-21T05:40:00.000Z",
      more: 0,
    });
    expect(log.lines).toContain(
      `Run 900 of sluiceway.yml has been waiting for a runner for 20 minutes. The dashboard says so under the scan line until it starts (record 0086): ${REPO_URL}/actions/runs/900`,
    );
    expect(github.requests.filter((one) => one === "listQueuedRuns")).toHaveLength(1);
  });

  test("queued for 5 minutes: nothing, a short queue is a busy runner", async () => {
    const { context, github, log } = setup();
    github.seedWorkflowRun("sluiceway.yml", {
      id: "900",
      status: "queued",
      since: "2026-09-21T05:55:00Z",
    });

    await scan(context);

    expect(dashboardBody(github)).not.toContain("waiting for a runner");
    expect(log.lines.join("\n")).not.toContain("waiting for a runner");
  });

  test("several: the one that waited longest, and a count of the others", async () => {
    const { context, github } = setup();
    github.seedWorkflowRun("sluiceway.yml", {
      id: "900",
      status: "queued",
      since: "2026-09-21T05:40:00Z",
    });
    github.seedWorkflowRun("sluiceway.yml", {
      id: "901",
      status: "queued",
      since: "2026-09-21T05:45:00Z",
    });
    github.seedWorkflowRun("sluiceway.yml", {
      id: "902",
      status: "queued",
      since: "2026-09-21T05:58:00Z",
    });

    await scan(context);

    expect(dashboardBody(github)).toContain(
      `${LINE} 1 more run has been waiting for a runner for 10 minutes or more.`,
    );
  });

  test("the line goes with the next scan once the run has started", async () => {
    const { context, github } = setup();
    github.seedWorkflowRun("sluiceway.yml", {
      id: "900",
      status: "queued",
      since: "2026-09-21T05:40:00Z",
    });
    await scan(context);
    expect(dashboardBody(github)).toContain(LINE);

    github.seedWorkflowRun("sluiceway.yml", {
      id: "900",
      status: "in_progress",
      since: "2026-09-21T05:40:00Z",
    });
    await scan({ ...context, runId: "4243" });

    expect(dashboardBody(github)).not.toContain("waiting for a runner");
  });

  test("a read GitHub refuses leaves the line out, says why in the job log, and the scan goes on", async () => {
    const { context, github, log } = setup();
    github.failQueuedRuns(403);

    await scan(context);

    expect(dashboardBody(github)).toContain("app:prod");
    expect(dashboardBody(github)).not.toContain("waiting for a runner");
    expect(
      log.lines.some((line) =>
        line.startsWith("The queued runs of sluiceway.yml could not be read:"),
      ),
    ).toBe(true);
    expect(log.warnings).toEqual([]);
  });
});
