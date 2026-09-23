import { describe, expect, test } from "bun:test";
import { type BodyInput, type RecentDeploy, renderBody, rowBlock } from "../../src/render/body.ts";
import { fitBody } from "../../src/render/budget.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { mergeBlock } from "../../src/render/merge-row.ts";
import {
  type DeployingRow,
  type DriftRow,
  type PendingRow,
  type Row,
  renderRow,
} from "../../src/render/row.ts";

// Slice 4.12 (record 0063): Deploying moves to the top when it has rows, and a
// deploying or queued row starts with a small animated spinner. Written out by
// hand from the build plan and the record, not from the code.

const REPO_URL = "https://github.com/example-org/infra";
const RUN_URL = `${REPO_URL}/actions/runs/17034455121`;
const SPINNER = "https://raw.githubusercontent.com/sluiceway/sluiceway/v0.11.0/assets/mascot";
const PICTURE = `<picture><source media="(prefers-color-scheme: dark)" srcset="${SPINNER}/spinner-dark.svg"><img alt="" width="16" height="16" src="${SPINNER}/spinner-light.svg"></picture>`;
// A queued row's crate stands still (record 0093).
const STILL_PICTURE = `<picture><source media="(prefers-color-scheme: dark)" srcset="${SPINNER}/spinner-queued-dark.svg"><img alt="" width="16" height="16" src="${SPINNER}/spinner-queued-light.svg"></picture>`;

function pending(stackId: string, ops: ("update" | "delete")[] = ["update"]): PendingRow {
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

const deploying = (stackId: string, extra: Partial<DeployingRow> = {}): DeployingRow => ({
  state: "deploying",
  stackId,
  ticker: "carol",
  runUrl: RUN_URL,
  ...extra,
});

const RECENT: RecentDeploy[] = [
  {
    stackId: "apps/web:prod",
    ticker: "alice",
    at: new Date("2026-09-21T09:41:00Z"),
    runUrl: RUN_URL,
  },
];

function input(rows: Row[], overrides: Partial<BodyInput> = {}): BodyInput {
  return {
    root: {
      scanSha: "8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c",
      scanRun: "17034455121",
      scanAt: "2026-09-21T10:02:41Z",
    },
    rows: rows.map((row) => rowBlock(row)),
    recentlyDeployed: [],
    repoUrl: REPO_URL,
    actionRef: "v0.11.0",
    personality: true,
    ...overrides,
  };
}

const headings = (body: string) => body.split("\n").filter((line) => line.startsWith("## "));
const paragraphs = (body: string) => body.split("\n\n");

const ALL: Row[] = [
  pending("apps/api:prod"),
  drifted("apps/db:prod"),
  deploying("network:prod"),
  {
    state: "preview-failed",
    stackId: "site:prod",
    reason: "the tool exited with an error",
    runUrl: RUN_URL,
  },
  { state: "in-sync", stackId: "apps/web:prod" },
];

describe("the order of the sections", () => {
  test("Deploying comes first, then Pending, Drifted, Preview failed, In sync and Recently deployed", () => {
    expect(headings(renderBody(input(ALL, { recentlyDeployed: RECENT })))).toEqual([
      "## Deploying",
      "## Pending",
      "## Drifted",
      "## Preview failed",
      "## In sync",
      "## Recently deployed",
    ]);
  });

  test("without a deploying or queued row there is no Deploying section, and Pending comes first", () => {
    const rows = ALL.filter((row) => row.state !== "deploying");
    expect(headings(renderBody(input(rows, { recentlyDeployed: RECENT })))).toEqual([
      "## Pending",
      "## Drifted",
      "## Preview failed",
      "## In sync",
      "## Recently deployed",
    ]);
  });

  test("a queued row alone makes the section, with the deploying rows by stack id", () => {
    const body = renderBody(
      input([pending("c"), deploying("b", { behind: ["a"] }), deploying("a")]),
    );
    expect(headings(body)).toEqual(["## Deploying", "## Pending"]);
    expect(parseDashboard(body).rows.map((row) => row.stackId)).toEqual(["a", "b", "c"]);
    expect(headings(renderBody(input([deploying("b", { behind: ["a"] })])))).toEqual([
      "## Deploying",
      "## Pending",
    ]);
  });

  test("the updates waiting to merge sit between Deploying and Pending, next to the rows they add to", () => {
    const merge = mergeBlock({
      pr: 12,
      title: "chore(deps): update chart to v1.2.4",
      stackIds: ["apps/api:prod"],
      head: "0123456789abcdef0123456789abcdef01234567",
      author: "renovate[bot]",
    });
    const body = renderBody(
      input([pending("apps/api:prod"), deploying("network:prod")], { merges: [merge] }),
    );
    expect(headings(body)).toEqual(["## Deploying", "## Updates waiting to merge", "## Pending"]);
  });

  test("the counts line and the scan line stay above everything, the destroy alert right above the pending list", () => {
    const all = paragraphs(
      renderBody(input([pending("apps/api:prod", ["delete"]), deploying("network:prod")])),
    );
    const counts = all.findIndex((paragraph) => paragraph.includes("**1 pending**"));
    const top = all.indexOf("## Deploying");
    const heading = all.indexOf("## Pending");
    expect(counts).toBeGreaterThan(0);
    expect(counts).toBeLessThan(top);
    expect(top).toBeLessThan(heading);
    expect(all[heading + 2]).toStartWith("> [!CAUTION]");
    expect(all[heading + 3]).toStartWith("- [ ] **apps/api:prod**");
  });

  test("without personality the order is the same", () => {
    expect(headings(renderBody(input(ALL, { personality: false })))).toEqual([
      "## Deploying",
      "## Pending",
      "## Drifted",
      "## Preview failed",
      "## In sync",
    ]);
  });
});

describe("the spinner", () => {
  const firstLine = (row: Row, actionRef?: string) =>
    renderRow(row, { actionRef }).split("\n")[0] ?? "";

  test("a deploying row starts with it, from the ref it is given, light and dark", () => {
    expect(firstLine(deploying("network:prod"), "v0.11.0")).toBe(
      `- ${PICTURE} **network:prod** · deploying · ticked by carol · [run](${RUN_URL}) <!-- sluiceway:row stack="network:prod" state="deploying" -->`,
    );
  });

  test("a row waiting to start starts with it too", () => {
    expect(firstLine(deploying("a", { waiting: true }), "v0.11.0")).toStartWith(
      `- ${PICTURE} **a** · waiting to start`,
    );
  });

  // Record 0093: a queued crate is tied up and still, as in the queued header,
  // so motion on a row always means that stack is deploying now.
  test("a queued row starts with the crate standing still", () => {
    expect(firstLine(deploying("b", { behind: ["a"] }), "v0.11.0")).toStartWith(
      `- ${STILL_PICTURE} **b** · queued behind **a**`,
    );
  });

  test("no other row gets it", () => {
    for (const row of ALL.filter((one) => one.state !== "deploying"))
      expect(renderRow(row, { actionRef: "v0.11.0" })).not.toContain("spinner");
  });

  test("without a ref there is none, and the row is what it was", () => {
    expect(firstLine(deploying("network:prod"))).toBe(
      `- **network:prod** · deploying · ticked by carol · [run](${RUN_URL}) <!-- sluiceway:row stack="network:prod" state="deploying" -->`,
    );
  });

  test("a commit SHA is a ref as well, and a ref is never trusted as markup", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    expect(firstLine(deploying("a"), sha)).toContain(
      `https://raw.githubusercontent.com/sluiceway/sluiceway/${sha}/assets/mascot/spinner-light.svg`,
    );
    expect(firstLine(deploying("a"), 'v1"><script>')).toContain(
      "/sluiceway/v1%22%3E%3Cscript%3E/assets/mascot/spinner-dark.svg",
    );
  });

  test("the row reads back with its facts, and one tick regex still finds nothing to tick on it", () => {
    const block = rowBlock(deploying("b", { behind: ["a"], destroys: 2 }), {
      actionRef: "v0.11.0",
    });
    expect(block).toMatchObject({ stackId: "b", known: true, state: "queued", destroys: 2 });
    expect(block.text.split("\n")[0]).not.toContain("[ ]");
  });
});

describe("the writers draw it through the size budget", () => {
  const budget = (personality: boolean) =>
    fitBody({
      ...input([], { personality }),
      rows: [
        deploying("network:prod"),
        deploying("site:prod", { behind: ["network:prod"] }),
        pending("apps/api:prod"),
      ],
      carried: [],
    }).body;

  test("with personality every deploying and queued row has it, and nothing else", () => {
    const body = budget(true);
    expect(body.split("spinner-light.svg")).toHaveLength(2);
    expect(body.split("spinner-queued-light.svg")).toHaveLength(2);
    expect(body).toContain(`- ${PICTURE} **network:prod** · deploying`);
    expect(body).toContain(`- ${STILL_PICTURE} **site:prod** · queued behind`);
  });

  test("without personality there is none, as there is no header", () => {
    expect(budget(false)).not.toContain("spinner");
  });

  test("a carried row is written back as it is, with the spinner of the version that wrote it", () => {
    const old = rowBlock(deploying("network:prod"), { actionRef: "v0.10.0" });
    const body = fitBody({ ...input([]), rows: [], carried: [old] }).body;
    expect(body).toContain("/v0.10.0/assets/mascot/spinner-light.svg");
    expect(body).not.toContain("/v0.11.0/assets/mascot/spinner");
  });
});

describe("the body size", () => {
  const many = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      deploying(`stack-${String(index).padStart(3, "0")}`),
    );

  test("when the spinners do not fit, they go before any pending row is shortened, all of them", () => {
    const rows: Row[] = [...many(256), pending("apps/api:prod")];
    const fitted = fitBody({ ...input([]), rows, carried: [] });
    expect(fitted.fits).toBe(true);
    expect(fitted.shortened).toBe(0);
    expect(fitted.body).not.toContain("spinner");
  });

  test("they stay when the body fits with them", () => {
    const fitted = fitBody({ ...input([]), rows: many(20), carried: [] });
    expect(fitted.body.split("spinner-light.svg")).toHaveLength(21);
  });

  test("a body that must shorten pending rows even without them has none either", () => {
    const big = pending(
      "apps/api:prod",
      Array.from({ length: 40 }, () => "update"),
    );
    const rows: Row[] = [...many(3), big];
    const bare = fitBody({ ...input([]), rows: [...many(3).map((row) => row), big], carried: [] })
      .body.length;
    const fitted = fitBody({ ...input([]), rows, carried: [] }, { target: bare - 2_000 });
    expect(fitted.shortened).toBe(1);
    expect(fitted.body).not.toContain("spinner");
  });

  test("the spinner costs a deploying row under 400 characters", () => {
    const row = deploying("network:prod");
    const cost = rowBlock(row, { actionRef: "v0.11.0" }).text.length - rowBlock(row).text.length;
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(400);
  });
});

describe("snapshots", () => {
  const rows: Row[] = [
    pending("apps/api:prod", ["delete"]),
    deploying("network:prod"),
    deploying("site:prod", { behind: ["network:prod"], waiting: true }),
    { state: "in-sync", stackId: "apps/web:prod" },
  ];
  const fitted = (some: Row[]) =>
    `${fitBody({ ...input([], { recentlyDeployed: RECENT }), rows: some, carried: [] }).body}\n`;

  test("deploying and queued rows at the top, with the spinner", () => {
    expect(fitted(rows)).toMatchSnapshot();
  });

  test("nothing deploying, pending first", () => {
    expect(fitted(rows.filter((row) => row.state !== "deploying"))).toMatchSnapshot();
  });
});
