import { afterEach, describe, expect, test } from "bun:test";
import { createGitHubClient } from "../../src/github/client.ts";
import { createOctokitPort } from "../../src/github/octokit-port.ts";
import { FakeGitHub } from "./fake-github.ts";
import { type FakeGitHubServer, startFakeGitHubServer } from "./server.ts";

// The fake keeps commits and pull requests and answers the walk from them, the
// way real GitHub answered on 2026-09-21 (the pull request of slice 2.8). Each
// behavior is pinned on the fake and, at the end, over HTTP behind the real
// Octokit port.

function sha(name: string): string {
  return name.padEnd(40, "0");
}

// main: c1, then pull request 7 as a merge commit over two branch commits,
// then a direct push.
function repo(): FakeGitHub {
  const fake = new FakeGitHub();
  fake.seedCommit({ sha: sha("c1"), author: "bob", message: "first", files: ["README.md"] });
  fake.seedCommit({ sha: sha("b1"), parents: [sha("c1")], author: "alice", message: "branch 1" });
  fake.seedCommit({ sha: sha("b2"), parents: [sha("b1")], author: "alice", message: "branch 2" });
  fake.seedCommit({
    sha: sha("m"),
    parents: [sha("c1"), sha("b2")],
    author: "merger",
    message: "Merge pull request #7",
  });
  fake.seedPullRequest({
    number: 7,
    title: "Grafana alerts",
    author: "alice",
    files: ["apps/grafana/a.ts", "apps/grafana/b.ts"],
    commits: [sha("b1"), sha("b2"), sha("m")],
  });
  fake.seedCommit({
    sha: sha("d1"),
    parents: [sha("m")],
    author: undefined,
    message: "hotfix",
    files: [{ path: "apps/loki/new.ts", previousPath: "apps/grafana/old.ts" }],
  });
  return fake;
}

describe("the walk", () => {
  test("lists the commits that can be reached from the head, children before parents, each with its pull requests", async () => {
    const fake = repo();
    const walk = await fake.walkCommits(sha("d1"));
    expect(walk.defaultBranch).toBe("main");
    expect(walk.commits.map((commit) => [commit.sha, commit.parents, commit.author])).toEqual([
      [sha("d1"), [sha("m")], undefined],
      [sha("m"), [sha("c1"), sha("b2")], "merger"],
      [sha("b2"), [sha("b1")], "alice"],
      [sha("b1"), [sha("c1")], "alice"],
      [sha("c1"), [], "bob"],
    ]);
    const pullRequest = {
      number: 7,
      title: "Grafana alerts",
      author: "alice",
      base: "main",
      merged: true,
      changedFiles: 2,
      files: ["apps/grafana/a.ts", "apps/grafana/b.ts"],
      renamed: false,
    };
    expect(walk.commits.map((commit) => commit.pullRequests)).toEqual([
      [],
      [pullRequest],
      [pullRequest],
      [pullRequest],
      [],
    ]);
    expect(fake.requests).toEqual(["walkCommits"]);
  });

  test("starts at the head it is given: a newer commit is not on it", async () => {
    const walk = await repo().walkCommits(sha("m"));
    expect(walk.commits.map((commit) => commit.sha)).not.toContain(sha("d1"));
  });

  test("holds the newest 100 commits and no more", async () => {
    const fake = new FakeGitHub();
    for (let index = 0; index < 130; index++) {
      fake.seedCommit({
        sha: sha(`n${index}x`),
        parents: index === 0 ? [] : [sha(`n${index - 1}x`)],
      });
    }
    const walk = await fake.walkCommits(sha("n129x"));
    expect(walk.commits).toHaveLength(100);
    expect(walk.commits.at(-1)?.sha).toBe(sha("n30x"));
  });

  // Slice 5.5 (record 0072): `attribution.lookback`, one GraphQL page per
  // 100 commits.
  test("holds the lookback it is asked for, at one request per page of 100", async () => {
    const fake = new FakeGitHub();
    for (let index = 0; index < 260; index++) {
      fake.seedCommit({
        sha: sha(`n${index}x`),
        parents: index === 0 ? [] : [sha(`n${index - 1}x`)],
      });
    }
    const walk = await fake.walkCommits(sha("n259x"), 250);
    expect(walk.commits).toHaveLength(250);
    expect(walk.commits.at(-1)?.sha).toBe(sha("n10x"));
    expect(fake.requests).toEqual(["walkCommits", "walkCommits", "walkCommits"]);
    expect((await fake.walkCommits(sha("n259x"), 20)).commits).toHaveLength(20);
  });

  test("a commit the repo does not have fails", async () => {
    await expect(repo().walkCommits(sha("gone"))).rejects.toThrow();
  });

  test("a pull request that renamed a file says so, and lists only the new path", async () => {
    const [commit] = (await renamed().walkCommits(sha("c1"))).commits;
    expect(commit?.pullRequests[0]?.renamed).toBe(true);
    expect(commit?.pullRequests[0]?.files).toEqual(["apps/loki/rules.ts", "README.md"]);
    const [plain] = (await repo().walkCommits(sha("m"))).commits;
    expect(plain?.pullRequests[0]?.renamed).toBe(false);
  });

  test("a pull request lists its first 100 files and says how many it changed", async () => {
    const fake = new FakeGitHub();
    fake.seedCommit({ sha: sha("c1") });
    fake.seedPullRequest({
      number: 9,
      files: Array.from({ length: 140 }, (_, index) => `apps/${index}.ts`),
      commits: [sha("c1")],
    });
    const [commit] = (await fake.walkCommits(sha("c1"))).commits;
    expect(commit?.pullRequests[0]?.changedFiles).toBe(140);
    expect(commit?.pullRequests[0]?.files).toHaveLength(100);
  });
});

// Pull request 12 moved a file out of grafana into loki.
function renamed(): FakeGitHub {
  const fake = new FakeGitHub();
  fake.seedCommit({ sha: sha("c1") });
  fake.seedPullRequest({
    number: 12,
    files: [{ path: "apps/loki/rules.ts", previousPath: "apps/grafana/rules.ts" }, "README.md"],
    commits: [sha("c1")],
  });
  return fake;
}

describe("the files of a pull request", () => {
  test("a renamed file comes under both paths, in one request", async () => {
    const fake = renamed();
    expect(await fake.listPullRequestFiles(12)).toEqual([
      "apps/loki/rules.ts",
      "apps/grafana/rules.ts",
      "README.md",
    ]);
    expect(fake.requests).toEqual(["listPullRequestFiles"]);
  });

  test("a pull request the repo does not have fails", async () => {
    await expect(renamed().listPullRequestFiles(99)).rejects.toThrow();
  });
});

describe("the files of a commit", () => {
  test("a renamed file comes under both paths, and the call is one request", async () => {
    const fake = repo();
    expect(await fake.listCommitFiles(sha("d1"))).toEqual([
      "apps/loki/new.ts",
      "apps/grafana/old.ts",
    ]);
    expect(fake.requests).toEqual(["listCommitFiles"]);
  });

  // Slice 5.9: pages of 300, each one request, up to GitHub's 3,000.
  test("every file, one request per page of 300", async () => {
    const fake = new FakeGitHub();
    fake.seedCommit({
      sha: sha("big"),
      files: Array.from({ length: 320 }, (_, index) => `f/${index}`),
    });
    expect(await fake.listCommitFiles(sha("big"))).toHaveLength(320);
    expect(fake.requests).toEqual(["listCommitFiles", "listCommitFiles"]);
  });

  test("3,000 files or more is nothing, because files may be missing", async () => {
    const fake = new FakeGitHub();
    fake.seedCommit({
      sha: sha("huge"),
      files: Array.from({ length: 3_000 }, (_, index) => `f/${index}`),
    });
    expect(await fake.listCommitFiles(sha("huge"))).toBeUndefined();
  });

  test("the files of a pull request, one request per page of 100", async () => {
    const fake = new FakeGitHub();
    fake.seedCommit({ sha: sha("c1") });
    const files = Array.from({ length: 140 }, (_, index) => `f/${index}`);
    fake.seedPullRequest({ number: 7, files, commits: [sha("c1")] });
    expect(await fake.listPullRequestFiles(7)).toEqual(files);
    expect(fake.requests).toEqual(["listPullRequestFiles", "listPullRequestFiles"]);
  });

  test("a commit the repo does not have fails", async () => {
    await expect(repo().listCommitFiles(sha("gone"))).rejects.toThrow();
  });
});

describe("over HTTP behind the real port", () => {
  const servers: FakeGitHubServer[] = [];
  afterEach(async () => {
    for (const server of servers.splice(0)) await server.close();
  });

  async function served(fake: FakeGitHub) {
    const server = await startFakeGitHubServer(fake);
    servers.push(server);
    const octokit = createGitHubClient("a-token", { baseUrl: server.url });
    return createOctokitPort(octokit, { owner: "acme", repo: "infra" });
  }

  test("the walk and the files read as the fake gives them", async () => {
    const fake = repo();
    const port = await served(fake);
    expect(await port.walkCommits(sha("d1"))).toEqual(await fake.walkCommits(sha("d1")));
    expect(await port.listCommitFiles(sha("d1"))).toEqual(await fake.listCommitFiles(sha("d1")));
  });

  // Slice 5.9: the pages go over the wire with GitHub's Link header.
  test("the files of a big commit and of a big pull request come page by page", async () => {
    const fake = new FakeGitHub();
    const files = Array.from({ length: 450 }, (_, index) => `f/${index}`);
    fake.seedCommit({ sha: sha("big"), files });
    fake.seedPullRequest({ number: 7, files: files.slice(0, 250), commits: [sha("big")] });
    const port = await served(fake);
    expect(await port.listCommitFiles(sha("big"))).toEqual(files);
    expect(await port.listPullRequestFiles(7)).toEqual(files.slice(0, 250));
    expect(fake.requests.filter((request) => request === "listCommitFiles")).toHaveLength(2);
    expect(fake.requests.filter((request) => request === "listPullRequestFiles")).toHaveLength(3);
  });

  test("a lookback past one page is paged, and a renamed file's old path is read", async () => {
    const fake = new FakeGitHub();
    for (let index = 0; index < 160; index++) {
      fake.seedCommit({
        sha: sha(`n${index}x`),
        parents: index === 0 ? [] : [sha(`n${index - 1}x`)],
      });
    }
    fake.seedPullRequest({
      number: 12,
      files: [{ path: "apps/loki/rules.ts", previousPath: "apps/grafana/rules.ts" }],
      commits: [sha("n150x")],
    });
    const port = await served(fake);
    expect(await port.walkCommits(sha("n159x"), 150)).toEqual(
      await fake.walkCommits(sha("n159x"), 150),
    );
    expect(await port.listPullRequestFiles(12)).toEqual(await fake.listPullRequestFiles(12));
  });

  test("a bot's pull request goes over the wire the way GraphQL names a bot, without the suffix", async () => {
    const fake = new FakeGitHub();
    fake.seedCommit({ sha: sha("c1"), author: "renovate[bot]" });
    fake.seedPullRequest({
      number: 3,
      author: "renovate[bot]",
      files: ["bun.lock"],
      commits: [sha("c1")],
    });
    const port = await served(fake);
    const [commit] = (await port.walkCommits(sha("c1"))).commits;
    expect(commit?.author).toBe("renovate[bot]");
    expect(commit?.pullRequests[0]?.author).toBe("renovate[bot]");
  });

  test("a commit the repo does not have fails both calls", async () => {
    const port = await served(repo());
    await expect(port.walkCommits(sha("gone"))).rejects.toThrow(/no commit/);
    await expect(port.listCommitFiles(sha("gone"))).rejects.toThrow();
  });
});
