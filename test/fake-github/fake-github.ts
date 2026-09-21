import { HISTORY_CAP } from "../../src/core/edit-history.ts";
import type {
  Comparison,
  EditHistory,
  GitHubPort,
  HistoryEntry,
  Issue,
  IssueAuthor,
  NewIssue,
  Permission,
} from "../../src/github/port.ts";

// An in-memory GitHub behind the port. It copies the real behavior the lab
// found (issue 17), because those are the things a naive fake gets wrong. It
// holds what the port holds. Events and deployment records join it with the
// slices that add them to the port.

export const BOT: IssueAuthor = { login: "github-actions[bot]", type: "Bot" };
// Who edits a body when a test does not say.
export const SOMEONE: IssueAuthor = { login: "someone", type: "User" };

const CREATE_LIMIT_CHARACTERS = 65_536;
const UPDATE_LIMIT_BYTES = 262_144;
const PAGE_SIZE = 100;
const MAX_PINNED = 3;
const COMPARE_FILE_CAP = 300;
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
  editBody(number: number, body: string, editor: IssueAuthor = SOMEONE): void {
    this.#store(this.#find(number), body, editor);
  }

  // A person deletes a revision in GitHub's interface: the editor and the
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

  // What a person may do in the repo. A login that was never seeded is an
  // account that is not a collaborator.
  seedPermission(login: string, permission: Permission): void {
    this.#permissions.set(login.toLowerCase(), { ...permission });
  }

  // From now on the lookup of this person fails, as when GitHub is down.
  failPermissionLookup(login: string, status = 500): void {
    this.#failingLookups.set(login.toLowerCase(), status);
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

  async getPermission(login: string): Promise<Permission> {
    this.#count("getPermission");
    const status = this.#failingLookups.get(login.toLowerCase());
    if (status !== undefined) throw new FakeGitHubError(status, "Server Error");
    // Real GitHub answers 200 for any account that exists, collaborator or
    // not (probed on 2026-09-21).
    return { ...(this.#permissions.get(login.toLowerCase()) ?? NO_ACCESS) };
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

function copy(issue: Issue): Issue {
  return { ...issue, labels: [...issue.labels], author: { ...issue.author } };
}
