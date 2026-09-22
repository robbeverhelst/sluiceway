// Every GitHub call Sluiceway makes goes through this one interface. Modes
// talk to GitHub through it and nothing else, and tests hand them the fake in
// test/fake-github/. Each method is one request of the API budget of record
// 0017, except listIssues, which is one request per page of 100.
//
// It holds the calls the dashboard, the narrowed scan, the tick rule, the walk
// through the edit history, the deployment records, the orphan tick sweep,
// the rescan box, attribution and merge and deploy need.

import type { CommitWalk } from "../core/attribution.ts";
import type { HistoryEntry, HistoryPage } from "../core/edit-history.ts";
import type { AllowedMethods, MergeMethod, OpenPullRequest } from "../core/merge-and-deploy.ts";
import type { IssuesRun } from "../core/orphan-tick.ts";
import type { RemoteFile } from "../core/renovate-config.ts";
import type { Comparison } from "../core/scan-plan.ts";
import type { Permission } from "../core/tick-rule.ts";
import type {
  Deployment,
  DeploymentPage,
  DeploymentStatus,
  NewDeployment,
  NewDeploymentStatus,
  WorkflowRun,
} from "./deployment-calls.ts";

export type * from "./deployment-calls.ts";

export type {
  AllowedMethods,
  CommitWalk,
  Comparison,
  HistoryEntry,
  HistoryPage,
  IssuesRun,
  MergeMethod,
  OpenPullRequest,
  Permission,
};

// The open pull requests of the repo, and the branch they are judged against
// (record 0054).
export interface OpenPullRequests {
  defaultBranch: string;
  pullRequests: OpenPullRequest[];
}

// What GitHub answered a merge. A refusal is an answer about the pull
// request: GitHub will not merge it, such as for branch protection (405), its
// head is not the commit that was ticked (409), or it refused what was asked
// (422). `message` is GitHub's own words.
export type MergeAnswer =
  | { merged: true; sha: string }
  | { merged: false; status: number; message: string };

// An issue's body together with one page of its edit history.
export interface EditHistory extends HistoryPage {
  body: string;
}

export interface IssueAuthor {
  login: string;
  // "Bot", "User" and so on, as GitHub writes it.
  type: string;
}

export interface Issue {
  number: number;
  // The GraphQL node id. Pinning needs it.
  nodeId: string;
  state: "open" | "closed";
  // When the issue was last closed, as GitHub writes it
  // ("2026-09-20T06:00:12Z"), or null for an open issue.
  closedAt: string | null;
  title: string;
  // GitHub gives null for an issue without a body. Here that is "".
  body: string;
  labels: string[];
  author: IssueAuthor;
}

export interface NewIssue {
  title: string;
  body: string;
  labels: string[];
}

// A check run on a commit, as the port keeps it (record 0050). `htmlUrl` is
// `https://github.com/<owner>/<repo>/runs/<id>`, the page that shows its
// output. It belongs to the id, so a re-run of the workflow does not move it.
export interface CheckRun {
  id: number;
  name: string;
  htmlUrl: string;
}

// What a check run's page shows. GitHub renders `summary` and `text` as
// Markdown and takes at most 65,535 characters in each.
export interface CheckRunOutput {
  title: string;
  summary: string;
  text: string;
}

export interface NewCheckRun {
  sha: string;
  name: string;
  output: CheckRunOutput;
}

export interface GitHubPort {
  // Every issue with the label in that state, lowest number first. Pull
  // requests are left out.
  listIssues(query: { label: string; state: "open" | "closed" }): Promise<Issue[]>;

  // The 100 closed issues with the label that changed last, newest first, in
  // one request (slice 5.9). Where a closed dashboard is looked for.
  listRecentlyClosedIssues(label: string): Promise<Issue[]>;

  getIssue(number: number): Promise<Issue>;

  // GitHub refuses a body over 65,536 characters here (issue 17).
  createIssue(issue: NewIssue): Promise<Issue>;

  // Gives back what GitHub answered, which is not proof of what it stored: a
  // body over 262,144 bytes is answered with success and dropped (issue 17).
  // Only the write loop calls this, because it reads back what it wrote.
  updateIssueBody(number: number, body: string): Promise<Issue>;

  // Only the title (slice 5.9).
  updateIssueTitle(number: number, title: string): Promise<void>;

  closeIssue(number: number): Promise<void>;

  reopenIssue(number: number): Promise<void>;

  createComment(number: number, body: string): Promise<void>;

  // The body and one page of the edit history in one query, so that both
  // describe one moment (record 0025). Entries come newest first, and `after`
  // is the `next` of the page before. An issue that was never edited has no
  // entries. One point of the GraphQL budget, and `issues: read` is enough
  // (issue 28). Every entry holds a whole body, so pages are small.
  readEditHistory(
    number: number,
    page: { size: number; after: string | undefined },
  ): Promise<EditHistory>;

  // The comparison from `base` to `head`, two commit ids (record 0010). The
  // files are the ones of the whole comparison, and GitHub never lists more
  // than 300. Fails when GitHub does not have a commit, as after a force push.
  compareCommits(base: string, head: string): Promise<Comparison>;

  // What a person may do in the repo, live, as the three booleans the tick
  // rule reads (record 0018). Works with contents: read and issues: read
  // (issue 17). Someone who is not a collaborator is a clean answer with every
  // boolean false. Nothing when GitHub has no account by the login, as after a
  // rename or a delete (slice 5.9). Fails when GitHub gives no answer to
  // judge, and then the caller fails closed.
  getPermission(login: string): Promise<Permission | undefined>;

  // A deployment record (record 0003), always with `auto_merge: false` and
  // `required_contexts: []`. It has no status yet.
  createDeployment(deployment: NewDeployment): Promise<Deployment>;

  // Always sent with `auto_inactive: false`. With GitHub's default, one
  // stack's success marks every earlier success in the same environment
  // inactive, whatever its task (issue 27).
  createDeploymentStatus(id: number, status: NewDeploymentStatus): Promise<DeploymentStatus>;

  // One GraphQL page: the newest 100 records of one environment name, each
  // with its latest status. Records that are not Sluiceway's are on it too.
  listNewestDeployments(environment: string): Promise<DeploymentPage>;

  // The REST fall back for a stack that is not on that page: the newest
  // record with this task, or nothing. REST gives a record without its status.
  newestDeploymentOfTask(task: string): Promise<Deployment | undefined>;

  // The second request of the fall back. Nothing for a record with no status.
  // `apply` asks this first, so a record that already ended costs one request
  // (record 0019).
  latestDeploymentStatus(id: number): Promise<DeploymentStatus | undefined>;

  // One record by its id, without its status, as REST gives it. Fails for a
  // record GitHub does not have. `apply` reads the record it was handed here
  // (record 0035).
  getDeployment(id: number): Promise<Deployment>;

  // Needs `actions: read`. Nothing for a run GitHub does not have.
  getWorkflowRun(runId: string): Promise<WorkflowRun | undefined>;

  // The newest 100 runs of one workflow that an `issues` event started,
  // newest first (record 0025). `workflow` is the file name of the workflow,
  // such as `sluiceway.yml`. Needs `actions: read`. Only a scan that meets a
  // tick makes this call.
  listIssuesRuns(workflow: string): Promise<IssuesRun[]>;

  // The lookback (record 0026): one GraphQL query per 100 of the newest
  // `lookback` commits from `head` back (100 when not given, record 0072),
  // children before parents, each with its parents, its author and its pull
  // requests with their changed files. Works with `contents: read`. Fails for
  // a commit GitHub does not have.
  walkCommits(head: string, lookback?: number): Promise<CommitWalk>;

  // The changed files of one pull request over REST, a renamed file under
  // both paths, the first 100 (record 0072). GraphQL gives only the new path,
  // so attribution reads this for a pull request that renamed a file.
  listPullRequestFiles(number: number): Promise<string[]>;

  // The changed files of one commit, a renamed file under both paths. The
  // only call attribution makes per commit, and only for a direct push.
  // GitHub gives at most 300 files.
  listCommitFiles(sha: string): Promise<string[]>;

  // Works with the workflow token and issues: write (issue 17). Fails when
  // the repo already has three pinned issues.
  pinIssue(nodeId: string): Promise<void>;

  // The numbers of the pinned issues of the repo, at most three, in one
  // GraphQL query (slice 5.9). A scan reads them before it pins a dashboard
  // that exists, so a pinned one costs no second request.
  listPinnedIssues(): Promise<number[]>;

  // The newest check run of each name on one commit (`filter=latest`), of
  // every app, the jobs of every workflow included. One request per page of
  // 100 (record 0050).
  listCheckRuns(sha: string): Promise<CheckRun[]>;

  // A finished check run on a commit, always `completed` and `neutral`, so it
  // adds no failure to the commit's checks (record 0050). Needs
  // `checks: write`: without it GitHub answers 403 "Resource not accessible by
  // integration". GitHub puts it in the oldest check suite of GitHub Actions
  // on the commit, whichever workflow that is, and sets its `details_url` to
  // its own page whatever is sent, so none is sent.
  createCheckRun(run: NewCheckRun): Promise<CheckRun>;

  // Replaces the whole output of a check run and nothing else: a field left
  // out would be emptied. Needs `checks: write`.
  updateCheckRun(id: number, output: CheckRunOutput): Promise<CheckRun>;

  // Starts a `workflow_dispatch` run of one workflow file on a branch or tag.
  // It is the one thing the workflow token may start (record 0017), and it
  // needs `actions: write`: without it GitHub answers 403.
  // With `inputs` only for a workflow that declares them: GitHub refuses a
  // dispatch with an input the workflow does not declare (record 0064).
  // Asks GitHub for the run it started (`return_run_details`, slice 5.9) and
  // gives back the page of that run, or nothing when GitHub did not say.
  dispatchWorkflow(
    workflow: string,
    ref: string,
    inputs?: Record<string, string>,
  ): Promise<string | undefined>;

  // Every open pull request, oldest first, each with its files and the
  // combined checks of its head commit, one GraphQL query per page of 100
  // (record 0054, slice 5.9). Needs
  // `pull-requests: read`. Only a scan with `mergeAndDeploy.authors` makes it,
  // and `resolve` before it merges.
  listOpenPullRequests(): Promise<OpenPullRequests>;

  // The merge methods the repo allows. GitHub gives them to a token with
  // `contents: write` only, and a key it leaves out is absent.
  allowedMergeMethods(): Promise<AllowedMethods>;

  // Merges a pull request, only while its head is `head` (record 0054).
  // Needs `contents: write`. A merge made with the workflow token starts no
  // workflow run of its push (record 0017). Fails for any answer that is not
  // a merge or a refusal.
  mergePullRequest(
    number: number,
    merge: { head: string; method: MergeMethod },
  ): Promise<MergeAnswer>;

  // One file of a GitHub repo as text, at `ref` or on its default branch, or
  // nothing when it is not there (record 0071). `contents: read` covers this
  // repo. Another repo answers when it is public. Fails for any other answer,
  // such as a private repo the workflow token cannot read. `resolve` reads a
  // Renovate preset outside the checkout with it, and the scan the files of
  // the branch of an update it previews.
  readRepositoryFile(file: RemoteFile): Promise<string | undefined>;
}
