import { describe, expect, test } from "bun:test";
import { createGitHubClient } from "../../src/github/client.ts";
import { createOctokitPort } from "../../src/github/octokit-port.ts";

// The real Octokit with its fetch swapped for one that answers from a list, as
// in octokit-port.test.ts. The answers have the shape real GitHub gave on
// 2026-09-21 for the walk of this repo's main branch, for a pull request by a
// bot in a public repo, and for a commit id GitHub does not have.

interface Answer {
  status?: number;
  json: unknown;
  // The Link header, for a list that goes on.
  link?: string;
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
      headers: {
        "content-type": "application/json",
        ...(answer.link === undefined ? {} : { link: answer.link }),
      },
    });
  };
  const octokit = createGitHubClient("a-token", { request: { fetch } });
  return { port: createOctokitPort(octokit, { owner: "acme", repo: "infra" }), sent };
}

const HEAD = "a55ea6ea1b09b67ca25e41bcff94b0173b571998";
const PARENT = "b5135544429157e154422f7fd43600dd0fc9f251";

function walked(
  nodes: unknown[],
  branch: unknown = { name: "main" },
  pageInfo: unknown = { hasNextPage: false, endCursor: null },
): Answer {
  return {
    json: {
      data: { repository: { defaultBranchRef: branch, object: { history: { pageInfo, nodes } } } },
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
              renamed: false,
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
    expect(variables).toEqual({
      owner: "acme",
      repo: "infra",
      head: HEAD,
      first: 100,
      after: null,
    });
    expect(query).toContain("object(oid: $head)");
    expect(query).toContain("history(first: $first, after: $after)");
    expect(query).toContain("files(first: 100)");
  });

  // Slice 5.5 (record 0072): a lookback past 100 is paged, and a pull
  // request that renamed a file says so. Seen on 2026-09-22 against this
  // repo: `changeType` is `RENAMED`, and GraphQL has no old path.
  test("a lookback past one page asks for the next page after the cursor, for what is left", async () => {
    const node = (oid: string, changeType = "MODIFIED") => ({
      oid,
      messageHeadline: "m",
      author: null,
      parents: { nodes: [] },
      associatedPullRequests: {
        nodes: [
          {
            number: 84,
            title: "t",
            merged: true,
            baseRefName: "main",
            author: null,
            changedFiles: 1,
            files: { nodes: [{ path: "a.ts", changeType }] },
          },
        ],
      },
    });
    const { port, sent } = portThatAnswers([
      walked(
        Array.from({ length: 100 }, () => node(HEAD)),
        undefined,
        {
          hasNextPage: true,
          endCursor: "cursor-1",
        },
      ),
      walked([node(PARENT, "RENAMED")]),
    ]);
    const walk = await port.walkCommits(HEAD, 150);
    expect(walk.commits).toHaveLength(101);
    expect(walk.commits.at(-1)?.sha).toBe(PARENT);
    expect(walk.commits.map(({ pullRequests }) => pullRequests[0]?.renamed).slice(99)).toEqual([
      false,
      true,
    ]);
    expect(sent.map(({ body }) => (body as { variables: unknown }).variables)).toEqual([
      { owner: "acme", repo: "infra", head: HEAD, first: 100, after: null },
      { owner: "acme", repo: "infra", head: HEAD, first: 50, after: "cursor-1" },
    ]);
  });

  test("a history that ends before the lookback stops asking", async () => {
    const { port, sent } = portThatAnswers([walked([])]);
    expect((await port.walkCommits(HEAD, 500)).commits).toEqual([]);
    expect(sent).toHaveLength(1);
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
            renamed: false,
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

  // Slice 5.9: past 300 files GitHub names the next page in the Link header,
  // up to 3,000 files. The port follows it to the end.
  test("follows the Link header past the first 300 files", async () => {
    const next = `https://api.github.com/repositories/1/commits/${HEAD}?page=2`;
    const first = Array.from({ length: 300 }, (_, index) => ({ filename: `a/${index}.ts` }));
    const { port, sent } = portThatAnswers([
      { json: { sha: HEAD, files: first }, link: `<${next}>; rel="next", <${next}>; rel="last"` },
      { json: { sha: HEAD, files: [{ filename: "b/last.ts" }] } },
    ]);

    const files = await port.listCommitFiles(HEAD);

    expect(files).toHaveLength(301);
    expect(files?.at(-1)).toBe("b/last.ts");
    expect(sent.map(({ path, search }) => `${path}${search}`)).toEqual([
      `/repos/acme/infra/commits/${HEAD}`,
      `/repositories/1/commits/${HEAD}?page=2`,
    ]);
  });

  test("a commit with 3,000 files, the most GitHub lists, gives nothing: files may be missing", async () => {
    const page = (from: number) =>
      Array.from({ length: 300 }, (_, index) => ({ filename: `a/${from + index}.ts` }));
    const answers = Array.from({ length: 10 }, (_, index) => ({
      json: { sha: HEAD, files: page(index * 300) },
      ...(index < 9
        ? {
            link: `<https://api.github.com/repositories/1/commits/${HEAD}?page=${index + 2}>; rel="next"`,
          }
        : {}),
    }));
    const { port } = portThatAnswers(answers);
    expect(await port.listCommitFiles(HEAD)).toBeUndefined();
  });
});

// Slice 5.9: the files of a pull request that changed more than the 100 the
// walk holds, page by page, a renamed file under both paths.
describe("the files of one pull request", () => {
  test("are read 100 at a time to the last page", async () => {
    const next = "https://api.github.com/repositories/1/pulls/30/files?per_page=100&page=2";
    const first = Array.from({ length: 100 }, (_, index) => ({ filename: `a/${index}.ts` }));
    const { port, sent } = portThatAnswers([
      { json: first, link: `<${next}>; rel="next"` },
      { json: [{ filename: "b/new.ts", previous_filename: "b/old.ts" }] },
    ]);

    const files = await port.listPullRequestFiles(30);

    expect(files).toHaveLength(102);
    expect(files?.slice(-2)).toEqual(["b/new.ts", "b/old.ts"]);
    expect(sent[0]).toMatchObject({
      method: "GET",
      path: "/repos/acme/infra/pulls/30/files",
      search: "?per_page=100",
    });
  });

  test("a pull request with 3,000 files, the most GitHub lists, gives nothing", async () => {
    const answers = Array.from({ length: 30 }, (_, index) => ({
      json: Array.from({ length: 100 }, (_, one) => ({ filename: `a/${index * 100 + one}.ts` })),
      ...(index < 29
        ? {
            link: `<https://api.github.com/repositories/1/pulls/30/files?per_page=100&page=${index + 2}>; rel="next"`,
          }
        : {}),
    }));
    const { port } = portThatAnswers(answers);
    expect(await port.listPullRequestFiles(30)).toBeUndefined();
  });
});

describe("the files of a pull request", () => {
  test("are one REST call for a page of 100, and a renamed file counts under both paths", async () => {
    const { port, sent } = portThatAnswers([
      {
        json: [
          {
            filename: "test/render/pending-crates.test.ts",
            previous_filename: "test/render/pending-level.test.ts",
            status: "renamed",
          },
          { filename: "README.md", status: "modified" },
        ],
      },
    ]);
    expect(await port.listPullRequestFiles(84)).toEqual([
      "test/render/pending-crates.test.ts",
      "test/render/pending-level.test.ts",
      "README.md",
    ]);
    expect(sent.map(({ method, path, search }) => [method, path, search])).toEqual([
      ["GET", "/repos/acme/infra/pulls/84/files", "?per_page=100"],
    ]);
  });
});
