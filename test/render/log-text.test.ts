import { describe, expect, test } from "bun:test";
import type { Change } from "../../src/core/diff.ts";
import { diffLogLines, logGroupTitle, poolSizeLine } from "../../src/render/log-text.ts";

function change(op: Change["op"], type: string, name: string, rest: Partial<Change> = {}): Change {
  return { address: `${type}::${name}`, type, name, op, changedKeys: [], replaceKeys: [], ...rest };
}

describe("the log text of a diff", () => {
  // The diff of the worked example of record 0027, handed over out of order.
  test("counts first, then deletes, replaces and the rest, one change per line", () => {
    const lines = diffLogLines({
      stackId: "storage/buckets:prod",
      changes: [
        change("create", "aws:s3/bucketVersioning:BucketVersioning", "uploads"),
        change("replace", "aws:s3/bucket:Bucket", "uploads", {
          changedKeys: ["tags", "bucket"],
          replaceKeys: ["bucket"],
        }),
        change("none", "aws:s3/bucket:Bucket", "archive", {
          tracking: "move",
          previousAddress: "aws:s3/bucket:Bucket::old-archive",
        }),
        change("delete", "aws:s3/bucketPolicy:BucketPolicy", "uploads-public-read"),
        change(
          "update",
          "aws:s3/bucketLifecycleConfiguration:BucketLifecycleConfiguration",
          "logs",
          {
            changedKeys: ["rules"],
          },
        ),
      ],
    });

    expect(lines).toEqual([
      "1 create, 1 update, 1 replace, 1 delete, 1 tracking only",
      "DELETE aws:s3/bucketPolicy:BucketPolicy uploads-public-read",
      "REPLACE aws:s3/bucket:Bucket uploads · forced by bucket · also changes tags",
      "move aws:s3/bucket:Bucket archive",
      "update aws:s3/bucketLifecycleConfiguration:BucketLifecycleConfiguration logs · rules",
      "create aws:s3/bucketVersioning:BucketVersioning uploads",
    ]);
  });

  test("a stack with nothing to deploy says so", () => {
    expect(diffLogLines({ stackId: "a:prod", changes: [] })).toEqual(["no changes"]);
  });

  test("an op with a tracking change names both", () => {
    const lines = diffLogLines({
      stackId: "a:prod",
      changes: [change("update", "t", "n", { tracking: "import", changedKeys: ["b", "a", "b"] })],
    });

    expect(lines).toEqual(["1 update", "update + import t n · a, b"]);
  });

  // A line of the job log that starts with `::` is a workflow command, and the
  // runner looks past leading spaces. So text from outside never starts a line.
  test("text from outside cannot start a line of its own", () => {
    const lines = diffLogLines({
      stackId: "a:prod",
      changes: [
        change("create", "t\r\n::error::type", "n\n::add-mask::name\u2028##[error]x", {
          changedKeys: ["key\n::stop-commands::k"],
        }),
      ],
    });

    expect(lines).toEqual([
      "1 create",
      "create t  ::error::type n ::add-mask::name ##[error]x · key ::stop-commands::k",
    ]);
    for (const line of lines) expect(line).toMatch(/^(\d|[a-zA-Z])/);
  });
});

describe("the title of a stack's group in the job log", () => {
  test("is the stack id", () => {
    expect(logGroupTitle("apps/grafana:prod")).toBe("apps/grafana:prod");
  });

  test("stays on one line", () => {
    expect(logGroupTitle("apps\n::endgroup::/x:prod")).toBe("apps ::endgroup::/x:prod");
  });
});

// Record 0046: the job log holds every path in full, as the summary does.
describe("property paths in the log text", () => {
  test("every path of a change is listed, whole", () => {
    const long = `spec.template.spec.containers[0].${"env[3].".repeat(12)}value`;
    const paths = [long, ...Array.from({ length: 14 }, (_, index) => `values.k${index + 10}`)];
    const [, line] = diffLogLines({
      stackId: "apps/web:prod",
      changes: [change("update", "t", "n", { changedKeys: paths })],
    });
    expect(line).toBe(`update t n · ${[...paths].sort().join(", ")}`);
  });
});

// Slice 5.21: the scan says which pool it used and where the number came
// from, so a reader of the job log can tell (record 0085).
describe("the log line of the pool size", () => {
  test("names the input when the input set it", () => {
    expect(poolSizeLine({ size: 3, from: "input" })).toBe(
      "The pool is 3 previews at once, from the concurrency input.",
    );
  });

  test("names the cores of the machine when they set it", () => {
    expect(poolSizeLine({ size: 1, from: "cores", cores: 1 })).toBe(
      "The pool is 1 preview at once, one for each core of this machine, which has 1. The concurrency input sets another size.",
    );
    expect(poolSizeLine({ size: 2, from: "cores", cores: 2 })).toBe(
      "The pool is 2 previews at once, one for each core of this machine, which has 2. The concurrency input sets another size.",
    );
  });

  test("says when the cores were more than the pool follows", () => {
    expect(poolSizeLine({ size: 8, from: "cores", cores: 64 })).toBe(
      "The pool is 8 previews at once: this machine has 64 cores, and the pool follows them up to 8. The concurrency input sets another size.",
    );
  });

  test("says when the machine gave no count of its cores", () => {
    expect(poolSizeLine({ size: 1, from: "unknown" })).toBe(
      "The pool is 1 preview at once: this machine did not say how many cores it has. The concurrency input sets another size.",
    );
  });
});
