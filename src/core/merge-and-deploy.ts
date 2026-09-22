// Merge and deploy (record 0054): which open pull requests the dashboard lists
// as updates waiting to merge, and how a tick merges one. Pure: the glue hands
// in the pull requests and the repo's settings as data.

import { type Claimant, claim } from "./claim.ts";

// An open pull request, in the port's words.
export interface OpenPullRequest {
  number: number;
  // Free text from outside. Escaped and shortened wherever it is shown.
  title: string;
  // As the site writes it: an app's login with "[bot]". Absent for an
  // account that is gone.
  author: string | undefined;
  draft: boolean;
  // The branch it would merge into.
  base: string;
  // The commit at the head of its branch. A tick approves merging exactly
  // that commit.
  head: string;
  // GitHub works this out in the background, so it can be "unknown".
  mergeable: "mergeable" | "conflicting" | "unknown";
  // The combined result of every check and status on the head commit.
  // "none" when nothing reported one.
  checks: "success" | "pending" | "failure" | "none";
  // Paths relative to the repo root.
  files: string[];
  // False when the list may miss a path: more files than one page holds, or
  // a renamed file whose old path GitHub does not give.
  filesComplete: boolean;
  // Its branch lives in a fork. Such a branch is never previewed: its code
  // would run with the scan's credentials (record 0071).
  fromFork: boolean;
}

export interface QualifyOptions {
  // `mergeAndDeploy.authors`, in lower case. Empty turns it off.
  authors: readonly string[];
  defaultBranch: string;
  stacks: Claimant[];
  // `scan.unrelated`.
  unrelated: string[];
  // What each stack depends on, as far as the caller knows (record 0056). Two
  // stacks of one pull request where one waits on the other do not qualify.
  dependsOn?: ReadonlyMap<string, readonly string[]> | undefined;
}

export type NotQualified =
  | "author"
  | "draft"
  | "base"
  | "checks"
  | "conflicting"
  | "files-unknown"
  | "unclaimed"
  | "stacks-depend"
  | "no-stack";

export type Qualified =
  // In code unit order. More than one when more than one stack claims its
  // files (record 0071).
  { qualifies: true; stackIds: string[] } | { qualifies: false; why: NotQualified };

// A pull request qualifies when its author is on the list, it is ready and
// green, and the claim rule of record 0010 gives every file it changes to a
// stack. A file `scan.unrelated` matches claims nothing and forces nothing, so
// it is left out, as it is for a push. Since record 0071 a pull request that
// several stacks claim qualifies too, with one deploy per stack, unless one of
// its stacks depends on another: one tick would deploy them side by side.
export function qualify(pullRequest: OpenPullRequest, options: QualifyOptions): Qualified {
  const author = pullRequest.author?.toLowerCase();
  if (author === undefined || !options.authors.includes(author)) {
    return { qualifies: false, why: "author" };
  }
  if (pullRequest.draft) return { qualifies: false, why: "draft" };
  if (pullRequest.base !== options.defaultBranch) return { qualifies: false, why: "base" };
  if (pullRequest.checks !== "success") return { qualifies: false, why: "checks" };
  if (pullRequest.mergeable === "conflicting") return { qualifies: false, why: "conflicting" };
  if (!pullRequest.filesComplete) return { qualifies: false, why: "files-unknown" };
  const { claims, unclaimed } = claim(options.stacks, pullRequest.files, options.unrelated);
  if (unclaimed.length > 0) return { qualifies: false, why: "unclaimed" };
  const stackIds = [...claims.keys()].sort(byCodeUnit);
  if (stackIds.length === 0) return { qualifies: false, why: "no-stack" };
  if (dependOnEachOther(stackIds, options.dependsOn)) {
    return { qualifies: false, why: "stacks-depend" };
  }
  return { qualifies: true, stackIds };
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Whether one of the stacks waits on another of them, directly or through
// stacks in between.
function dependOnEachOther(
  ids: readonly string[],
  dependsOn: ReadonlyMap<string, readonly string[]> | undefined,
): boolean {
  if (!dependsOn || ids.length < 2) return false;
  const inPullRequest = new Set(ids);
  for (const id of ids) {
    const seen = new Set<string>();
    const next = [...(dependsOn.get(id) ?? [])];
    while (next.length > 0) {
      const one = next.pop() ?? "";
      if (inPullRequest.has(one)) return true;
      if (seen.has(one)) continue;
      seen.add(one);
      next.push(...(dependsOn.get(one) ?? []));
    }
  }
  return false;
}

// Why a pull request is not listed, for the job log.
export const NOT_QUALIFIED: Record<NotQualified, string> = {
  author: "its author is not in mergeAndDeploy.authors",
  draft: "it is a draft",
  base: "it does not merge into the default branch",
  checks: "its checks are not all green",
  conflicting: "it conflicts with its base branch",
  "files-unknown": "not every file it changes is known",
  unclaimed: "no stack claims some of its files",
  "stacks-depend": "its stacks depend on each other, and one tick would deploy them side by side",
  "no-stack": "no stack claims any of its files",
};

export interface WaitingUpdate {
  pullRequest: OpenPullRequest;
  stackIds: string[];
}

// The oldest this many are always listed, and the fold holds all after the
// first ten (record 0064). A line is about 250 characters at most, so thirty
// stay under an eighth of the body's target size (record 0028). Since record
// 0071 the newer ones are listed too, as far as the size budget has room.
export const MAX_UPDATES = 30;

// The qualifying pull requests, oldest first.
export function waitingUpdates(
  pullRequests: readonly OpenPullRequest[],
  options: QualifyOptions,
): WaitingUpdate[] {
  return [...pullRequests]
    .sort((a, b) => a.number - b.number)
    .flatMap((pullRequest) => {
      const qualified = qualify(pullRequest, options);
      return qualified.qualifies ? [{ pullRequest, stackIds: qualified.stackIds }] : [];
    });
}

export type MergeMethod = "squash" | "rebase" | "merge";

// What the repo allows. A key is absent when GitHub did not say.
export interface AllowedMethods {
  squash?: boolean | undefined;
  rebase?: boolean | undefined;
  merge?: boolean | undefined;
}

// Renovate's `automergeStrategy` in GitHub's words, as Renovate maps it on
// GitHub. GitHub has no fast-forward merge, and Renovate falls back to the
// repo's method for it, as for `auto` (record 0064).
const RENOVATE_METHODS: Record<string, MergeMethod> = {
  squash: "squash",
  rebase: "rebase",
  "merge-commit": "merge",
};

// The order Renovate picks the repo's method in on GitHub: squash, then a
// merge commit, then rebase (record 0064, amending the order of 0054).
const FALLBACK: MergeMethod[] = ["squash", "merge", "rebase"];

// The method Renovate would use, when the repo allows it, else the first
// allowed one in Renovate's order. A method GitHub did not say anything about
// counts as allowed: GitHub answers the merge call if not.
export function mergeMethod(
  allowed: AllowedMethods,
  strategy: string | undefined,
): MergeMethod | undefined {
  const renovate = strategy === undefined ? undefined : RENOVATE_METHODS[strategy];
  const candidates = renovate === undefined ? FALLBACK : [renovate, ...FALLBACK];
  return candidates.find((method) => allowed[method] !== false);
}
