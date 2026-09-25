// The answers of the app's /api/v1 the command line reads, as the app's
// OpenAPI document, version 1.0.0, describes them (record 0116). A copy of the
// document is test/fixtures/app/openapi.json, and the tests hold a fake app
// to it. Only the fields the command line reads are named here.

export type AppState = "pending" | "deploying" | "drifted" | "failed" | "in-sync";

export type Counts = Record<AppState, number>;

export interface Me {
  login: string;
  org: string;
  token: { name: string; expiresAt: string };
}

export interface StackLine {
  stack: string;
  repo: string;
  state: AppState;
  word: string;
  destroys: boolean;
  line: string;
}

export interface RepoLine {
  name: string;
  dashboard: string | null;
  stacks: number;
  counts: Counts;
  recordWriter: string | null;
}

export interface Org {
  org: { login: string };
  counts: Counts;
  total: number;
  lastScan: { sha: string; at: string; repo: string } | null;
  repos: RepoLine[];
  stacks: StackLine[];
  locked: { name: string; counts: Counts; total: number }[];
  allowance: { sentence: string | null };
}

export interface Repo {
  repo: RepoLine;
  scan: { sha: string; at: string | null } | null;
  counts: Counts;
  total: number;
  stacks: StackLine[];
}

export interface Deploy {
  deployment: number | null;
  who: string;
  result: string;
  state: "in-sync" | "failed" | "none" | "deploying";
  at: string;
}

export interface Stack {
  stack: string;
  repo: string;
  word: string;
  line: string;
  changes: string | null;
  destroys: string | null;
  drift: string | null;
  ticked: boolean;
  dashboard: string;
  preview: { name: string; url: string } | null;
  run: string | null;
  lastDeploy: Deploy | null;
}

export interface TickAnswer {
  outcome: "asked" | "refused" | "github" | "moved" | "taken" | "failed";
  sentence: string;
  deployment: { id: number } | null;
  dashboard: string;
}

export interface RescanAnswer {
  outcome: "asked" | "refused" | "github" | "failed";
  sentence: string;
  dashboard: string;
}

export interface Config {
  repo: string;
  file: string | null;
  sha: string | null;
  url: string | null;
  problem: string | null;
  keys: Record<string, unknown>;
}

export interface PullRequestAnswer {
  outcome:
    | "opened"
    | "pull-request-open"
    | "nothing-to-change"
    | "config-invalid"
    | "two-files"
    | "no-default-branch"
    | "read-failed"
    | "write-failed";
  url: string | null;
  sentence: string;
  changes: string[];
  problems: string[];
}
