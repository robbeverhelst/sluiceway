import { describe, expect, test } from "bun:test";
import { getOctokit } from "@actions/github";
import { createOctokitPort } from "../../src/github/octokit-port.ts";

// The real Octokit with its fetch swapped for one that answers from a list, as
// in octokit-port.test.ts. The answers have the shape real GitHub gave on
// 2026-09-21 for the walk of this repo's main branch, for a pull request by a
// bot in a public repo, and for a commit id GitHub does not have.

interface Answer {
  status?: number;
  json: unknown;
}

function portThatAnswers(answers: Answer[]) {
  const sent: { method: string; path: string; search: string; body: unknown }[] = [];
  const fetch = async (url: string, init: { method?: string; body?: string }) => {
    sent.push({
      method: init.method ?? "GET",
      path: new URL(url).pathname,
      search: new URL(url).search,
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    const answer = answers.shift();
    if (!answer) throw new Error(`No answer left for ${init.method} ${url}`);
    return new Response(JSON.stringify(answer.json), {
      status: answer.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  const octokit = getOctokit("a-token", { request: { fetch } });
  return { port: createOctokitPort(octokit, { owner: "acme", repo: "infra" }), sent };
}

const HEAD = "a55ea6ea1b09b67ca25e41bcff94b0173b571998";
const PARENT = "b5135544429157e154422f7fd43600dd0fc9f251";

function walked(nodes: unknown[], branch: unknown = { name: "main" }): Answer {
  return {
    json: {
      data: { repository: { defaultBranchRef: branch, object: { history: { nodes } } } },
    },
  };
}

describe("walking the commits", () => {
  test("is one GraphQL query from the scanned commit back, with each commit's pull requests and their files", async () => {
    const { port, sent } = portThatAnswers([
      walked([
        {
          oid: HEAD,
          messageHeadline: "build: rebuild dist for slice 2.1",
          author: { user: { login: "robbeverhelst" } },
          parents: { nodes: [{ oid: PARENT }] },
          associatedPullRequests: {
            nodes: [
              {
                number: 60,
                title: "feat(github): slice 2.1",
                merged: true,
                baseRefName: "main",
                author: { __typename: "User", login: "robbeverhelst" },
                changedFiles: 2,
                files: { nodes: [{ path: "README.md" }, { path: "dist/index.js" }] },
              },
            ],
          },
        },
        {
          oid: PARENT,
          messageHeadline: "a direct push",
          author: { user: null },
          parents: { nodes: [] },
          associatedPullRequests: { nodes: [] },
        },
      ]),
    ]);

    expect(await port.walkCommits(HEAD)).toEqual({
      defaultBranch: "main",
      commits: [
        {
          sha: HEAD,
          parents: [PARENT],
          author: "robbeverhelst",
          message: "build: rebuild dist for slice 2.1",
          pullRequests: [
            {
              number: 60,
              title: "feat(github): slice 2.1",
              author: "robbeverhelst",
              base: "main",
              merged: true,
              changedFiles: 2,
              files: ["README.md", "dist/index.js"],
            },
          ],
        },
        { sha: PARENT, parents: [], author: undefined, message: "a direct push", pullRequests: [] },
      ],
    });

    expect(sent).toHaveLength(1);
    const [{ method, path, body }] = sent as [(typeof sent)[number]];
    expect([method, path]).toEqual(["POST", "/graphql"]);
    const { query, variables } = body as { query: string; variables: unknown };
    expect(variables).toEqual({ owner: "acme", repo: "infra", head: HEAD });
    expect(query).toContain("object(oid: $head)");
    expect(query).toContain("history(first: 100)");
    expect(query).toContain("files(first: 100)");
  });

  test("GraphQL names a bot without its suffix, and the port gives the login as the site writes it", async () => {
    const { port } = portThatAnswers([
      walked([
        {
          oid: HEAD,
          messageHeadline: "chore(deps): update",
          author: { user: { login: "renovate[bot]" } },
          parents: { nodes: [] },
          associatedPullRequests: {
            nodes: [
              {
                number: 46367,
                title: "chore(deps): update",
                merged: true,
                baseRefName: "main",
                author: { __typename: "Bot", login: "renovate" },
                changedFiles: 1,
                files: { nodes: [{ path: "bun.lock" }] },
              },
            ],
          },
        },
      ]),
    ]);
    const walk = await port.walkCommits(HEAD);
    expect(walk.commits[0]?.author).toBe("renovate[bot]");
    expect(walk.commits[0]?.pullRequests[0]?.author).toBe("renovate[bot]");
  });

  test("a pull request whose author is gone, and nodes GitHub gives as null", async () => {
    const { port } = portThatAnswers([
      walked([
        null,
        {
          oid: HEAD,
          messageHeadline: "x",
          author: null,
          parents: { nodes: [null] },
          associatedPullRequests: {
            nodes: [
              null,
              {
                number: 7,
                title: "x",
                merged: true,
                baseRefName: "main",
                author: null,
                changedFiles: 3001,
                files: null,
              },
            ],
          },
        },
      ]),
    ]);
    expect((await port.walkCommits(HEAD)).commits).toEqual([
      {
        sha: HEAD,
        parents: [],
        author: undefined,
        message: "x",
        pullRequests: [
          {
            number: 7,
            title: "x",
            author: undefined,
            base: "main",
            merged: true,
            changedFiles: 3001,
            files: [],
          },
        ],
      },
    ]);
  });

  test("a commit GitHub does not have is an error, as real GitHub answers with no object", async () => {
    const { port } = portThatAnswers([
      { json: { data: { repository: { defaultBranchRef: { name: "main" }, object: null } } } },
    ]);
    await expect(port.walkCommits(HEAD)).rejects.toThrow(/no commit a55ea6e/);
  });

  test("a repo without a default branch is an error", async () => {
    const { port } = portThatAnswers([walked([], null)]);
    await expect(port.walkCommits(HEAD)).rejects.toThrow(/default branch/);
  });
});

describe("the files of one commit", () => {
  test("are one REST call without a page size, which gives up to 300 files, and a renamed file counts under both paths", async () => {
    const { port, sent } = portThatAnswers([
      {
        json: {
          sha: HEAD,
          files: [
            { filename: "apps/grafana/index.ts", status: "modified" },
            { filename: "apps/loki/new.ts", previous_filename: "apps/grafana/old.ts" },
          ],
        },
      },
    ]);
    expect(await port.listCommitFiles(HEAD)).toEqual([
      "apps/grafana/index.ts",
      "apps/loki/new.ts",
      "apps/grafana/old.ts",
    ]);
    expect(sent.map(({ method, path, search }) => [method, path, search])).toEqual([
      ["GET", `/repos/acme/infra/commits/${HEAD}`, ""],
    ]);
  });

  test("a commit without files", async () => {
    const { port } = portThatAnswers([{ json: { sha: HEAD } }]);
    expect(await port.listCommitFiles(HEAD)).toEqual([]);
  });
});
