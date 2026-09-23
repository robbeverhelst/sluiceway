import { describe, expect, test } from "bun:test";
import type { PreviewOptions, PreviewResult } from "../../src/adapters/adapter.ts";
import { HANDED_ON_DESCRIPTION } from "../../src/core/deployment.ts";
import { change, inSync, pending, QUEUED_SPINNER, REPO_URL } from "./harness.ts";
import {
  ALICE,
  matrix,
  RESOLVE_RUN,
  RESOLVE_RUN_URL,
  rowsOf,
  scanned,
  tick,
  wake,
} from "./resolve-harness.ts";

// `resolve` and `dependsOn` (record 0056): a tick whose dependency has a change
// waiting is refused with a note, ticks in one chain deploy one layer at a
// time and the rest are queued, and a `resolve` that a dispatch started takes
// a queued stack on once what it waits behind went out.

const TABLE = {
  "app:prod": pending("app:prod", change("web"), change("old", "delete")),
  "network:prod": pending("network:prod", change("vpc")),
  "site:prod": pending("site:prod", change("cdn")),
  "tools:prod": inSync("tools:prod"),
};

const CHAIN =
  "stacks:\n  - path: app\n    dependsOn: [network:prod]\n  - path: site\n    dependsOn: [app:prod]\n";

const HASH = "2b44350653e84a11";
const NEXT_RUN = "6161";

function records(h: Awaited<ReturnType<typeof scanned>>) {
  const entries = matrix(h) as { stack: string; deployment: number }[];
  return entries.map(({ stack, deployment }) => ({
    stack,
    record: h.github.deployment(deployment),
  }));
}

describe("a tick whose dependency has a change waiting", () => {
  test("is refused: no record, no lookup, the box cleared with a note that names it, and a green job", async () => {
    const h = await scanned(TABLE, { config: CHAIN });
    tick(h, ALICE, ["app:prod"]);

    await wake(h);

    expect(matrix(h)).toEqual([]);
    expect(h.github.requests).not.toContain("createDeployment");
    expect(h.github.comments(h.number)).toEqual([]);
    const row = rowsOf(h)["app:prod"] ?? "";
    expect(row.split("\n")[0]).toStartWith("- [ ] **app:prod**");
    expect(row.split("\n")[1]).toBe(
      "  :information_source: this tick started nothing: it depends on **network:prod**, which has a change waiting. Tick both to deploy them in order, or deploy **network:prod** first.",
    );
    expect(h.log.lines).toContain(
      "app:prod is ticked, and it depends on network:prod, which has a change waiting and is not ticked. The box is cleared.",
    );
  });

  test("goes out when the dependency is in sync", async () => {
    const h = await scanned(
      { ...TABLE, "network:prod": inSync("network:prod") },
      { config: CHAIN },
    );
    tick(h, ALICE, ["app:prod"]);

    await wake(h);

    expect((matrix(h) as { stack: string }[]).map(({ stack }) => stack)).toEqual(["app:prod"]);
  });
});

describe("three ticked stacks in one chain", () => {
  test("hand `apply` the first layer only, and queue the rest behind the stack before them", async () => {
    const h = await scanned(TABLE, { config: CHAIN });
    tick(h, ALICE, ["site:prod", "app:prod", "network:prod"]);

    await wake(h);

    expect(records(h).map(({ stack }) => stack)).toEqual(["network:prod"]);
    const queued = h.github
      .deploymentsOf("sluiceway")
      .filter((record) => record.task !== "sluiceway:network:prod");
    expect(
      queued.map(({ task, payload, status }) => ({ task, payload, state: status?.state })),
    ).toEqual([
      {
        task: "sluiceway:app:prod",
        payload: expect.objectContaining({
          run: RESOLVE_RUN,
          ticker: "alice",
          behind: ["network:prod"],
        }),
        state: "queued",
      },
      {
        task: "sluiceway:site:prod",
        payload: expect.objectContaining({
          run: RESOLVE_RUN,
          ticker: "alice",
          behind: ["app:prod"],
        }),
        state: "queued",
      },
    ]);
  });

  test("show the first as waiting to start and the others as queued behind the one before", async () => {
    const h = await scanned(TABLE, { config: CHAIN });
    tick(h, ALICE, ["site:prod", "app:prod", "network:prod"]);

    await wake(h);

    const rows = rowsOf(h);
    expect(rows["network:prod"]?.split("\n")[0]).toContain("· waiting to start ·");
    expect(rows["app:prod"]?.split("\n")[0]).toBe(
      `- ${QUEUED_SPINNER}**app:prod** · queued behind **network:prod** · ticked by alice · [run](${RESOLVE_RUN_URL}) <!-- sluiceway:row stack="app:prod" state="queued" destroys="1" deletes="1" -->`,
    );
    expect(rows["site:prod"]?.split("\n")[0]).toContain("· queued behind **app:prod** ·");
    expect(h.github.issue(h.number).body).toContain("🔵&nbsp;3 deploying");
  });
});

describe("a tick on a stack whose dependency is deploying", () => {
  test("is queued behind it, and nothing is handed on", async () => {
    const h = await scanned(TABLE, { config: CHAIN });
    h.github.seedDeployment({
      task: "sluiceway:network:prod",
      payload: { v: 1, hash: HASH, ticker: "carol", run: "77" },
      status: { state: "in_progress" },
    });
    h.github.seedRun("77", { completed: false });
    tick(h, ALICE, ["app:prod"]);

    await wake(h);

    expect(matrix(h)).toEqual([]);
    const app = h.github
      .deploymentsOf("sluiceway")
      .find(({ task }) => task === "sluiceway:app:prod");
    expect(app?.payload).toMatchObject({ behind: ["network:prod"] });
    expect(rowsOf(h)["app:prod"]).toContain('state="queued"');
  });
});

describe("a resolve that a dispatch started", () => {
  async function chainUnderWay(networkState: string) {
    const h = await scanned(TABLE, { config: CHAIN });
    tick(h, ALICE, ["site:prod", "app:prod", "network:prod"]);
    await wake(h);
    const [first] = records(h);
    h.github.addDeploymentStatus(first?.record.id ?? 0, {
      state: networkState,
      autoInactive: false,
    });
    h.github.seedRun(RESOLVE_RUN, { completed: true });
    h.github.seedRun(NEXT_RUN, { completed: false });
    h.context.runId = NEXT_RUN;
    h.outputs.length = 0;
    h.github.requests.length = 0;
    return h;
  }

  test("starts a queued stack once what it waits behind went out, under a record of its own run", async () => {
    const h = await chainUnderWay("success");

    await wake(h, { ref: "refs/heads/main", workflow: ".github/workflows/sluiceway.yml" });

    const [entry] = records(h);
    expect(entry?.stack).toBe("app:prod");
    expect(entry?.record.payload).toEqual({
      v: 1,
      hash: expect.any(String),
      ticker: "alice",
      run: NEXT_RUN,
    });
    expect(entry?.record.status?.state).toBe("queued");
    const old = h.github
      .deploymentsOf("sluiceway")
      .find(
        ({ task, payload }) =>
          task === "sluiceway:app:prod" && (payload as { run: string }).run === RESOLVE_RUN,
      );
    expect(old?.status).toMatchObject({ state: "inactive", description: HANDED_ON_DESCRIPTION });
    // The hash the tick approved goes on.
    const hashOf = (payload: unknown) => (payload as { hash?: string } | undefined)?.hash;
    expect(hashOf(entry?.record.payload)).toBe(hashOf(old?.payload) as string);
    const rows = rowsOf(h);
    expect(rows["app:prod"]?.split("\n")[0]).toContain(
      `· waiting to start · ticked by alice · [run](${REPO_URL}/actions/runs/${NEXT_RUN})`,
    );
    // The stack after it still waits, behind a stack that is now deploying.
    expect(rows["site:prod"]).toContain('state="queued"');
  });

  test("ends a queued stack whose dependency failed, and starts nothing", async () => {
    const h = await chainUnderWay("failure");

    await wake(h, { ref: "refs/heads/main" });

    expect(matrix(h)).toEqual([]);
    const app = h.github
      .deploymentsOf("sluiceway")
      .find(({ task }) => task === "sluiceway:app:prod");
    expect(app?.status).toMatchObject({
      state: "failure",
      description: "a stack it depends on did not deploy",
    });
  });

  test("with no dependsOn in the config asks GitHub nothing", async () => {
    const h = await scanned(TABLE);

    await wake(h, { ref: "refs/heads/main" });

    expect(matrix(h)).toEqual([]);
    expect(h.github.requests).toEqual([]);
  });
});

// `dependsOn: auto` (slice 4.7, record 0059): the scan puts what a stack's
// preview read from its stack references on its row, and `resolve` waits on
// those stacks the way it waits on the ones the file names.
describe("a stack with dependsOn: auto", () => {
  const AUTO = "stacks:\n  - path: app\n    dependsOn: auto\n";
  const reads = (result: PreviewResult, ids: string[]) => async (options: PreviewOptions) =>
    options.dependencies !== undefined && result.ok
      ? { ...result, dependencies: { stackIds: ids, elsewhere: 0 } }
      : result;
  const READING = { ...TABLE, "app:prod": reads(TABLE["app:prod"], ["network:prod"]) };

  test("a tick is refused while a stack it read has a change waiting", async () => {
    const h = await scanned(READING, { config: AUTO });
    tick(h, ALICE, ["app:prod"]);

    await wake(h);

    expect(matrix(h)).toEqual([]);
    expect(rowsOf(h)["app:prod"]?.split("\n")[1]).toBe(
      "  :information_source: this tick started nothing: it depends on **network:prod**, which has a change waiting. Tick both to deploy them in order, or deploy **network:prod** first.",
    );
  });

  test("ticked together, the stack it read goes first and it is queued behind it", async () => {
    const h = await scanned(READING, { config: AUTO });
    tick(h, ALICE, ["app:prod", "network:prod"]);

    await wake(h);

    expect(records(h).map(({ stack }) => stack)).toEqual(["network:prod"]);
    expect(rowsOf(h)["app:prod"]?.split("\n")[0]).toContain("· queued behind **network:prod** ·");
  });

  test("a read that would close a circle with the file is dropped, and the log says so", async () => {
    const h = await scanned(
      { ...TABLE, "app:prod": reads(TABLE["app:prod"], ["site:prod"]) },
      { config: `${AUTO}  - path: site\n    dependsOn: [app:prod]\n` },
    );
    tick(h, ALICE, ["app:prod"]);

    await wake(h);

    expect((matrix(h) as { stack: string }[]).map(({ stack }) => stack)).toEqual(["app:prod"]);
    expect(h.log.lines).toContain(
      "app:prod reads site:prod through its stack references, and site:prod already depends on app:prod. That would be a circle, so app:prod does not wait on site:prod.",
    );
  });

  test("without auto, what a row says it read is not read", async () => {
    const h = await scanned(READING, { config: AUTO });
    // The same body, with the config that names no auto.
    await Bun.write(`${h.context.root}/sluiceway.yaml`, "");
    tick(h, ALICE, ["app:prod"]);

    await wake(h);

    expect((matrix(h) as { stack: string }[]).map(({ stack }) => stack)).toEqual(["app:prod"]);
  });
});
