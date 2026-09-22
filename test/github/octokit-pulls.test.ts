import { describe, expect, test } from "bun:test";
import { getOctokit } from "@actions/github";
import { createOctokitPort } from "../../src/github/octokit-port.ts";

// The real Octokit with its fetch swapped for one that answers from a list, as
// in octokit-port.test.ts. The answers have the shape of GitHub's REST and
// GraphQL documentation (slice 4.2). They were not probed on real GitHub.

interface Answer {
  status?: number;
  json: unknown;
}

function portThatAnswers(answers: Answer[]) {
  const sent: { method: string; path: string; body: unknown }[] = [];
  const fetch = async (url: string, init: { method?: string; body?: string }) => {
    sent.push({
      method: init.method ?? "GET",
      path: new URL(url).pathname,
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

function node(overrides: Record<string, unknown> = {}) {
  return {
    number: 418,
    title: "Update Helm release odoo to v17.0.4",
    isDraft: false,
    baseRefName: "main",
    headRefOid: HEAD,
    mergeable: "MERGEABLE",
    isCrossRepository: false,
    author: { __typename: "Bot", login: "renovate" },
    changedFiles: 1,
    files: { nodes: [{ path: "apps/odoo/Pulumi.prod.yaml", changeType: "MODIFIED" }] },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
    ...overrides,
  };
}

function listed(nodes: unknown[], pageInfo?: { hasNextPage: boolean; endCursor: string }): Answer {
  return {
    json: {
      data: {
        repository: {
          defaultBranchRef: { name: "main" },
          pullRequests: { nodes, ...(pageInfo ? { pageInfo } : {}) },
        },
      },
    },
  };
}

describe("listing the open pull requests", () => {
  test("is one GraphQL query that gives each one in the port's words", async () => {
    const { port, sent } = portThatAnswers([listed([node()])]);
    expect(await port.listOpenPullRequests()).toEqual({
      defaultBranch: "main",
      pullRequests: [
        {
          number: 418,
          title: "Update Helm release odoo to v17.0.4",
          author: "renovate[bot]",
          draft: false,
          base: "main",
          head: HEAD,
          mergeable: "mergeable",
          checks: "success",
          files: ["apps/odoo/Pulumi.prod.yaml"],
          filesComplete: true,
          fromFork: false,
        },
      ],
    });
    expect(sent.map(({ method, path }) => `${method} ${path}`)).toEqual(["POST /graphql"]);
  });

  test("pages past the oldest 100 with GraphQL's cursor (slice 4.13)", async () => {
    const { port, sent } = portThatAnswers([
      listed([node({ number: 1 })], { hasNextPage: true, endCursor: "Y3Vyc29yOjEwMA==" }),
      listed([node({ number: 101 })], { hasNextPage: false, endCursor: "Y3Vyc29yOjEwMQ==" }),
    ]);
    const { pullRequests } = await port.listOpenPullRequests();
    expect(pullRequests.map(({ number }) => number)).toEqual([1, 101]);
    const variables = sent.map(
      ({ body }) => (body as { variables: Record<string, unknown> }).variables,
    );
    expect(variables).toEqual([
      { owner: "acme", repo: "infra", after: null },
      { owner: "acme", repo: "infra", after: "Y3Vyc29yOjEwMA==" },
    ]);
  });

  // Slice 5.9: past the oldest 1,000 too, one request per page of 100, to
  // the last page.
  test("reads every page, past the oldest 1,000 open pull requests", async () => {
    const answers = Array.from({ length: 12 }, (_, index) =>
      listed([node({ number: index + 1 })], {
        hasNextPage: index < 11,
        endCursor: `c${index}`,
      }),
    );
    const { port, sent } = portThatAnswers(answers);
    const { pullRequests } = await port.listOpenPullRequests();
    expect(pullRequests).toHaveLength(12);
    expect(sent).toHaveLength(12);
  });

  test("reads the checks, the merge state and a person as GitHub gives them", async () => {
    const { port } = portThatAnswers([
      listed([
        node({
          author: { __typename: "User", login: "alice" },
          mergeable: "CONFLICTING",
          commits: { nodes: [{ commit: { statusCheckRollup: { state: "ERROR" } } }] },
        }),
        node({
          mergeable: "UNKNOWN",
          commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
        }),
        node({ commits: { nodes: [{ commit: { statusCheckRollup: { state: "EXPECTED" } } }] } }),
        node({ author: null }),
      ]),
    ]);
    const { pullRequests } = await port.listOpenPullRequests();
    expect(
      pullRequests.map(({ author, mergeable, checks }) => [author, mergeable, checks]),
    ).toEqual([
      ["alice", "conflicting", "failure"],
      ["renovate[bot]", "unknown", "none"],
      ["renovate[bot]", "mergeable", "pending"],
      [undefined, "mergeable", "success"],
    ]);
  });

  // Slice 5.17: a pull request whose checks have not all finished waits on
  // them, and one whose checks have failed anywhere does not, whatever the
  // rollup puts first.
  test("reads a check run or a commit status that has not finished as pending", async () => {
    const rollup = (contexts: unknown[]) => ({
      commits: {
        nodes: [
          { commit: { statusCheckRollup: { state: "PENDING", contexts: { nodes: contexts } } } },
        ],
      },
    });
    const { port } = portThatAnswers([
      listed([
        node(rollup([{ __typename: "CheckRun", status: "IN_PROGRESS", conclusion: null }])),
        node(
          rollup([
            { __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" },
            { __typename: "StatusContext", state: "PENDING" },
          ]),
        ),
        node(rollup([{ __typename: "CheckRun", status: "QUEUED", conclusion: null }])),
      ]),
    ]);
    const { pullRequests } = await port.listOpenPullRequests();
    expect(pullRequests.map(({ checks }) => checks)).toEqual(["pending", "pending", "pending"]);
  });

  test("reads a failed check next to one that has not finished as a failure", async () => {
    const rollup = (contexts: unknown[]) => ({
      commits: {
        nodes: [
          { commit: { statusCheckRollup: { state: "PENDING", contexts: { nodes: contexts } } } },
        ],
      },
    });
    const { port } = portThatAnswers([
      listed([
        node(
          rollup([
            { __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" },
            { __typename: "StatusContext", state: "PENDING" },
          ]),
        ),
        node(
          rollup([
            { __typename: "StatusContext", state: "ERROR" },
            { __typename: "CheckRun", status: "IN_PROGRESS", conclusion: null },
          ]),
        ),
        node(
          rollup([
            { __typename: "CheckRun", status: "COMPLETED", conclusion: "TIMED_OUT" },
            { __typename: "CheckRun", status: "IN_PROGRESS", conclusion: null },
          ]),
        ),
        node({
          commits: {
            nodes: [
              { commit: { statusCheckRollup: { state: "FAILURE", contexts: { nodes: [] } } } },
            ],
          },
        }),
      ]),
    ]);
    const { pullRequests } = await port.listOpenPullRequests();
    expect(pullRequests.map(({ checks }) => checks)).toEqual([
      "failure",
      "failure",
      "failure",
      "failure",
    ]);
  });

  test("asks for the checks of the head commit in the same query", async () => {
    const { port, sent } = portThatAnswers([listed([node()])]);
    await port.listOpenPullRequests();
    const { query } = (sent[0]?.body ?? { query: "" }) as { query: string };
    expect(query).toContain("contexts(first: 100)");
    expect(query).toContain("... on CheckRun");
    expect(query).toContain("... on StatusContext");
  });

  test("says when the branch lives in a fork (slice 5.4)", async () => {
    const { port } = portThatAnswers([listed([node({ isCrossRepository: true })])]);
    const { pullRequests } = await port.listOpenPullRequests();
    expect(pullRequests[0]?.fromFork).toBe(true);
  });

  test("a list of files that may miss a path is not complete", async () => {
    const { port } = portThatAnswers([
      listed([
        node({ changedFiles: 101 }),
        node({ files: { nodes: [{ path: "apps/odoo/new.ts", changeType: "RENAMED" }] } }),
        node({ files: null }),
      ]),
    ]);
    const { pullRequests } = await port.listOpenPullRequests();
    expect(pullRequests.map(({ filesComplete }) => filesComplete)).toEqual([false, false, false]);
  });
});

describe("the merge methods the repo allows", () => {
  test("are read from the repo, and absent where GitHub leaves them out", async () => {
    const { port } = portThatAnswers([
      { json: { allow_squash_merge: false, allow_rebase_merge: true, allow_merge_commit: true } },
      { json: {} },
    ]);
    expect(await port.allowedMergeMethods()).toEqual({ squash: false, rebase: true, merge: true });
    expect(await port.allowedMergeMethods()).toEqual({
      squash: undefined,
      rebase: undefined,
      merge: undefined,
    });
  });
});

describe("merging a pull request", () => {
  test("sends the ticked head commit and the method, and gives the merge commit", async () => {
    const { port, sent } = portThatAnswers([
      { json: { sha: "6dcb09b5b57875f334f61aebed695e2e4193db5e", merged: true, message: "ok" } },
    ]);
    expect(await port.mergePullRequest(418, { head: HEAD, method: "squash" })).toEqual({
      merged: true,
      sha: "6dcb09b5b57875f334f61aebed695e2e4193db5e",
    });
    expect(sent).toEqual([
      {
        method: "PUT",
        path: "/repos/acme/infra/pulls/418/merge",
        body: { sha: HEAD, merge_method: "squash" },
      },
    ]);
  });

  test("gives GitHub's refusal about the pull request as an answer", async () => {
    const { port } = portThatAnswers([
      { status: 405, json: { message: "At least 1 approving review is required." } },
      { status: 409, json: { message: "Head branch was modified." } },
    ]);
    expect(await port.mergePullRequest(418, { head: HEAD, method: "squash" })).toEqual({
      merged: false,
      status: 405,
      message: "At least 1 approving review is required.",
    });
    expect(await port.mergePullRequest(418, { head: HEAD, method: "squash" })).toMatchObject({
      merged: false,
      status: 409,
    });
  });

  test("fails for an answer about Sluiceway, such as a missing permission", async () => {
    const { port } = portThatAnswers([
      { status: 403, json: { message: "Resource not accessible by integration" } },
    ]);
    await expect(port.mergePullRequest(418, { head: HEAD, method: "squash" })).rejects.toThrow(
      "Resource not accessible by integration",
    );
  });
});

// Slice 5.4 (record 0071): a file of a GitHub repo, for a Renovate preset
// outside the checkout and for the branch of an update waiting to merge.
describe("reading a file of a repo", () => {
  test("asks for the raw file at the ref, in the repo named", async () => {
    const { port, sent } = portThatAnswers([{ json: '{ "automergeStrategy": "rebase" }' }]);
    const text = await port.readRepositoryFile({
      owner: "acme",
      repo: "renovate-config",
      path: "presets/merge.json",
      ref: "v1",
    });
    expect(text).toBe('{ "automergeStrategy": "rebase" }');
    expect(sent.map(({ method, path }) => [method, path])).toEqual([
      // Octokit encodes the slash of the path, which GitHub reads as one.
      ["GET", "/repos/acme/renovate-config/contents/presets%2Fmerge.json"],
    ]);
  });

  test("gives nothing for a file that is not there", async () => {
    const { port } = portThatAnswers([{ status: 404, json: { message: "Not Found" } }]);
    expect(
      await port.readRepositoryFile({
        owner: "acme",
        repo: "infra",
        path: "gone.json",
        ref: undefined,
      }),
    ).toBeUndefined();
  });

  test("fails for any other answer", async () => {
    const { port } = portThatAnswers([{ status: 403, json: { message: "Forbidden" } }]);
    await expect(
      port.readRepositoryFile({ owner: "acme", repo: "infra", path: "a.json", ref: undefined }),
    ).rejects.toThrow();
  });
});
