import { describe, expect, test } from "bun:test";
import { type BodyInput, renderBody, rowBlock } from "../../src/render/body.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import type { DriftRow, PendingRow, Row } from "../../src/render/row.ts";

// Slice 4.11 (record 0062): one alert block above the pending list that names
// the pending stacks with a delete or replace. Written out by hand from the
// record.

const REPO_URL = "https://github.com/example-org/infra";
const RUN_URL = `${REPO_URL}/actions/runs/17034455121`;

function pending(stackId: string, ops: ("create" | "update" | "delete")[]): PendingRow {
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

// Record 0055: nothing to deploy from the code, and what changed outside it.
function drifted(stackId: string, ops: ("update" | "delete")[]): DriftRow {
  return {
    state: "drift",
    diff: {
      stackId,
      changes: [],
      drift: ops.map((op, index) => ({
        address: `address-${index}`,
        type: "local:index/file:File",
        name: `file-${index}`,
        op,
        changedKeys: op === "update" ? ["content"] : [],
        replaceKeys: [],
      })),
    },
    hash: "4be1a0c93d7e5f20",
    runUrl: RUN_URL,
  };
}

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
    actionRef: "v0.1.0",
    personality: true,
    ...overrides,
  };
}

const paragraphs = (body: string) => body.split("\n\n");
const alerts = (body: string) =>
  paragraphs(body).filter((paragraph) => paragraph.startsWith("> [!CAUTION]"));

describe("the destroy alert", () => {
  test("names every pending stack with a delete or replace, by stack id", () => {
    const body = renderBody(
      input([
        pending("storage/buckets:prod", ["delete"]),
        pending("apps/auth:prod", ["update"]),
        pending("apps/api:prod", ["create", "delete"]),
      ]),
    );
    expect(alerts(body)).toEqual([
      "> [!CAUTION]\n> 2 pending stacks delete or replace resources: **apps/api:prod**, **storage/buckets:prod**",
    ]);
  });

  test("one stack reads in the singular", () => {
    expect(alerts(renderBody(input([pending("a", ["delete"])])))).toEqual([
      "> [!CAUTION]\n> 1 pending stack deletes or replaces resources: **a**",
    ]);
  });

  test("sits under the line under the Pending heading, right above the pending list", () => {
    const all = paragraphs(renderBody(input([pending("a", ["delete"])])));
    const heading = all.indexOf("## Pending");
    expect(all[heading + 2]).toStartWith("> [!CAUTION]");
    expect(all[heading + 3]).toStartWith("- [ ] **a**");
  });

  test("is there without personality, on a read-only dashboard and under redact", () => {
    const rows = [pending("a", ["delete"])];
    const expected = ["> [!CAUTION]\n> 1 pending stack deletes or replaces resources: **a**"];
    expect(alerts(renderBody(input(rows, { personality: false })))).toEqual(expected);
    expect(alerts(renderBody(input(rows, { readOnly: true })))).toEqual(expected);
    const redacted = input([]);
    redacted.rows = rows.map((row) => rowBlock(row, { redact: true }));
    expect(alerts(renderBody(redacted))).toEqual(expected);
  });

  test("is never there when no destroy is pending", () => {
    const none: Row[][] = [
      [],
      [pending("a", ["update", "create"])],
      [{ state: "in-sync", stackId: "a" }],
      // A deploying row with a destroy: nothing is left to tick.
      [{ state: "deploying", stackId: "a", ticker: "alice", runUrl: RUN_URL, destroys: 2 }],
    ];
    for (const rows of none) expect(alerts(renderBody(input(rows)))).toEqual([]);
  });

  test("a row of a state this version does not know does not count", () => {
    const unknown = parseDashboard(
      '- [ ] **x** · later <!-- sluiceway:row stack="x" state="flooded" hash="3fa9c1e2aabbccdd" destroys="1" -->\n  <!-- /sluiceway:row -->',
    ).rows;
    expect(alerts(renderBody({ ...input([]), rows: unknown }))).toEqual([]);
  });

  test("a stack id is never trusted as markup", () => {
    expect(alerts(renderBody(input([pending("a*b<c>", ["delete"])])))[0]).toContain(
      "**a&#42;b&lt;c&gt;**",
    );
  });
});

// Record 0075: a drifted row deletes and replaces nothing, because nothing
// waits from its code. What the alert names for it is a resource gone outside
// the code, the one loss a person may not know of yet.
describe("drifted rows in the destroy alert", () => {
  test("names every drifted stack with a resource gone outside the code", () => {
    const body = renderBody(
      input([drifted("site:prod", ["delete"]), drifted("web:prod", ["update"])]),
    );
    expect(alerts(body)).toEqual([
      "> [!CAUTION]\n> 1 drifted stack has resources gone outside the code: **site:prod**",
    ]);
  });

  test("the plural", () => {
    const body = renderBody(
      input([drifted("b", ["delete", "update"]), drifted("a", ["delete", "delete"])]),
    );
    expect(alerts(body)).toEqual([
      "> [!CAUTION]\n> 2 drifted stacks have resources gone outside the code: **a**, **b**",
    ]);
  });

  test("with pending destroys too, one block with a paragraph for each", () => {
    const body = renderBody(input([pending("p", ["delete"]), drifted("d", ["delete"])]));
    expect(alerts(body)).toEqual([
      [
        "> [!CAUTION]",
        "> 1 pending stack deletes or replaces resources: **p**",
        ">",
        "> 1 drifted stack has resources gone outside the code: **d**",
      ].join("\n"),
    ]);
  });

  test("sits right above the pending list, and under the Pending line when nothing is pending", () => {
    const all = paragraphs(renderBody(input([drifted("d", ["delete"])])));
    const heading = all.indexOf("## Pending");
    expect(all[heading + 1]).toBe("Nothing to deploy from the code.");
    expect(all[heading + 2]).toStartWith("> [!CAUTION]");
    expect(all[heading + 3]).toBe("## Drifted");
  });

  test("a drifted row with only changed properties is not named", () => {
    expect(alerts(renderBody(input([drifted("d", ["update", "update"])])))).toEqual([]);
  });

  test("is there under redact and without personality", () => {
    const rows = [drifted("d", ["delete"])];
    const expected = ["> [!CAUTION]\n> 1 drifted stack has resources gone outside the code: **d**"];
    expect(alerts(renderBody(input(rows, { personality: false })))).toEqual(expected);
    const redacted = input([]);
    redacted.rows = rows.map((row) => rowBlock(row, { redact: true }));
    expect(alerts(renderBody(redacted))).toEqual(expected);
  });
});
