// Row placement at a scan's late read, at its interface: what the scan has so
// far and what the late read found go in, the rows and what was done come
// out, or the stacks to preview first. No scan, no fake GitHub, no tool.

import { describe, expect, test } from "bun:test";
import type { DeployFact, DeployFacts } from "../../src/core/deployment.ts";
import type { Change, Diff } from "../../src/core/diff.ts";
import { diffHash } from "../../src/core/diff-hash.ts";
import type { OpenPullRequest } from "../../src/core/merge-and-deploy.ts";
import {
  isFullScan,
  type LateRead,
  type LateWhy,
  type Listing,
  mergesAtLateRead,
  NO_DEPLOYS,
  type Placed,
  type PlacedRows,
  type PreviewedStack,
  placeRows,
  type RowsAtLateRead,
  type ScanSoFar,
} from "../../src/core/row-placement.ts";
import type { PreviewResult, ToolDeploy } from "../../src/core/tool-result.ts";
import type { ParsedMerge, ParsedRow, RowState } from "../../src/render/marker.ts";
import { mergeBlock, tickedMergeBlock } from "../../src/render/merge-row.ts";

const REPO = "https://github.com/acme/infra";
const STARTED = new Date("2026-09-22T10:00:00Z");
const BEFORE = new Date("2026-09-22T09:00:00Z");
const AFTER = new Date("2026-09-22T10:05:00Z");
const H1 = "1".repeat(40);
const H2 = "2".repeat(40);
const LINES = { full: "By #12.", counted: "By 1 pull request." };

function change(name: string, op: Change["op"] = "update"): Change {
  return {
    address: `urn:${name}`,
    type: "aws:s3:Bucket",
    name,
    op,
    changedKeys: [],
    replaceKeys: [],
  };
}

function diff(id: string, ...changes: Change[]): Diff {
  return { stackId: id, changes };
}

function pending(id: string, ...changes: Change[]): PreviewedStack {
  const shown = changes.length > 0 ? changes : [change("bucket")];
  return { result: { ok: true, diff: diff(id, ...shown), toolLog: "" }, startedAt: STARTED };
}

function inSync(id: string): PreviewedStack {
  return { result: { ok: true, diff: diff(id), toolLog: "" }, startedAt: STARTED };
}

function failedPreview(): PreviewedStack {
  const result: PreviewResult = {
    ok: false,
    reason: { kind: "tool-error", exitCode: 1 },
    detail: [],
    toolLog: "",
  };
  return { result, startedAt: STARTED };
}

// The hash of the fresh row `pending(id)` gives.
function hashOf(id: string): string {
  return diffHash(diff(id, change("bucket")));
}

function liveRow(
  id: string,
  state: RowState = "pending",
  more: Partial<ParsedRow> = {},
): ParsedRow {
  return {
    known: true,
    stackId: id,
    state,
    hash: "live-hash",
    destroys: 0,
    failed: false,
    shortened: 0,
    drift: false,
    ticked: false,
    text: `- [ ] ${id} live <!-- sluiceway:row stack="${id}" state="${state}" -->`,
    ...more,
  } as ParsedRow;
}

function open(more: Partial<Extract<DeployFact, { kind: "open" }>> = {}): DeployFact {
  return { kind: "open", deployment: 71, waiting: false, ticker: "ana", run: "900", ...more };
}

function succeeded(at: Date, hash = "old-hash"): DeployFact {
  return { kind: "succeeded", ticker: "ana", run: "800", at, hash };
}

function failed(at: Date): DeployFact {
  return {
    kind: "failed",
    reason: "The deploy failed.",
    ticker: "ana",
    run: "801",
    attempt: "2",
    at,
  };
}

function facts(byStack: Record<string, DeployFact>, unread = 0): DeployFacts {
  return { byStack: new Map(Object.entries(byStack)), succeeded: [], trail: [], unread };
}

function scanSoFar(more: Partial<ScanSoFar> = {}): ScanSoFar {
  return {
    ids: ["app", "db"],
    scan: { sha: "abc123", runId: "1000", at: "2026-09-22T10:10:00.000Z" },
    windows: { byStack: new Map(), now: new Date("2026-09-22T10:10:00.000Z"), timeZone: "UTC" },
    repoUrl: REPO,
    links: {
      summary: `${REPO}/actions/runs/1000/attempts/1`,
      log: `${REPO}/actions/runs/1000/job/5`,
    },
    logDiff: false,
    readOnly: false,
    redact: false,
    listing: { kind: "off" },
    branchPreviews: new Map(),
    previewed: new Map(),
    again: new Set(),
    pageUrls: new Map(),
    histories: undefined,
    ...more,
  };
}

interface Live {
  rows?: ParsedRow[];
  current?: boolean;
  merges?: ParsedMerge[];
  root?: { fullScanAt?: string; fullScanRun?: string };
}

function lateRead(live: Live = {}, more: Partial<Omit<LateRead, "live">> = {}): LateRead {
  const first = new Map<string, ParsedRow>();
  for (const row of live.rows ?? []) if (!first.has(row.stackId)) first.set(row.stackId, row);
  return {
    live: {
      root: live.root
        ? {
            version: 1,
            scanSha: "old",
            scanRun: "400",
            scanAt: "2026-09-21T00:00:00.000Z",
            ...live.root,
          }
        : undefined,
      merges: live.merges ?? [],
      waiting: [],
      outside: [],
      bulk: [],
      current: live.current ?? true,
      first,
    },
    deploys: NO_DEPLOYS,
    resolveWaits: false,
    attributed: new Map(),
    ...more,
  } as LateRead;
}

function deploys(byStack: Record<string, DeployFact>, settled: string[] = []): LateRead["deploys"] {
  return { facts: facts(byStack), settled: new Set(settled), runs: new Map() };
}

function rowsOf(answer: RowsAtLateRead): { rows: PlacedRows; placed: Placed } {
  if (answer.kind !== "placed") {
    throw new Error(`Expected rows, got preview-first: ${JSON.stringify(answer.stacks)}`);
  }
  return answer;
}

function previewed(entries: Record<string, PreviewedStack>): Map<string, PreviewedStack> {
  return new Map(Object.entries(entries));
}

// What each stack got: a fresh row by its state, a carried block, or none.
function placement(rows: PlacedRows): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, row] of rows.rows) out[id] = `fresh ${row.state}`;
  for (const [id, row] of rows.carried) out[id] = `carried ${row.state}`;
  return out;
}

describe("which row each stack gets at the late read (records 0004 and 0011)", () => {
  // One stack "app", in every combination the rule tells apart.
  const cases: {
    name: string;
    mine?: PreviewedStack;
    live?: ParsedRow;
    fact?: DeployFact;
    settled?: boolean;
    again?: boolean;
    expected: string;
  }[] = [
    { name: "a previewed stack gets a fresh row", mine: pending("app"), expected: "fresh pending" },
    {
      name: "a fresh row replaces the live one",
      mine: inSync("app"),
      live: liveRow("app"),
      expected: "fresh in-sync",
    },
    {
      name: "a preview failure is a fresh row too",
      mine: failedPreview(),
      expected: "fresh preview-failed",
    },
    {
      name: "a stack not previewed keeps its live row",
      live: liveRow("app"),
      expected: "carried pending",
    },
    {
      name: "a deploy that ended before the preview started changes nothing",
      mine: pending("app"),
      live: liveRow("app"),
      fact: succeeded(BEFORE),
      expected: "fresh pending",
    },
    {
      name: "a deploy that ended after the preview started keeps the live row",
      mine: pending("app"),
      live: liveRow("app"),
      fact: succeeded(AFTER),
      expected: "carried pending",
    },
    {
      name: "a deploy the scan settled itself has no writer behind it: the fresh row",
      mine: pending("app"),
      live: liveRow("app"),
      fact: failed(AFTER),
      settled: true,
      expected: "fresh pending",
    },
    {
      name: "a stack previewed again takes its fresh row, once",
      mine: pending("app"),
      fact: succeeded(AFTER),
      again: true,
      expected: "fresh pending",
    },
    {
      name: "an open deployment gets a deploying row from the record",
      mine: pending("app"),
      live: liveRow("app"),
      fact: open(),
      expected: "fresh deploying",
    },
    {
      name: "an open deployment with a live deploying row keeps it byte for byte",
      live: liveRow("app", "deploying"),
      fact: open(),
      expected: "carried deploying",
    },
    {
      name: "a queued record with a live queued row keeps it",
      live: liveRow("app", "queued"),
      fact: open({ behind: ["db"] }),
      expected: "carried queued",
    },
    {
      name: "a queued record under a live deploying row is drawn from the record",
      live: liveRow("app", "deploying"),
      fact: open({ behind: ["db"] }),
      expected: "fresh deploying",
    },
  ];

  for (const one of cases) {
    test(one.name, () => {
      const answer = placeRows(
        scanSoFar({
          ids: ["app"],
          previewed: previewed(one.mine ? { app: one.mine } : {}),
          again: new Set(one.again ? ["app"] : []),
        }),
        lateRead(
          { rows: one.live ? [one.live] : [] },
          {
            deploys: deploys(one.fact ? { app: one.fact } : {}, one.settled ? ["app"] : []),
          },
        ),
      );
      expect(placement(rowsOf(answer).rows)).toEqual({ app: one.expected });
    });
  }

  const first: {
    name: string;
    mine?: PreviewedStack;
    live?: ParsedRow;
    fact?: DeployFact;
    why: LateWhy;
  }[] = [
    { name: "a stack with neither a preview nor a row", why: "no-row" },
    {
      name: "a live deploying row with no open deployment",
      live: liveRow("app", "deploying"),
      why: "no-open-deployment",
    },
    {
      name: "a live queued row with no open deployment",
      live: liveRow("app", "queued"),
      why: "no-open-deployment",
    },
    {
      name: "a deploy that ended after the preview, and no live row to keep",
      mine: pending("app"),
      fact: succeeded(AFTER),
      why: "deploy-ended",
    },
    {
      name: "a deploy that ended after the preview, and a live row that still says deploying",
      mine: pending("app"),
      live: liveRow("app", "deploying"),
      fact: succeeded(AFTER),
      why: "deploy-ended",
    },
  ];

  for (const one of first) {
    test(`preview first: ${one.name}`, () => {
      const answer = placeRows(
        scanSoFar({ ids: ["app"], previewed: previewed(one.mine ? { app: one.mine } : {}) }),
        lateRead(
          { rows: one.live ? [one.live] : [] },
          { deploys: deploys(one.fact ? { app: one.fact } : {}) },
        ),
      );
      expect(answer).toEqual({ kind: "preview-first", stacks: [{ id: "app", why: one.why }] });
    });
  }

  test("every stack to preview first is named in one answer, in discovery order", () => {
    const answer = placeRows(
      scanSoFar({ ids: ["web", "app", "db"], previewed: previewed({ app: pending("app") }) }),
      lateRead({ rows: [liveRow("db", "deploying")] }),
    );
    expect(answer).toEqual({
      kind: "preview-first",
      stacks: [
        { id: "web", why: "no-row" },
        { id: "db", why: "no-open-deployment" },
      ],
    });
  });

  test("a carried row is the live block itself, never read inside", () => {
    const row = liveRow("db");
    const { rows } = rowsOf(
      placeRows(
        scanSoFar({ previewed: previewed({ app: pending("app") }) }),
        lateRead({ rows: [row] }),
      ),
    );
    expect(rows.carried.get("db")).toBe(row);
  });

  test("of two blocks for one stack the first is carried", () => {
    const one = liveRow("db", "pending", { text: "first" });
    const two = liveRow("db", "in-sync", { text: "second" });
    const { rows } = rowsOf(
      placeRows(
        scanSoFar({ previewed: previewed({ app: pending("app") }) }),
        lateRead({ rows: [one, two] }),
      ),
    );
    expect(rows.carried.get("db")).toBe(one);
  });

  test("a body of another version carries nothing: every stack without a preview is previewed", () => {
    const answer = placeRows(
      scanSoFar({ previewed: previewed({ app: pending("app") }) }),
      lateRead({ rows: [liveRow("db")], current: false }),
    );
    expect(answer).toEqual({ kind: "preview-first", stacks: [{ id: "db", why: "no-row" }] });
  });

  test("a row of a stack discovery does not know is dropped", () => {
    const { rows, placed } = rowsOf(
      placeRows(
        scanSoFar({ previewed: previewed({ app: pending("app") }) }),
        lateRead({ rows: [liveRow("db"), liveRow("gone")] }),
      ),
    );
    expect(placement(rows)).toEqual({ app: "fresh pending", db: "carried pending" });
    expect(placed.dropped).toEqual(["gone"]);
  });
});

describe("what the late read reports it did", () => {
  test("carried, deploying and deferred stacks", () => {
    const { placed } = rowsOf(
      placeRows(
        scanSoFar({
          ids: ["app", "db", "web", "api"],
          previewed: previewed({ app: pending("app"), api: pending("api") }),
        }),
        lateRead(
          {
            rows: [
              liveRow("app"),
              liveRow("db"),
              liveRow("web", "deploying"),
              liveRow("api", "in-sync"),
            ],
          },
          { deploys: deploys({ web: open(), api: succeeded(AFTER) }) },
        ),
      ),
    );
    expect(placed).toEqual({
      carried: ["db", "web"],
      carriedBlocks: 3,
      dropped: [],
      deploying: ["web"],
      deferred: ["api"],
      ticks: [],
      mergeTicks: [],
      resolveWaits: false,
      unread: 0,
      bulk: [],
    });
  });

  test("records this version cannot read are counted", () => {
    const { placed } = rowsOf(
      placeRows(
        scanSoFar({ ids: ["app"], previewed: previewed({ app: pending("app") }) }),
        lateRead({}, { deploys: { facts: facts({}, 2), settled: new Set(), runs: new Map() } }),
      ),
    );
    expect(placed.unread).toBe(2);
  });
});

describe("the rows the scan draws (records 0026, 0027, 0051 and 0076)", () => {
  test("a deploying row names the ticker, links the attempt of the record and counts destroys from the preview", () => {
    const { rows } = rowsOf(
      placeRows(
        scanSoFar({
          ids: ["app"],
          previewed: previewed({
            app: pending("app", change("a", "delete"), change("b", "replace")),
          }),
        }),
        lateRead(
          {},
          {
            deploys: deploys({ app: open({ attempt: "3", waiting: true }) }),
            attributed: new Map([["app", { lines: LINES }]]),
          },
        ),
      ),
    );
    expect(rows.rows.get("app")).toEqual({
      state: "deploying",
      stackId: "app",
      ticker: "ana",
      runUrl: `${REPO}/actions/runs/900/attempts/3`,
      waiting: true,
      destroys: 2,
      deletes: 1,
      attribution: LINES,
      behind: undefined,
    });
  });

  test("without a preview a deploying row takes its destroys from the marker it replaces", () => {
    const { rows } = rowsOf(
      placeRows(
        scanSoFar({ ids: ["app"] }),
        lateRead(
          { rows: [liveRow("app", "pending", { destroys: 4, deletes: 3 })] },
          { deploys: deploys({ app: open() }) },
        ),
      ),
    );
    expect(rows.rows.get("app")).toMatchObject({ destroys: 4, deletes: 3 });
  });

  test("a pending row gets its attribution line, an in sync one does not", () => {
    const lines = LINES;
    const { rows } = rowsOf(
      placeRows(
        scanSoFar({ previewed: previewed({ app: pending("app"), db: inSync("db") }) }),
        lateRead(
          {},
          {
            attributed: new Map([
              ["app", { lines }],
              ["db", { lines }],
            ]),
          },
        ),
      ),
    );
    expect(rows.rows.get("app")).toMatchObject({ attribution: lines });
    expect(rows.rows.get("db")).not.toHaveProperty("attribution");
  });

  test("a pending row is pending again when the last deploy went out with the same hash", () => {
    const place = (logDiff: boolean) =>
      rowsOf(
        placeRows(
          scanSoFar({ ids: ["app"], logDiff, previewed: previewed({ app: pending("app") }) }),
          lateRead({}, { deploys: deploys({ app: succeeded(BEFORE, hashOf("app")) }) }),
        ),
      ).rows.rows.get("app");
    expect(place(false)).toMatchObject({ pendingAgain: { logUrl: undefined } });
    expect(place(true)).toMatchObject({
      pendingAgain: { logUrl: `${REPO}/actions/runs/1000/job/5` },
    });
  });

  test("a pending row with another hash than the last deploy is not pending again", () => {
    const { rows } = rowsOf(
      placeRows(
        scanSoFar({ ids: ["app"], previewed: previewed({ app: pending("app") }) }),
        lateRead({}, { deploys: deploys({ app: succeeded(BEFORE, "other") }) }),
      ),
    );
    expect(rows.rows.get("app")).toMatchObject({ pendingAgain: undefined });
  });

  test("a failed deploy puts the failure line on the fresh row, linked to its attempt", () => {
    const { rows } = rowsOf(
      placeRows(
        scanSoFar({ ids: ["app"], previewed: previewed({ app: pending("app") }) }),
        lateRead({}, { deploys: deploys({ app: failed(BEFORE) }) }),
      ),
    );
    expect(rows.rows.get("app")).toMatchObject({
      failure: {
        reason: "The deploy failed.",
        ticker: "ana",
        at: BEFORE,
        runUrl: `${REPO}/actions/runs/801/attempts/2`,
      },
    });
  });

  test("an outside deploy that ended after the failure clears the failure line", () => {
    const later: ToolDeploy = { kind: "deploy", endedAt: new Date("2026-09-22T09:30:00Z") };
    const { rows } = rowsOf(
      placeRows(
        scanSoFar({
          ids: ["app"],
          previewed: previewed({ app: pending("app") }),
          histories: new Map([["app", [later]]]),
        }),
        lateRead({}, { deploys: deploys({ app: failed(BEFORE) }) }),
      ),
    );
    expect(rows.rows.get("app")).toMatchObject({ failure: undefined });
  });

  test("a pending row links its preview page", () => {
    const page = `${REPO}/runs/77`;
    const { rows } = rowsOf(
      placeRows(
        scanSoFar({
          ids: ["app"],
          previewed: previewed({ app: pending("app") }),
          pageUrls: new Map([["app", page]]),
        }),
        lateRead(),
      ),
    );
    expect(JSON.stringify(rows.rows.get("app"))).toContain(page);
  });
});

describe("the ticks the late read meets (record 0025)", () => {
  const ticked = (id: string, hash: string | undefined, state: RowState = "pending") =>
    liveRow(id, state, { ticked: true, hash });

  const cases: {
    name: string;
    mine?: PreviewedStack;
    live: ParsedRow;
    fact?: DeployFact;
    waits: boolean;
    row: Record<string, unknown> | "carried";
    tick: { tick: Placed["ticks"][number]["tick"]; box: boolean } | "preview-first" | undefined;
  }[] = [
    {
      name: "a fresh row of the same hash keeps the tick while resolve is on its way",
      mine: pending("app"),
      live: ticked("app", hashOf("app")),
      waits: true,
      row: { state: "pending", ticked: true },
      tick: { tick: "carry", box: true },
    },
    {
      name: "a fresh row of the same hash sweeps the tick when nothing is on its way",
      mine: pending("app"),
      live: ticked("app", hashOf("app")),
      waits: false,
      row: { state: "pending", orphanTick: true },
      tick: { tick: "sweep", box: true },
    },
    {
      name: "a fresh row of another hash sweeps the tick, even while resolve is on its way",
      mine: pending("app"),
      live: ticked("app", "old"),
      waits: true,
      row: { state: "pending", orphanTick: true },
      tick: { tick: "sweep", box: true },
    },
    {
      name: "a fresh row with no box drops the tick with no note",
      mine: inSync("app"),
      live: ticked("app", "old"),
      waits: false,
      row: { state: "in-sync" },
      tick: { tick: "sweep", box: false },
    },
    {
      name: "a live row keeps its tick while resolve is on its way",
      live: ticked("app", "old"),
      waits: true,
      row: "carried",
      tick: { tick: "carry", box: true },
    },
    {
      name: "a live row kept for a deploy that ended leaves its orphan tick for the next scan",
      mine: pending("app"),
      live: ticked("app", "old"),
      fact: succeeded(AFTER),
      waits: false,
      row: "carried",
      tick: { tick: "next-scan", box: true },
    },
    {
      name: "an orphan tick on a live row the scan has no preview for is previewed first",
      live: ticked("app", "old"),
      waits: false,
      row: "carried",
      tick: "preview-first",
    },
    {
      name: "a tick on a stack with an open deployment is not the sweep's to judge",
      live: ticked("app", "old", "deploying"),
      fact: open(),
      waits: false,
      row: "carried",
      tick: undefined,
    },
  ];

  for (const one of cases) {
    test(one.name, () => {
      const answer = placeRows(
        scanSoFar({
          ids: ["app"],
          previewed: previewed(one.mine ? { app: one.mine } : {}),
        }),
        lateRead(
          { rows: [one.live] },
          { deploys: deploys(one.fact ? { app: one.fact } : {}), resolveWaits: one.waits },
        ),
      );
      if (one.tick === "preview-first") {
        expect(answer).toEqual({
          kind: "preview-first",
          stacks: [{ id: "app", why: "orphan-tick" }],
        });
        return;
      }
      const { rows, placed } = rowsOf(answer);
      if (one.row === "carried") expect(rows.carried.get("app")).toBe(one.live);
      else expect(rows.rows.get("app")).toMatchObject(one.row);
      expect(placed.ticks).toEqual(one.tick ? [{ id: "app", ...one.tick }] : []);
      expect(placed.resolveWaits).toBe(one.waits);
    });
  }

  test("a read-only dashboard meets no tick: it goes with the box", () => {
    const { rows, placed } = rowsOf(
      placeRows(
        scanSoFar({ ids: ["app"], readOnly: true, previewed: previewed({ app: pending("app") }) }),
        lateRead({ rows: [ticked("app", hashOf("app"))] }),
      ),
    );
    expect(placed.ticks).toEqual([]);
    expect(rows.rows.get("app")).not.toHaveProperty("orphanTick");
  });

  test("a tick is read on a body of another version too, and swept from the fresh row", () => {
    const { rows, placed } = rowsOf(
      placeRows(
        scanSoFar({ ids: ["app"], previewed: previewed({ app: pending("app") }) }),
        lateRead({ rows: [ticked("app", hashOf("app"))], current: false }),
      ),
    );
    expect(placed.ticks).toEqual([{ id: "app", tick: "sweep", box: true }]);
    expect(rows.rows.get("app")).toMatchObject({ orphanTick: true });
  });
});

describe("the root marker (record 0011)", () => {
  const liveRoot = { fullScanAt: "2026-09-01T00:00:00.000Z", fullScanRun: "500" };

  test("a full scan writes the keys of a full scan", () => {
    const { rows } = rowsOf(
      placeRows(
        scanSoFar({ previewed: previewed({ app: pending("app"), db: inSync("db") }) }),
        lateRead({ root: liveRoot }),
      ),
    );
    expect(rows.root).toEqual({
      scanSha: "abc123",
      scanRun: "1000",
      scanAt: "2026-09-22T10:10:00.000Z",
      fullScanAt: "2026-09-22T10:10:00.000Z",
      fullScanRun: "1000",
    });
  });

  test("a narrowed scan carries them through as they stand", () => {
    const { rows } = rowsOf(
      placeRows(
        scanSoFar({ previewed: previewed({ app: pending("app") }) }),
        lateRead({ root: liveRoot, rows: [liveRow("db")] }),
      ),
    );
    expect(rows.root).toMatchObject({ fullScanAt: liveRoot.fullScanAt, fullScanRun: "500" });
  });

  test("a scan is full when it previewed every stack, whatever rows they then got", () => {
    expect(isFullScan({ ids: ["app"], previewed: previewed({ app: pending("app") }) })).toBe(true);
    expect(isFullScan({ ids: ["app", "db"], previewed: previewed({ app: pending("app") }) })).toBe(
      false,
    );
  });
});

function pullRequest(number: number, head: string): OpenPullRequest {
  return {
    number,
    title: `Update thing ${number}`,
    author: "renovate[bot]",
    draft: false,
    base: "main",
    head,
    mergeable: "mergeable",
    checks: "success",
    files: [],
    filesComplete: true,
    fromFork: false,
  };
}

function listed(...prs: OpenPullRequest[]): Listing {
  return {
    kind: "listed",
    updates: prs.map((pr) => ({ pullRequest: pr, stackIds: ["app"] })),
    onChecks: [],
  };
}

function liveMerge(pr: number, head: string): ParsedMerge {
  return tickedMergeBlock(mergeBlock({ pr, stackIds: ["app"], head, title: "t", author: "a" }));
}

describe("the updates waiting to merge (records 0054 and 0081)", () => {
  const so = (listing: Listing) =>
    scanSoFar({ ids: ["app"], listing, previewed: previewed({ app: inSync("app") }) });

  test("with the setting off there are none", () => {
    const { rows } = rowsOf(
      placeRows(so({ kind: "off" }), lateRead({ merges: [liveMerge(4, H1)] })),
    );
    expect(rows.merges).toEqual([]);
    expect(rows.waiting).toEqual([]);
  });

  test("a list that could not be read keeps the live lines", () => {
    const merge = liveMerge(4, H1);
    const { rows } = rowsOf(placeRows(so({ kind: "failed" }), lateRead({ merges: [merge] })));
    expect(rows.merges).toEqual([merge]);
  });

  test("a live merge line of another version is not kept", () => {
    const { rows } = rowsOf(
      placeRows(so({ kind: "failed" }), lateRead({ merges: [liveMerge(4, H1)], current: false })),
    );
    expect(rows.merges).toEqual([]);
  });

  const ticks: { name: string; head: string; waits: boolean; tick: "carry" | "sweep" }[] = [
    {
      name: "the same head while resolve is on its way keeps the tick",
      head: H1,
      waits: true,
      tick: "carry",
    },
    {
      name: "the same head with nothing on its way sweeps it",
      head: H1,
      waits: false,
      tick: "sweep",
    },
    {
      name: "a new head sweeps it, even while resolve is on its way",
      head: H2,
      waits: true,
      tick: "sweep",
    },
  ];
  for (const one of ticks) {
    test(`a ticked merge line: ${one.name}`, () => {
      const { rows, placed } = rowsOf(
        placeRows(
          so(listed(pullRequest(4, one.head))),
          lateRead({ merges: [liveMerge(4, H1)] }, { resolveWaits: one.waits }),
        ),
      );
      expect(placed.mergeTicks).toEqual([{ pr: 4, tick: one.tick }]);
      expect(rows.merges[0]?.ticked).toBe(one.tick === "carry");
    });
  }

  test("an unticked merge line is drawn fresh and reports no tick", () => {
    const { rows, placed } = rowsOf(placeRows(so(listed(pullRequest(4, H1))), lateRead()));
    expect(rows.merges.map(({ pr, ticked }) => ({ pr, ticked }))).toEqual([
      { pr: 4, ticked: false },
    ]);
    expect(placed.mergeTicks).toEqual([]);
  });

  test("an update waiting on its checks gets a line with no box", () => {
    const listing: Listing = {
      kind: "listed",
      updates: [],
      onChecks: [{ pullRequest: pullRequest(9, H2), stackIds: ["app"] }],
    };
    const { rows } = rowsOf(placeRows(so(listing), lateRead()));
    expect(rows.waiting.map(({ pr, stackIds }) => ({ pr, stackIds }))).toEqual([
      { pr: 9, stackIds: ["app"] },
    ]);
  });
});

describe("the outside trail (record 0073)", () => {
  test("a stack's own runs are not outside deploys, and a stack not read keeps its live lines", () => {
    const at = new Date("2026-09-20T00:00:00Z");
    const own: ToolDeploy = { kind: "deploy", endedAt: at, runId: "800" };
    const outside: ToolDeploy = { kind: "destroy", endedAt: at };
    const liveLine = { stackId: "db", kind: "deploy" as const, at };
    const gone = { stackId: "gone", kind: "deploy" as const, at };
    const late = lateRead(
      {},
      {
        deploys: {
          facts: facts({}),
          settled: new Set(),
          runs: new Map([["app", new Set(["800"])]]),
        },
      },
    );
    const { rows } = rowsOf(
      placeRows(
        scanSoFar({
          previewed: previewed({ app: inSync("app"), db: inSync("db") }),
          histories: new Map([["app", [own, outside]]]),
        }),
        { ...late, live: { ...late.live, outside: [liveLine, gone] } },
      ),
    );
    expect(rows.outside).toEqual([{ stackId: "app", kind: "destroy", at }, liveLine]);
  });
});

describe("the merges that wait for this scan (record 0054)", () => {
  const merge = (pr: number) => open({ merge: pr, ticker: "ana" });

  test("a merge on a stack this scan has not previewed is previewed first", () => {
    expect(
      mergesAtLateRead({ ids: ["app", "db"], previewed: previewed({}) }, facts({ db: merge(4) })),
    ).toEqual({ kind: "preview-first", stacks: [{ id: "db", why: "merged" }] });
  });

  test("merges on previewed stacks are handed off, in stack id order", () => {
    const answer = mergesAtLateRead(
      { ids: ["db", "app"], previewed: previewed({ app: pending("app"), db: pending("db") }) },
      facts({ db: merge(5), app: merge(4), web: open() }),
    );
    expect(answer.kind).toBe("hand-off");
    if (answer.kind !== "hand-off") return;
    expect(answer.waiting.map(({ id, fact }) => [id, fact.merge])).toEqual([
      ["app", 4],
      ["db", 5],
    ]);
  });

  test("a merge on a stack discovery no longer knows is handed off, to be ended", () => {
    const answer = mergesAtLateRead(
      { ids: ["app"], previewed: previewed({}) },
      facts({ gone: merge(4) }),
    );
    expect(answer).toMatchObject({ kind: "hand-off", waiting: [{ id: "gone" }] });
  });
});
