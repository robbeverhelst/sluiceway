import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type BodyInput, type RecentDeploy, renderBody, rowBlock } from "../../src/render/body.ts";
import { HEADER_STATES, type HeaderState } from "../../src/render/dashboard-facts.ts";
import { type ParsedRow, parseDashboard } from "../../src/render/marker.ts";
import type {
  DeployingRow,
  DriftRow,
  FailureLine,
  InSyncRow,
  PendingRow,
  Row,
  RowLevel,
} from "../../src/render/row.ts";
import { rows58, rows100 } from "./fixtures.ts";

const ROOT = {
  scanSha: "8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c",
  scanRun: "17034455121",
  scanAt: "2026-09-21T10:02:41Z",
  fullScanAt: "2026-09-21T06:00:12Z",
  fullScanRun: "17031200455",
};

const REPO_URL = "https://github.com/example-org/infra";
const RUN_URL = `${REPO_URL}/actions/runs/17034455121`;

function pending(
  stackId: string,
  ops: ("create" | "update" | "delete" | "replace")[] = ["update"],
): PendingRow {
  return {
    state: "pending",
    diff: {
      stackId,
      changes: ops.map((op, index) => ({
        address: `address-${index}`,
        type: "random:index/randomPet:RandomPet",
        name: `pet-${index}`,
        op,
        changedKeys: op === "update" ? ["length"] : [],
        replaceKeys: [],
      })),
    },
    hash: "3fa9c1e2aabbccdd",
    runUrl: RUN_URL,
  };
}

const inSync = (stackId: string): InSyncRow => ({ state: "in-sync", stackId });

// Record 0055: nothing to deploy from the code, one file gone outside it.
const drifted = (stackId: string): DriftRow => ({
  state: "drift",
  diff: {
    stackId,
    changes: [],
    drift: [
      {
        address: "address-notes",
        type: "local:index/file:File",
        name: "notes",
        op: "delete",
        changedKeys: [],
        replaceKeys: [],
      },
    ],
  },
  hash: "4be1a0c93d7e5f20",
  runUrl: RUN_URL,
});

function input(rows: Row[], overrides: Partial<BodyInput> = {}): BodyInput {
  return {
    root: ROOT,
    rows: rows.map((row) => rowBlock(row)),
    recentlyDeployed: [],
    repoUrl: REPO_URL,
    actionRef: "v0.1.0",
    personality: true,
    ...overrides,
  };
}

const IMAGES = "https://raw.githubusercontent.com/sluiceway/sluiceway/v0.1.0/assets/mascot";

// Written out by hand from records 0029, 0040 and 0055, not from the code.
describe("a body with drift (record 0055)", () => {
  test("one drifted stack and one in sync: the drift picture, the count, the alert, and the Drifted section under Pending", () => {
    expect(renderBody(input([inSync("apps/web:prod"), drifted("apps/api:prod")]))).toBe(
      [
        '<!-- sluiceway:dashboard v="1" scan-sha="8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c" scan-run="17034455121" scan-at="2026-09-21T10:02:41Z" full-scan-at="2026-09-21T06:00:12Z" full-scan-run="17031200455" -->',
        "",
        '<p align="center">',
        "  <picture>",
        `    <source media="(prefers-color-scheme: dark)" srcset="${IMAGES}/drift-dark.svg">`,
        `    <img alt="Sluiceway: something changed outside the code" width="880" src="${IMAGES}/drift-light.svg">`,
        "  </picture>",
        "</p>",
        "",
        '<div align="center">',
        "",
        "⚪&nbsp;**0 pending** · 🟠&nbsp;1 drifted · ⚪&nbsp;0 deploying · ⚪&nbsp;0 preview failed · 🟢&nbsp;1 in sync",
        "",
        `Scanned [\`8c41f0e\`](${REPO_URL}/commit/8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c) on 2026-09-21 10:02 UTC · [run](${RUN_URL}) · <sub>last full scan 2026-09-21 06:00 UTC</sub>`,
        "",
        "</div>",
        "",
        "## Pending",
        "",
        "Nothing to deploy from the code.",
        "",
        // Record 0075: a resource gone outside the code is named above the list.
        "> [!CAUTION]",
        "> 1 drifted stack has resources gone outside the code: **apps/api:prod**",
        "",
        "## Drifted",
        "",
        "Real infrastructure changed outside the code. Deploying a stack puts it back as its code says.",
        "",
        `- [ ] **apps/api:prod** · 1 gone outside the code · [preview](${RUN_URL}) <!-- sluiceway:row stack="apps/api:prod" state="drift" hash="4be1a0c93d7e5f20" drift="true" gone="1" -->`,
        "  <details><summary>1 change outside the code</summary>",
        "  <kbd>gone</kbd> <code>local:index/file:File</code> <b>notes</b><br>",
        "  </details>",
        "  <!-- /sluiceway:row -->",
        "",
        "## In sync",
        "",
        "<details><summary>1 stack in sync</summary>",
        "",
        '- apps/web:prod <!-- sluiceway:row stack="apps/web:prod" state="in-sync" -->',
        "  <!-- /sluiceway:row -->",
        "",
        "</details>",
        "",
        "---",
        "",
        "- [ ] Rescan all stacks <!-- sluiceway:rescan -->",
        "",
        "<sub>[Sluiceway](https://github.com/sluiceway/sluiceway) v0.1.0 · [docs](https://docs.sluiceway.dev/)</sub>",
      ].join("\n"),
    );
  });

  test("the Drifted section sits under the pending rows, and a pending row wins the picture", () => {
    const body = renderBody(input([drifted("b:drift"), pending("a:pending"), inSync("c:calm")]));
    expect(headings(body)).toEqual(["## Pending", "## Drifted", "## In sync"]);
    expect(body).toContain("pending-1-light.svg");
    expect(body).toContain("🟡&nbsp;**1 pending** · 🟠&nbsp;1 drifted · ⚪&nbsp;0 deploying");
  });

  test("with no drifted row the counts line and the sections are what they always were", () => {
    const body = renderBody(input([pending("a:pending"), inSync("c:calm")]));
    expect(body).not.toContain("drifted");
    expect(body).not.toContain("## Drifted");
  });

  test("personality off: no picture, no dot, the same count", () => {
    const body = renderBody(input([drifted("b:drift")], { personality: false }));
    expect(paragraphs(body)[1]).toBe(
      "**0 pending** · 1 drifted · 0 deploying · 0 preview failed · 0 in sync",
    );
  });
});

// Written out by hand from records 0029, 0033, 0040 and 0047, not from the code.
describe("the body of record 0029", () => {
  test("one pending stack and one in sync", () => {
    expect(renderBody(input([inSync("apps/web:prod"), pending("apps/api:prod")]))).toBe(
      [
        '<!-- sluiceway:dashboard v="1" scan-sha="8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c" scan-run="17034455121" scan-at="2026-09-21T10:02:41Z" full-scan-at="2026-09-21T06:00:12Z" full-scan-run="17031200455" -->',
        "",
        '<p align="center">',
        "  <picture>",
        `    <source media="(prefers-color-scheme: dark)" srcset="${IMAGES}/pending-1-dark.svg">`,
        `    <img alt="Sluiceway: 1 stack is pending" width="880" src="${IMAGES}/pending-1-light.svg">`,
        "  </picture>",
        "</p>",
        "",
        '<div align="center">',
        "",
        "🟡&nbsp;**1 pending** · ⚪&nbsp;0 deploying · ⚪&nbsp;0 preview failed · 🟢&nbsp;1 in sync",
        "",
        `Scanned [\`8c41f0e\`](${REPO_URL}/commit/8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c) on 2026-09-21 10:02 UTC · [run](${RUN_URL}) · <sub>last full scan 2026-09-21 06:00 UTC</sub>`,
        "",
        "</div>",
        "",
        "## Pending",
        "",
        "Tick a box to deploy that stack exactly as its row shows it.",
        "",
        `- [ ] **apps/api:prod** · 1 update · [preview](${RUN_URL}) <!-- sluiceway:row stack="apps/api:prod" state="pending" hash="3fa9c1e2aabbccdd" -->`,
        "  <details><summary>1 change</summary>",
        "  <kbd>update</kbd> <code>random:index/randomPet:RandomPet</code> <b>pet-0</b> · <code>length</code><br>",
        "  </details>",
        "  <!-- /sluiceway:row -->",
        "",
        "## In sync",
        "",
        "<details><summary>1 stack in sync</summary>",
        "",
        '- apps/web:prod <!-- sluiceway:row stack="apps/web:prod" state="in-sync" -->',
        "  <!-- /sluiceway:row -->",
        "",
        "</details>",
        "",
        "---",
        "",
        "- [ ] Rescan all stacks <!-- sluiceway:rescan -->",
        "",
        "<sub>[Sluiceway](https://github.com/sluiceway/sluiceway) v0.1.0 · [docs](https://docs.sluiceway.dev/)</sub>",
      ].join("\n"),
    );
  });
});

const FAILURE: FailureLine = {
  reason: "the run ended without reporting a result",
  ticker: "bob",
  at: new Date("2026-09-19T16:03:20Z"),
  runUrl: `${REPO_URL}/actions/runs/17019884120`,
};

// `deletes` left out is a marker of an older version, which did not say how
// many of the destroys are deletes (record 0075).
const deploying = (stackId: string, destroys = 0, deletes?: number): DeployingRow => ({
  state: "deploying",
  stackId,
  ticker: "carol",
  runUrl: RUN_URL,
  destroys,
  ...(deletes === undefined ? {} : { deletes }),
});

// A stack queued behind its dependency (record 0056).
const queued = (stackId: string, destroys = 0, deletes?: number): DeployingRow => ({
  ...deploying(stackId, destroys, deletes),
  behind: ["n:network"],
});

const previewFailed = (stackId: string): Row => ({
  state: "preview-failed",
  stackId,
  reason: "the tool exited with an error (exit code 255)",
  runUrl: RUN_URL,
});

// One small dashboard per header state, each holding everything that loses
// against its own state (record 0031).
const DASHBOARDS: Record<HeaderState, Row[]> = {
  failing: [
    previewFailed("b:broken"),
    deploying("c:deploying"),
    pending("d:pending"),
    { ...inSync("e:failed"), failure: FAILURE },
    inSync("f:calm"),
  ],
  deploying: [deploying("c:deploying"), pending("d:pending"), inSync("e:calm")],
  queued: [queued("q:queued"), pending("d:pending"), inSync("e:calm")],
  pending: [pending("d:pending"), inSync("e:calm")],
  drift: [drifted("g:drift"), inSync("e:calm")],
  "first-run": [],
  "in-sync": [inSync("e:calm"), inSync("f:calm")],
};

// The two header states whose picture can carry the destroy sign (record
// 0043), each with a destroy on a row of its own state.
const SIGNED: Record<"pending" | "deploying", Row[]> = {
  pending: [pending("a:destroys", ["create", "delete"]), pending("d:pending"), inSync("e:calm")],
  deploying: [deploying("c:deploying", 2), pending("d:pending"), inSync("e:calm")],
};

// Every dashboard above, by name.
const NAMED_DASHBOARDS: [string, Row[]][] = [
  ...HEADER_STATES.map((state): [string, Row[]] => [state, DASHBOARDS[state]]),
  ["pending with the destroy sign", SIGNED.pending],
  ["deploying with the destroy sign", SIGNED.deploying],
];

const RECENT: RecentDeploy[] = [
  ["apps/auth:prod", "alice", "2026-09-21T09:41:07Z", "17034388102"],
  ["apps/auth:staging", "alice", "2026-09-21T09:12:55Z", "17034120455"],
  ["platform/external-dns:prod", "carol", "2026-09-20T17:30:00Z", "17029910331"],
].map(([stackId = "", ticker = "", at = "", run = ""]) => ({
  stackId,
  ticker,
  at: new Date(at),
  runUrl: `${REPO_URL}/actions/runs/${run}`,
}));

const paragraphs = (body: string) => body.split("\n\n");
const headings = (body: string) => body.split("\n").filter((line) => line.startsWith("## "));

function lineUnderPending(body: string): string {
  const all = paragraphs(body);
  return all[all.indexOf("## Pending") + 1] ?? "";
}

describe("the picture", () => {
  // The alt texts of record 0031 and the file names of record 0033. The
  // pending, failing and deploying pictures show one crate per pending stack,
  // and their alt texts say the number (records 0047 and 0066). Each of the
  // dashboards above has one pending row where its state allows one.
  const FILE: Record<HeaderState, string> = {
    "first-run": "first-run",
    "in-sync": "in-sync",
    pending: "pending-1",
    deploying: "deploying-1",
    queued: "queued-1",
    failing: "failing-1",
    drift: "drift",
  };
  const ALT: Record<HeaderState, string> = {
    "first-run": "Sluiceway: no stacks yet",
    "in-sync": "Sluiceway: everything is in sync",
    pending: "Sluiceway: 1 stack is pending",
    deploying: "Sluiceway: deploying, 1 stack is pending",
    queued: "Sluiceway: queued behind dependencies, 1 stack is pending",
    failing: "Sluiceway: something failed, 1 stack is pending",
    drift: "Sluiceway: something changed outside the code",
  };
  // Records 0043 and 0075: the state's alt text plus the fact.
  const SIGNED_ALT = {
    pending: "Sluiceway: 1 stack is pending, some delete or replace resources",
    deploying: "Sluiceway: deploying, 1 stack is pending, some changes replace resources",
  };

  // The markup of record 0040: centered, and as wide as the issue (0039).
  const centered = (file: string, alt: string) =>
    [
      '<p align="center">',
      "  <picture>",
      `    <source media="(prefers-color-scheme: dark)" srcset="${IMAGES}/${file}-dark.svg">`,
      `    <img alt="${alt}" width="880" src="${IMAGES}/${file}-light.svg">`,
      "  </picture>",
      "</p>",
    ].join("\n");

  test.each(HEADER_STATES.filter((state) => state !== "pending"))("%s", (state) => {
    const body = renderBody(input(DASHBOARDS[state]));
    expect(paragraphs(body)[1]).toBe(centered(FILE[state], ALT[state]));
  });

  // Record 0066: failing and deploying have one file pair per crate count
  // from 0 to 12 and one past it, like pending (record 0047), and say the
  // number unless it is 0.
  test.each<[number, string, string]>([
    [0, "failing-0", "Sluiceway: something failed"],
    [1, "failing-1", "Sluiceway: something failed, 1 stack is pending"],
    [9, "failing-9", "Sluiceway: something failed, 9 stacks are pending"],
    [12, "failing-12", "Sluiceway: something failed, 12 stacks are pending"],
    [13, "failing-13", "Sluiceway: something failed, 13 stacks are pending"],
    [20, "failing-20", "Sluiceway: something failed, 20 stacks are pending"],
    [21, "failing-more", "Sluiceway: something failed, more than 20 stacks are pending"],
    [58, "failing-more", "Sluiceway: something failed, more than 20 stacks are pending"],
  ])("a failed preview and %i pending rows show %s", (count, file, alt) => {
    const rows = Array.from({ length: count }, (_, index) => pending(`stack-${index}`));
    const body = renderBody(input([...rows, previewFailed("broken"), inSync("calm")]));
    expect(paragraphs(body)[1]).toBe(centered(file, alt));
  });

  test.each<[number, string, string]>([
    [0, "deploying-0", "Sluiceway: deploying"],
    [1, "deploying-1", "Sluiceway: deploying, 1 stack is pending"],
    [4, "deploying-4", "Sluiceway: deploying, 4 stacks are pending"],
    [12, "deploying-12", "Sluiceway: deploying, 12 stacks are pending"],
    [17, "deploying-17", "Sluiceway: deploying, 17 stacks are pending"],
    [21, "deploying-more", "Sluiceway: deploying, more than 20 stacks are pending"],
  ])("a deploying row and %i pending rows show %s", (count, file, alt) => {
    const rows = Array.from({ length: count }, (_, index) => pending(`stack-${index}`));
    const body = renderBody(input([deploying("moving"), ...rows, inSync("calm")]));
    expect(paragraphs(body)[1]).toBe(centered(file, alt));
  });

  // Record 0075: a queued row while nothing deploys has a picture of its
  // own, with the crates of the pending stacks like failing and deploying.
  test.each<[number, string, string]>([
    [0, "queued-0", "Sluiceway: queued behind dependencies"],
    [1, "queued-1", "Sluiceway: queued behind dependencies, 1 stack is pending"],
    [5, "queued-5", "Sluiceway: queued behind dependencies, 5 stacks are pending"],
    [20, "queued-20", "Sluiceway: queued behind dependencies, 20 stacks are pending"],
    [21, "queued-more", "Sluiceway: queued behind dependencies, more than 20 stacks are pending"],
  ])("a queued row and %i pending rows show %s", (count, file, alt) => {
    const rows = Array.from({ length: count }, (_, index) => pending(`stack-${index}`));
    const body = renderBody(input([queued("waiting"), ...rows, inSync("calm")]));
    expect(paragraphs(body)[1]).toBe(centered(file, alt));
  });

  test("a deploying row wins over a queued row, and the queued row is no crate", () => {
    const body = renderBody(input([deploying("moving"), queued("waiting"), inSync("calm")]));
    expect(paragraphs(body)[1]).toBe(centered("deploying-0", "Sluiceway: deploying"));
  });

  // The count is the pending rows alone: a deploying, queued or failed row is
  // not a crate waiting, and a failure line counts as failing, not pending.
  test("only pending rows are crates under failing and deploying", () => {
    const failing = renderBody(
      input([deploying("a"), deploying("b"), previewFailed("c"), previewFailed("d"), pending("e")]),
    );
    expect(paragraphs(failing)[1]).toBe(
      centered("failing-1", "Sluiceway: something failed, 1 stack is pending"),
    );
    const moving = renderBody(input([deploying("a"), deploying("b"), inSync("c")]));
    expect(paragraphs(moving)[1]).toBe(centered("deploying-0", "Sluiceway: deploying"));
  });

  // Drift shows only when nothing is pending (record 0055), so its count is
  // always 0 and it keeps its one picture.
  test("drift is one picture", () => {
    const body = renderBody(input([drifted("a"), drifted("b"), inSync("c")]));
    expect(paragraphs(body)[1]).toBe(centered("drift", ALT.drift));
  });

  test.each<[number, string, string]>([
    [1, "pending-1", "Sluiceway: 1 stack is pending"],
    [2, "pending-2", "Sluiceway: 2 stacks are pending"],
    [7, "pending-7", "Sluiceway: 7 stacks are pending"],
    [12, "pending-12", "Sluiceway: 12 stacks are pending"],
    [13, "pending-13", "Sluiceway: 13 stacks are pending"],
    [19, "pending-19", "Sluiceway: 19 stacks are pending"],
    [20, "pending-20", "Sluiceway: 20 stacks are pending"],
    [21, "pending-more", "Sluiceway: more than 20 stacks are pending"],
    [58, "pending-more", "Sluiceway: more than 20 stacks are pending"],
  ])("%i pending rows show %s", (count, file, alt) => {
    const rows = Array.from({ length: count }, (_, index) => pending(`stack-${index}`));
    const body = renderBody(input([...rows, inSync("calm")]));
    expect(paragraphs(body)[1]).toBe(centered(file, alt));
  });

  test("a row of an unknown state does not add a crate", () => {
    const later: ParsedRow[] = Array.from({ length: 12 }, (_, index) => ({
      known: false,
      stackId: `later-${index}`,
      state: "someday",
      text: `- later-${index} <!-- sluiceway:row stack="later-${index}" state="someday" -->\n  <!-- /sluiceway:row -->`,
    }));
    const base = input([pending("a"), pending("b")]);
    const body = renderBody({ ...base, rows: [...base.rows, ...later] });
    expect(paragraphs(body)[1]).toBe(centered("pending-2", "Sluiceway: 2 stacks are pending"));
  });

  // When bad news wins, the crates still say how many wait (record 0066).
  test("ten pending rows under a header state that is not pending show ten crates", () => {
    const ten = Array.from({ length: 10 }, (_, index) => pending(`stack-${index}`));
    expect(paragraphs(renderBody(input([...ten, deploying("z")])))[1]).toBe(
      centered("deploying-10", "Sluiceway: deploying, 10 stacks are pending"),
    );
    expect(paragraphs(renderBody(input([...ten, previewFailed("z")])))[1]).toBe(
      centered("failing-10", "Sluiceway: something failed, 10 stacks are pending"),
    );
  });

  // Records 0043 and 0075: a sign is added to the picture of the real state,
  // with the crates that state already had. A delete puts up the delete
  // sign, a replace the replace sign.
  test.each<[number, string, string]>([
    [1, "pending-1-deletes", "Sluiceway: 1 stack is pending"],
    [3, "pending-3-deletes", "Sluiceway: 3 stacks are pending"],
    [12, "pending-12-deletes", "Sluiceway: 12 stacks are pending"],
    [13, "pending-13-deletes", "Sluiceway: 13 stacks are pending"],
    [21, "pending-more-deletes", "Sluiceway: more than 20 stacks are pending"],
  ])("a pending header with a delete at %i pending rows is %s", (count, file, alt) => {
    const rows = Array.from({ length: count }, (_, index) =>
      pending(`stack-${index}`, index === 0 ? ["delete"] : ["update"]),
    );
    const body = renderBody(input([...rows, inSync("calm")]));
    expect(paragraphs(body)[1]).toBe(centered(file, `${alt}, some delete resources`));
  });

  test("a replace puts up the replace sign, and a delete and a replace put up both", () => {
    expect(paragraphs(renderBody(input([pending("a", ["replace"]), pending("b")])))[1]).toBe(
      centered("pending-2-replaces", "Sluiceway: 2 stacks are pending, some replace resources"),
    );
    expect(
      paragraphs(renderBody(input([pending("a", ["replace"]), pending("b", ["delete"])])))[1],
    ).toBe(
      centered(
        "pending-2-deletes-replaces",
        "Sluiceway: 2 stacks are pending, some delete or replace resources",
      ),
    );
  });

  test("a deploying header gets the sign from a deploying row", () => {
    const body = renderBody(input([deploying("a", 1, 0), pending("b"), inSync("c")]));
    expect(paragraphs(body)[1]).toBe(centered("deploying-1-replaces", SIGNED_ALT.deploying));
  });

  test("a deploying header gets the sign from a pending row", () => {
    const body = renderBody(input([deploying("a"), pending("b", ["create", "delete"])]));
    expect(paragraphs(body)[1]).toBe(
      centered(
        "deploying-1-deletes",
        "Sluiceway: deploying, 1 stack is pending, some changes delete resources",
      ),
    );
  });

  // A marker an older version wrote does not say how many are deletes, so
  // they count as deletes (record 0075).
  test("a deploying row from an older marker puts up the delete sign", () => {
    const body = renderBody(input([deploying("a", 2), inSync("c")]));
    expect(paragraphs(body)[1]).toBe(
      centered("deploying-0-deletes", "Sluiceway: deploying, some changes delete resources"),
    );
  });

  test("a queued header gets the sign from a queued row", () => {
    const body = renderBody(input([queued("a", 2, 1), inSync("c")]));
    expect(paragraphs(body)[1]).toBe(
      centered(
        "queued-0-deletes-replaces",
        "Sluiceway: queued behind dependencies, some changes delete or replace resources",
      ),
    );
  });

  // Record 0066 amends 0043: the jam gets the sign too, from the same rule.
  test.each<[string, Row[], string, string]>([
    [
      "a pending row",
      [pending("a", ["delete"]), previewFailed("b")],
      "failing-1-deletes",
      "Sluiceway: something failed, 1 stack is pending, some changes delete resources",
    ],
    [
      "a deploying row",
      [deploying("a", 1, 0), { ...inSync("b"), failure: FAILURE }],
      "failing-0-replaces",
      "Sluiceway: something failed, some changes replace resources",
    ],
  ])("a failing header gets the sign from %s", (_, rows, file, alt) => {
    expect(paragraphs(renderBody(input(rows)))[1]).toBe(centered(file, alt));
  });

  test("a failing header without a destroy has no sign", () => {
    const body = renderBody(input([pending("a"), previewFailed("b")]));
    expect(body).not.toMatch(/-(deletes|replaces)-/);
  });

  test("an in sync or preview failed row does not turn the sign on", () => {
    const carried = parseDashboard(
      [
        '- a <!-- sluiceway:row stack="a" state="in-sync" destroys="2" -->',
        "  <!-- /sluiceway:row -->",
        '- **b** · update <!-- sluiceway:row stack="b" state="pending" hash="3fa9c1e2aabbccdd" -->',
        "  <!-- /sluiceway:row -->",
      ].join("\n"),
    ).rows;
    expect(paragraphs(renderBody(input([], { rows: carried })))[1]).toBe(
      centered("pending-1", ALT.pending),
    );
  });

  test("a row of an unknown state with destroys does not turn the sign on", () => {
    const later = parseDashboard(
      '- later <!-- sluiceway:row stack="later" state="someday" destroys="3" -->\n  <!-- /sluiceway:row -->',
    ).rows;
    const base = input([pending("a")]);
    const body = renderBody({ ...base, rows: [...base.rows, ...later] });
    expect(paragraphs(body)[1]).toBe(centered("pending-1", ALT.pending));
  });

  test("is served from the exact ref it is given, a commit SHA as well", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const body = renderBody(input(DASHBOARDS.pending, { actionRef: sha }));
    expect(body).toContain(
      `src="https://raw.githubusercontent.com/sluiceway/sluiceway/${sha}/assets/mascot/pending-1-light.svg"`,
    );
    expect(body).toEndWith(
      "<sub>[Sluiceway](https://github.com/sluiceway/sluiceway) `0123456` · [docs](https://docs.sluiceway.dev/)</sub>",
    );
  });

  test("a redacted dashboard gets the same header", () => {
    const blocks = (redact: boolean) => rows58().map((row) => rowBlock(row, { redact }));
    const [, picture, , counts] = paragraphs(renderBody({ ...input([]), rows: blocks(true) }));
    const full = paragraphs(renderBody({ ...input([]), rows: blocks(false) }));
    expect([full[1], full[3]]).toEqual([picture ?? "", counts ?? ""]);
    // The fixture has preview failures and 11 pending stacks, with deletes and
    // replaces among them, so its header is the jam with 11 crates and both
    // signs, with dots.
    expect(picture).toContain("/failing-11-deletes-replaces-light.svg");
    expect(counts).toStartWith("🟡&nbsp;**11 pending** · ");
  });
});

// Record 0040: under a header the two lines are one centered block. The
// paragraphs are the root marker, the picture, the opening tag, the counts
// line, the scan line and the closing tag.
describe("the centered block", () => {
  test.each(NAMED_DASHBOARDS)(
    "%s: both lines sit inside one div, each still Markdown",
    (_name, rows) => {
      const body = renderBody(input(rows));
      const all = paragraphs(body);
      expect(all[2]).toBe('<div align="center">');
      expect(all[3]).toContain(" pending** · ");
      expect(all[4]).toStartWith("Scanned [`8c41f0e`](");
      expect(all[5]).toBe("</div>");
      // Deploying comes first while it has rows (record 0063).
      expect(all[6]).toBe(
        rows.some((row) => row.state === "deploying") ? "## Deploying" : "## Pending",
      );
      expect(body.match(/<div align="center">/g)).toHaveLength(1);
      expect(body.match(/<\/div>/g)).toHaveLength(1);
    },
  );

  test("the block is exactly the seven lines of the plan", () => {
    const body = renderBody(input([]));
    const lines = body.split("\n");
    const at = lines.indexOf('<div align="center">');
    expect(lines.slice(at, at + 7)).toEqual([
      '<div align="center">',
      "",
      "⚪&nbsp;**0 pending** · ⚪&nbsp;0 deploying · ⚪&nbsp;0 preview failed · ⚪&nbsp;0 in sync",
      "",
      `Scanned [\`8c41f0e\`](${REPO_URL}/commit/8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c) on 2026-09-21 10:02 UTC · [run](${RUN_URL}) · <sub>last full scan 2026-09-21 06:00 UTC</sub>`,
      "",
      "</div>",
    ]);
  });
});

// The wording is record 0029's and has no dots when there is no header: with
// personality off (0034).
describe("the counts line", () => {
  const OFF = { personality: false };
  const ONE_OF_EACH = [
    { ...pending("a", ["delete"]), failure: FAILURE },
    deploying("b", 3),
    previewFailed("c"),
    inSync("d"),
  ];

  // The line record 0029 was judged on, from the same made-up dashboard.
  test("the 58 stack fixture", () => {
    const body = renderBody({ ...input([], OFF), rows: rows58().map((row) => rowBlock(row)) });
    expect(paragraphs(body)[1]).toBe(
      "**11 pending** · 2 deploying · 2 preview failed · 43 in sync · :warning: **4 pending stacks destroy resources** · 2 failed deploys",
    );
  });

  test("keeps its shape when every count is 0", () => {
    expect(paragraphs(renderBody(input([], OFF)))[1]).toBe(
      "**0 pending** · 0 deploying · 0 preview failed · 0 in sync",
    );
  });

  test("one of each", () => {
    expect(paragraphs(renderBody(input(ONE_OF_EACH, OFF)))[1]).toBe(
      "**1 pending** · 1 deploying · 1 preview failed · 1 in sync · :warning: **1 pending stack destroys resources** · 1 failed deploy",
    );
  });

  // Record 0043: there is no plain header any more, so a body with a destroy
  // has the dots of whatever header it shows.
  test("the 58 stack fixture under a header has dots, and none on the destroy warning", () => {
    const big = renderBody({ ...input([]), rows: rows58().map((row) => rowBlock(row)) });
    expect(paragraphs(big)[3]).toBe(
      "🟡&nbsp;**11 pending** · 🔵&nbsp;2 deploying · 🔴&nbsp;2 preview failed · 🟢&nbsp;43 in sync · :warning: **4 pending stacks destroy resources** · 🔴&nbsp;2 failed deploys",
    );
  });
});

// Record 0040. The example line is the one in the record.
describe("the count dots", () => {
  const many = (count: number, row: (stackId: string) => Row, name: string) =>
    Array.from({ length: count }, (_, index) => row(`${name}-${index}`));

  test("the line of record 0040", () => {
    const rows = [
      ...many(7, (id) => pending(id), "pending"),
      ...many(2, (id) => deploying(id), "deploying"),
      ...many(2, previewFailed, "broken"),
      ...many(41, inSync, "calm"),
      ...many(2, (id) => ({ ...inSync(id), failure: FAILURE }), "failed"),
    ];
    expect(paragraphs(renderBody(input(rows)))[3]).toBe(
      "🟡&nbsp;**7 pending** · 🔵&nbsp;2 deploying · 🔴&nbsp;2 preview failed · 🟢&nbsp;43 in sync · 🔴&nbsp;2 failed deploys",
    );
  });

  test("a count of 0 gets the white dot, so red always means there is something to look at", () => {
    expect(paragraphs(renderBody(input([])))[3]).toBe(
      "⚪&nbsp;**0 pending** · ⚪&nbsp;0 deploying · ⚪&nbsp;0 preview failed · ⚪&nbsp;0 in sync",
    );
    expect(paragraphs(renderBody(input(DASHBOARDS["in-sync"])))[3]).toBe(
      "⚪&nbsp;**0 pending** · ⚪&nbsp;0 deploying · ⚪&nbsp;0 preview failed · 🟢&nbsp;2 in sync",
    );
    expect(paragraphs(renderBody(input(DASHBOARDS.deploying)))[3]).toBe(
      "🟡&nbsp;**1 pending** · 🔵&nbsp;1 deploying · ⚪&nbsp;0 preview failed · 🟢&nbsp;1 in sync",
    );
  });

  test("one failed deploy is in the singular, and the line ends without it at 0", () => {
    expect(paragraphs(renderBody(input([{ ...inSync("a"), failure: FAILURE }])))[3]).toBe(
      "⚪&nbsp;**0 pending** · ⚪&nbsp;0 deploying · ⚪&nbsp;0 preview failed · 🟢&nbsp;1 in sync · 🔴&nbsp;1 failed deploy",
    );
  });

  // Record 0043: the dots are shown whenever there is a header, also when the
  // picture carries the destroy sign. The warning keeps its `:warning:`.
  test("the body with the sign has dots, the white dot at 0, and no dot on the warning", () => {
    expect(paragraphs(renderBody(input(SIGNED.pending)))[3]).toBe(
      "🟡&nbsp;**2 pending** · ⚪&nbsp;0 deploying · ⚪&nbsp;0 preview failed · 🟢&nbsp;1 in sync · :warning: **1 pending stack destroys resources**",
    );
    expect(paragraphs(renderBody(input(SIGNED.deploying)))[3]).toBe(
      "🟡&nbsp;**1 pending** · 🔵&nbsp;1 deploying · ⚪&nbsp;0 preview failed · 🟢&nbsp;1 in sync",
    );
  });

  test("the destroy warning gets no dot", () => {
    for (const personality of [true, false]) {
      const body = renderBody(input(SIGNED.pending, { personality }));
      expect(body).toContain(" · :warning: **1 pending stack destroys resources**");
      expect(body).not.toMatch(/&nbsp;:warning:/);
    }
  });

  // Slice 4.5 adds the recently deployed list. Never a row, and never the
  // voice (record 0032).
  test("the dots are nowhere but on the counts line and the recently deployed list", () => {
    for (const [, rows] of NAMED_DASHBOARDS) {
      const all = paragraphs(renderBody(input(rows, { recentlyDeployed: RECENT })));
      const trail = all.indexOf("## Recently deployed") + 2;
      const rest = all.filter((_, index) => index !== 3 && index !== trail).join("\n");
      expect(rest).not.toMatch(/🟡|🔵|🔴|🟢|⚪|🟠|🟣|&nbsp;/u);
    }
  });
});

describe("the scan line", () => {
  test("leaves the last full scan out when the root marker does not hold it", () => {
    const { fullScanAt: _at, fullScanRun: _run, ...root } = ROOT;
    expect(paragraphs(renderBody(input([], { root })))[4]).toBe(
      `Scanned [\`8c41f0e\`](${REPO_URL}/commit/8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c) on 2026-09-21 10:02 UTC · [run](${RUN_URL})`,
    );
  });

  // A writer other than the scan takes the root facts from the live body,
  // which anyone with write access can edit.
  test("root facts that were edited by hand cannot break out of the line or throw", () => {
    const root = {
      scanSha: "`](x) **",
      scanRun: "1) [x](y",
      scanAt: "yesterday",
      fullScanAt: "never",
    };
    expect(paragraphs(renderBody(input([], { root })))[4]).toBe(
      `Scanned [\`&#96;&#93;(x) &#42;\`](${REPO_URL}/commit/%60%5D%28x%29%20%2A%2A) · [run](${REPO_URL}/actions/runs/1%29%20%5Bx%5D%28y)`,
    );
  });

  // Record 0028. The words are the ones the owner judged on the over budget
  // prototype. The count comes from the row markers, because that is all a
  // writer other than the scan can read (record 0009).
  test("the note about shortened rows sits directly under it, outside the centered block", () => {
    const blocks = [
      rowBlock(pending("a"), { level: 3 }),
      rowBlock(pending("b")),
      rowBlock(pending("c"), { level: 1 }),
      rowBlock(inSync("d")),
    ];
    const all = paragraphs(renderBody(input([], { rows: blocks })));
    expect(all.slice(2, 6)).toEqual([
      '<div align="center">',
      "🟡&nbsp;**3 pending** · ⚪&nbsp;0 deploying · ⚪&nbsp;0 preview failed · 🟢&nbsp;1 in sync",
      all[4] ?? "",
      "</div>",
    ]);
    expect(all[6]).toBe(
      "> [!NOTE]\n> This dashboard is too large for one issue, so 2 of 3 pending rows are shortened. The summary that a shortened row links to shows every change. Deletes and replaces are the last thing to be cut.",
    );
    expect(all[7]).toBe("## Pending");

    // With personality off it sits under the scan line as it always did.
    const off = paragraphs(renderBody(input([], { rows: blocks, personality: false })));
    expect(off[2]).toBe(all[4] ?? "");
    expect(off[3]).toBe(all[6] ?? "");
    expect(off[4]).toBe("## Pending");
  });

  test("the note counts one row and one pending row in the singular", () => {
    const one = renderBody(input([], { rows: [rowBlock(pending("a"), { level: 2 })] }));
    expect(paragraphs(one)[6]).toStartWith(
      "> [!NOTE]\n> This dashboard is too large for one issue, so 1 of 1 pending row is shortened. ",
    );
    const two = renderBody(
      input([], { rows: [rowBlock(pending("a"), { level: 2 }), rowBlock(pending("b"))] }),
    );
    expect(paragraphs(two)[6]).toContain("so 1 of 2 pending rows is shortened.");
  });

  // Record 0084 (issue 188): the budget shortens drifted rows too, so the
  // note counts them. It names each section that has a shortened row, so it
  // is true for any mix, and with only pending rows it reads as it always did.
  describe("names each section that has a shortened row", () => {
    // Each row with the level the budget left it at.
    const note = (rows: [Row, RowLevel][]) =>
      paragraphs(
        renderBody(input([], { rows: rows.map(([row, level]) => rowBlock(row, { level })) })),
      )[6];
    const words = (count: string) =>
      `> [!NOTE]\n> This dashboard is too large for one issue, so ${count} shortened. The summary that a shortened row links to shows every change. Deletes and replaces are the last thing to be cut.`;

    test("only pending rows shortened", () => {
      expect(
        note([
          [pending("a"), 2],
          [pending("b"), 0],
          [drifted("c"), 0],
        ]),
      ).toBe(words("1 of 2 pending rows is"));
    });

    test("only drifted rows shortened", () => {
      expect(
        note([
          [pending("a"), 0],
          [drifted("b"), 2],
          [drifted("c"), 0],
        ]),
      ).toBe(words("1 of 2 drifted rows is"));
      expect(
        note([
          [drifted("b"), 2],
          [drifted("c"), 2],
        ]),
      ).toBe(words("2 of 2 drifted rows are"));
    });

    test("both pending and drifted rows shortened", () => {
      expect(
        note([
          [pending("a"), 3],
          [pending("b"), 1],
          [drifted("c"), 2],
        ]),
      ).toBe(words("2 of 2 pending rows and 1 of 1 drifted row are"));
    });
  });

  test("a body with every row in full has no note", () => {
    expect(renderBody(input(DASHBOARDS.pending))).not.toContain("[!NOTE]");
  });

  // Slice 1.7 found that the note would vanish the first time `resolve`
  // re-renders. A writer that holds nothing but the live body keeps it.
  test("the note survives a writer that only has the row blocks", () => {
    const body = renderBody(
      input([], { rows: [rowBlock(pending("a"), { level: 3 }), rowBlock(pending("b"))] }),
    );
    expect(body).toContain("1 of 2 pending rows is shortened");
    expect(renderBody(input([], { rows: parseDashboard(body).rows }))).toBe(body);
  });

  test("only a pending row counts as shortened", () => {
    const carried = parseDashboard(
      [
        '- **a** · deploying <!-- sluiceway:row stack="a" state="deploying" shortened="3" -->',
        "  <!-- /sluiceway:row -->",
      ].join("\n"),
    ).rows;
    expect(renderBody(input([], { rows: carried }))).not.toContain("[!NOTE]");
  });
});

describe("the sections", () => {
  test("Pending is always shown, every other section only when it has rows", () => {
    expect(headings(renderBody(input([])))).toEqual(["## Pending"]);
    expect(headings(renderBody(input(DASHBOARDS["in-sync"])))).toEqual([
      "## Pending",
      "## In sync",
    ]);
    expect(headings(renderBody(input([deploying("a")])))).toEqual(["## Deploying", "## Pending"]);
    expect(headings(renderBody(input(DASHBOARDS.failing, { recentlyDeployed: RECENT })))).toEqual([
      "## Deploying",
      "## Pending",
      "## Preview failed",
      "## In sync",
      "## Recently deployed",
    ]);
  });

  test("inside a section rows are sorted by stack id, by code unit", () => {
    const ids = ["b", "a:prod", "B", "a/x", "ä", "a"];
    const body = renderBody(input(ids.map((id) => pending(id))));
    expect(parseDashboard(body).rows.map((row) => row.stackId)).toEqual([
      "B",
      "a",
      "a/x",
      "a:prod",
      "b",
      "ä",
    ]);
  });

  test("a row with a delete is not moved to the top of Pending", () => {
    const body = renderBody(input([pending("a"), pending("b", ["delete"]), pending("c")]));
    expect(parseDashboard(body).rows.map((row) => row.stackId)).toEqual(["a", "b", "c"]);
  });

  test("the preview failed section says what its rows cannot do", () => {
    const all = paragraphs(renderBody(input([previewFailed("a")])));
    expect(all[all.indexOf("## Preview failed") + 1]).toBe(
      "These stacks could not be previewed, so they cannot be deployed from here until a scan succeeds.",
    );
  });
});

describe("the in sync section", () => {
  test("is a fold", () => {
    const all = paragraphs(renderBody(input([inSync("a"), inSync("b")])));
    const at = all.indexOf("## In sync");
    expect(all.slice(at + 1, at + 4)).toEqual([
      "<details><summary>2 stacks in sync</summary>",
      `${rowBlock(inSync("a")).text}\n${rowBlock(inSync("b")).text}`,
      "</details>",
    ]);
  });

  // The 58 stack fixture has one: data/warehouse:prod.
  test("a row with a failure line is listed open, above the fold", () => {
    const all = paragraphs(
      renderBody({ ...input([]), rows: rows58().map((row) => rowBlock(row)) }),
    );
    const at = all.indexOf("## In sync");
    expect(all[at + 1]).toStartWith("- data/warehouse:prod <!-- sluiceway:row");
    expect(all[at + 1]).toContain(":x: last deploy failed");
    expect(all[at + 2]).toBe("<details><summary>42 more in sync</summary>");
    expect(all[at + 3]?.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(42);
    expect(all[at + 3]).not.toContain("data/warehouse:prod");
  });

  test("has no fold when every row in it has a failure line", () => {
    const body = renderBody(input([{ ...inSync("a"), failure: FAILURE }]));
    expect(body).toContain("## In sync");
    expect(body).not.toContain("<details>");
  });
});

// Slice 2.20 (record 0051): a stack left out with a reason is listed with it,
// in a fold of its own under In sync, so an exclusion never rots out of sight.
describe("the ignored fold", () => {
  const IGNORED = [
    { stackId: "apps/legacy:dev", reason: "Deployed by the platform team" },
    { stackId: "apps/legacy:prod", reason: "Deployed by the platform team" },
  ];

  test("comes after the in sync fold, one line per stack with its reason", () => {
    const all = paragraphs(renderBody(input([inSync("a")], { ignored: IGNORED })));
    const at = all.indexOf("## In sync");
    expect(all.slice(at + 1, at + 7)).toEqual([
      "<details><summary>1 stack in sync</summary>",
      rowBlock(inSync("a")).text,
      "</details>",
      "<details><summary>2 stacks left out by ignore</summary>",
      "- apps/legacy:dev · Deployed by the platform team\n- apps/legacy:prod · Deployed by the platform team",
      "</details>",
    ]);
  });

  test("keeps the In sync heading when no stack is in sync", () => {
    const all = paragraphs(renderBody(input([pending("a")], { ignored: IGNORED.slice(0, 1) })));
    const at = all.indexOf("## In sync");
    expect(all.slice(at + 1, at + 4)).toEqual([
      "<details><summary>1 stack left out by ignore</summary>",
      "- apps/legacy:dev · Deployed by the platform team",
      "</details>",
    ]);
    expect(all[1]).toBeDefined();
  });

  test("changes nothing else: no count, no header state, no row", () => {
    const without = renderBody(input([pending("a"), inSync("b")]));
    const withIt = renderBody(input([pending("a"), inSync("b")], { ignored: IGNORED }));
    expect(withIt.split("\n\n## In sync")[0]).toBe(without.split("\n\n## In sync")[0]);
    expect(parseDashboard(withIt).rows.map((row) => row.stackId)).toEqual(["a", "b"]);
    expect(renderBody(input([pending("a"), inSync("b")], { ignored: [] }))).toBe(without);
  });

  test("the reason is text from the config and never markup", () => {
    const body = renderBody(
      input([], { ignored: [{ stackId: "a:b", reason: "<b>see</b> [docs](x)\n- [ ] tick" }] }),
    );
    expect(body).toContain("- a:b · &lt;b&gt;see&lt;/b&gt; &#91;docs&#93;(x) - &#91; &#93; tick");
  });
});

describe("recently deployed", () => {
  test("a plain list, newest first, each line with the green dot of a deploy", () => {
    const all = paragraphs(
      renderBody(input(DASHBOARDS["in-sync"], { recentlyDeployed: [...RECENT].reverse() })),
    );
    expect(all[all.indexOf("## Recently deployed") + 2]).toBe(
      [
        `- 🟢&nbsp;apps/auth:prod · alice · 09-21 09:41 · [run](${REPO_URL}/actions/runs/17034388102)`,
        `- 🟢&nbsp;apps/auth:staging · alice · 09-21 09:12 · [run](${REPO_URL}/actions/runs/17034120455)`,
        `- 🟢&nbsp;platform/external-dns:prod · carol · 09-20 17:30 · [run](${REPO_URL}/actions/runs/17029910331)`,
      ].join("\n"),
    );
  });

  // Slice 4.5: the dots belong to the header, as the count dots do (record
  // 0040), so a dashboard without personality keeps the plain list.
  test("without personality the list has no dots", () => {
    const all = paragraphs(
      renderBody(
        input(DASHBOARDS["in-sync"], {
          recentlyDeployed: [
            ...RECENT,
            { ...(RECENT[0] as RecentDeploy), result: "rehearsed" },
            { ...(RECENT[0] as RecentDeploy), result: "in-sync" },
          ],
          personality: false,
        }),
      ),
    );
    const lines = all[all.indexOf("## Recently deployed") + 2]?.split("\n") ?? [];
    expect(lines).toHaveLength(5);
    for (const line of lines) expect(line).toMatch(/^- [a-z]/);
  });

  test("the newest 10 and no more", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      stackId: `stack-${index}`,
      ticker: "alice",
      at: new Date(Date.UTC(2026, 8, 1 + index, 12)),
      runUrl: "run-url",
    }));
    const all = paragraphs(renderBody(input([], { recentlyDeployed: many })));
    const lines = all[all.indexOf("## Recently deployed") + 2]?.split("\n") ?? [];
    expect(lines).toHaveLength(10);
    expect(lines[0]).toStartWith("- 🟢&nbsp;stack-11 ·");
    expect(lines[9]).toStartWith("- 🟢&nbsp;stack-2 ·");
  });

  test("two deploys in the same millisecond are ordered by stack id", () => {
    const at = new Date("2026-09-21T09:41:07Z");
    const twins = ["b", "a"].map((stackId) => ({ stackId, ticker: "x", at, runUrl: "u" }));
    const body = renderBody(input([], { recentlyDeployed: twins }));
    expect(body.indexOf("- 🟢&nbsp;a ·")).toBeLessThan(body.indexOf("- 🟢&nbsp;b ·"));
    expect(body).toBe(renderBody(input([], { recentlyDeployed: [...twins].reverse() })));
  });

  test("a stack id and a login are never trusted as markup", () => {
    const hostile = [{ stackId: "a*b", ticker: "<x>", at: new Date(0), runUrl: "u" }];
    expect(renderBody(input([], { recentlyDeployed: hostile }))).toContain(
      "- 🟢&nbsp;a&#42;b · &lt;x&gt; · 1970-01-01 00:00 · [run](u)",
    );
  });

  // Slice 2.20 (record 0051): the trail says when nothing went out.
  test("a rehearsal says so, with the purple dot", () => {
    const all = paragraphs(
      renderBody(
        input(DASHBOARDS["in-sync"], {
          recentlyDeployed: [{ ...(RECENT[0] as RecentDeploy), result: "rehearsed" }],
        }),
      ),
    );
    expect(all[all.indexOf("## Recently deployed") + 2]).toBe(
      "- 🟣&nbsp;apps/auth:prod · rehearsed · alice · 09-21 09:41 · [run](https://github.com/example-org/infra/actions/runs/17034388102)",
    );
  });

  // Slice 4.7 (record 0059): a deploy that put drift back says so.
  test("a drift repair says so, with the green dot of a deploy", () => {
    const all = paragraphs(
      renderBody(
        input(DASHBOARDS["in-sync"], {
          recentlyDeployed: [{ ...(RECENT[0] as RecentDeploy), result: "drift-repaired" }],
        }),
      ),
    );
    expect(all[all.indexOf("## Recently deployed") + 2]).toBe(
      "- 🟢&nbsp;apps/auth:prod · drift fixed · alice · 09-21 09:41 · [run](https://github.com/example-org/infra/actions/runs/17034388102)",
    );
  });

  test("a deploy that found nothing to deploy says so, with the white dot", () => {
    const all = paragraphs(
      renderBody(
        input(DASHBOARDS["in-sync"], {
          recentlyDeployed: [{ ...(RECENT[0] as RecentDeploy), result: "in-sync" }],
        }),
      ),
    );
    expect(all[all.indexOf("## Recently deployed") + 2]).toBe(
      "- ⚪&nbsp;apps/auth:prod · no changes · alice · 09-21 09:41 · [run](https://github.com/example-org/infra/actions/runs/17034388102)",
    );
  });
});

// Record 0075: the good-news line is picked by the day of the scan on the
// root marker, so every writer of the same scan gives the same line.
describe("the good-news line of the day", () => {
  const onDay = (scanAt: string) =>
    lineUnderPending(renderBody(input(DASHBOARDS["in-sync"], { root: { ...ROOT, scanAt } })));

  test("three scan days give three lines, and the fourth the first again", () => {
    expect(
      [
        "2026-09-19T08:00:00Z",
        "2026-09-20T23:59:00Z",
        "2026-09-21T00:00:00Z",
        "2026-09-22T12:00:00Z",
      ].map(onDay),
    ).toEqual([
      "Gate closed, water calm. Nothing to deploy.",
      "Level water on both sides of the gate. Nothing to deploy.",
      "Still water upstream. Nothing to deploy.",
      "Gate closed, water calm. Nothing to deploy.",
    ]);
  });

  test("a scan time that does not parse gives the first line", () => {
    expect(onDay("yesterday")).toBe("Gate closed, water calm. Nothing to deploy.");
  });

  test("without personality the dry line stays whatever the day", () => {
    const dry = (scanAt: string) =>
      lineUnderPending(
        renderBody(input(DASHBOARDS["in-sync"], { root: { ...ROOT, scanAt }, personality: false })),
      );
    expect(dry("2026-09-19T08:00:00Z")).toBe(dry("2026-09-20T08:00:00Z"));
  });
});

// Records 0032 and 0034: which words stand under the Pending heading.
describe("the line under the Pending heading", () => {
  const INSTRUCTION = "Tick a box to deploy that stack exactly as its row shows it.";
  const cases: [string, Row[], string, string][] = [
    // The scan of ROOT ran on 2026-09-21, the day of the third good-news line
    // (record 0075).
    [
      "in sync",
      DASHBOARDS["in-sync"],
      "Still water upstream. Nothing to deploy.",
      "Nothing to deploy. All 2 stacks are in sync.",
    ],
    [
      "first run",
      [],
      "The channel is dry. Add a stack to `sluiceway.yaml` and the next scan fills it.",
      "No stacks found yet. Add one to `sluiceway.yaml` and the next scan lists it here.",
    ],
    ["pending", DASHBOARDS.pending, INSTRUCTION, INSTRUCTION],
    ["deploying with rows pending", DASHBOARDS.deploying, INSTRUCTION, INSTRUCTION],
    ["failing with rows pending", DASHBOARDS.failing, INSTRUCTION, INSTRUCTION],
    ["a destroy with rows pending", SIGNED.pending, INSTRUCTION, INSTRUCTION],
    [
      "failing with nothing pending",
      [previewFailed("a"), inSync("b")],
      "Nothing to deploy.",
      "Nothing to deploy.",
    ],
    [
      "deploying with nothing pending",
      [deploying("a"), inSync("b")],
      "Nothing to deploy.",
      "Nothing to deploy.",
    ],
    [
      "queued with nothing pending",
      [queued("a"), inSync("b")],
      "Nothing to deploy.",
      "Nothing to deploy.",
    ],
    // This body was plain before record 0043 and is deploying now. Its line
    // does not change.
    [
      "a destroy with nothing pending",
      [deploying("a", 1), inSync("b")],
      "Nothing to deploy.",
      "Nothing to deploy.",
    ],
  ];

  test.each(cases)("%s", (_name, rows, withPersonality, without) => {
    expect(lineUnderPending(renderBody(input(rows)))).toBe(withPersonality);
    expect(lineUnderPending(renderBody(input(rows, { personality: false })))).toBe(without);
  });
});

describe("dashboard.personality: false", () => {
  test("the root marker is followed directly by the counts line", () => {
    const all = paragraphs(renderBody(input(DASHBOARDS.pending, { personality: false })));
    expect(all[0]).toStartWith("<!-- sluiceway:dashboard ");
    expect(all[1]).toBe("**1 pending** · 0 deploying · 0 preview failed · 1 in sync");
  });

  test("no picture, no centering and no dots", () => {
    for (const [, body] of ALL_BODIES().filter(([, body]) => !body.personality))
      expect(renderBody(body)).not.toMatch(
        /<picture>|<img|align=|<div|<p |🟡|🟠|🔵|🔴|🟢|⚪|&nbsp;/u,
      );
  });

  // The header is the picture, the two tags of the centered block and the
  // dots. Take those and the voice away and the two bodies are the same.
  test("nothing else changes", () => {
    for (const [, rows] of NAMED_DASHBOARDS) {
      const on = paragraphs(renderBody(input(rows, { recentlyDeployed: RECENT })));
      const off = paragraphs(
        renderBody(input(rows, { recentlyDeployed: RECENT, personality: false })),
      );
      const voiced = on.indexOf("## Pending") + 1;
      const trail = on.indexOf("## Recently deployed") + 2;
      expect(on[1]).toStartWith('<p align="center">\n  <picture>');
      const undotted = on
        .map((text, index) => (index === trail ? text.replaceAll(/^- 🟢&nbsp;/gmu, "- ") : text))
        .filter((_, index) => ![1, 2, 5, voiced].includes(index))
        .map((text, index) =>
          index === 1 ? text.replace(/(?:🟡|🟠|🔵|🔴|🟢|⚪)&nbsp;/gu, "") : text,
        );
      expect(off.filter((_, index) => index !== voiced - 3)).toEqual(undotted);
    }
  });
});

// Slice 2.17 (onboarding log, hurdle 16): a workflow that only scans has
// nothing that acts on a box, so `dashboard.readOnly` draws none.
describe("dashboard.readOnly: true", () => {
  const READ_ONLY_LINE =
    "This dashboard is read only, so rows have no boxes and nothing deploys from here. Rows get their boxes when `dashboard.readOnly` comes out of `sluiceway.yaml`.";

  function readOnly(rows: Row[], overrides: Partial<BodyInput> = {}): BodyInput {
    return input([], {
      rows: rows.map((row) => rowBlock(row, { readOnly: true })),
      readOnly: true,
      ...overrides,
    });
  }

  test("the line under the Pending heading says so while rows are pending", () => {
    for (const rows of [DASHBOARDS.pending, DASHBOARDS.failing, SIGNED.deploying]) {
      expect(lineUnderPending(renderBody(readOnly(rows)))).toBe(READ_ONLY_LINE);
      expect(lineUnderPending(renderBody(readOnly(rows, { personality: false })))).toBe(
        READ_ONLY_LINE,
      );
    }
  });

  test("with nothing pending the line is the one it always is", () => {
    for (const rows of [DASHBOARDS["in-sync"], [], [previewFailed("a"), inSync("b")]]) {
      expect(lineUnderPending(renderBody(readOnly(rows)))).toBe(
        lineUnderPending(renderBody(input(rows))),
      );
    }
  });

  test("there is no rescan box and no box on any row", () => {
    const body = renderBody(readOnly(DASHBOARDS.failing, { recentlyDeployed: RECENT }));
    expect(body).not.toContain("sluiceway:rescan");
    expect(body).not.toContain("Rescan all stacks");
    expect(body).not.toMatch(/^\s*- \[[ xX]\]/m);
    expect(body).toContain("\n---\n\n<sub>[Sluiceway](");
    expect(parseDashboard(body).rows.filter((row) => row.known && row.ticked)).toEqual([]);
  });

  // Take the boxes and the line under the heading away, and the two bodies
  // are the same.
  test("nothing else changes", () => {
    for (const [, rows] of NAMED_DASHBOARDS) {
      for (const personality of [true, false]) {
        const unboxed = (text: string) =>
          text
            .replace("\n\n- [ ] Rescan all stacks <!-- sluiceway:rescan -->", "")
            .replace(/^(\s*)- \[ \] /gm, "$1- ");
        const on = paragraphs(
          renderBody(readOnly(rows, { recentlyDeployed: RECENT, personality })),
        );
        const off = paragraphs(
          unboxed(renderBody(input(rows, { recentlyDeployed: RECENT, personality }))),
        );
        const line = on.indexOf("## Pending") + 1;
        expect(on.filter((_, index) => index !== line)).toEqual(
          off.filter((_, index) => index !== line),
        );
      }
    }
  });
});

describe("a row of a state this version does not know", () => {
  const later: ParsedRow = {
    known: false,
    stackId: "apps/later:prod",
    state: "someday",
    text: '- [x] **apps/later:prod** · someday <!-- sluiceway:row stack="apps/later:prod" state="someday" -->\n  anything at all\n  <!-- /sluiceway:row -->',
  };

  test("is placed at the end of the body, byte for byte, and left out of the counts", () => {
    const base = input(DASHBOARDS.pending);
    const body = renderBody({ ...base, rows: [later, ...base.rows] });
    expect(body).toBe(`${renderBody(base)}\n\n${later.text}`);
    expect(parseDashboard(body).rows.at(-1)).toEqual(later);
    expect(parseDashboard(body).rescanTicked).toBe(false);
  });

  // In sync is a claim about every stack, and this one is not known to be calm.
  test("takes the voice and the count of stacks out of the good-news line", () => {
    for (const personality of [true, false]) {
      const base = input(DASHBOARDS["in-sync"], { personality });
      const body = renderBody({ ...base, rows: [...base.rows, later] });
      expect(lineUnderPending(body)).toBe("Nothing to deploy.");
    }
  });
});

const ALL_BODIES = (): [string, BodyInput][] => [
  ...NAMED_DASHBOARDS.flatMap(([name, rows]): [string, BodyInput][] => [
    [name, input(rows, { recentlyDeployed: RECENT })],
    [`${name}, no personality`, input(rows, { recentlyDeployed: RECENT, personality: false })],
  ]),
  [
    "58 stacks",
    { ...input([], { recentlyDeployed: RECENT }), rows: rows58().map((r) => rowBlock(r)) },
  ],
  [
    "58 stacks, redacted",
    { ...input([]), rows: rows58().map((row) => rowBlock(row, { redact: true })) },
  ],
  ["100 stacks", { ...input([]), rows: rows100().map((row) => rowBlock(row, { level: 3 })) }],
  [
    "58 stacks, read only",
    {
      ...input([], { recentlyDeployed: RECENT, readOnly: true }),
      rows: rows58().map((row) => rowBlock(row, { readOnly: true })),
    },
  ],
];

// What must hold for every body a writer ever renders.
describe("every rendered body", () => {
  test.each(ALL_BODIES())(
    "%s: the same input gives the same bytes, in any order of rows",
    (_name, body) => {
      const rendered = renderBody(body);
      expect(renderBody(body)).toBe(rendered);
      expect(
        renderBody({
          ...body,
          rows: [...body.rows].reverse(),
          recentlyDeployed: [...body.recentlyDeployed].reverse(),
        }),
      ).toBe(rendered);
    },
  );

  test.each(ALL_BODIES())(
    "%s: reads back as the root facts and the same row blocks",
    (_name, body) => {
      const parsed = parseDashboard(renderBody(body));
      expect(parsed.root).toEqual({ version: 1, ...ROOT });
      expect(parsed.rescanTicked).toBe(false);
      const sorted = [...body.rows].sort((a, b) => (a.stackId < b.stackId ? -1 : 1));
      expect([...parsed.rows].sort((a, b) => (a.stackId < b.stackId ? -1 : 1))).toEqual(sorted);
    },
  );

  // Rendering what was read gives the same body, which is what lets a writer
  // skip a write (record 0004).
  test.each(ALL_BODIES())("%s: rendering what was read changes nothing", (_name, body) => {
    const rendered = renderBody(body);
    expect(renderBody({ ...body, rows: parseDashboard(rendered).rows })).toBe(rendered);
  });

  test.each(ALL_BODIES())("%s: the shape of the text", (_name, body) => {
    const rendered = renderBody(body);
    expect(rendered).toStartWith("<!-- sluiceway:dashboard ");
    expect(rendered).not.toMatch(/\n\n\n|[ \t]\n|\r|\u2014/);
    expect(rendered).not.toMatch(/\s$/);
    expect(rendered).not.toContain("Penny");
    // The picture and the centered block are top level blocks, each followed
    // by a blank line.
    if (body.personality)
      expect(rendered).toContain('  </picture>\n</p>\n\n<div align="center">\n\n');
    // One rescan box, unticked, and none on a read-only dashboard.
    if (body.readOnly) {
      expect(rendered).not.toContain("sluiceway:rescan");
    } else {
      expect(rendered.match(/sluiceway:rescan/g)).toHaveLength(1);
      expect(rendered).toContain(
        "\n---\n\n- [ ] Rescan all stacks <!-- sluiceway:rescan -->\n\n<sub>",
      );
    }
  });
});

describe("sizes", () => {
  // Record 0027 measured 37,607 characters for this dashboard.
  test("the 58 stack body is well under the target of 58,000 characters", () => {
    const body = renderBody({
      ...input([], { recentlyDeployed: RECENT }),
      rows: rows58().map((row) => rowBlock(row)),
    });
    expect(body.length).toBeGreaterThan(30_000);
    expect(body.length).toBeLessThan(45_000);
  });

  // Slice 4.11: the destroy alert above the pending list (record 0062) names
  // the pending stacks with a destroy, so the frame grows by one short id per
  // such stack. Without it the frame stays under 2,100: slice 4.15 put the
  // count and the destroy fact in the failing picture's alt text (record
  // 0066), about 100 characters more than the 2,000 it was.
  test("everything outside the row blocks is under 2,100 characters, plus the destroy alert", () => {
    const rows = rows58().map((row) => rowBlock(row));
    const body = renderBody({ ...input([], { recentlyDeployed: RECENT }), rows });
    const inside = rows.reduce((sum, row) => sum + row.text.length + 1, 0);
    const alert = body.split("\n\n").find((paragraph) => paragraph.startsWith("> [!CAUTION]"));
    expect(alert).toBeDefined();
    expect(body.length - inside - (alert?.length ?? 0)).toBeLessThan(2_100);
    expect(alert?.length).toBeLessThan(500);
  });
});

describe("snapshots", () => {
  for (const state of HEADER_STATES) {
    test(`header state ${state}`, () => {
      expect(
        `${renderBody(input(DASHBOARDS[state], { recentlyDeployed: RECENT }))}\n`,
      ).toMatchSnapshot();
    });
  }

  // Pending has one picture per crate count and one past the maximum (record
  // 0047). The header state snapshot above is one crate. Three whole bodies,
  // and the picture alone for every count, with and without the destroy sign
  // (record 0043), so the snapshots name every file.
  for (const count of [3, 12, 20, 21]) {
    test(`${count} pending`, () => {
      const rows = Array.from({ length: count }, (_, index) => pending(`stack-${index}`));
      expect(`${renderBody(input([...rows, inSync("calm")]))}\n`).toMatchSnapshot();
    });
    test(`${count} pending with the destroy sign`, () => {
      const rows = Array.from({ length: count }, (_, index) =>
        pending(`stack-${index}`, index === 0 ? ["create", "delete"] : ["update"]),
      );
      expect(`${renderBody(input([...rows, inSync("calm")]))}\n`).toMatchSnapshot();
    });
  }

  // The signs of record 0075: none, the delete sign, the replace sign, both.
  // On the pending picture they come from the first pending row, and on the
  // others from a queued row, which stands in no other rule of the header.
  const SIGNS: [string, ("delete" | "replace")[], Row[]][] = [
    ["", [], []],
    [", with the delete sign", ["delete"], [queued("signed", 1, 1)]],
    [", with the replace sign", ["replace"], [queued("signed", 1, 0)]],
    [", with both signs", ["delete", "replace"], [queued("signed", 2, 1)]],
  ];

  for (const [sign, ops] of SIGNS)
    test(`the pending picture at 1 to 21 pending${sign}`, () => {
      const pictures = Array.from({ length: 21 }, (_, index) => {
        const rows = Array.from({ length: index + 1 }, (_, row) =>
          pending(`stack-${row}`, row === 0 && ops.length > 0 ? ops : ["update"]),
        );
        return paragraphs(renderBody(input(rows)))[1];
      });
      expect(`${pictures.join("\n\n")}\n`).toMatchSnapshot();
    });

  // Records 0066 and 0075: failing, deploying and queued have one picture per
  // crate count from 0 to 20 and one past it, with each of the signs, so the
  // snapshots name every file of theirs too.
  for (const state of ["failing", "deploying", "queued"] as const)
    for (const [sign, , signed] of SIGNS)
      test(`the ${state} picture at 0 to 21 pending${sign}`, () => {
        const pictures = Array.from({ length: 22 }, (_, count) => {
          const rows = Array.from({ length: count }, (_, row) => pending(`stack-${row}`));
          const cause =
            state === "failing"
              ? [previewFailed("broken")]
              : state === "deploying"
                ? [deploying("moving")]
                : [queued("waiting")];
          return paragraphs(renderBody(input([...cause, ...signed, ...rows])))[1];
        });
        expect(`${pictures.join("\n\n")}\n`).toMatchSnapshot();
      });

  // Its deploying rows are rendered as a writer renders them under a header,
  // with the spinner (record 0063), so the snapshots name those files too.
  test("deploying with the destroy sign", () => {
    expect(
      `${renderBody({
        ...input([], { recentlyDeployed: RECENT }),
        rows: SIGNED.deploying.map((row) => rowBlock(row, { actionRef: "v0.1.0" })),
      })}\n`,
    ).toMatchSnapshot();
  });

  // Slice 2.17: pending rows without boxes, the line that says so, and no
  // rescan box.
  test("read only, failing with rows pending", () => {
    expect(
      `${renderBody({
        ...input([], { recentlyDeployed: RECENT, readOnly: true }),
        rows: DASHBOARDS.failing.map((row) => rowBlock(row, { readOnly: true })),
      })}\n`,
    ).toMatchSnapshot();
  });

  test("in sync, with stacks left out by ignore", () => {
    expect(
      `${renderBody(
        input(DASHBOARDS["in-sync"], {
          recentlyDeployed: RECENT,
          ignored: [
            { stackId: "apps/legacy:dev", reason: "Deployed by the platform team" },
            { stackId: "sandbox/playground", reason: "A scratch stack, never deployed from here" },
          ],
        }),
      )}\n`,
    ).toMatchSnapshot();
  });

  test("personality off, in sync", () => {
    expect(
      `${renderBody(input(DASHBOARDS["in-sync"], { personality: false }))}\n`,
    ).toMatchSnapshot();
  });

  test("personality off, first run", () => {
    expect(`${renderBody(input([], { personality: false }))}\n`).toMatchSnapshot();
  });

  test("personality off, failing", () => {
    expect(
      `${renderBody(input(DASHBOARDS.failing, { recentlyDeployed: RECENT, personality: false }))}\n`,
    ).toMatchSnapshot();
  });

  test("the 58 stack body", () => {
    expect(
      `${renderBody({ ...input([], { recentlyDeployed: RECENT }), rows: rows58().map((row) => rowBlock(row)) })}\n`,
    ).toMatchSnapshot();
  });

  test("the 58 stack body, redacted", () => {
    expect(
      `${renderBody({ ...input([], { recentlyDeployed: RECENT }), rows: rows58().map((row) => rowBlock(row, { redact: true })) })}\n`,
    ).toMatchSnapshot();
  });
});

// The renderer names files it cannot see, so the committed snapshots are held
// against the files on disk. Until slice 1.7b the body asked for
// `pending-<theme>.svg`, which record 0039 removed, and until slice 1.7c for
// `plain-<theme>.svg`, which record 0043 removed.
describe("the image urls in the snapshots", () => {
  const SNAPSHOTS = resolve(import.meta.dir, "..");
  const MASCOT = resolve(import.meta.dir, "../../assets/mascot");
  // The schema line of the sluiceway.yaml that init writes (record 0065) is
  // the one address that is not a picture.
  const urls = (text: string) =>
    [...text.matchAll(/https:\/\/raw\.githubusercontent\.com\/[^"\s)]+/g)]
      .map((match) => match[0])
      .filter((url) => !url.endsWith("/schema/sluiceway.schema.json"));

  const found = [...new Bun.Glob("**/__snapshots__/*.snap").scanSync(SNAPSHOTS)]
    .sort()
    .flatMap((file) => urls(readFileSync(join(SNAPSHOTS, file), "utf8")));

  test("every one names a file that exists in assets/mascot/", () => {
    expect(found.length).toBeGreaterThan(0);
    for (const url of new Set(found)) {
      const [, name] = /\/assets\/mascot\/([a-z0-9-]+\.svg)$/.exec(url) ?? [];
      expect(name, url).toBeDefined();
      expect(existsSync(join(MASCOT, name ?? "")), url).toBe(true);
    }
  });

  test("the body snapshots show every picture in both themes", () => {
    const own = urls(
      readFileSync(join(import.meta.dir, "__snapshots__/body.test.ts.snap"), "utf8"),
    );
    const files = readdirSync(MASCOT).filter((name) => name.endsWith(".svg"));
    // The 702 header files and the row spinner in both themes (records 0063,
    // 0066 and 0075).
    expect(files).toHaveLength(704);
    expect([...new Set(own.map((url) => url.split("/").at(-1) ?? ""))].sort()).toEqual(
      files.sort(),
    );
  });
});
