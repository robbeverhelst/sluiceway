import { describe, expect, test } from "bun:test";
import { type BodyInput, renderBody } from "../../src/render/body.ts";
import { parseDashboard, type RootFacts, rootMarker } from "../../src/render/marker.ts";

// Record 0108: the scan says it is running, on the dashboard, as its first
// act, on the root marker and in one line under the scan line. Written out
// by hand.

const SCAN = {
  scanSha: "8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c",
  scanRun: "17034455121",
  scanAt: "2026-09-21T10:02:41Z",
};
const RUNNING = { run: "17034460007", since: "2026-09-21T10:41:12.000Z" };
const REPO_URL = "https://github.com/example-org/infra";
const SCAN_LINE = `Scanned [\`8c41f0e\`](${REPO_URL}/commit/8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c) on 2026-09-21 10:02 UTC · [run](${REPO_URL}/actions/runs/17034455121)`;
const RUNNING_LINE = `A scan is running since 2026-09-21 10:41 UTC · [run](${REPO_URL}/actions/runs/17034460007)`;

function body(root: RootFacts, more: Partial<BodyInput> = {}): string {
  return renderBody({
    root,
    rows: [],
    recentlyDeployed: [],
    repoUrl: REPO_URL,
    actionRef: "v0.1.0",
    personality: true,
    ...more,
  });
}

function paragraphs(text: string): string[] {
  return text.split("\n\n").map((one) => one.trim());
}

describe("the running scan on the root marker", () => {
  test("is written last, after the waiting run, and read back", () => {
    const waitingRun = { run: "17034000999", since: "2026-09-21T09:30:00.000Z", more: 0 };
    const line = rootMarker({ ...SCAN, waitingRun, scanRunning: RUNNING });
    expect(line).toBe(
      '<!-- sluiceway:dashboard v="1" scan-sha="8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c" scan-run="17034455121" scan-at="2026-09-21T10:02:41Z" run-waiting="17034000999" run-waiting-since="2026-09-21T09:30:00.000Z" scan-running="17034460007" scan-running-since="2026-09-21T10:41:12.000Z" -->',
    );
    expect(parseDashboard(line).root?.scanRunning).toEqual(RUNNING);
    expect(parseDashboard(line).root?.waitingRun).toEqual(waitingRun);
  });

  test("no running scan: no keys, and nothing read back", () => {
    const facts: RootFacts = SCAN;
    expect(rootMarker(facts)).not.toContain("scan-running");
    expect(parseDashboard(rootMarker(facts)).root?.scanRunning).toBeUndefined();
  });

  test("one key without the other, edited by hand, reads as no running scan", () => {
    const edited = (pairs: string) =>
      parseDashboard(`<!-- sluiceway:dashboard v="1" scan-run="1"${pairs} -->`).root?.scanRunning;
    expect(edited(' scan-running="7"')).toBeUndefined();
    expect(edited(' scan-running-since="2026-09-21T10:41:12Z"')).toBeUndefined();
    expect(edited(' scan-running="7" scan-running-since="2026-09-21T10:41:12Z"')).toEqual({
      run: "7",
      since: "2026-09-21T10:41:12Z",
    });
  });
});

describe("the line under the scan line", () => {
  test("says since when the scan runs and links its run, right under the scan line", () => {
    const all = paragraphs(body({ ...SCAN, scanRunning: RUNNING }));
    expect(all.slice(2, 7)).toEqual([
      '<div align="center">',
      "⚪&nbsp;**0 pending** · ⚪&nbsp;0 deploying · ⚪&nbsp;0 preview failed · ⚪&nbsp;0 in sync",
      SCAN_LINE,
      RUNNING_LINE,
      "</div>",
    ]);
  });

  test("the time is in the repo's zone, with its offset", () => {
    const line = paragraphs(
      body({ ...SCAN, scanRunning: RUNNING }, { timeZone: "Europe/Brussels" }),
    )[5];
    expect(line).toBe(
      `A scan is running since 2026-09-21 12:41 UTC+2 · [run](${REPO_URL}/actions/runs/17034460007)`,
    );
  });

  test("sits above the line about a run that waits for a runner", () => {
    const waitingRun = { run: "17034000999", since: "2026-09-21T09:30:00.000Z", more: 0 };
    const all = paragraphs(body({ ...SCAN, waitingRun, scanRunning: RUNNING }));
    expect(all[5]).toBe(RUNNING_LINE);
    expect(all[6]).toStartWith("[A run of this dashboard's workflow](");
    expect(all[7]).toBe("</div>");
  });

  test("without personality it is the paragraph under the scan line", () => {
    const all = paragraphs(body({ ...SCAN, scanRunning: RUNNING }, { personality: false }));
    expect(all[2]).toBe(SCAN_LINE);
    expect(all[3]).toBe(RUNNING_LINE);
    expect(all[4]).toBe("## Pending");
  });

  test("no running scan: no line, and the body is what it was", () => {
    expect(body(SCAN)).not.toContain("A scan is running");
    expect(body({ ...SCAN, scanRunning: undefined })).toBe(body(SCAN));
  });

  // Every other writer carries the facts from the live body, which anyone
  // with write access can edit.
  test("facts edited by hand cannot break out of the line or throw", () => {
    expect(body({ ...SCAN, scanRunning: { ...RUNNING, since: "soon" } })).not.toContain(
      "A scan is running",
    );
    const line = paragraphs(body({ ...SCAN, scanRunning: { ...RUNNING, run: "1) [x](y" } }))[5];
    expect(line).toBe(
      `A scan is running since 2026-09-21 10:41 UTC · [run](${REPO_URL}/actions/runs/1%29%20%5Bx%5D%28y)`,
    );
  });
});
