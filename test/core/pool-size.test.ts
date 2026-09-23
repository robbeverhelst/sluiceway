import { describe, expect, test } from "bun:test";
import { poolSize } from "../../src/core/pool.ts";

// Slice 5.21 (issue 198): previewing is bound by the CPU, so without the
// `concurrency` input the pool follows the cores of the machine the scan runs
// on, from 1 to 8 (record 0085).
describe("the size of the pool without the concurrency input", () => {
  test("is 1 on a machine with one core, as ubuntu-slim has", () => {
    expect(poolSize(undefined, 1)).toEqual({ size: 1, from: "cores", cores: 1 });
  });

  test("is 2 on a machine with two cores, as ubuntu-latest has for a private repo", () => {
    expect(poolSize(undefined, 2)).toEqual({ size: 2, from: "cores", cores: 2 });
  });

  test("is 4 on a machine with four cores, as ubuntu-latest has for a public repo", () => {
    expect(poolSize(undefined, 4)).toEqual({ size: 4, from: "cores", cores: 4 });
  });

  test("follows the cores up to 8", () => {
    expect(poolSize(undefined, 8)).toEqual({ size: 8, from: "cores", cores: 8 });
  });

  test("is 8 on a machine with many cores", () => {
    expect(poolSize(undefined, 9)).toEqual({ size: 8, from: "cores", cores: 9 });
    expect(poolSize(undefined, 64)).toEqual({ size: 8, from: "cores", cores: 64 });
  });

  test.each([undefined, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "is 1 when the count of cores is %p, which is no count",
    (cores) => {
      expect(poolSize(undefined, cores)).toEqual({ size: 1, from: "unknown" });
    },
  );
});

describe("the size of the pool with the concurrency input", () => {
  test("is the input, whatever the machine has", () => {
    expect(poolSize(3, 1)).toEqual({ size: 3, from: "input" });
    expect(poolSize(1, 64)).toEqual({ size: 1, from: "input" });
    expect(poolSize(2, undefined)).toEqual({ size: 2, from: "input" });
  });

  test("is not held to the range the cores are", () => {
    expect(poolSize(16, 2)).toEqual({ size: 16, from: "input" });
  });
});
