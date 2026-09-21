import type {
  Comparison,
  GitHubPort,
  Issue,
  IssueAuthor,
  NewIssue,
} from "../../src/github/port.ts";

// An in-memory GitHub behind the port. It copies the real behavior the lab
// found (issue 17), because those are the things a naive fake gets wrong. It
// holds what the port holds. The edit history, events and deployment records
// join it with the slices that add them to the port.

export const BOT: IssueAuthor = { login: "github-actions[bot]", type: "Bot" };

const CREATE_LIMIT_CHARACTERS = 65_536;
const UPDATE_LIMIT_BYTES = 262_144;
const PAGE_SIZE = 100;
const MAX_PINNED = 3;
const COMPARE_FILE_CAP = 300;

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
  readonly #comments = new Map<number, string[]>();
  readonly #pinned: number[] = [];
  readonly #comparisons = new Map<string, Comparison>();
  readonly #updateLimitBytes: number;
  #nextNumber = 1;
  // The fake's clock. It moves one second each time it is read, so two things
  // never happen at the same time and every run gives the same times.
  #seconds = 0;

  constructor(options: FakeGitHubOptions = {}) {
    this.#updateLimitBytes = options.updateLimitBytes ?? UPDATE_LIMIT_BYTES;
  }

  // The test's own hands. None of these count as a request.

  // Puts an issue in the repo as it stands, by anyone and in any state.
  seedIssue(issue: Partial<Omit<Issue, "number" | "nodeId">> = {}): Issue {
    return copy(this.#add({ ...issue }));
  }

  // Another writer edits the body: a person, or another job.
  editBody(number: number, body: string): void {
    this.#find(number).body = body;
  }

  // What the repo's history says about two commits. A pair that was never
  // seeded holds a commit the repo does not have.
  seedComparison(base: string, head: string, comparison: Comparison): void {
    this.#comparisons.set(`${base}...${head}`, comparison);
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
    issue.body = body;
    return copy(issue);
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

  #now(): string {
    this.#seconds += 1;
    return new Date(Date.UTC(2026, 0, 1) + this.#seconds * 1000)
      .toISOString()
      .replace(".000Z", "Z");
  }

  #count(request: Request): void {
    this.requests.push(request);
    this.onRequest?.(request);
  }

  #add(issue: Partial<Omit<Issue, "number" | "nodeId">>): Issue {
    const number = this.#nextNumber++;
    const added: Issue = {
      number,
      nodeId: `I_fake${number}`,
      state: issue.state ?? "open",
      closedAt: issue.closedAt ?? (issue.state === "closed" ? this.#now() : null),
      title: issue.title ?? "",
      body: issue.body ?? "",
      labels: [...(issue.labels ?? [])],
      author: { ...(issue.author ?? BOT) },
    };
    this.#issues.set(number, added);
    return added;
  }

  #find(number: number): Issue {
    const issue = this.#issues.get(number);
    if (!issue) throw new FakeGitHubError(404, "Not Found");
    return issue;
  }
}

function copy(issue: Issue): Issue {
  return { ...issue, labels: [...issue.labels], author: { ...issue.author } };
}
