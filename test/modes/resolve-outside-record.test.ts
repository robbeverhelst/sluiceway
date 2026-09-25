import { describe, expect, test } from "bun:test";
import { parseDashboard } from "../../src/render/marker.ts";
import { change, pending, SHA, SPINNER } from "./harness.ts";
import {
  ALICE,
  matrix,
  RESOLVE_RUN,
  RESOLVE_RUN_URL,
  type ResolveHarness,
  rowsOf,
  scanned,
  tick,
  wake,
} from "./resolve-harness.ts";

// Outside records (slice 5.44, record 0109) on the fake: a writer other than
// Sluiceway opens a deployment record in the published shape, naming the run
// of a dispatch it made, and the `resolve` of that run hands the record to
// `apply` as it hands on the record of a tick. The record is the lock, and
// what waits or names another run is left alone.

const TABLE = {
  "a:prod": pending("a:prod", change("logs")),
  "b:prod": pending("b:prod", change("db")),
};

const DISPATCH = { ref: "refs/heads/main" };
const OTHER_RUN = "7777";

const firstLine = (row: string | undefined) => row?.split("\n")[0] ?? "";

function hashOf(h: ResolveHarness, stack: string): string {
  const row = parseDashboard(h.github.issue(h.number).body).rows.find(
    ({ stackId }) => stackId === stack,
  );
  if (!row?.known || !row.hash) throw new Error(`no hash on the row of ${stack}`);
  return row.hash;
}

// What a reader of the published shape writes before it dispatches the
// workflow: a record of the stack, in the stack's environment, with the diff
// hash of the row, a ticker of its own word and the run it started.
function outsideRecord(
  h: ResolveHarness,
  stack: string,
  overrides: { run?: string; hash?: string; payload?: unknown; status?: string } = {},
) {
  return h.github.seedDeployment({
    task: `sluiceway:${stack}`,
    environment: "sluiceway",
    sha: SHA,
    payload: overrides.payload ?? {
      v: 1,
      hash: overrides.hash ?? hashOf(h, stack),
      ticker: "dave",
      run: overrides.run ?? RESOLVE_RUN,
    },
    ...(overrides.status === undefined ? {} : { status: { state: overrides.status } }),
  });
}

describe("a resolve that no issue edit started, with a record that names its run", () => {
  test("hands the record on, writes the deploying row, and opens no record of its own", async () => {
    const h = await scanned(TABLE);
    const record = outsideRecord(h, "a:prod", { status: "queued" });

    await wake(h, DISPATCH);

    expect(matrix(h)).toEqual([
      { stack: "a:prod", environment: "sluiceway", deployment: record.id },
    ]);
    expect(h.github.deploymentsOf("sluiceway").map(({ id }) => id)).toEqual([record.id]);
    expect(h.github.deployment(record.id).status?.state).toBe("queued");
    expect(firstLine(rowsOf(h)["a:prod"])).toBe(
      `- ${SPINNER}**a:prod** · waiting to start · ticked by dave · [run](${RESOLVE_RUN_URL}) <!-- sluiceway:row stack="a:prod" state="deploying" -->`,
    );
    expect(firstLine(rowsOf(h)["b:prod"])).toContain('state="pending"');
    expect(h.log.lines).toContain(
      `a:prod: deployment record ${record.id} names this run and waits for nothing, and this run did not open it. It is handed to apply, which previews the stack again and deploys only on the hash the record carries (record 0109).`,
    );
    expect(h.github.comments(h.number)).toEqual([]);
  });

  test("a record with no status yet is open, and is handed on the same way", async () => {
    const h = await scanned(TABLE);
    const record = outsideRecord(h, "a:prod");

    await wake(h, DISPATCH);

    expect((matrix(h) as { deployment: number }[]).map(({ deployment }) => deployment)).toEqual([
      record.id,
    ]);
  });

  test("the schedule's resolve hands it on too", async () => {
    const h = await scanned(TABLE);
    const record = outsideRecord(h, "a:prod", { status: "queued" });

    await wake(h, { schedule: "0 9 * * 1-5" });

    expect((matrix(h) as { deployment: number }[]).map(({ deployment }) => deployment)).toEqual([
      record.id,
    ]);
  });

  test("two records go on in stack id order, whatever order they were opened in", async () => {
    const h = await scanned(TABLE);
    const b = outsideRecord(h, "b:prod", { status: "queued" });
    const a = outsideRecord(h, "a:prod", { status: "queued" });

    await wake(h, DISPATCH);

    expect((matrix(h) as { deployment: number }[]).map(({ deployment }) => deployment)).toEqual([
      a.id,
      b.id,
    ]);
  });
});

describe("a record that names the run and is left alone", () => {
  test("a record of another run", async () => {
    const h = await scanned(TABLE);
    h.github.seedRun(OTHER_RUN, { completed: false });
    outsideRecord(h, "a:prod", { run: OTHER_RUN, status: "queued" });

    await wake(h, DISPATCH);

    expect(matrix(h)).toEqual([]);
    expect(h.github.deployment(1).status?.state).toBe("queued");
  });

  test("a record whose payload this version cannot read", async () => {
    const h = await scanned(TABLE);
    outsideRecord(h, "a:prod", {
      payload: { v: 2, hash: hashOf(h, "a:prod"), ticker: "dave", run: RESOLVE_RUN },
      status: "queued",
    });

    await wake(h, DISPATCH);

    expect(matrix(h)).toEqual([]);
    expect(h.github.deployment(1).status?.state).toBe("queued");
  });

  test("a record of a stack discovery does not know, with a line that says so", async () => {
    const h = await scanned(TABLE);
    const record = h.github.seedDeployment({
      task: "sluiceway:gone:prod",
      environment: "sluiceway",
      sha: SHA,
      payload: { v: 1, hash: "0123456789abcdef", ticker: "dave", run: RESOLVE_RUN },
      status: { state: "queued" },
    });

    await wake(h, DISPATCH);

    expect(matrix(h)).toEqual([]);
    expect(h.github.deployment(record.id).status?.state).toBe("queued");
    expect(h.log.lines).toContain(
      `Deployment record ${record.id} names this run, and discovery does not know its stack, gone:prod. It is left alone, and it ends as every open record of a run that is over does (record 0003).`,
    );
  });

  test("a record of a stack that is deploying under a newer record", async () => {
    const h = await scanned(TABLE);
    const outside = outsideRecord(h, "a:prod", { status: "queued" });
    h.github.seedRun(OTHER_RUN, { completed: false });
    const newer = outsideRecord(h, "a:prod", { run: OTHER_RUN, status: "in_progress" });

    await wake(h, DISPATCH);

    expect(matrix(h)).toEqual([]);
    expect(h.log.lines).toContain(
      `Deployment record ${outside.id} names this run, and a:prod is deploying under record ${newer.id}. It is left alone.`,
    );
  });

  test("a record that waits behind a stack starts as a queued stack does, not as an outside one", async () => {
    const h = await scanned(TABLE, { config: "stacks:\n  - path: b\n    dependsOn: [a:prod]\n" });
    tick(h, ALICE, ["a:prod", "b:prod"]);
    await wake(h);
    const [first] = matrix(h) as { deployment: number }[];
    h.github.addDeploymentStatus(first?.deployment ?? 0, { state: "success", autoInactive: false });
    h.github.seedRun(RESOLVE_RUN, { completed: true });
    h.github.seedRun(OTHER_RUN, { completed: false });
    h.context.runId = OTHER_RUN;
    h.outputs.length = 0;

    await wake(h, DISPATCH);

    const entries = matrix(h) as { stack: string; deployment: number }[];
    expect(entries.map(({ stack }) => stack)).toEqual(["b:prod"]);
    // A new record of this run, not the queued one.
    expect(h.github.deployment(entries[0]?.deployment ?? 0).payload).toMatchObject({
      run: OTHER_RUN,
    });
  });
});

describe("a resolve that no issue edit started, with nothing that names its run", () => {
  test("reads one page of records per environment name and says what it looked for", async () => {
    const h = await scanned(TABLE);

    await wake(h, DISPATCH);

    expect(matrix(h)).toEqual([]);
    expect(h.github.requests).toEqual(["listNewestDeployments"]);
    expect(h.log.lines).toContain(
      "The event that started this job is not about an issue, no open deployment record names this run, and no stack has dependsOn, a phase or a deploy window. Nothing to do.",
    );
  });
});
