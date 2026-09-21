import { describe, expect, test } from "bun:test";
import { change, inSync, pending, SHA } from "./harness.ts";
import {
  ALICE,
  BOB,
  matrix,
  RESOLVE_RUN,
  RESOLVE_RUN_URL,
  rowsOf,
  scanned,
  tick,
  WRITE,
  wake,
} from "./resolve-harness.ts";

// A tick by a person who may tick (records 0003, 0025, 0031 and 0035): a
// deployment record as `queued`, the matrix, and the row swap.

const TABLE = {
  "a:prod": pending("a:prod", change("logs"), change("old", "delete"), change("db", "replace")),
  "b:prod": pending("b:prod", change("logs")),
  "c:prod": inSync("c:prod"),
};

const CONFIG = "stacks:\n  - path: b\n    environment: production\n";

function hashOf(row: string | undefined): string {
  return /hash="([^"]+)"/.exec(row ?? "")?.[1] ?? "";
}

describe("a tick by a person who may tick", () => {
  test("creates a deployment record as `queued` that carries the hash, the ticker and the run", async () => {
    const h = await scanned(TABLE, { config: CONFIG });
    const hash = hashOf(rowsOf(h)["a:prod"]);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    tick(h, ALICE, ["a:prod"]);

    await wake(h);

    const [entry] = matrix(h) as { deployment: number }[];
    const record = h.github.deployment(entry?.deployment ?? 0);
    expect(record).toMatchObject({
      task: "sluiceway:a:prod",
      environment: "sluiceway",
      sha: SHA,
      payload: { v: 1, hash, ticker: "alice", run: RESOLVE_RUN },
      status: { state: "queued" },
    });
  });

  test("hands `apply` one matrix entry per deploy, with the environment of the stack", async () => {
    const h = await scanned(TABLE, { config: CONFIG });
    tick(h, ALICE, ["b:prod", "a:prod"]);

    await wake(h);

    const entries = matrix(h) as { stack: string; environment: string; deployment: number }[];
    expect(entries.map(({ stack, environment }) => ({ stack, environment }))).toEqual([
      { stack: "a:prod", environment: "sluiceway" },
      { stack: "b:prod", environment: "production" },
    ]);
    expect(h.github.deployment(entries[1]?.deployment ?? 0).environment).toBe("production");
  });

  test("swaps the row for a deploying row without a box, and copies `destroys` from the old marker", async () => {
    const h = await scanned(TABLE);
    const before = rowsOf(h);
    expect(before["a:prod"]).toContain('destroys="2"');
    tick(h, ALICE, ["a:prod"]);

    await wake(h);

    const after = rowsOf(h);
    expect(after["a:prod"]).toBe(
      [
        `- **a:prod** · waiting to start · ticked by alice · [run](${RESOLVE_RUN_URL}) <!-- sluiceway:row stack="a:prod" state="deploying" destroys="2" -->`,
        "  <!-- /sluiceway:row -->",
      ].join("\n"),
    );
    // Every other row is carried through byte for byte.
    expect(after["b:prod"]).toBe(before["b:prod"] as string);
    expect(after["c:prod"]).toBe(before["c:prod"] as string);
  });

  test("regenerates everything around the row blocks: the counts, the sections and the plain header", async () => {
    const h = await scanned(TABLE);
    tick(h, ALICE, ["a:prod"]);

    await wake(h);

    const body = h.github.issue(h.number).body;
    expect(body).toContain("**1 pending** · 1 deploying · 0 preview failed · 1 in sync");
    expect(body.indexOf("## Deploying")).toBeGreaterThan(body.indexOf("## Pending"));
    // A deploying row that destroys something keeps the header plain (0031).
    expect(body).toContain('alt="Sluiceway"');
    // The scan facts on the root marker are the scan's, carried through.
    expect(body.split("\n")[0]).toBe(h.github.issue(h.number).body.split("\n")[0] as string);
    expect(body.split("\n")[0]).toContain('scan-run="4242"');
    expect(body.split("\n")[0]).toContain("full-scan-run");
  });

  test("sets the output after the records exist and before the body is written", async () => {
    const h = await scanned(TABLE);
    tick(h, ALICE, ["a:prod"]);

    await wake(h);

    expect(h.outputs).toHaveLength(1);
    const before = h.github.requests.slice(0, h.outputs[0]?.afterRequests);
    const after = h.github.requests.slice(h.outputs[0]?.afterRequests);
    expect(before).toContain("createDeployment");
    expect(before).toContain("createDeploymentStatus");
    expect(before).not.toContain("updateIssueBody");
    expect(after).toContain("updateIssueBody");
    expect(after).not.toContain("createDeployment");
  });

  test("a body write that fails does not lose the hand-off, and the job goes red", async () => {
    const h = await scanned(TABLE);
    tick(h, ALICE, ["a:prod"]);
    // Another writer gets in after every write, three times over.
    let edits = 0;
    h.github.onRequest = (request) => {
      if (request === "getIssue" && h.github.requests.includes("updateIssueBody")) {
        h.github.editBody(h.number, `${h.github.issue(h.number).body}\nedit ${edits++}`, BOB);
      }
    };

    await expect(wake(h)).rejects.toThrow("could not be written");

    expect(matrix(h)).toHaveLength(1);
  });

  test("a body that does not fit with the rows swapped is not written, after the hand-off", async () => {
    const h = await scanned(TABLE);
    h.context.limits = { body: { limit: 500 } };
    tick(h, ALICE, ["a:prod"]);
    const body = h.github.issue(h.number).body;

    await expect(wake(h)).rejects.toThrow("GitHub drops a body over 65,536 without an error");

    expect(matrix(h)).toHaveLength(1);
    expect(h.github.issue(h.number).body).toBe(body);
  });

  test("a live body that turned into another version before the write is left alone", async () => {
    const h = await scanned(TABLE);
    tick(h, ALICE, ["a:prod"]);
    let moved = false;
    h.github.onRequest = (request) => {
      if (request !== "getIssue" || moved) return;
      moved = true;
      h.github.editBody(
        h.number,
        h.github
          .issue(h.number)
          .body.replace('sluiceway:dashboard v="1"', 'sluiceway:dashboard v="2"'),
        BOB,
      );
    };

    await wake(h);

    expect(matrix(h)).toHaveLength(1);
    expect(h.github.requests).not.toContain("updateIssueBody");
    expect(h.github.issue(h.number).body).toContain('sluiceway:dashboard v="2"');
  });

  test("reads the body and the history in one request, and never runs the tool", async () => {
    const h = await scanned(TABLE);
    tick(h, ALICE, ["a:prod"]);

    await wake(h);

    expect(h.github.requests[0]).toBe("readEditHistory");
    expect(h.github.requests.filter((request) => request === "readEditHistory")).toHaveLength(1);
    expect(h.adapter.previewed).toEqual([]);
    expect(h.adapter.versionChecks).toBe(0);
    expect("env" in h.context || "run" in h.context).toBe(false);
  });

  test("every tick gets the ticker the history names for it, not the sender of the event", async () => {
    const h = await scanned(TABLE);
    h.github.seedPermission(BOB.login, WRITE);
    tick(h, ALICE, ["a:prod"]);
    tick(h, BOB, ["b:prod"]);

    // The first event's payload already holds both ticks (issue 28).
    await wake(h);

    const entries = matrix(h) as { stack: string; deployment: number }[];
    const tickers = Object.fromEntries(
      entries.map(({ stack, deployment }) => [
        stack,
        (h.github.deployment(deployment).payload as { ticker: string }).ticker,
      ]),
    );
    expect(tickers).toEqual({ "a:prod": "alice", "b:prod": "bob" });
    expect(rowsOf(h)["b:prod"]).toContain("ticked by bob");
  });

  test("a dashboard without a tick costs one request and writes nothing", async () => {
    const h = await scanned(TABLE);
    h.github.editBody(h.number, `${h.github.issue(h.number).body}\nA note by a person.`, ALICE);

    await wake(h);

    expect(h.github.requests).toEqual(["readEditHistory"]);
    expect(matrix(h)).toEqual([]);
  });
});
