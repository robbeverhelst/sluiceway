import type { MergeMethod, OpenPullRequest } from "../../src/github/port.ts";
import type { FakeGitHub } from "./fake-github.ts";
import type { Answer, Route } from "./server.ts";

// The merge and deploy calls of the fake GitHub server, in GitHub's form
// (record 0054): the GraphQL list of open pull requests, the repo's merge
// settings and the merge.

export function isOpenPullRequestsQuery(query: string): boolean {
  return query.includes("pullRequests(states: OPEN");
}

const ROLLUP: Record<OpenPullRequest["checks"], string | null> = {
  success: "SUCCESS",
  pending: "PENDING",
  failure: "FAILURE",
  none: null,
};

function node(pullRequest: OpenPullRequest): unknown {
  const { author } = pullRequest;
  const state = ROLLUP[pullRequest.checks];
  return {
    number: pullRequest.number,
    title: pullRequest.title,
    isDraft: pullRequest.draft,
    baseRefName: pullRequest.base,
    headRefOid: pullRequest.head,
    mergeable: pullRequest.mergeable.toUpperCase(),
    // GraphQL names an app without "[bot]".
    author:
      author === undefined
        ? null
        : author.endsWith("[bot]")
          ? { __typename: "Bot", login: author.slice(0, -"[bot]".length) }
          : { __typename: "User", login: author },
    changedFiles: pullRequest.filesComplete
      ? pullRequest.files.length
      : pullRequest.files.length + 1,
    files: { nodes: pullRequest.files.map((path) => ({ path, changeType: "MODIFIED" })) },
    commits: {
      nodes: [{ commit: { statusCheckRollup: state === null ? null : { state } } }],
    },
  };
}

// A page of 100, oldest first, with GraphQL's cursor: the fake's cursor is the
// number of pull requests before the page (record 0064).
export function openPullRequestsQuery(
  fake: FakeGitHub,
  variables: unknown,
): Answer {
  const after = (variables as { after?: unknown } | undefined)?.after;
  const from = typeof after === "string" ? Number(after) : 0;
  const { defaultBranch, pullRequests: page, total } = fake.openPullRequestsPage(from, PAGE);
  const end = from + page.length;
  return {
    status: 200,
    json: {
      data: {
        repository: {
          defaultBranchRef: { name: defaultBranch },
          pullRequests: {
            pageInfo: { hasNextPage: end < total, endCursor: String(end) },
            nodes: page.map(node),
          },
        },
      },
    },
  };
}

const PAGE = 100;

export function pullRoutes(fake: FakeGitHub, repo: string): [string, RegExp, Route][] {
  return [
    [
      "GET",
      new RegExp(`^${repo}$`),
      async () => {
        const allowed = await fake.allowedMergeMethods();
        return {
          status: 200,
          json: {
            ...(allowed.squash === undefined ? {} : { allow_squash_merge: allowed.squash }),
            ...(allowed.rebase === undefined ? {} : { allow_rebase_merge: allowed.rebase }),
            ...(allowed.merge === undefined ? {} : { allow_merge_commit: allowed.merge }),
          },
        };
      },
    ],
    [
      "PUT",
      new RegExp(`^${repo}/pulls/(\\d+)/merge$`),
      async ({ body }, number) => {
        const method = (
          typeof body.merge_method === "string" ? body.merge_method : "merge"
        ) as MergeMethod;
        const answer = await fake.mergePullRequest(Number(number), {
          head: typeof body.sha === "string" ? body.sha : "",
          method,
        });
        return answer.merged
          ? {
              status: 200,
              json: { sha: answer.sha, merged: true, message: "Pull Request successfully merged" },
            }
          : { status: answer.status, json: { message: answer.message } };
      },
    ],
  ];
}
