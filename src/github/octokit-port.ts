import type { getOctokit } from "@actions/github";
import { attributionCalls } from "./octokit-attribution.ts";
import { checkCalls } from "./octokit-checks.ts";
import { deploymentCalls } from "./octokit-deployments.ts";
import { pullCalls } from "./octokit-pulls.ts";
import { runCalls } from "./octokit-runs.ts";
import type { GitHubPort, HistoryEntry, Issue } from "./port.ts";

type Octokit = ReturnType<typeof getOctokit>;

export interface Repo {
  owner: string;
  repo: string;
}

// The fields of GitHub's issue that the port keeps. Both the REST list and the
// single read give them.
interface ApiIssue {
  number: number;
  node_id: string;
  state: string;
  closed_at: string | null;
  title: string;
  body?: string | null | undefined;
  labels: (string | { name?: string | undefined })[];
  user: { login: string; type: string } | null;
  pull_request?: unknown;
}

const PINNED_ISSUES = `query ($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    pinnedIssues(first: 3) {
      nodes {
        issue {
          number
        }
      }
    }
  }
}`;

interface PinnedIssues {
  repository: {
    pinnedIssues: { nodes: ({ issue: { number: number } | null } | null)[] | null } | null;
  } | null;
}

const PIN_ISSUE = `mutation ($issueId: ID!) {
  pinIssue(input: {issueId: $issueId}) {
    issue {
      id
    }
  }
}`;

// `diff` is, despite its name, the whole body right after the edit (issue 28).
const EDIT_HISTORY = `query ($owner: String!, $repo: String!, $number: Int!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      body
      userContentEdits(first: $first, after: $after) {
        totalCount
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          editedAt
          deletedAt
          editor {
            __typename
            login
          }
          diff
        }
      }
    }
  }
}`;

interface ApiEdit {
  editedAt: string;
  deletedAt: string | null;
  editor: { __typename: string; login: string } | null;
  diff: string | null;
}

interface ApiEditHistory {
  repository: {
    issue: {
      body: string | null;
      userContentEdits: {
        totalCount: number;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: (ApiEdit | null)[] | null;
      };
    } | null;
  } | null;
}

// The port on real GitHub. The octokit is the one the glue makes from the
// workflow token (record 0017). Nothing here decides anything: each method is
// one call and a translation into the port's words.
export function createOctokitPort(octokit: Octokit, repo: Repo): GitHubPort {
  return {
    async listIssues({ label, state }) {
      const issues = await octokit.paginate(octokit.rest.issues.listForRepo, {
        ...repo,
        labels: label,
        state,
        sort: "created",
        direction: "asc",
        per_page: 100,
      });
      // GitHub lists pull requests as issues.
      return issues.filter((issue) => !issue.pull_request).map(toIssue);
    },

    async getIssue(number) {
      const { data } = await octokit.rest.issues.get({ ...repo, issue_number: number });
      return toIssue(data);
    },

    async createIssue({ title, body, labels }) {
      const { data } = await octokit.rest.issues.create({ ...repo, title, body, labels });
      return toIssue(data);
    },

    async listRecentlyClosedIssues(label) {
      // One page, the ones that changed last: a dashboard that was closed is
      // among them, however many closed issues the label has (slice 5.9).
      const { data } = await octokit.rest.issues.listForRepo({
        ...repo,
        labels: label,
        state: "closed",
        sort: "updated",
        direction: "desc",
        per_page: 100,
      });
      return data.filter((issue) => !issue.pull_request).map(toIssue);
    },

    async updateIssueTitle(number, title) {
      await octokit.rest.issues.update({ ...repo, issue_number: number, title });
    },

    async updateIssueBody(number, body) {
      const { data } = await octokit.rest.issues.update({ ...repo, issue_number: number, body });
      return toIssue(data);
    },

    async closeIssue(number) {
      await octokit.rest.issues.update({
        ...repo,
        issue_number: number,
        state: "closed",
        state_reason: "not_planned",
      });
    },

    async reopenIssue(number) {
      await octokit.rest.issues.update({ ...repo, issue_number: number, state: "open" });
    },

    async createComment(number, body) {
      await octokit.rest.issues.createComment({ ...repo, issue_number: number, body });
    },

    async readEditHistory(number, { size, after }) {
      const data = await octokit.graphql<ApiEditHistory>(EDIT_HISTORY, {
        ...repo,
        number,
        first: size,
        after: after ?? null,
      });
      const issue = data.repository?.issue;
      if (!issue) throw new Error(`GitHub gave no issue ${number} when the edit history was read.`);
      const { totalCount, pageInfo, nodes } = issue.userContentEdits;
      return {
        body: issue.body ?? "",
        entries: (nodes ?? []).map(toHistoryEntry),
        total: totalCount,
        // GitHub names an end cursor on the last page too.
        next: pageInfo.hasNextPage && pageInfo.endCursor !== null ? pageInfo.endCursor : undefined,
      };
    },

    async compareCommits(base, head) {
      // Every file of the comparison comes on the first page whatever the page
      // size, which only counts commits. No commit is read here.
      const { data } = await octokit.rest.repos.compareCommitsWithBasehead({
        ...repo,
        basehead: `${base}...${head}`,
        per_page: 1,
      });
      return {
        status: data.status,
        files: (data.files ?? []).map((file) =>
          file.previous_filename === undefined
            ? { path: file.filename }
            : { path: file.filename, previousPath: file.previous_filename },
        ),
      };
    },

    async getPermission(login) {
      let data: Awaited<
        ReturnType<typeof octokit.rest.repos.getCollaboratorPermissionLevel>
      >["data"];
      try {
        ({ data } = await octokit.rest.repos.getCollaboratorPermissionLevel({
          ...repo,
          username: login,
        }));
      } catch (error) {
        // GitHub's answer for a login it has no account for: 404 and "<login>
        // is not a user" (seen on 2026-09-21). Any other failure gave no
        // answer to judge (slice 5.9).
        if (isNoAccount(error)) return undefined;
        throw error;
      }
      const permissions = data.user?.permissions;
      if (!permissions) throw new Error(`GitHub's answer holds no permissions for ${login}.`);
      return {
        push: permissions.push === true,
        maintain: permissions.maintain === true,
        admin: permissions.admin === true,
      };
    },

    ...deploymentCalls(octokit, repo),
    ...runCalls(octokit, repo),

    ...attributionCalls(octokit, repo),

    ...checkCalls(octokit, repo),

    ...pullCalls(octokit, repo),

    async pinIssue(nodeId) {
      await octokit.graphql(PIN_ISSUE, { issueId: nodeId });
    },

    async listPinnedIssues() {
      const data = await octokit.graphql<PinnedIssues>(PINNED_ISSUES, { ...repo });
      return (data.repository?.pinnedIssues?.nodes ?? []).flatMap((node) =>
        node?.issue ? [node.issue.number] : [],
      );
    },

    async dispatchWorkflow(workflow, ref, inputs) {
      await octokit.rest.actions.createWorkflowDispatch({
        ...repo,
        workflow_id: workflow,
        ref,
        ...(inputs ? { inputs } : {}),
      });
    },
  };
}

// What a deleted entry looks like through the API was never observed (issue
// 27, item 7). GitHub's docs say the editor and the time stay and the content
// goes, so an entry with a deletion time has no body whatever else it holds.
// An entry GitHub gives as null has no body and nobody as its editor.
function toHistoryEntry(edit: ApiEdit | null): HistoryEntry {
  return {
    editor: edit?.editor
      ? { login: edit.editor.login, type: edit.editor.__typename }
      : { login: "", type: "" },
    editedAt: edit?.editedAt ?? "",
    body: !edit || edit.deletedAt !== null ? null : edit.diff,
  };
}

function toIssue(issue: ApiIssue): Issue {
  return {
    number: issue.number,
    nodeId: issue.node_id,
    state: issue.state === "closed" ? "closed" : "open",
    closedAt: issue.closed_at,
    title: issue.title,
    body: issue.body ?? "",
    labels: issue.labels.flatMap((label) =>
      typeof label === "string" ? label : (label.name ?? []),
    ),
    // GitHub gives no user for an account that is gone. Nobody is never the bot.
    author: issue.user
      ? { login: issue.user.login, type: issue.user.type }
      : { login: "", type: "" },
  };
}

// The 404 of the permission lookup that is an answer: no account by the login.
function isNoAccount(error: unknown): boolean {
  const { status, response } = (error ?? {}) as {
    status?: unknown;
    response?: { data?: { message?: unknown } };
  };
  const message = response?.data?.message;
  return status === 404 && typeof message === "string" && / is not a user$/.test(message);
}
