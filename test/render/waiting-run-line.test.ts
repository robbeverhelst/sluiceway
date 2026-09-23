import { describe, expect, test } from "bun:test";
import { type BodyInput, renderBody } from "../../src/render/body.ts";
import { parseDashboard, type RootFacts, rootMarker } from "../../src/render/marker.ts";

// Record 0086: a run of the dashboard's own workflow that has waited for a
// runner gets one line under the scan line. Written out by hand.

const REPO_URL = "https://github.com/example-org/infra";
const SCAN = {
  scanSha: "8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c",
  scanRun: "17034455121",
  scanAt: "2026-09-21T10:02:41Z",
};
const SCAN_LINE = `Scanned [\`8c41f0e\`](${REPO_URL}/commit/8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c) on 2026-09-21 10:02 UTC · [run](${REPO_URL}/actions/runs/17034455121)`;
const WAITING = { run: "17034000999", since: "2026-09-21T09:30:00.000Z", more: 0 };
const WAITING_URL = `${REPO_URL}/actions/runs/17034000999`;

function body(root: RootFacts, personality = true): string {
  const input: BodyInput = {
    root,
    rows: [],
    recentlyDeployed: [],
    repoUrl: REPO_URL,
    actionRef: "v0.1.0",
    personality,
  };
  return renderBody(input);
}

function paragraphs(text: string): string[] {
  return text.split("\n\n").map((one) => one.trim());
}

describe("the waiting run on the root marker", () => {
  test("is written after the scan facts, and read back", () => {
    const line = rootMarker({ ...SCAN, waitingRun: { ...WAITING, more: 2 } });
    expect(line).toBe(
      '<!-- sluiceway:dashboard v="1" scan-sha="8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c" scan-run="17034455121" scan-at="2026-09-21T10:02:41Z" run-waiting="17034000999" run-waiting-since="2026-09-21T09:30:00.000Z" run-waiting-more="2" -->',
    );
    expect(parseDashboard(line).root?.waitingRun).toEqual({ ...WAITING, more: 2 });
  });

  test("no more runs: the count is left out, and read back as 0", () => {
    const line = rootMarker({ ...SCAN, waitingRun: WAITING });
    expect(line).not.toContain("run-waiting-more");
    expect(parseDashboard(line).root?.waitingRun).toEqual(WAITING);
  });

  test("no waiting run: no keys, and nothing read back", () => {
    expect(rootMarker(SCAN)).not.toContain("run-waiting");
    expect(parseDashboard(rootMarker(SCAN)).root?.waitingRun).toBeUndefined();
  });

  test("keys edited by hand read as no waiting run, or as no more runs", () => {
    const edited = (pairs: string) =>
      parseDashboard(`<!-- sluiceway:dashboard v="1" scan-run="1"${pairs} -->`).root?.waitingRun;
    expect(edited(' run-waiting-since="2026-09-21T09:30:00Z"')).toBeUndefined();
    expect(edited(' run-waiting="7"')).toBeUndefined();
    expect(
      edited(' run-waiting="7" run-waiting-since="2026-09-21T09:30:00Z" run-waiting-more="lots"'),
    ).toEqual({
      run: "7",
      since: "2026-09-21T09:30:00Z",
      more: 0,
    });
  });
});

describe("the line under the scan line", () => {
  test("names how long the run has waited at the scan, since when, and links it", () => {
    const all = paragraphs(body({ ...SCAN, waitingRun: WAITING }));
    expect(all.slice(2, 7)).toEqual([
      '<div align="center">',
      "⚪&nbsp;**0 pending** · ⚪&nbsp;0 deploying · ⚪&nbsp;0 preview failed · ⚪&nbsp;0 in sync",
      SCAN_LINE,
      `[A run of this dashboard's workflow](${WAITING_URL}) has been waiting for a runner for 32 minutes, since 2026-09-21 09:30 UTC.`,
      "</div>",
    ]);
  });

  test("several: the others are counted", () => {
    const one = paragraphs(body({ ...SCAN, waitingRun: { ...WAITING, more: 1 } }))[5];
    expect(one).toEndWith(
      "since 2026-09-21 09:30 UTC. 1 more run has been waiting for a runner for 10 minutes or more.",
    );
    const three = paragraphs(body({ ...SCAN, waitingRun: { ...WAITING, more: 3 } }))[5];
    expect(three).toEndWith(
      "since 2026-09-21 09:30 UTC. 3 more runs have been waiting for a runner for 10 minutes or more.",
    );
  });

  test("an hour and more is said in hours and minutes", () => {
    const at = (since: string) =>
      paragraphs(body({ ...SCAN, waitingRun: { ...WAITING, since } }))[5];
    expect(at("2026-09-21T09:02:00Z")).toContain("for 1 hour, since");
    expect(at("2026-09-21T08:01:00Z")).toContain("for 2 hours and 1 minute, since");
    expect(at("2026-09-21T07:40:41Z")).toContain("for 2 hours and 22 minutes, since");
  });

  test("without personality it is the paragraph under the scan line", () => {
    const all = paragraphs(body({ ...SCAN, waitingRun: WAITING }, false));
    expect(all[2]).toBe(SCAN_LINE);
    expect(all[3]).toStartWith("[A run of this dashboard's workflow](");
    expect(all[4]).toBe("## Pending");
  });

  test("no waiting run: no line", () => {
    expect(body(SCAN)).not.toContain("waiting for a runner");
  });

  // A writer other than the scan carries the facts from the live body, which
  // anyone with write access can edit.
  test("facts edited by hand cannot break out of the line or throw", () => {
    expect(body({ ...SCAN, waitingRun: { ...WAITING, since: "soon" } })).not.toContain(
      "waiting for a runner",
    );
    const line = paragraphs(body({ ...SCAN, waitingRun: { ...WAITING, run: "1) [x](y" } }))[5];
    expect(line).toStartWith(
      `[A run of this dashboard's workflow](${REPO_URL}/actions/runs/1%29%20%5Bx%5D%28y) has been`,
    );
    const later = paragraphs(
      body({ ...SCAN, waitingRun: { ...WAITING, since: "2026-09-21T11:00:00Z" } }),
    )[5];
    expect(later).toBe(
      `[A run of this dashboard's workflow](${WAITING_URL}) has been waiting for a runner since 2026-09-21 11:00 UTC.`,
    );
  });
});
