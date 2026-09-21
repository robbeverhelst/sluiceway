// Every GitHub call Sluiceway makes goes through this one interface. Modes
// talk to GitHub through it and nothing else, and tests hand them the fake in
// test/fake-github/. Each method is one request of the API budget of record
// 0017, except listIssues, which is one request per page of 100.
//
// It holds the calls the dashboard, the narrowed scan, the tick rule and the
// walk through the edit history need. Deployment records join it with the
// slice that uses them.

import type { HistoryEntry, HistoryPage } from "../core/edit-history.ts";
import type { Comparison } from "../core/scan-plan.ts";
import type { Permission } from "../core/tick-rule.ts";

export type { Comparison, HistoryEntry, HistoryPage, Permission };

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

export interface GitHubPort {
  // Every issue with the label in that state, lowest number first. Pull
  // requests are left out.
  listIssues(query: { label: string; state: "open" | "closed" }): Promise<Issue[]>;

  getIssue(number: number): Promise<Issue>;

  // GitHub refuses a body over 65,536 characters here (issue 17).
  createIssue(issue: NewIssue): Promise<Issue>;

  // Gives back what GitHub answered, which is not proof of what it stored: a
  // body over 262,144 bytes is answered with success and dropped (issue 17).
  // Only the write loop calls this, because it reads back what it wrote.
  updateIssueBody(number: number, body: string): Promise<Issue>;

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
  // boolean false. Fails when GitHub gives no answer to judge, and then the
  // caller fails closed.
  getPermission(login: string): Promise<Permission>;

  // Works with the workflow token and issues: write (issue 17). Fails when
  // the repo already has three pinned issues.
  pinIssue(nodeId: string): Promise<void>;
}
