import { LOOKBACK } from "../../src/core/attribution.ts";
import { HISTORY_CAP } from "../../src/core/edit-history.ts";
import type { RemoteFile } from "../../src/core/renovate-config.ts";
import type {
  AllowedMethods,
  CheckRun,
  CheckRunOutput,
  CommitWalk,
  Comparison,
  Deployment,
  DeploymentPage,
  DeploymentRecord,
  DeploymentStatus,
  EditHistory,
  GitHubPort,
  HistoryEntry,
  Issue,
  IssueAuthor,
  IssuesRun,
  MergeAnswer,
  MergeMethod,
  NewCheckRun,
  NewDeployment,
  NewDeploymentStatus,
  NewIssue,
  OpenPullRequest,
  OpenPullRequests,
  Permission,
  WorkflowRun,
} from "../../src/github/port.ts";
import { FakeCommits, type SeedCommit, type SeedPullRequest } from "./commits.ts";
import { FakeDeployments, type FakeStatus, type SeedDeployment } from "./deployments.ts";
import { type FakeMerge, FakePulls, type SeedOpenPullRequest } from "./pulls.ts";

// An in-memory GitHub behind the port. It copies the real behavior the lab
// found (issue 17), because those are the things a naive fake gets wrong. It
// holds what the port holds. Its deployment records are in deployments.ts.

export const BOT: IssueAuthor = { login: "github-actions[bot]", type: "Bot" };
// Who edits a body when a test does not say.
export const SOMEONE: IssueAuthor = { login: "someone", type: "User" };

const CREATE_LIMIT_CHARACTERS = 65_536;
const UPDATE_LIMIT_BYTES = 262_144;
const PAGE_SIZE = 100;
const MAX_PINNED = 3;
const COMPARE_FILE_CAP = 300;
// What GitHub takes in one field of a check run's output (research,
// preview-page.md).
const CHECK_RUN_FIELD_LIMIT = 65_535;
const NO_ACCESS: Permission = { push: false, maintain: false, admin: false };

export class FakeGitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "FakeGitHubError";
  }
}

export interface FakeGitHubOptions {
  // Where an update is dropped. The default is GitHub's. A test lowers it to
  // stand for a GitHub that counts differently than Sluiceway does.
  updateLimitBytes?: number;
  // `https://github.com/<owner>/<repo>`, which the address of a check run is
  // made from.
  repoUrl?: string;
}

// A check run as the fake stores it.
export interface FakeCheckRun extends CheckRun {
  status: "completed";
  conclusion: "neutral" | "success";
  output: CheckRunOutput;
}

type Request = keyof GitHubPort;

export class FakeGitHub implements GitHubPort {
  // The name of every request so far, in order. A page of a list is one
  // request, as it is against the API budget.
  readonly requests: Request[] = [];

  // Runs before each request is answered, so a test can let another writer in
  // at an exact moment.
  onRequest: ((request: Request) => void) | undefined;

  readonly #issues = new Map<number, Issue>();
  // Every stored body of an issue, oldest first, the original body included.
  readonly #edits = new Map<number, HistoryEntry[]>();
  readonly #comments = new Map<number, string[]>();
  readonly #pinned: number[] = [];
  readonly #comparisons = new Map<string, Comparison>();
  // By login in lower case, because GitHub finds a login in any case.
  readonly #permissions = new Map<string, Permission>();
  readonly #failingLookups = new Map<string, number>();
  readonly #failingOnce = new Map<string, number>();
  readonly #goneAccounts = new Set<string>();
  readonly #updateLimitBytes: number;
  readonly #deployments = new FakeDeployments(() => this.#now());
  // The runs an issue edit started, by workflow file name, oldest first.
  readonly #issuesRuns = new Map<string, IssuesRun[]>();
  // The `issues.edited` events that were started and not delivered yet.
  readonly #events: { number: number; sender: IssueAuthor }[] = [];
  readonly #dispatches: { workflow: string; ref: string; inputs?: Record<string, string> }[] = [];
  #actionsWrite = true;
  #checksWrite = true;
  // Every check run of every commit, oldest first.
  readonly #checkRuns: (FakeCheckRun & { sha: string })[] = [];
  #nextCheckRunId = 106_538_952_701;
  readonly #repoUrl: string;
  readonly #commits = new FakeCommits();
  readonly #pulls = new FakePulls();
  #contentsWrite = true;
  readonly #repositoryFiles = new Map<string, string>();
  #nextNumber = 1;
  // The fake's clock. It moves one second each time it is read, so two things
  // never happen at the same time and every run gives the same times.
  #seconds = 0;

  constructor(options: FakeGitHubOptions = {}) {
    this.#updateLimitBytes = options.updateLimitBytes ?? UPDATE_LIMIT_BYTES;
    this.#repoUrl = options.repoUrl ?? "https://github.com/acme/infra";
  }

  // The test's own hands. None of these count as a request.

  // Puts an issue in the repo as it stands, by anyone and in any state.
  seedIssue(issue: Partial<Omit<Issue, "number" | "nodeId">> = {}): Issue {
    return copy(this.#add({ ...issue }));
  }

  // Another writer edits the body: a person, or another job.
  editBody(number: number, body: string, editor: IssueAuthor = SOMEONE): void {
    this.#store(this.#find(number), body, editor);
  }

  // A person deletes an entry's content in GitHub's interface: the editor and the
  // time stay and the content goes. `position` counts from the newest entry,
  // as the history lists them.
  deleteHistoryEntry(number: number, position: number): void {
    const entry = this.#history(number)[position];
    if (!entry) throw new Error(`Issue ${number} has no history entry ${position}`);
    entry.body = null;
  }

  // What the repo's history says about two commits. A pair that was never
  // seeded holds a commit the repo does not have.
  seedComparison(base: string, head: string, comparison: Comparison): void {
    this.#comparisons.set(`${base}...${head}`, comparison);
  }

  // A commit of the repo, newer than every commit seeded before it (record
  // 0026). A repo without commits answers no walk.
  seedCommit(commit: SeedCommit): void {
    this.#commits.seedCommit(commit);
  }

  seedPullRequest(pullRequest: SeedPullRequest): void {
    this.#commits.seedPullRequest(pullRequest);
  }

  // What a person may do in the repo. A login that was never seeded is an
  // account that is not a collaborator.
  // An open pull request (record 0054). Unset facts are those of a green
  // Renovate pull request into main.
  seedOpenPullRequest(pullRequest: SeedOpenPullRequest): OpenPullRequest {
    return this.#pulls.seed(pullRequest);
  }

  // How GitHub answers a merge of this pull request, such as 405 for branch
  // protection.
  refuseMerge(number: number, status: number, message: string): void {
    this.#pulls.refuse(number, status, message);
  }

  setAllowedMergeMethods(allowed: AllowedMethods): void {
    this.#pulls.allowed = allowed;
  }

  // A file of a repo at a ref, or on its default branch without one (record
  // 0071). Any other file is not there, which is also what GitHub answers
  // for a private repo the workflow token may not read.
  seedRepositoryFile(
    file: { owner: string; repo: string; path: string; ref?: string },
    text: string,
  ): void {
    this.#repositoryFiles.set(repositoryFileKey({ ...file, ref: file.ref }), text);
  }

  // The workflow token without `contents: write`.
  withoutContentsWrite(): void {
    this.#contentsWrite = false;
  }

  get merges(): FakeMerge[] {
    return this.#pulls.merges;
  }

  seedPermission(login: string, permission: Permission): void {
    this.#permissions.set(login.toLowerCase(), { ...permission });
  }

  // GitHub has no account by this login any more, as after a rename or a
  // delete. The lookup answers 404 "<login> is not a user".
  removeAccount(login: string): void {
    this.#goneAccounts.add(login.toLowerCase());
  }

  // The next lookup of this person fails, and the one after answers.
  failPermissionLookupOnce(login: string, status = 500): void {
    this.#failingOnce.set(login.toLowerCase(), status);
  }

  // From now on the lookup of this person fails, as when GitHub is down.
  failPermissionLookup(login: string, status = 500): void {
    this.#failingLookups.set(login.toLowerCase(), status);
  }

  // A deployment record as it stands, by any writer. Without a payload it
  // carries one of Sluiceway's, ticked by alice in run 4242.
  seedDeployment(deployment: SeedDeployment): DeploymentRecord {
    const { id } = this.#deployments.create(deployment);
    // It stands as it is: a seeded success flips nothing.
    if (deployment.status) {
      this.#deployments.addStatus(id, { ...deployment.status, autoInactive: false });
    }
    return this.#deployments.record(id);
  }

  // Another writer adds a status. It gets GitHub's default `auto_inactive`
  // unless it says otherwise, which the port always does.
  addDeploymentStatus(id: number, status: FakeStatus): DeploymentStatus {
    return this.#deployments.addStatus(id, status);
  }

  // What GitHub knows about a workflow run. A run that was never seeded is
  // one GitHub does not have.
  seedRun(runId: string, run: WorkflowRun): void {
    this.#deployments.seedRun(runId, run);
  }

  // A run of a workflow that an issue edit started. A run seeded later is
  // newer. Seeding a run again changes it in place, as when it ends. The fake
  // has no events yet, so no edit starts a run by itself.
  seedIssuesRun(workflow: string, run: IssuesRun): void {
    const runs = this.#issuesRuns.get(workflow) ?? [];
    const known = runs.find(({ id }) => id === run.id);
    if (known) known.completed = run.completed;
    else runs.push({ ...run });
    this.#issuesRuns.set(workflow, runs);
    this.seedRun(run.id, { completed: run.completed });
  }

  deployment(id: number): DeploymentRecord {
    return this.#deployments.record(id);
  }

  // Every record of an environment, oldest first. Not a request.
  deploymentsOf(environment: string): DeploymentRecord[] {
    return this.#deployments.all(environment);
  }

  deploymentStatuses(id: number): DeploymentStatus[] {
    return this.#deployments.statuses(id);
  }

  // The oldest event that was not delivered yet, as the payload of an
  // `issues.edited` run. The payload is made now, so it carries the newest
  // body and not the body of its own edit (issue 28). Only the fields
  // Sluiceway reads are on it.
  deliverEvent(): unknown {
    const event = this.#events.shift();
    if (!event) return undefined;
    const issue = this.#find(event.number);
    return {
      action: "edited",
      issue: {
        number: issue.number,
        state: issue.state,
        body: issue.body,
        labels: issue.labels.map((name) => ({ name })),
        user: { ...issue.author },
      },
      sender: { ...event.sender },
    };
  }

  // The token of the job has no `actions: write` from now on.
  withoutActionsWrite(): void {
    this.#actionsWrite = false;
  }

  // The token of the job has no `checks: write` from now on.
  withoutChecksWrite(): void {
    this.#checksWrite = false;
  }

  // A check run another writer made on a commit, such as a job of the
  // repo's CI.
  seedCheckRun(sha: string, name: string): CheckRun {
    return this.#addCheckRun(sha, name, { title: name, summary: "", text: "" }, "success");
  }

  // Every check run of a commit, older runs of one name included, oldest
  // first.
  checkRuns(sha: string): FakeCheckRun[] {
    return this.#checkRuns
      .filter((run) => run.sha === sha)
      .map(({ sha: _sha, ...run }) => ({ ...run, output: { ...run.output } }));
  }

  get dispatches(): { workflow: string; ref: string; inputs?: Record<string, string> }[] {
    return this.#dispatches.map((dispatch) => ({ ...dispatch }));
  }

  issue(number: number): Issue {
    return copy(this.#find(number));
  }

  comments(number: number): string[] {
    return [...(this.#comments.get(number) ?? [])];
  }

  get pinned(): number[] {
    return [...this.#pinned];
  }

  // The port.

  async listIssues(query: { label: string; state: "open" | "closed" }): Promise<Issue[]> {
    const issues: Issue[] = [];
    for (let page = 1; ; page++) {
      const found = await this.listIssuesPage(query, page, PAGE_SIZE);
      issues.push(...found.issues);
      if (!found.more) return issues;
    }
  }

  // One page of the list, which is one request. The port's list is made of
  // these, and the HTTP server hands them out one by one as GitHub does.
  async listIssuesPage(
    query: { label: string; state: "open" | "closed" },
    page: number,
    perPage: number,
  ): Promise<{ issues: Issue[]; more: boolean }> {
    this.#count("listIssues");
    const found = [...this.#issues.values()]
      .filter((issue) => issue.state === query.state && issue.labels.includes(query.label))
      .sort((a, b) => a.number - b.number);
    return {
      issues: found.slice((page - 1) * perPage, page * perPage).map(copy),
      more: page * perPage < found.length,
    };
  }

  // One request: the closed issues with the label, closed last first. The fake
  // keeps no time of the last change, and the close is the last one here.
  async listRecentlyClosedIssues(label: string): Promise<Issue[]> {
    this.#count("listRecentlyClosedIssues");
    return [...this.#issues.values()]
      .filter((issue) => issue.state === "closed" && issue.labels.includes(label))
      .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? "") || b.number - a.number)
      .slice(0, PAGE_SIZE)
      .map(copy);
  }

  async updateIssueTitle(number: number, title: string): Promise<void> {
    this.#count("updateIssueTitle");
    this.#find(number).title = title;
  }

  async listPinnedIssues(): Promise<number[]> {
    this.#count("listPinnedIssues");
    return [...this.#pinned];
  }

  async getIssue(number: number): Promise<Issue> {
    this.#count("getIssue");
    return copy(this.#find(number));
  }

  async createIssue(issue: NewIssue): Promise<Issue> {
    this.#count("createIssue");
    if (issue.body.length > CREATE_LIMIT_CHARACTERS) {
      throw new FakeGitHubError(
        422,
        `Validation Failed: body is too long (maximum is ${CREATE_LIMIT_CHARACTERS} characters)`,
      );
    }
    return copy(this.#add({ ...issue, author: BOT }));
  }

  async updateIssueBody(number: number, body: string): Promise<Issue> {
    this.#count("updateIssueBody");
    const issue = this.#find(number);
    if (new TextEncoder().encode(body).length > this.#updateLimitBytes) {
      return { ...copy(issue), body };
    }
    this.#store(issue, body, BOT);
    return copy(issue);
  }

  // One request, as the one GraphQL query it stands for.
  async readEditHistory(
    number: number,
    page: { size: number; after: string | undefined },
  ): Promise<EditHistory> {
    this.#count("readEditHistory");
    const issue = this.#find(number);
    const history = this.#history(number);
    const start = page.after === undefined ? 0 : Number(page.after);
    const end = start + page.size;
    return {
      body: issue.body,
      entries: history
        .slice(start, end)
        .map((entry) => ({ ...entry, editor: { ...entry.editor } })),
      total: history.length,
      next: end < history.length ? String(end) : undefined,
    };
  }

  async closeIssue(number: number): Promise<void> {
    this.#count("closeIssue");
    const issue = this.#find(number);
    issue.state = "closed";
    issue.closedAt = this.#now();
  }

  async reopenIssue(number: number): Promise<void> {
    this.#count("reopenIssue");
    const issue = this.#find(number);
    issue.state = "open";
    issue.closedAt = null;
  }

  async createComment(number: number, body: string): Promise<void> {
    this.#count("createComment");
    this.#find(number);
    this.#comments.set(number, [...this.comments(number), body]);
  }

  async compareCommits(base: string, head: string): Promise<Comparison> {
    this.#count("compareCommits");
    const comparison = this.#comparisons.get(`${base}...${head}`);
    if (!comparison) throw new FakeGitHubError(404, "Not Found");
    return {
      status: comparison.status,
      files: comparison.files.slice(0, COMPARE_FILE_CAP).map((file) => ({ ...file })),
    };
  }

  async getPermission(login: string): Promise<Permission | undefined> {
    this.#count("getPermission");
    const key = login.toLowerCase();
    const once = this.#failingOnce.get(key);
    if (once !== undefined) {
      this.#failingOnce.delete(key);
      throw new FakeGitHubError(once, "Server Error");
    }
    const status = this.#failingLookups.get(key);
    if (status !== undefined) throw new FakeGitHubError(status, "Server Error");
    if (this.#goneAccounts.has(key)) return undefined;
    // Real GitHub answers 200 for any account that exists, collaborator or
    // not (probed on 2026-09-21).
    return { ...(this.#permissions.get(login.toLowerCase()) ?? NO_ACCESS) };
  }

  async createDeployment(deployment: NewDeployment): Promise<Deployment> {
    this.#count("createDeployment");
    return this.#deployments.create(deployment);
  }

  // The port always sends `auto_inactive: false`. Only the HTTP server has
  // another value to hand over, from a writer that left it out.
  async createDeploymentStatus(
    id: number,
    status: NewDeploymentStatus,
    autoInactive = false,
  ): Promise<DeploymentStatus> {
    this.#count("createDeploymentStatus");
    return this.#deployments.addStatus(id, { ...status, autoInactive });
  }

  async listNewestDeployments(environment: string): Promise<DeploymentPage> {
    this.#count("listNewestDeployments");
    return this.#deployments.page(environment);
  }

  async newestDeploymentOfTask(task: string): Promise<Deployment | undefined> {
    this.#count("newestDeploymentOfTask");
    return this.#deployments.newestOfTask(task);
  }

  async latestDeploymentStatus(id: number): Promise<DeploymentStatus | undefined> {
    this.#count("latestDeploymentStatus");
    return this.#deployments.record(id).status;
  }

  async getDeployment(id: number): Promise<Deployment> {
    this.#count("getDeployment");
    const { status: _status, ...deployment } = this.#deployments.record(id);
    return deployment;
  }

  async getWorkflowRun(runId: string): Promise<WorkflowRun | undefined> {
    this.#count("getWorkflowRun");
    return this.#deployments.run(runId);
  }

  async listIssuesRuns(workflow: string): Promise<IssuesRun[]> {
    this.#count("listIssuesRuns");
    const runs = this.#issuesRuns.get(workflow) ?? [];
    return runs
      .slice(-PAGE_SIZE)
      .reverse()
      .map((run) => ({ ...run }));
  }

  // One request per page of 100 commits, as the GraphQL walk pages them.
  async walkCommits(head: string, lookback = LOOKBACK): Promise<CommitWalk> {
    const walk = this.#commits.walk(head, lookback);
    const pages = Math.max(1, Math.ceil((walk?.commits.length ?? 0) / PAGE_SIZE));
    for (let page = 0; page < pages; page++) this.#count("walkCommits");
    // Real GitHub answers with no object, which the port turns into this, in
    // the port's own words.
    if (!walk)
      throw new FakeGitHubError(404, `GitHub has no commit ${head.slice(0, 7)} to walk back from.`);
    return walk;
  }

  async listPullRequestFiles(number: number): Promise<string[]> {
    this.#count("listPullRequestFiles");
    const files = this.#commits.pullRequestFiles(number);
    if (!files) throw new FakeGitHubError(404, "Not Found");
    return files;
  }

  async listCommitFiles(sha: string): Promise<string[]> {
    this.#count("listCommitFiles");
    const files = this.#commits.files(sha);
    if (!files) throw new FakeGitHubError(422, `No commit found for SHA: ${sha}`);
    return files;
  }

  async pinIssue(nodeId: string): Promise<void> {
    this.#count("pinIssue");
    const issue = [...this.#issues.values()].find((candidate) => candidate.nodeId === nodeId);
    if (!issue) throw new FakeGitHubError(404, `Could not resolve to a node with the id ${nodeId}`);
    if (this.#pinned.includes(issue.number)) return;
    if (this.#pinned.length >= MAX_PINNED) {
      throw new FakeGitHubError(422, `Maximum ${MAX_PINNED} pinned issues per repository`);
    }
    this.#pinned.push(issue.number);
  }

  async listCheckRuns(sha: string): Promise<CheckRun[]> {
    const runs: CheckRun[] = [];
    for (let page = 1; ; page++) {
      const found = await this.listCheckRunsPage(sha, page, PAGE_SIZE);
      runs.push(...found.runs);
      if (!found.more) return runs;
    }
  }

  // One page of the list, which is one request. With `filter=latest` only
  // the newest check run of each name is on it (research, preview-page.md).
  async listCheckRunsPage(
    sha: string,
    page: number,
    perPage: number,
  ): Promise<{ runs: CheckRun[]; more: boolean }> {
    this.#count("listCheckRuns");
    const latest = new Map<string, CheckRun>();
    for (const run of this.#checkRuns) {
      if (run.sha === sha)
        latest.set(run.name, { id: run.id, name: run.name, htmlUrl: run.htmlUrl });
    }
    const found = [...latest.values()].sort((a, b) => b.id - a.id);
    return {
      runs: found.slice((page - 1) * perPage, page * perPage),
      more: page * perPage < found.length,
    };
  }

  async createCheckRun(run: NewCheckRun): Promise<CheckRun> {
    this.#count("createCheckRun");
    this.#mayWriteChecks();
    return this.#addCheckRun(run.sha, run.name, checkedOutput(run.output), "neutral");
  }

  async updateCheckRun(id: number, output: CheckRunOutput): Promise<CheckRun> {
    this.#count("updateCheckRun");
    this.#mayWriteChecks();
    const run = this.#checkRuns.find((one) => one.id === id);
    if (!run) throw new FakeGitHubError(404, "Not Found");
    run.output = checkedOutput(output);
    return { id: run.id, name: run.name, htmlUrl: run.htmlUrl };
  }

  // Gives back the page of the run it started, as GitHub does when it is
  // asked to (slice 5.9). The runs count up from 9000.
  async dispatchWorkflow(
    workflow: string,
    ref: string,
    inputs?: Record<string, string>,
  ): Promise<string | undefined> {
    this.#count("dispatchWorkflow");
    if (!this.#actionsWrite) {
      throw new FakeGitHubError(403, "Resource not accessible by integration");
    }
    this.#dispatches.push({ workflow, ref, ...(inputs ? { inputs: { ...inputs } } : {}) });
    return `${this.#repoUrl}/actions/runs/${9000 + this.#dispatches.length - 1}`;
  }

  // One request per page of 100, as GitHub's GraphQL gives them (record 0064).
  async listOpenPullRequests(): Promise<OpenPullRequests> {
    const list = this.#pulls.list();
    const pages = Math.max(1, Math.ceil(list.pullRequests.length / 100));
    for (let page = 0; page < pages; page++) this.#count("listOpenPullRequests");
    return list;
  }

  // One page of the list, as the HTTP server serves it: one request.
  openPullRequestsPage(from: number, size: number): OpenPullRequests & { total: number } {
    this.#count("listOpenPullRequests");
    const list = this.#pulls.list();
    return {
      defaultBranch: list.defaultBranch,
      pullRequests: list.pullRequests.slice(from, from + size),
      total: list.pullRequests.length,
    };
  }

  // GitHub leaves the merge settings out for a token without `contents:
  // write`.
  async allowedMergeMethods(): Promise<AllowedMethods> {
    this.#count("allowedMergeMethods");
    return this.#contentsWrite ? { ...this.#pulls.allowed } : {};
  }

  async readRepositoryFile(file: RemoteFile): Promise<string | undefined> {
    this.#count("readRepositoryFile");
    return this.#repositoryFiles.get(repositoryFileKey(file));
  }

  async mergePullRequest(
    number: number,
    { head, method }: { head: string; method: MergeMethod },
  ): Promise<MergeAnswer> {
    this.#count("mergePullRequest");
    if (!this.#contentsWrite) {
      throw new FakeGitHubError(403, "Resource not accessible by integration");
    }
    return this.#pulls.merge(number, head, method);
  }

  #mayWriteChecks(): void {
    if (!this.#checksWrite) {
      throw new FakeGitHubError(403, "Resource not accessible by integration");
    }
  }

  #addCheckRun(
    sha: string,
    name: string,
    output: CheckRunOutput,
    conclusion: FakeCheckRun["conclusion"],
  ): CheckRun {
    const id = this.#nextCheckRunId++;
    const htmlUrl = `${this.#repoUrl}/runs/${id}`;
    this.#checkRuns.push({ sha, id, name, htmlUrl, status: "completed", conclusion, output });
    return { id, name, htmlUrl };
  }

  #now(): string {
    this.#seconds += 1;
    return this.#time();
  }

  #time(): string {
    return new Date(Date.UTC(2026, 0, 1) + this.#seconds * 1000)
      .toISOString()
      .replace(".000Z", "Z");
  }

  // A body that is the one already stored is no edit. Not observed on real
  // GitHub: the write loop never sends one.
  #store(issue: Issue, body: string, editor: IssueAuthor): void {
    if (body === issue.body) return;
    issue.body = body;
    this.#edits.get(issue.number)?.push(entry(editor, this.#now(), body));
    // An edit made with the workflow token starts no workflow run (issue 17).
    if (editor.login !== BOT.login) this.#events.push({ number: issue.number, sender: editor });
  }

  // The history as GitHub lists it, newest first: nothing for an issue that
  // was never edited, and at most the original body and the newest 99 edits
  // (issue 28). The entries are the stored ones, not copies.
  #history(number: number): HistoryEntry[] {
    const [original, ...edits] = this.#edits.get(number) ?? [];
    if (!original || edits.length === 0) return [];
    return [...edits.slice(-(HISTORY_CAP - 1)).reverse(), original];
  }

  #count(request: Request): void {
    this.requests.push(request);
    this.#deployments.onRequest();
    this.onRequest?.(request);
  }

  #add(issue: Partial<Omit<Issue, "number" | "nodeId">>): Issue {
    const number = this.#nextNumber++;
    const added: Issue = {
      number,
      nodeId: `I_fake${number}`,
      state: issue.state ?? "open",
      closedAt: issue.closedAt ?? (issue.state === "closed" ? this.#now() : null),
      title: issue.title ?? "Sluiceway dashboard",
      body: issue.body ?? "",
      labels: [...(issue.labels ?? [])],
      author: { ...(issue.author ?? BOT) },
    };
    this.#issues.set(number, added);
    // The clock is not moved for it, so an issue is as old as the last thing
    // that happened before it.
    this.#edits.set(number, [entry(added.author, this.#time(), added.body)]);
    return added;
  }

  #find(number: number): Issue {
    const issue = this.#issues.get(number);
    if (!issue) throw new FakeGitHubError(404, "Not Found");
    return issue;
  }
}

// The history names the bot without "[bot]" (issue 28).
function entry(editor: IssueAuthor, editedAt: string, body: string): HistoryEntry {
  return {
    editor: { login: editor.login.replace(/\[bot\]$/, ""), type: editor.type },
    editedAt,
    body,
  };
}

// What GitHub stores of an output, or its refusal (research, preview-page.md):
// more than 65,535 characters in either field is refused, a summary over
// 65,535 bytes too, and a text over 65,535 bytes is cut at a character without
// a word.
function checkedOutput(output: CheckRunOutput): CheckRunOutput {
  for (const field of [output.summary, output.text]) {
    if (field.length > CHECK_RUN_FIELD_LIMIT) {
      throw new FakeGitHubError(
        422,
        `Only ${CHECK_RUN_FIELD_LIMIT} characters are allowed; ${field.length} were supplied.`,
      );
    }
  }
  if (new TextEncoder().encode(output.summary).length > CHECK_RUN_FIELD_LIMIT) {
    throw new FakeGitHubError(
      422,
      `summary exceeds a maximum bytesize of ${CHECK_RUN_FIELD_LIMIT}`,
    );
  }
  if (new TextEncoder().encode(output.text).length <= CHECK_RUN_FIELD_LIMIT) return { ...output };
  let text = "";
  let bytes = 0;
  for (const char of output.text) {
    bytes += new TextEncoder().encode(char).length;
    if (bytes > CHECK_RUN_FIELD_LIMIT) break;
    text += char;
  }
  return { ...output, text };
}

function copy(issue: Issue): Issue {
  return { ...issue, labels: [...issue.labels], author: { ...issue.author } };
}

// GitHub's owner and repo names are not case sensitive. Paths and refs are.
function repositoryFileKey(file: RemoteFile): string {
  return `${file.owner}/${file.repo}`.toLowerCase().concat(`@${file.ref ?? ""}:${file.path}`);
}
