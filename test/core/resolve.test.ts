import { describe, expect, test } from "bun:test";
import { capDeploys, MAX_DEPLOYS_PER_RUN, matrixOutput } from "../../src/core/resolve.ts";

// What `resolve` hands to `apply` (record 0035).

describe("the matrix output", () => {
  test("is a JSON list of { stack, environment, deployment }, in that key order", () => {
    expect(
      matrixOutput([
        { stack: "apps/grafana:prod", environment: "sluiceway", deployment: 1234567890 },
      ]),
    ).toBe('[{"stack":"apps/grafana:prod","environment":"sluiceway","deployment":1234567890}]');
  });

  test("is `[]` when nothing was started", () => {
    expect(matrixOutput([])).toBe("[]");
  });
});

describe("the cap on the deploys of one run", () => {
  test("is the 256 matrix jobs a workflow run can have", () => {
    expect(MAX_DEPLOYS_PER_RUN).toBe(256);
  });

  test("starts the first 256 in stack id order, by code unit, and leaves the rest over", () => {
    const ids = Array.from(
      { length: 300 },
      (_, index) => `s${String(index).padStart(3, "0")}:prod`,
    );
    const shuffled = [...ids].reverse().map((stackId) => ({ stackId }));

    const { start, over } = capDeploys(shuffled);

    expect(start.map(({ stackId }) => stackId)).toEqual(ids.slice(0, 256));
    expect(over.map(({ stackId }) => stackId)).toEqual(ids.slice(256));
  });

  test("sorts by code unit, as every list of stacks is", () => {
    const { start } = capDeploys([{ stackId: "b" }, { stackId: "B" }, { stackId: "a" }]);
    expect(start.map(({ stackId }) => stackId)).toEqual(["B", "a", "b"]);
  });

  test("leaves nothing over under the cap", () => {
    expect(capDeploys([{ stackId: "a" }]).over).toEqual([]);
  });
});
