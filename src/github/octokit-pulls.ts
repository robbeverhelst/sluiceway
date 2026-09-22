import type { getOctokit } from "@actions/github";
import type { OpenPullRequest } from "../core/merge-and-deploy.ts";
import type { GitHubPort, MergeAnswer } from "./port.ts";

type Octokit = ReturnType<typeof getOctokit>;

// The merge and deploy calls of the port on real GitHub (record 0054). As in
// octokit-port.ts, each is one call and a translation.
export type PullCalls = Pick<
  GitHubPort,
  "listOpenPullRequests" | "allowedMergeMethods" | "mergePullRequest" | "readRepositoryFile"
>;

// A page of the open pull requests, oldest first, with what the qualification
// rule reads: the author, the base, the head commit, the files and the
// combined checks of the head commit. `pull-requests: read` is enough.
const OPEN_PULL_REQUESTS = `query ($owner: String!, $repo: String!, $after: String) {
  repository(owner: $owner, name: $repo) {
    defaultBranchRef {
      name
    }
    pullRequests(states: OPEN, first: 100, after: $after, orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        number
        title
        isDraft
        baseRefName
        headRefOid
        mergeable
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
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                state
              }
            }
          }
        }
      }
    }
  }
}`;

interface PullRequestNode {
  number: number;
  title: string;
  isDraft: boolean;
  baseRefName: string;
  headRefOid: string;
  mergeable: string;
  author: { __typename: string; login: string } | null;
  changedFiles: number;
  files: { nodes: ({ path: string; changeType: string } | null)[] | null } | null;
  commits: {
    nodes: ({ commit: { statusCheckRollup: { state: string } | null } } | null)[] | null;
  };
}

interface OpenPullRequestsData {
  repository: {
    defaultBranchRef: { name: string } | null;
    pullRequests: {
      nodes: (PullRequestNode | null)[] | null;
      pageInfo?: { hasNextPage: boolean; endCursor: string | null } | null;
    };
  } | null;
}

// How many pages of 100 open pull requests one list reads.
export const MAX_PAGES = 10;

function present<T>(nodes: readonly (T | null)[] | null | undefined): T[] {
  return (nodes ?? []).filter((node): node is T => node !== null);
}

const CHECKS: Record<string, OpenPullRequest["checks"]> = {
  SUCCESS: "success",
  PENDING: "pending",
  EXPECTED: "pending",
  FAILURE: "failure",
  ERROR: "failure",
};

function toPullRequest(node: PullRequestNode): OpenPullRequest {
  const files = present(node.files?.nodes);
  const state = present(node.commits.nodes)[0]?.commit.statusCheckRollup?.state;
  const { author } = node;
  return {
    number: node.number,
    title: node.title,
    // GraphQL names an app without the "[bot]" the site writes (record 0026).
    author:
      author === null
        ? undefined
        : author.__typename === "Bot" && !author.login.endsWith("[bot]")
          ? `${author.login}[bot]`
          : author.login,
    draft: node.isDraft,
    base: node.baseRefName,
    head: node.headRefOid,
    mergeable:
      node.mergeable === "MERGEABLE"
        ? "mergeable"
        : node.mergeable === "CONFLICTING"
          ? "conflicting"
          : "unknown",
    checks: state === undefined ? "none" : (CHECKS[state] ?? "failure"),
    files: files.map(({ path }) => path),
    // A renamed file comes with its new path only, and the claim rule needs
    // both (record 0010).
    filesComplete:
      files.length === node.changedFiles &&
      files.every(({ changeType }) => changeType !== "RENAMED"),
  };
}

// The answers of the merge call that are about the pull request, not about
// Sluiceway: GitHub will not merge it (405), its head moved (409), or GitHub
// refused what was asked (422).
const REFUSALS = new Set([405, 409, 422]);

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

function messageOf(error: unknown): string {
  const response = (error as { response?: { data?: { message?: unknown } } } | null)?.response;
  const message = response?.data?.message;
  if (typeof message === "string") return message;
  return error instanceof Error ? error.message : String(error);
}

export function pullCalls(octokit: Octokit, repo: { owner: string; repo: string }): PullCalls {
  return {
    async listOpenPullRequests() {
      // Page by page, oldest first (record 0064). Past the tenth page the rest
      // are left out: a repo with more than 1,000 open pull requests pays ten
      // requests of its hourly budget for each list (record 0017).
      let defaultBranch: string | undefined;
      const pullRequests: OpenPullRequest[] = [];
      let after: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const data: OpenPullRequestsData = await octokit.graphql<OpenPullRequestsData>(
          OPEN_PULL_REQUESTS,
          { ...repo, after },
        );
        defaultBranch ??= data.repository?.defaultBranchRef?.name;
        const list = data.repository?.pullRequests;
        pullRequests.push(...present(list?.nodes).map(toPullRequest));
        const next = list?.pageInfo;
        if (!next?.hasNextPage || !next.endCursor) break;
        after = next.endCursor;
      }
      if (defaultBranch === undefined) throw new Error("GitHub named no default branch.");
      return { defaultBranch, pullRequests };
    },

    async allowedMergeMethods() {
      // GitHub gives these to a token with `contents: write` only.
      const { data } = await octokit.rest.repos.get(repo);
      return {
        squash: data.allow_squash_merge,
        rebase: data.allow_rebase_merge,
        merge: data.allow_merge_commit,
      };
    },

    async mergePullRequest(number, { head, method }): Promise<MergeAnswer> {
      try {
        const { data } = await octokit.rest.pulls.merge({
          ...repo,
          pull_number: number,
          sha: head,
          merge_method: method,
        });
        return { merged: true, sha: data.sha };
      } catch (error) {
        const status = statusOf(error);
        if (status === undefined || !REFUSALS.has(status)) throw error;
        return { merged: false, status, message: messageOf(error) };
      }
    },

    async readRepositoryFile({ owner, repo: name, path, ref }) {
      // The raw file, so one past the 1 MB that the JSON answer holds reads
      // too.
      try {
        const { data } = await octokit.rest.repos.getContent({
          owner,
          repo: name,
          path,
          ...(ref === undefined ? {} : { ref }),
          mediaType: { format: "raw" },
        });
        return typeof data === "string" ? data : undefined;
      } catch (error) {
        if (statusOf(error) === 404) return undefined;
        throw error;
      }
    },
  };
}
