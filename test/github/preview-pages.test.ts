// Record 0050: a scan writes one preview page per pending stack on the
// scanned commit, and a later scan of the same commit updates it in place.
// Finding the pages costs one list per 100 check runs on the commit, and
// writing costs one request per pending stack.

import { describe, expect, test } from "bun:test";
import { previewPages } from "../../src/github/preview-pages.ts";
import { FakeGitHub, FakeGitHubError } from "../fake-github/fake-github.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";

function page(stackId: string, text = "x") {
  return { stackId, output: { title: stackId, summary: "s", text } };
}

describe("writing preview pages", () => {
  test("the first scan of a commit creates one page per stack, after one list", async () => {
    const github = new FakeGitHub();
    const written = await previewPages(github, SHA).write([page("a:dev"), page("b:dev")]);

    const runs = github.checkRuns(SHA);
    expect(runs.map(({ name }) => name)).toEqual(["sluiceway / a:dev", "sluiceway / b:dev"]);
    expect(written.urls).toEqual(
      new Map([
        ["a:dev", runs[0]?.htmlUrl ?? ""],
        ["b:dev", runs[1]?.htmlUrl ?? ""],
      ]),
    );
    expect(written).toMatchObject({ created: 2, updated: 0, failed: [], skipped: [] });
    expect(github.requests).toEqual(["listCheckRuns", "createCheckRun", "createCheckRun"]);
  });

  test("a scan of the same commit updates each page in place and makes no duplicate", async () => {
    const github = new FakeGitHub();
    const first = await previewPages(github, SHA).write([page("a:dev"), page("b:dev")]);
    github.requests.length = 0;

    const again = await previewPages(github, SHA).write([page("a:dev", "y"), page("b:dev", "y")]);

    expect(again.urls).toEqual(first.urls);
    expect(again).toMatchObject({ created: 0, updated: 2 });
    expect(github.checkRuns(SHA)).toHaveLength(2);
    expect(github.checkRuns(SHA).map(({ output }) => output.text)).toEqual(["y", "y"]);
    expect(github.requests).toEqual(["listCheckRuns", "updateCheckRun", "updateCheckRun"]);
  });

  test("a page on another commit is not this commit's page", async () => {
    const github = new FakeGitHub();
    await previewPages(github, "f".repeat(40)).write([page("a:dev")]);
    const written = await previewPages(github, SHA).write([page("a:dev")]);
    expect(written.created).toBe(1);
  });

  test("of two runs with one name the newest is updated, the one filter=latest shows", async () => {
    const github = new FakeGitHub();
    await github.createCheckRun({ sha: SHA, name: "sluiceway / a:dev", output: page("a").output });
    const newer = await github.createCheckRun({
      sha: SHA,
      name: "sluiceway / a:dev",
      output: page("a").output,
    });
    const written = await previewPages(github, SHA).write([page("a:dev", "y")]);
    expect(written.urls.get("a:dev")).toBe(newer.htmlUrl);
    expect(github.checkRuns(SHA).map(({ output }) => output.text)).toEqual(["x", "y"]);
  });

  test("a second round of the same scan lists no more and creates or updates what it has", async () => {
    const github = new FakeGitHub();
    const pages = previewPages(github, SHA);
    await pages.write([page("a:dev")]);
    github.requests.length = 0;

    const second = await pages.write([page("a:dev", "y"), page("c:dev")]);

    expect(second).toMatchObject({ created: 1, updated: 1 });
    expect(github.requests).toEqual(["updateCheckRun", "createCheckRun"]);
    expect(github.checkRuns(SHA)).toHaveLength(2);
  });

  test("no pending stack means no request at all", async () => {
    const github = new FakeGitHub();
    const written = await previewPages(github, SHA).write([]);
    expect(written.urls.size).toBe(0);
    expect(github.requests).toEqual([]);
  });

  test("100 pending stacks among the jobs of CI cost one list per 100 check runs and one write each", async () => {
    const github = new FakeGitHub();
    for (let i = 0; i < 30; i++) github.seedCheckRun(SHA, `ci / job-${i}`);
    const ids = Array.from({ length: 100 }, (_, i) => `apps/service-${i}:prod`);
    await previewPages(github, SHA).write(ids.map((id) => page(id)));
    github.requests.length = 0;

    const again = await previewPages(github, SHA).write(ids.map((id) => page(id, "y")));

    expect(again.updated).toBe(100);
    const made = (name: string) => github.requests.filter((one) => one === name).length;
    expect(made("listCheckRuns")).toBe(2);
    expect(made("updateCheckRun")).toBe(100);
    expect(github.requests).toHaveLength(102);
  });
});

describe("when GitHub refuses", () => {
  test("without checks: write the first refusal stops the writes, and no stack has a page", async () => {
    const github = new FakeGitHub();
    github.withoutChecksWrite();
    const pages = previewPages(github, SHA);

    const written = await pages.write([page("a:dev"), page("b:dev"), page("c:dev")]);

    expect(written.urls.size).toBe(0);
    expect(written.refused).toEqual({
      message: "Resource not accessible by integration",
      permission: true,
    });
    expect(written.failed).toEqual([]);
    expect(written.skipped).toEqual(["a:dev", "b:dev", "c:dev"]);
    expect(github.requests).toEqual(["listCheckRuns", "createCheckRun"]);

    // A later round of the same scan does not ask again, or say it again.
    github.requests.length = 0;
    const later = await pages.write([page("d:dev")]);
    expect(later.skipped).toEqual(["d:dev"]);
    expect(later.refused).toBeUndefined();
    expect(github.requests).toEqual([]);
  });

  test("a refused list stops the writes the same way", async () => {
    const github = new FakeGitHub();
    github.listCheckRuns = async () => {
      throw new FakeGitHubError(403, "Resource not accessible by integration");
    };
    const written = await previewPages(github, SHA).write([page("a:dev")]);
    expect(written.refused?.permission).toBe(true);
    expect(written.skipped).toEqual(["a:dev"]);
  });

  test("a refusal for another reason stops the writes and says it is not the permission", async () => {
    const github = new FakeGitHub();
    github.createCheckRun = async () => {
      throw new FakeGitHubError(403, "You have exceeded a secondary rate limit.");
    };
    const written = await previewPages(github, SHA).write([page("a:dev"), page("b:dev")]);
    expect(written.refused).toEqual({
      message: "You have exceeded a secondary rate limit.",
      permission: false,
    });
    expect(written.skipped).toEqual(["a:dev", "b:dev"]);
  });

  test("one page that fails for another reason costs only that stack its page", async () => {
    const github = new FakeGitHub();
    const create = github.createCheckRun.bind(github);
    github.createCheckRun = async (run) => {
      if (run.name === "sluiceway / b:dev") throw new FakeGitHubError(502, "Server Error");
      return create(run);
    };
    const written = await previewPages(github, SHA).write([
      page("a:dev"),
      page("b:dev"),
      page("c:dev"),
    ]);
    expect([...written.urls.keys()]).toEqual(["a:dev", "c:dev"]);
    expect(written.failed).toEqual([{ stackId: "b:dev", message: "Server Error" }]);
    expect(written.refused).toBeUndefined();
  });

  test("a page that is gone since the list, with the run it sat in, is created again", async () => {
    const github = new FakeGitHub();
    await previewPages(github, SHA).write([page("a:dev")]);
    github.updateCheckRun = async () => {
      throw new FakeGitHubError(404, "Not Found");
    };
    const written = await previewPages(github, SHA).write([page("a:dev", "y")]);
    expect(written).toMatchObject({ created: 1, updated: 0, failed: [] });
    expect(github.checkRuns(SHA)).toHaveLength(2);
  });
});
