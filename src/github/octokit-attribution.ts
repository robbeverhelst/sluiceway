import type { getOctokit } from "@actions/github";
import { LOOKBACK, type WalkedCommit, type WalkedPullRequest } from "../core/attribution.ts";
import type { GitHubPort } from "./port.ts";

type Octokit = ReturnType<typeof getOctokit>;

// The attribution calls of the port on real GitHub (record 0026). As in
// octokit-port.ts, each is one call and a translation.
export type AttributionCalls = Pick<
  GitHubPort,
  "walkCommits" | "listCommitFiles" | "listPullRequestFiles"
>;

// The history of the scanned commit, not of the branch: the range of a row
// ends at its `scan-sha`, and a newer commit explains nothing about it. The
// numbers are a page of the lookback, the file cap of a pull request, and
// room for a commit that came in through more than one pull request. Seen on
// 2026-09-21: 7 points of the GraphQL budget for 100 commits. A lookback past
// 100 is paged (record 0072).
const WALK = `query ($owner: String!, $repo: String!, $head: GitObjectID!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    defaultBranchRef {
      name
    }
    object(oid: $head) {
      ... on Commit {
        history(first: $first, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            oid
            messageHeadline
            author {
              user {
                login
              }
            }
            parents(first: 10) {
              nodes {
                oid
              }
            }
            associatedPullRequests(first: 5) {
              nodes {
                number
                title
                merged
                baseRefName
                author {
                  __typename
                  login
                }
                changedFiles
                files(first: 100) {
                  nodes {
                    path
                    changeType
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

// GraphQL gives at most 100 nodes of a connection on one page.
const PAGE = 100;

interface PullRequestNode {
  number: number;
  title: string;
  merged: boolean;
  baseRefName: string;
  author: { __typename: string; login: string } | null;
  changedFiles: number;
  files: { nodes: ({ path: string; changeType: string } | null)[] | null } | null;
}

interface CommitNode {
  oid: string;
  messageHeadline: string;
  author: { user: { login: string } | null } | null;
  parents: { nodes: ({ oid: string } | null)[] | null };
  associatedPullRequests: { nodes: (PullRequestNode | null)[] | null } | null;
}

interface Walk {
  repository: {
    defaultBranchRef: { name: string } | null;
    object: {
      history?: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: (CommitNode | null)[] | null;
      };
    } | null;
  } | null;
}

function present<T>(nodes: readonly (T | null)[] | null | undefined): T[] {
  return (nodes ?? []).filter((node): node is T => node !== null);
}

// GraphQL names the author of a pull request by a bot without the `[bot]` the
// site and REST write (`renovate`, type `Bot`). A commit's user already has it.
function toPullRequest(node: PullRequestNode): WalkedPullRequest {
  const { author } = node;
  return {
    number: node.number,
    title: node.title,
    author:
      author === null
        ? undefined
        : author.__typename === "Bot" && !author.login.endsWith("[bot]")
          ? `${author.login}[bot]`
          : author.login,
    base: node.baseRefName,
    merged: node.merged,
    changedFiles: node.changedFiles,
    files: present(node.files?.nodes).map(({ path }) => path),
    // GraphQL has no old path, so a rename is read again over REST (record
    // 0072). Seen on 2026-09-22: the field is `changeType`, `RENAMED`.
    renamed: present(node.files?.nodes).some(({ changeType }) => changeType === "RENAMED"),
  };
}

function toCommit(node: CommitNode): WalkedCommit {
  return {
    sha: node.oid,
    parents: present(node.parents.nodes).map(({ oid }) => oid),
    author: node.author?.user?.login,
    message: node.messageHeadline,
    pullRequests: present(node.associatedPullRequests?.nodes).map(toPullRequest),
  };
}

export function attributionCalls(
  octokit: Octokit,
  repo: { owner: string; repo: string },
): AttributionCalls {
  return {
    async walkCommits(head, lookback = LOOKBACK) {
      const commits: WalkedCommit[] = [];
      let defaultBranch: string | undefined;
      let after: string | null = null;
      do {
        const first = Math.min(PAGE, lookback - commits.length);
        const data: Walk = await octokit.graphql<Walk>(WALK, { ...repo, head, first, after });
        const history = data.repository?.object?.history;
        // For a commit it does not have, GitHub answers with no object and no
        // error.
        if (!history)
          throw new Error(`GitHub has no commit ${head.slice(0, 7)} to walk back from.`);
        defaultBranch = data.repository?.defaultBranchRef?.name;
        if (defaultBranch === undefined) throw new Error("GitHub named no default branch.");
        commits.push(...present(history.nodes).map(toCommit));
        after = history.pageInfo.hasNextPage ? history.pageInfo.endCursor : null;
      } while (after !== null && commits.length < lookback);
      return { defaultBranch, commits };
    },

    async listPullRequestFiles(number) {
      // One page of 100, the file cap the walk holds a pull request to: one
      // with more counts as a change outside every stack and is never read.
      // Seen on 2026-09-22: a renamed file has `previous_filename`.
      const { data } = await octokit.rest.pulls.listFiles({
        ...repo,
        pull_number: number,
        per_page: PAGE,
      });
      return data.flatMap((file) =>
        file.previous_filename === undefined
          ? [file.filename]
          : [file.filename, file.previous_filename],
      );
    },

    async listCommitFiles(sha) {
      // Without a page size GitHub gives up to 300 files in one answer. With
      // one it pages them (seen on 2026-09-21).
      const { data } = await octokit.rest.repos.getCommit({ ...repo, ref: sha });
      return (data.files ?? []).flatMap((file) =>
        file.previous_filename === undefined
          ? [file.filename]
          : [file.filename, file.previous_filename],
      );
    },
  };
}
