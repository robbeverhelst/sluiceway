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
    author: { __typename: "Bot", login: "renovate" },
    changedFiles: 1,
    files: { nodes: [{ path: "apps/odoo/Pulumi.prod.yaml", changeType: "MODIFIED" }] },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
    ...overrides,
  };
}

function listed(nodes: unknown[]): Answer {
  return {
    json: {
      data: { repository: { defaultBranchRef: { name: "main" }, pullRequests: { nodes } } },
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
        },
      ],
    });
    expect(sent.map(({ method, path }) => `${method} ${path}`)).toEqual(["POST /graphql"]);
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
