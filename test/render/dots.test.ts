import { describe, expect, test } from "bun:test";
import { HEADER_STATES } from "../../src/render/dashboard-facts.ts";
import { HEADER_DOT, RESULT_DOT } from "../../src/render/dots.ts";

// Slice 4.5: the result of a deploy and of a scan as a dot, in the colours of
// the counts line (record 0040). Written out from the slice, not the code.
describe("the result dots", () => {
  test("one per outcome of apply", () => {
    expect(RESULT_DOT).toEqual({
      deployed: "🟢",
      failed: "🔴",
      refused: "🟡",
      "in-sync": "⚪",
      rehearsed: "🟣",
    });
  });

  test("one per header state, the colour of its count on the counts line", () => {
    expect(HEADER_DOT).toEqual({
      failing: "🔴",
      deploying: "🔵",
      // Record 0075: a queued row is counted with the deploying ones.
      queued: "🔵",
      pending: "🟡",
      drift: "🟠",
      "first-run": "⚪",
      "in-sync": "🟢",
    });
    expect(Object.keys(HEADER_DOT).sort()).toEqual([...HEADER_STATES].sort());
  });
});
