import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  deploymentPayload,
  deploymentPayloadJsonSchema,
  deploymentPayloadSchema,
  mergePayload,
  readDeploymentPayload,
} from "../../src/core/deployment.ts";

// Slice 5.33 (record 0096): the payload of a deployment record is a surface
// others build on, so it has a published schema, and the writer checks what it
// writes against the same schema, as the result file does (record 0061).

const HASH = "2b44350653e84a11";

describe("the schema of the payload", () => {
  test("takes every shape the writers give", () => {
    const shapes = [
      deploymentPayload({ hash: HASH, ticker: "alice", run: "4242" }),
      deploymentPayload({ hash: HASH, ticker: "alice", run: "4242", attempt: "2" }),
      deploymentPayload({
        hash: HASH,
        ticker: "alice",
        run: "4242",
        behind: ["infra/network:prod"],
      }),
      deploymentPayload({ hash: HASH, ticker: "alice", run: "4242", drift: true }),
      deploymentPayload({ hash: HASH, ticker: "renovate[bot]", run: "4242", onMerge: true }),
      mergePayload({ ticker: "alice", run: "4242", attempt: "1", merge: 519 }),
    ];
    for (const shape of shapes) expect(deploymentPayloadSchema.safeParse(shape).success).toBe(true);
  });

  test("refuses a key it does not name, so nothing can ride along", () => {
    const payload = { ...deploymentPayload({ hash: HASH, ticker: "alice", run: "4242" }) };
    expect(deploymentPayloadSchema.safeParse({ ...payload, value: "x" }).success).toBe(false);
    expect(deploymentPayloadSchema.safeParse({ ...payload, v: 2 }).success).toBe(false);
  });

  test("holds a hash to the diff hash, and a run and an attempt to run ids", () => {
    const payload = { v: 1, hash: HASH, ticker: "alice", run: "4242" };
    expect(deploymentPayloadSchema.safeParse({ ...payload, hash: "not a hash" }).success).toBe(
      false,
    );
    expect(deploymentPayloadSchema.safeParse({ ...payload, run: "../1" }).success).toBe(false);
    expect(deploymentPayloadSchema.safeParse({ ...payload, attempt: "0" }).success).toBe(false);
  });

  test("a merge record carries no hash", () => {
    const merge = { v: 1, ticker: "alice", run: "4242", merge: 519 };
    expect(deploymentPayloadSchema.safeParse(merge).success).toBe(true);
    expect(deploymentPayloadSchema.safeParse({ ...merge, hash: HASH }).success).toBe(false);
  });

  // The check changes nothing that reaches GitHub: the keys keep the order
  // they have always been written in.
  test("the writer keeps the order of the keys", () => {
    const payload = deploymentPayload({
      hash: HASH,
      ticker: "alice",
      run: "4242",
      attempt: "1",
      behind: ["infra/network:prod"],
      drift: true,
      onMerge: true,
    });
    expect(Object.keys(payload)).toEqual([
      "v",
      "hash",
      "ticker",
      "run",
      "attempt",
      "behind",
      "drift",
      "onMerge",
    ]);
    expect(
      Object.keys(mergePayload({ ticker: "alice", run: "4242", attempt: "1", merge: 1 })),
    ).toEqual(["v", "ticker", "run", "attempt", "merge"]);
  });

  test("the writer refuses a payload that does not fit it", () => {
    expect(() => deploymentPayload({ hash: "h", ticker: "alice", run: "4242" })).toThrow();
  });
});

describe("the published JSON schema of the payload", () => {
  const schema = deploymentPayloadJsonSchema();

  test("says that it holds no value and no secret", () => {
    expect(schema.title).toBe("Sluiceway deployment record payload");
    expect(String(schema.description)).toContain("no property value");
    expect(String(schema.description)).toContain("no secret");
  });

  test("is committed next to the others, as the generator writes it now", () => {
    const file = resolve(import.meta.dir, "../../schema/deployment-payload.schema.json");
    expect(readFileSync(file, "utf8")).toBe(`${JSON.stringify(schema, null, 2)}\n`);
  });
});

// Record 0102: the value fingerprint the tick approved rides on the record as
// an added key, after every older one.
describe("the value fingerprint on the payload", () => {
  const FINGERPRINT = "f65a69fe79dd93c3";

  test("is written last, in the order the payload has always had", () => {
    const written = deploymentPayload({
      hash: HASH,
      ticker: "alice",
      run: "4242",
      attempt: "1",
      drift: true,
      onMerge: true,
      fingerprint: FINGERPRINT,
    });
    expect(Object.keys(written)).toEqual([
      "v",
      "hash",
      "ticker",
      "run",
      "attempt",
      "drift",
      "onMerge",
      "fingerprint",
    ]);
    expect(deploymentPayloadSchema.safeParse(written).success).toBe(true);
  });

  test("is left out when the record carries none", () => {
    expect(deploymentPayload({ hash: HASH, ticker: "alice", run: "4242" })).not.toHaveProperty(
      "fingerprint",
    );
  });

  test("is held to 16 hex characters, so no value can ride in it", () => {
    const payload = { v: 1, hash: HASH, ticker: "alice", run: "4242" };
    expect(
      deploymentPayloadSchema.safeParse({ ...payload, fingerprint: FINGERPRINT }).success,
    ).toBe(true);
    expect(deploymentPayloadSchema.safeParse({ ...payload, fingerprint: "v3" }).success).toBe(
      false,
    );
    expect(() =>
      deploymentPayload({ hash: HASH, ticker: "alice", run: "4242", fingerprint: "CANARY" }),
    ).toThrow();
  });

  test("is read back, and a value that is not one leaves the key out", () => {
    const payload = { v: 1, hash: HASH, ticker: "alice", run: "4242" };
    expect(readDeploymentPayload({ ...payload, fingerprint: FINGERPRINT })?.fingerprint).toBe(
      FINGERPRINT,
    );
    expect(readDeploymentPayload({ ...payload, fingerprint: 12 })).toEqual({
      hash: HASH,
      ticker: "alice",
      run: "4242",
    });
    expect(readDeploymentPayload(payload)?.fingerprint).toBeUndefined();
  });

  test("a merge record never carries one", () => {
    const merge = { v: 1, ticker: "alice", run: "4242", merge: 519 };
    expect(
      deploymentPayloadSchema.safeParse({ ...merge, fingerprint: FINGERPRINT }).success,
    ).toBe(false);
  });
});
