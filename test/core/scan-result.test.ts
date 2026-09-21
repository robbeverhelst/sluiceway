import { describe, expect, test } from "bun:test";
import { everyPreviewFailed } from "../../src/core/scan-result.ts";

// Record 0012: the job fails when every attempted preview failed and more than
// one was attempted. One broken stack never turns a job red.
describe("when a scan could not do its work", () => {
  test.each([
    { attempted: 0, failed: 0, red: false },
    { attempted: 1, failed: 0, red: false },
    { attempted: 1, failed: 1, red: false },
    { attempted: 2, failed: 1, red: false },
    { attempted: 2, failed: 2, red: true },
    { attempted: 58, failed: 57, red: false },
    { attempted: 58, failed: 58, red: true },
  ])("$failed of $attempted failed: red is $red", ({ attempted, failed, red }) => {
    expect(everyPreviewFailed(attempted, failed)).toBe(red);
  });
});
