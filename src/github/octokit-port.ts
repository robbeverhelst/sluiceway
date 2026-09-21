import type { getOctokit } from "@actions/github";
import type { GitHubPort, Issue } from "./port.ts";

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

const PIN_ISSUE = `mutation ($issueId: ID!) {
  pinIssue(input: {issueId: $issueId}) {
    issue {
      id
    }
  }
}`;

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

    async pinIssue(nodeId) {
      await octokit.graphql(PIN_ISSUE, { issueId: nodeId });
    },
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
