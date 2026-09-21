// Attribution (record 0026): the line on a row that names the merged pull
// requests, and the direct pushes, that the stack claims since its last
// successful deploy from the dashboard. It explains a row and decides nothing.
// The glue walks the commits once per job and hands them over as data, as it
// does with the compare file list (record 0010). Every job that renders a row
// works the line out again with this one function.

import { escapeText } from "../render/escape.ts";
import { type AttributionLines, plural } from "../render/row.ts";
import type { SummaryMerge } from "../render/summary.ts";
import { type Claimant, claim } from "./claim.ts";

// The lookback: how many of the newest commits a job walks. Fixed in v1.
export const LOOKBACK = 100;

// How many pull requests and direct pushes a row names. Fixed in v1.
export const NAMED_ON_A_ROW = 5;

// GitHub lists at most this many files of one commit on a page. A direct push
// with a list this long may be missing files, and is treated the same way.
export const COMMIT_FILE_CAP = 300;

// A commit id in full, SHA-1 or SHA-256. A writer that is not the scan takes
// the `scan-sha` from the root marker, which a person can edit, and no request
// and no link is built from text that came from outside.
export function isCommitId(text: string): boolean {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(text);
}

export const NEVER_DEPLOYED = "not deployed from this dashboard yet";

// A pull request GitHub associates with a walked commit.
export interface WalkedPullRequest {
  number: number;
  title: string;
  // The login of who opened it, as GitHub writes it on the site. Nothing for
  // an account that is gone.
  author: string | undefined;
  // The name of the branch it was merged into.
  base: string;
  merged: boolean;
  // How many files it changed, and the first 100 of them. With more than
  // that it counts as a change outside every stack, which never hides it.
  changedFiles: number;
  files: string[];
}

export interface WalkedCommit {
  sha: string;
  parents: string[];
  // The login of the commit's author. Nothing for an author with no GitHub
  // account, who is left unnamed.
  author: string | undefined;
  // The first line of the commit message. Only the summary shows it.
  message: string;
  pullRequests: WalkedPullRequest[];
}

// The newest `LOOKBACK` commits from the scanned commit back, children before
// parents, as GitHub lists a history.
export interface CommitWalk {
  defaultBranch: string;
  commits: WalkedCommit[];
}

export interface AttributionInput {
  walk: CommitWalk;
  // The changed files of the direct pushes, by commit id. A renamed file is
  // there under both paths. A direct push that is not in it counts as a change
  // outside every stack.
  pushFiles: ReadonlyMap<string, readonly string[]>;
  // Every stack of the repo, for the claim rule (record 0010).
  stacks: Claimant[];
  // `scan.unrelated`.
  unrelated: string[];
  // `https://github.com/<owner>/<repo>`.
  repoUrl: string;
  // The `scan-sha` of the root marker. The row's diff was previewed there, so
  // the range ends there.
  scanSha: string;
}

export interface Attribution {
  lines: AttributionLines;
  // Every pull request and direct push the stack claims in its range, newest
  // first and without a cut, for the summary.
  merges: SummaryMerge[];
}

// One merge as a reader thinks of it: a pull request however it landed, or a
// direct push.
interface Merged {
  merge: SummaryMerge;
  claimedBy: ReadonlySet<string>;
  // It holds a file that no stack claims, or more files than were read. That
  // is the kind of change that may reach any stack.
  outside: boolean;
}

// A commit belongs to its merged pull request whose base is the default
// branch. A commit with none is a direct push.
function pullRequestOf(commit: WalkedCommit, walk: CommitWalk): WalkedPullRequest | undefined {
  return commit.pullRequests.find(
    (pullRequest) => pullRequest.merged && pullRequest.base === walk.defaultBranch,
  );
}

// A commit is in range when it cannot be reached from the starting commit by
// following parents inside the lookback. The walk lists children before
// parents, so every path from the starting commit to an older commit in the
// lookback lies inside it. A starting commit outside the lookback leaves every
// walked commit in range, and `earlier` says that more exist.
function inRange(walk: CommitWalk, from: string): { commits: WalkedCommit[]; earlier: boolean } {
  const bySha = new Map(walk.commits.map((commit) => [commit.sha, commit]));
  if (!bySha.has(from)) return { commits: walk.commits, earlier: true };
  const reached = new Set<string>();
  const queue = [from];
  for (let sha = queue.pop(); sha !== undefined; sha = queue.pop()) {
    if (reached.has(sha)) continue;
    reached.add(sha);
    queue.push(...(bySha.get(sha)?.parents.filter((parent) => bySha.has(parent)) ?? []));
  }
  return { commits: walk.commits.filter(({ sha }) => !reached.has(sha)), earlier: false };
}

// The direct pushes whose files the glue has to read, one request each: the
// ones in the range of at least one of the starting commits.
export function directPushesToRead(walk: CommitWalk, from: readonly string[]): string[] {
  const wanted = new Set<string>();
  for (const start of new Set(from)) {
    for (const commit of inRange(walk, start).commits) {
      if (!pullRequestOf(commit, walk)) wanted.add(commit.sha);
    }
  }
  return walk.commits.filter(({ sha }) => wanted.has(sha)).map(({ sha }) => sha);
}

function by(author: string | undefined): string {
  return author === undefined ? "" : ` by ${escapeText(author)}`;
}

function nameOf(merge: SummaryMerge): string {
  return merge.kind === "pull-request"
    ? `#${merge.number}${by(merge.author)}`
    : `[${merge.sha.slice(0, 7)}](${merge.url})${by(merge.author)}`;
}

function countOf(merges: SummaryMerge[]): string {
  const pushes = merges.filter((merge) => merge.kind === "push").length;
  return [
    merges.length - pushes && plural(merges.length - pushes, "pull request"),
    pushes && `${pushes} direct push${pushes === 1 ? "" : "es"}`,
  ]
    .filter(Boolean)
    .join(" and ");
}

// Long enough to stay unambiguous in a large repo, and 56 characters shorter
// than two whole ids on every row of a body with a size budget.
function inLink(sha: string): string {
  return sha.slice(0, 12);
}

// Works the claims of every merge out once, and gives the function that
// attributes one stack. `from` is the commit on the stack's last successful
// deployment record, or nothing when the bounded reads found none.
export function attributor(
  input: AttributionInput,
): (stackId: string, from: string | undefined) => Attribution {
  const { walk, repoUrl } = input;
  const mergedBy = new Map<string, Merged>();
  const mergeOf = new Map<string, Merged>();

  const judge = (merge: SummaryMerge, files: readonly string[] | undefined): Merged => {
    if (files === undefined) return { merge, claimedBy: new Set(), outside: true };
    const { claims, unclaimed } = claim(input.stacks, [...files], input.unrelated);
    return { merge, claimedBy: new Set(claims.keys()), outside: unclaimed.length > 0 };
  };

  for (const commit of walk.commits) {
    const pullRequest = pullRequestOf(commit, walk);
    const key = pullRequest ? `#${pullRequest.number}` : commit.sha;
    let merged = mergedBy.get(key);
    if (!merged && pullRequest) {
      // The walk holds the first 100 files of a pull request. One that changed
      // more is not paged through.
      const known = pullRequest.changedFiles <= pullRequest.files.length;
      merged = judge(
        {
          kind: "pull-request",
          number: pullRequest.number,
          title: pullRequest.title,
          url: `${repoUrl}/pull/${pullRequest.number}`,
          ...(pullRequest.author === undefined ? {} : { author: pullRequest.author }),
        },
        known ? pullRequest.files : undefined,
      );
    } else if (!merged) {
      const files = input.pushFiles.get(commit.sha);
      merged = judge(
        {
          kind: "push",
          sha: commit.sha,
          message: commit.message,
          url: `${repoUrl}/commit/${commit.sha}`,
          ...(commit.author === undefined ? {} : { author: commit.author }),
        },
        files !== undefined && files.length < COMMIT_FILE_CAP ? files : undefined,
      );
    }
    mergedBy.set(key, merged);
    mergeOf.set(commit.sha, merged);
  }

  const ranges = new Map<string, ReturnType<typeof inRange>>();

  return (stackId, from) => {
    if (from === undefined) {
      return { lines: { full: NEVER_DEPLOYED, counted: NEVER_DEPLOYED }, merges: [] };
    }
    const range = ranges.get(from) ?? inRange(walk, from);
    ranges.set(from, range);

    // Each merge once, at its newest commit, so the order is newest first.
    const merged = [...new Set(range.commits.flatMap(({ sha }) => mergeOf.get(sha) ?? []))];
    const claimed = merged.filter(({ claimedBy }) => claimedBy.has(stackId)).map((m) => m.merge);
    const outside = merged.filter((m) => !m.claimedBy.has(stackId) && m.outside).length;

    const line = (names: string[]): string => {
      const parts = [...names];
      const and = () => (parts.length > 0 ? "and " : "");
      if (outside > 0) parts.push(`${and()}${plural(outside, "change")} outside this stack`);
      if (range.earlier) parts.push(`${and()}earlier changes`);
      const text =
        parts.length > 0
          ? `from ${parts.join(", ")}`
          : "nothing this stack claims has changed since its last deploy";
      return `${text} · [compare](${repoUrl}/compare/${inLink(from)}...${inLink(input.scanSha)})`;
    };

    const named = claimed.slice(0, NAMED_ON_A_ROW).map(nameOf);
    const more = claimed.length - named.length;
    return {
      lines: {
        full: line([named.join(", "), more > 0 ? `and ${more} more` : ""].filter(Boolean)),
        counted: line(claimed.length > 0 ? [countOf(claimed)] : []),
      },
      merges: claimed,
    };
  };
}
