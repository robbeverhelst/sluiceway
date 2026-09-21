import { describe, expect, test } from "bun:test";
import { readWorkflowRef } from "../../src/github/workflow-ref.ts";

describe("the workflow of the running job", () => {
  test("is the file and the ref of GITHUB_WORKFLOW_REF", () => {
    expect(
      readWorkflowRef({
        GITHUB_WORKFLOW_REF: "acme/infra/.github/workflows/sluiceway.yml@refs/heads/main",
      }),
    ).toEqual({ file: "sluiceway.yml", ref: "refs/heads/main" });
  });

  test("a ref with an at sign in it stays whole", () => {
    expect(
      readWorkflowRef({
        GITHUB_WORKFLOW_REF: "acme/infra/.github/workflows/deploy.yaml@refs/heads/team@home",
      }),
    ).toEqual({ file: "deploy.yaml", ref: "refs/heads/team@home" });
  });

  test.each([
    ["not set", {}],
    ["empty", { GITHUB_WORKFLOW_REF: "" }],
    ["without a ref", { GITHUB_WORKFLOW_REF: "acme/infra/.github/workflows/sluiceway.yml" }],
    ["without a file", { GITHUB_WORKFLOW_REF: "@refs/heads/main" }],
    ["with an empty ref", { GITHUB_WORKFLOW_REF: "acme/infra/.github/workflows/s.yml@" }],
  ])("is unknown when the variable is %s", (_name, env) => {
    expect(readWorkflowRef(env)).toBeUndefined();
  });
});
