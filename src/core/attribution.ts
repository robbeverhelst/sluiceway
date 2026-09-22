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

// The lookback: how many of the newest commits a job walks, when
// `attribution.lookback` does not say (record 0072).
export const LOOKBACK = 100;

// How many pull requests and direct pushes a row names, when
// `attribution.names` does not say (record 0072).
export const NAMED_ON_A_ROW = 5;

// How many changes outside a stack its fold names (record 0072). The rest is
// a count, and the compare link shows them all.
export const OUTSIDE_NAMED = 20;

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
  // It renamed at least one file. GraphQL gives only the new path, so the
  // glue reads its files over REST, which gives the old one too (record 0072).
  renamed?: boolean | undefined;
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
  // The changed files of the pull requests that renamed a file, by number,
  // read over REST with each renamed file under both paths (record 0072). A
  // pull request that is not in it counts under its new paths alone.
  pullRequestFiles?: ReadonlyMap<number, readonly string[]> | undefined;
  // `attribution.names`: how many a row names before the rest is a count.
  names?: number | undefined;
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

// A range of commits: what a row explains, from the stack's last successful
// deploy to the scanned commit, or what one deploy on the trail shipped, from
// the success before it to its own commit (record 0072).
export interface Range {
  from: string;
  // The scanned commit when not given.
  to?: string | undefined;
}

// A commit is in range when it can be reached from `to` and not from `from` by
// following parents inside the lookback. The walk lists children before
// parents, so every path from either commit to an older commit in the
// lookback lies inside it. A `from` outside the lookback leaves every walked
// commit under `to` in range, and `earlier` says that more exist. A `to`
// outside the lookback leaves nothing to say: `commits` is absent.
function inRange(
  walk: CommitWalk,
  from: string,
  to?: string,
): { commits?: WalkedCommit[]; earlier: boolean } {
  const bySha = new Map(walk.commits.map((commit) => [commit.sha, commit]));
  const reach = (start: string): Set<string> => {
    const reached = new Set<string>();
    const queue = bySha.has(start) ? [start] : [];
    for (let sha = queue.pop(); sha !== undefined; sha = queue.pop()) {
      if (reached.has(sha)) continue;
      reached.add(sha);
      queue.push(...(bySha.get(sha)?.parents.filter((parent) => bySha.has(parent)) ?? []));
    }
    return reached;
  };
  if (to !== undefined && !bySha.has(to)) return { earlier: false };
  const under = to === undefined ? undefined : reach(to);
  const reached = reach(from);
  return {
    commits: walk.commits.filter(({ sha }) => !reached.has(sha) && (under?.has(sha) ?? true)),
    earlier: !bySha.has(from),
  };
}

function rangesOf(from: readonly (string | Range)[]): Range[] {
  const seen = new Set<string>();
  return from
    .map((one) => (typeof one === "string" ? { from: one } : one))
    .filter(({ from: start, to }) => {
      const key = `${start} ${to ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function commitsInRanges(walk: CommitWalk, from: readonly (string | Range)[]): Set<string> {
  const wanted = new Set<string>();
  for (const { from: start, to } of rangesOf(from)) {
    for (const commit of inRange(walk, start, to).commits ?? []) wanted.add(commit.sha);
  }
  return wanted;
}

// The direct pushes whose files the glue has to read, one request each: the
// ones in at least one of the ranges, newest first. A bare commit is the range
// from it to the scanned commit.
export function directPushesToRead(walk: CommitWalk, from: readonly (string | Range)[]): string[] {
  const wanted = commitsInRanges(walk, from);
  return walk.commits
    .filter((commit) => wanted.has(commit.sha) && !pullRequestOf(commit, walk))
    .map(({ sha }) => sha);
}

// The pull requests whose files the glue has to read over REST, newest first:
// the ones in at least one of the ranges that renamed a file (record 0072),
// or that changed more files than the walk holds, which are read page by
// page (slice 5.9).
export function pullRequestsToRead(walk: CommitWalk, from: readonly (string | Range)[]): number[] {
  const wanted = commitsInRanges(walk, from);
  const numbers: number[] = [];
  for (const commit of walk.commits) {
    const pullRequest = wanted.has(commit.sha) ? pullRequestOf(commit, walk) : undefined;
    if (
      pullRequest &&
      (pullRequest.renamed || pullRequest.changedFiles > pullRequest.files.length) &&
      !numbers.includes(pullRequest.number)
    )
      numbers.push(pullRequest.number);
  }
  return numbers;
}

function by(author: string | undefined): string {
  return author === undefined ? "" : ` by ${escapeText(author)}`;
}

function nameOf(merge: SummaryMerge): string {
  return merge.kind === "pull-request"
    ? `#${merge.number}${by(merge.author)}`
    : `[${merge.sha.slice(0, 7)}](${merge.url})${by(merge.author)}`;
}

// Inside a fold the text is an HTML block, where a Markdown link is not one.
function htmlNameOf(merge: SummaryMerge): string {
  return merge.kind === "pull-request"
    ? `<a href="${merge.url}">#${merge.number}</a>${by(merge.author)}`
    : `<a href="${merge.url}">${merge.sha.slice(0, 7)}</a>${by(merge.author)}`;
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

// The fold under the line that names the changes outside the stack (record
// 0072), newest first, the first twenty of them.
function outsideFold(outside: SummaryMerge[]): string[] {
  const named = outside.slice(0, OUTSIDE_NAMED).map((merge) => `${htmlNameOf(merge)}<br>`);
  const more = outside.length - named.length;
  return [
    "<details><summary>changes outside this stack</summary>",
    ...named,
    ...(more > 0 ? [`and ${more} more<br>`] : []),
    "</details>",
  ];
}

export interface Attributor {
  // The attribution of one stack's row. `from` is the commit on the stack's
  // last successful deployment record, or nothing when the bounded reads found
  // none.
  (stackId: string, from: string | undefined): Attribution;
  // What one deploy of the stack shipped, for its line of the trail (record
  // 0072): from `from`, the commit of the success before it, to `to`, its own
  // commit. Nothing when `to` is outside the lookback, or when nothing went
  // out that the stack claims or that counts as outside it.
  shipped(stackId: string, from: string, to: string): AttributionLines | undefined;
}

// Works the claims of every merge out once, and gives the function that
// attributes one stack.
export function attributor(input: AttributionInput): Attributor {
  const { walk, repoUrl } = input;
  const names = input.names ?? NAMED_ON_A_ROW;
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
      // The walk holds the first 100 files of a pull request, and the glue
      // reads every file of one that changed more (slice 5.9). One whose list
      // could not be read whole counts as outside every stack.
      const known =
        input.pullRequestFiles?.get(pullRequest.number) ??
        (pullRequest.changedFiles <= pullRequest.files.length ? pullRequest.files : undefined);
      merged = judge(
        {
          kind: "pull-request",
          number: pullRequest.number,
          title: pullRequest.title,
          url: `${repoUrl}/pull/${pullRequest.number}`,
          ...(pullRequest.author === undefined ? {} : { author: pullRequest.author }),
        },
        known,
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
        files,
      );
    }
    mergedBy.set(key, merged);
    mergeOf.set(commit.sha, merged);
  }

  const ranges = new Map<string, ReturnType<typeof inRange>>();
  const rangeOf = (from: string, to?: string) => {
    const key = `${from} ${to ?? ""}`;
    const range = ranges.get(key) ?? inRange(walk, from, to);
    ranges.set(key, range);
    return range;
  };

  // What a range holds for one stack, and the line that says it: `from` on a
  // row, `shipped` on the trail.
  const explain = (stackId: string, from: string, to: string | undefined) => {
    const range = rangeOf(from, to);
    // Each merge once, at its newest commit, so the order is newest first.
    const merged = [...new Set((range.commits ?? []).flatMap(({ sha }) => mergeOf.get(sha) ?? []))];
    const claimed = merged.filter(({ claimedBy }) => claimedBy.has(stackId)).map((m) => m.merge);
    const outside = merged
      .filter((m) => !m.claimedBy.has(stackId) && m.outside)
      .map((m) => m.merge);
    const link = `[compare](${repoUrl}/compare/${inLink(from)}...${inLink(to ?? input.scanSha)})`;

    const line = (word: string, nothing: string, listed: string[]): string => {
      const parts = [...listed];
      const and = () => (parts.length > 0 ? "and " : "");
      if (outside.length > 0)
        parts.push(`${and()}${plural(outside.length, "change")} outside this stack`);
      if (range.earlier) parts.push(`${and()}earlier changes`);
      return `${parts.length > 0 ? `${word} ${parts.join(", ")}` : nothing} · ${link}`;
    };
    const named = claimed.slice(0, names).map(nameOf);
    const more = claimed.length - named.length;
    const full = [named.join(", "), more > 0 && named.length > 0 ? `and ${more} more` : ""].filter(
      Boolean,
    );
    return {
      range,
      claimed,
      outside,
      // With nothing named, the names are a count.
      lines: (word: string, nothing: string): AttributionLines => {
        const counted = line(word, nothing, claimed.length > 0 ? [countOf(claimed)] : []);
        return {
          full: named.length > 0 ? line(word, nothing, full) : counted,
          counted,
        };
      },
    };
  };

  const one = (stackId: string, from: string | undefined): Attribution => {
    if (from === undefined) {
      return { lines: { full: NEVER_DEPLOYED, counted: NEVER_DEPLOYED }, merges: [] };
    }
    const { claimed, outside, lines } = explain(stackId, from, undefined);
    return {
      lines: {
        ...lines("from", "nothing this stack claims has changed since its last deploy"),
        ...(outside.length > 0 ? { outside: outsideFold(outside) } : {}),
      },
      merges: claimed,
    };
  };

  return Object.assign(one, {
    shipped(stackId: string, from: string, to: string): AttributionLines | undefined {
      const { range, claimed, outside, lines } = explain(stackId, from, to);
      if (range.commits === undefined) return undefined;
      if (claimed.length === 0 && outside.length === 0 && !range.earlier) return undefined;
      return lines("shipped", "");
    },
  });
}
