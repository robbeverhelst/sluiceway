import { describe, expect, test } from "bun:test";
import { parseConfig } from "../../src/core/config.ts";
import { checkWorkflows, type WorkflowFile } from "../../src/core/workflow-check.ts";

// Slice 5.28, record 0092: the check reads the environment a job that runs
// Sluiceway names, as written, so it can say who decides who may deploy. It
// cannot read the environment's rules: they are a setting of the repo.

const DEFAULTS = parseConfig("");

const ONE_STEP = `on:
  push:
    branches: [main]
  issues:
    types: [edited]
jobs:
  sluiceway:
    runs-on: ubuntu-latest
ENVIRONMENT    steps:
      - uses: sluiceway/sluiceway@v0
`;

function environmentOf(environment: string): string | undefined {
  const text = ONE_STEP.replace("ENVIRONMENT", environment);
  const file: WorkflowFile = { path: ".github/workflows/deploy-dashboard.yml", text };
  return checkWorkflows([file], DEFAULTS).workflows[0]?.jobs[0]?.environment;
}

describe("the environment of a job", () => {
  test("is not there when the job names none", () => {
    expect(environmentOf("")).toBeUndefined();
  });

  test("is the name, written as a string", () => {
    expect(environmentOf("    environment: production\n")).toBe("production");
  });

  test("is the name, written as a map", () => {
    expect(
      environmentOf("    environment:\n      name: sluiceway\n      deployment: false\n"),
    ).toBe("sluiceway");
  });

  test("is an expression as written, which only a run evaluates", () => {
    expect(environmentOf("    environment:\n      name: ${{ matrix.environment }}\n")).toBe(
      "${{ matrix.environment }}",
    );
  });

  test("a map with no name names none, as GitHub would not run it", () => {
    expect(environmentOf("    environment:\n      url: https://example.com\n")).toBeUndefined();
  });
});
