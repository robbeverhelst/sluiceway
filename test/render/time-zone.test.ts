import { describe, expect, test } from "bun:test";
import { type BodyInput, type RecentDeploy, renderBody, rowBlock } from "../../src/render/body.ts";
import { fitBody } from "../../src/render/budget.ts";
import { type Row, renderRow } from "../../src/render/row.ts";

// Record 0089: `dashboard.timeZone`. Every time a person reads on the
// dashboard is in the repo's zone. The trail's times lean on the line under
// its heading, which names the zone; a time that stands alone says its
// offset. Written out by hand from the record.

const REPO_URL = "https://github.com/example-org/infra";

const FAILED: Row = {
  state: "in-sync",
  stackId: "apps/auth:prod",
  failure: {
    reason: "the tool exited with an error",
    ticker: "alice",
    at: new Date("2026-01-15T08:52:00Z"),
    runUrl: `${REPO_URL}/actions/runs/7`,
  },
};

const deploy = (stackId: string, iso: string): RecentDeploy => ({
  stackId,
  ticker: "alice",
  at: new Date(iso),
  runUrl: `${REPO_URL}/actions/runs/1`,
});

function input(overrides: Partial<BodyInput> = {}): BodyInput {
  return {
    root: {
      scanSha: "8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c",
      scanRun: "17034455121",
      scanAt: "2026-07-21T10:02:41Z",
      fullScanAt: "2026-07-21T06:00:00Z",
    },
    rows: [rowBlock({ state: "in-sync", stackId: "apps/web:prod" })],
    recentlyDeployed: [
      deploy("apps/auth:prod", "2026-07-20T09:41:00Z"),
      deploy("apps/web:prod", "2026-01-15T09:41:00Z"),
    ],
    outsideDeploys: [
      { stackId: "apps/db:prod", kind: "deploy", at: new Date("2026-07-19T22:30:00Z") },
    ],
    repoUrl: REPO_URL,
    actionRef: "v0.1.0",
    personality: false,
    ...overrides,
  };
}

function section(body: string, heading: string): string[] {
  const all = body.split("\n\n");
  const at = all.indexOf(heading);
  return at === -1 ? [] : [all[at + 1] ?? "", ...(all[at + 2]?.split("\n") ?? [])];
}

describe("the default", () => {
  test("no zone and UTC named outright write the same bytes", () => {
    expect(renderBody(input({ timeZone: "UTC" }))).toBe(renderBody(input()));
    expect(renderRow(FAILED, { timeZone: "UTC" })).toBe(renderRow(FAILED));
  });

  test("is UTC as it always was", () => {
    const body = renderBody(input());
    expect(body).toContain(
      "on 2026-07-21 10:02 UTC · [run](https://github.com/example-org/infra/actions/runs/17034455121) · <sub>last full scan 2026-07-21 06:00 UTC</sub>",
    );
    expect(section(body, "## Recently deployed")).toEqual([
      "Times are in UTC.",
      `- apps/auth:prod · alice · 07-20 09:41 · [run](${REPO_URL}/actions/runs/1)`,
      expect.stringMatching(/^- apps\/db:prod · deployed outside the dashboard · 07-19 22:30 /),
      `- apps/web:prod · alice · 01-15 09:41 · [run](${REPO_URL}/actions/runs/1)`,
    ]);
  });
});

describe("in Europe/Brussels", () => {
  const body = renderBody(input({ timeZone: "Europe/Brussels" }));

  test("the scan line says the offset of each time", () => {
    expect(body).toContain(
      "on 2026-07-21 12:02 UTC+2 · [run](https://github.com/example-org/infra/actions/runs/17034455121) · <sub>last full scan 2026-07-21 08:00 UTC+2</sub>",
    );
  });

  test("the line under the trail names the zone, and a January and a July line each keep their own offset", () => {
    expect(section(body, "## Recently deployed")).toEqual([
      "Times are in Europe/Brussels.",
      `- apps/auth:prod · alice · 07-20 11:41 · [run](${REPO_URL}/actions/runs/1)`,
      expect.stringMatching(/^- apps\/db:prod · deployed outside the dashboard · 07-20 00:30 /),
      `- apps/web:prod · alice · 01-15 10:41 · [run](${REPO_URL}/actions/runs/1)`,
    ]);
  });

  test("the line about a run waiting for a runner says its offset", () => {
    const waiting = renderBody(
      input({
        timeZone: "Europe/Brussels",
        root: {
          scanSha: "8c41f0e",
          scanRun: "1",
          scanAt: "2026-07-21T10:02:41Z",
          waitingRun: { run: "9", since: "2026-07-21T09:30:00.000Z", more: 0 },
        },
      }),
    );
    expect(waiting).toContain(
      "has been waiting for a runner for 32 minutes, since 2026-07-21 11:30 UTC+2.",
    );
  });

  test("the failure line on a row says its offset", () => {
    expect(renderRow(FAILED, { timeZone: "Europe/Brussels" })).toContain(
      `:x: last deploy failed: the tool exited with an error · ticked by alice · 2026-01-15 09:52 UTC+1 · [run](${REPO_URL}/actions/runs/7)`,
    );
  });

  test("a row the budget draws gets the zone of the body", () => {
    const fitted = fitBody({
      ...input({ timeZone: "Europe/Brussels" }),
      rows: [FAILED],
      carried: [],
    });
    expect(fitted.body).toContain("· 2026-01-15 09:52 UTC+1 ·");
  });

  test("the marker keeps the UTC ISO time", () => {
    expect(body).toContain('at="2026-07-19T22:30:00.000Z"');
  });
});

describe("a half-hour zone", () => {
  test("the scan line and the trail are in Asia/Kolkata", () => {
    const body = renderBody(input({ timeZone: "Asia/Kolkata" }));
    expect(body).toContain("on 2026-07-21 15:32 UTC+5:30 ·");
    expect(section(body, "## Recently deployed").slice(0, 2)).toEqual([
      "Times are in Asia/Kolkata.",
      `- apps/auth:prod · alice · 07-20 15:11 · [run](${REPO_URL}/actions/runs/1)`,
    ]);
  });
});

describe("the year of the scan is the zone's", () => {
  test("a scan just after midnight on new year in the zone leaves that year out of the trail", () => {
    const body = renderBody(
      input({
        timeZone: "Europe/Brussels",
        root: { scanSha: "8c41f0e", scanRun: "1", scanAt: "2026-12-31T23:30:00Z" },
        recentlyDeployed: [deploy("apps/auth:prod", "2026-12-31T23:10:00Z")],
        outsideDeploys: [],
      }),
    );
    expect(body).toContain("on 2027-01-01 00:30 UTC+1 ·");
    expect(section(body, "## Recently deployed")[1]).toBe(
      `- apps/auth:prod · alice · 01-01 00:10 · [run](${REPO_URL}/actions/runs/1)`,
    );
  });
});
