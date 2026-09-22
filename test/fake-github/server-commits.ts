import type { CommitWalk } from "../../src/github/port.ts";
import { type FakeGitHub, FakeGitHubError } from "./fake-github.ts";
import type { Answer, Route } from "./server.ts";

// The attribution calls of the fake GitHub server, in GitHub's form (record
// 0026): the GraphQL walk, the REST read of one commit, and of one pull
// request's files (record 0072).

export function isWalkQuery(query: string): boolean {
  return query.includes("associatedPullRequests(");
}

// GraphQL names a bot without the `[bot]` the site writes (seen on
// 2026-09-21), and gives the type next to it.
function actor(login: string | undefined): unknown {
  if (login === undefined) return null;
  return login.endsWith("[bot]")
    ? { __typename: "Bot", login: login.slice(0, -"[bot]".length) }
    : { __typename: "User", login };
}

function history(walk: CommitWalk): unknown {
  return {
    nodes: walk.commits.map((commit) => ({
      oid: commit.sha,
      messageHeadline: commit.message,
      author: { user: commit.author === undefined ? null : { login: commit.author } },
      parents: { nodes: commit.parents.map((oid) => ({ oid })) },
      associatedPullRequests: {
        nodes: commit.pullRequests.map((pullRequest) => ({
          number: pullRequest.number,
          title: pullRequest.title,
          merged: pullRequest.merged,
          baseRefName: pullRequest.base,
          author: actor(pullRequest.author),
          changedFiles: pullRequest.changedFiles,
          files: {
            nodes: pullRequest.files.map((path, index) => ({
              path,
              // The fake knows a rename per pull request, not per file.
              changeType: pullRequest.renamed && index === 0 ? "RENAMED" : "MODIFIED",
            })),
          },
        })),
      },
    })),
  };
}

// A page of the walk: `first` commits after the cursor, which here is the
// number of commits the pages before it held (record 0072).
export async function walkQuery(fake: FakeGitHub, variables: unknown): Promise<Answer> {
  const { head, first, after } = (variables ?? {}) as Record<string, unknown>;
  const defaultBranchRef = { name: "main" };
  const size = typeof first === "number" ? first : 100;
  const offset = typeof after === "string" ? Number(after) : 0;
  try {
    const walk = await fake.walkCommits(typeof head === "string" ? head : "", offset + size + 1);
    const page = { ...walk, commits: walk.commits.slice(offset, offset + size) };
    const hasNextPage = walk.commits.length > offset + size;
    return {
      status: 200,
      json: {
        data: {
          repository: {
            defaultBranchRef: { name: walk.defaultBranch },
            object: {
              history: {
                pageInfo: { hasNextPage, endCursor: String(offset + size) },
                ...(history(page) as object),
              },
            },
          },
        },
      },
    };
  } catch (error) {
    if (!(error instanceof FakeGitHubError)) throw error;
    // For a commit it does not have, real GitHub answers with no object and
    // no error.
    return { status: 200, json: { data: { repository: { defaultBranchRef, object: null } } } };
  }
}

export function commitRoutes(fake: FakeGitHub, repo: string): [string, RegExp, Route][] {
  return [
    [
      "GET",
      new RegExp(`^${repo}/pulls/(\\d+)/files$`),
      async (_call, number) => {
        // As in the commit route, each path is an entry of its own.
        const paths = await fake.listPullRequestFiles(Number(number));
        return { status: 200, json: paths.map((filename) => ({ filename })) };
      },
    ],
    [
      "GET",
      new RegExp(`^${repo}/commits/([^/]+)$`),
      async (_call, sha) => {
        // The fake gives a renamed file as two paths. Here each is an entry of
        // its own, which the port reads as the same list. The entry with a
        // `previous_filename` is pinned at the wire, in octokit-attribution.
        const paths = await fake.listCommitFiles(sha);
        return { status: 200, json: { sha, files: paths.map((filename) => ({ filename })) } };
      },
    ],
  ];
}
