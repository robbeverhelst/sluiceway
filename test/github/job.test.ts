import { describe, expect, test } from "bun:test";
import { readJob } from "../../src/github/job.ts";

const ENV = {
  GITHUB_WORKSPACE: "/home/runner/work/infra/infra",
  GITHUB_REPOSITORY: "acme/infra",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_RUN_ID: "4242",
  GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
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
    });
  });

  test("another server gives another url", () => {
    expect(readJob({ ...ENV, GITHUB_SERVER_URL: "https://github.example.com/" }).repoUrl).toBe(
      "https://github.example.com/acme/infra",
    );
  });

  test.each(["GITHUB_WORKSPACE", "GITHUB_REPOSITORY", "GITHUB_RUN_ID", "GITHUB_SHA"] as const)(
    "without %s there is no job to read",
    (name) => {
      expect(() => readJob({ ...ENV, [name]: "" })).toThrow(
        `${name} is not set. Sluiceway runs as a step of a GitHub Actions job.`,
      );
    },
  );

  test("a repository that is not owner/repo is refused", () => {
    expect(() => readJob({ ...ENV, GITHUB_REPOSITORY: "infra" })).toThrow(
      'GITHUB_REPOSITORY is "infra", which is not an owner and a repo.',
    );
  });
});
