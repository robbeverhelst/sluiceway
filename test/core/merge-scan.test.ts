import { describe, expect, test } from "bun:test";
import {
  declaresMergeScanInput,
  MERGE_SCAN_INPUT,
  mergeScanInputs,
  readMergeScanInput,
} from "../../src/core/merge-scan.ts";

// The dispatch input that tells the scan after a merge which pull requests
// `resolve` merged, so it can narrow (slice 4.13).

describe("the input", () => {
  test("is named sluiceway-merged and holds the pull request numbers", () => {
    expect(MERGE_SCAN_INPUT).toBe("sluiceway-merged");
    expect(mergeScanInputs([418, 421])).toEqual({ "sluiceway-merged": "418,421" });
  });

  test("reads back as the numbers, and anything else as none", () => {
    expect(readMergeScanInput("418,421")).toEqual([418, 421]);
    expect(readMergeScanInput(" 418 ")).toEqual([418]);
    for (const value of [undefined, "", "418,x", "0", "-1", "4.5", 418]) {
      expect(readMergeScanInput(value)).toEqual([]);
    }
  });
});

describe("a workflow that declares it", () => {
  const WITH = `on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      sluiceway-merged:
        description: Set by Sluiceway after a merge from the dashboard. Leave it empty.
        required: false
jobs: {}
`;

  test("is read from the workflow_dispatch trigger's inputs", () => {
    expect(declaresMergeScanInput(WITH)).toBe(true);
  });

  test("a workflow without it, or that does not read, does not", () => {
    for (const text of [
      "on:\n  workflow_dispatch:\njobs: {}\n",
      "on: [push, workflow_dispatch]\n",
      "on:\n  workflow_dispatch:\n    inputs:\n      other:\n        type: string\n",
      "on: workflow_dispatch\n",
      ": not yaml : [",
      "",
    ]) {
      expect(declaresMergeScanInput(text)).toBe(false);
    }
  });
});
