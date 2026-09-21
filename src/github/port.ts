// Every GitHub call Sluiceway makes goes through this one interface. Modes
// talk to GitHub through it and nothing else, and tests hand them the fake in
// test/fake-github/. Each method is one request of the API budget of record
// 0017, except listIssues, which is one request per page of 100.
//
// It holds the calls the dashboard and the narrowed scan need. Deployment
// records, the edit history and permissions join it with the slices that use
// them.

import type { Comparison } from "../core/scan-plan.ts";
import type { Permission } from "../core/tick-rule.ts";

export type { Comparison, Permission };

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
