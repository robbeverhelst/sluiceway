import { describe, expect, test } from "bun:test";
import type { DeploymentRecord } from "../../src/core/deployment.ts";
import { openRecordsOfRun } from "../../src/core/settle.ts";

const RUN = "5151";

function record(
  id: number,
  overrides: Partial<Omit<DeploymentRecord, "status">> & { state?: string } = {},
): DeploymentRecord {
  const { state, ...rest } = overrides;
  return {
    id,
    task: "sluiceway:a:prod",
    environment: "sluiceway",
    sha: "0123456789abcdef0123456789abcdef01234567",
    payload: { v: 1, hash: "2b44350653e84a11", ticker: "alice", run: RUN },
    createdAt: `2026-09-21T08:00:${String(id).padStart(2, "0")}Z`,
    status:
      state === undefined
        ? undefined
        : { state, description: "", createdAt: "2026-09-21T08:10:00Z" },
    ...rest,
  };
}

describe("openRecordsOfRun", () => {
  test("finds a record of this run with no status, `queued` or `in_progress`", () => {
    const records = [
      record(1, { task: "sluiceway:a:prod" }),
      record(2, { task: "sluiceway:b:prod", state: "queued" }),
      record(3, { task: "sluiceway:c:prod", state: "in_progress" }),
    ];

    expect(openRecordsOfRun(records, RUN)).toEqual([
      { id: 1, stackId: "a:prod" },
      { id: 2, stackId: "b:prod" },
      { id: 3, stackId: "c:prod" },
    ]);
  });

  test("a state GitHub adds later is no result, so the record is open", () => {
    expect(openRecordsOfRun([record(1, { state: "pending" })], RUN)).toEqual([
      { id: 1, stackId: "a:prod" },
    ]);
  });

  test.each(["success", "inactive", "failure", "error"])(
    "leaves a record of this run that ended as %s alone",
    (state) => {
      expect(openRecordsOfRun([record(1, { state })], RUN)).toEqual([]);
    },
  );

  test("leaves an open record of another run alone", () => {
    const other = { v: 1, hash: "2b44350653e84a11", ticker: "bob", run: "4242" };
    expect(openRecordsOfRun([record(1, { payload: other, state: "queued" })], RUN)).toEqual([]);
  });

  test("leaves a record that is not Sluiceway's alone, whatever its payload says", () => {
    // The duplicate a job level `environment:` key makes (record 0003).
    expect(openRecordsOfRun([record(1, { task: "deploy", state: "queued" })], RUN)).toEqual([]);
  });

  test("leaves a record whose payload this version cannot read alone", () => {
    const records = [
      record(1, { payload: { v: 2, hash: "x", ticker: "alice", run: RUN } }),
      record(2, { payload: { v: 1, hash: "x", ticker: "alice", run: `${RUN} ` } }),
      record(3, { payload: null }),
    ];
    expect(openRecordsOfRun(records, RUN)).toEqual([]);
  });

  test("finds an open record of this run that is not the newest of its stack", () => {
    const records = [
      record(1, { state: "queued" }),
      record(2, { payload: { v: 1, hash: "x", ticker: "bob", run: "6000" }, state: "success" }),
    ];
    expect(openRecordsOfRun(records, RUN)).toEqual([{ id: 1, stackId: "a:prod" }]);
  });

  test("names a record once when it was read twice", () => {
    expect(openRecordsOfRun([record(1), record(1)], RUN)).toEqual([{ id: 1, stackId: "a:prod" }]);
  });
});
