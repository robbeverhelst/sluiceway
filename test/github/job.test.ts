import { describe, expect, test } from "bun:test";
import { readJob } from "../../src/github/job.ts";

const ENV = {
  GITHUB_WORKSPACE: "/home/runner/work/infra/infra",
  GITHUB_REPOSITORY: "acme/infra",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_RUN_ID: "4242",
  GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
  GITHUB_EVENT_NAME: "push",
  GITHUB_WORKFLOW_REF: "acme/infra/.github/workflows/sluiceway.yml@refs/heads/main",
};

describe("the facts of the job, read once from its environment", () => {
  test("the checked-out repo, the repo's url, the run and the commit", () => {
    expect(readJob(ENV)).toEqual({
      root: "/home/runner/work/infra/infra",
      owner: "acme",
      repo: "infra",
      repoUrl: "https://github.com/acme/infra",
      runId: "4242",
      sha: "0123456789abcdef0123456789abcdef01234567",
      event: "push",
      workflow: "sluiceway.yml",
    });
  });

  test("the workflow is the file name, whatever the ref looks like", () => {
    const workflow = (ref: string) => readJob({ ...ENV, GITHUB_WORKFLOW_REF: ref }).workflow;
    expect(workflow("acme/infra/.github/workflows/deploy.yaml@refs/tags/v1.2.3")).toBe(
      "deploy.yaml",
    );
    expect(workflow("acme/infra/.github/workflows/infra.yml@refs/heads/feature/a@b.yml@c")).toBe(
      "infra.yml",
    );
    expect(workflow("acme/infra/.github/workflows/infra.yml@0123456789abcdef")).toBe("infra.yml");
    expect(workflow("acme/infra/.github/workflows/infra@prod.yml@refs/heads/main")).toBe(
      "infra@prod.yml",
    );
  });

  test("a workflow ref that names no workflow file is refused", () => {
    expect(() => readJob({ ...ENV, GITHUB_WORKFLOW_REF: "acme/infra@refs/heads/main" })).toThrow(
      'GITHUB_WORKFLOW_REF is "acme/infra@refs/heads/main", which names no workflow file.',
    );
  });

  test("another server gives another url", () => {
    expect(readJob({ ...ENV, GITHUB_SERVER_URL: "https://github.example.com/" }).repoUrl).toBe(
      "https://github.example.com/acme/infra",
    );
  });

  test.each([
    "GITHUB_WORKSPACE",
    "GITHUB_REPOSITORY",
    "GITHUB_RUN_ID",
    "GITHUB_SHA",
    "GITHUB_EVENT_NAME",
    "GITHUB_WORKFLOW_REF",
  ] as const)("without %s there is no job to read", (name) => {
    expect(() => readJob({ ...ENV, [name]: "" })).toThrow(
      `${name} is not set. Sluiceway runs as a step of a GitHub Actions job.`,
    );
  });

  test("a repository that is not owner/repo is refused", () => {
    expect(() => readJob({ ...ENV, GITHUB_REPOSITORY: "infra" })).toThrow(
      'GITHUB_REPOSITORY is "infra", which is not an owner and a repo.',
    );
  });
});
