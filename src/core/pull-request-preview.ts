// The pull request preview (record 0101): what a change does to the
// infrastructure, shown to the reviewer while the pull request is open, and
// never deployed from. This holds the rules. The glue reads the event, runs
// the tool and writes the pages.
//
// Two refusals come before everything else, because the preview runs the
// pull request's code with the credentials of its job. A pull request from a
// fork is refused outright: GitHub withholds secrets from a fork's run by
// default, and this does not rely on that. And `pull_request_target` is never
// a pull request preview, whatever the payload says: it runs with the secrets
// of the base branch on purpose, which is exactly what must not meet a
// stranger's code.

import { type Claimant, claim } from "./claim.ts";
import { COMPARE_FILE_CAP, type Comparison } from "./scan-plan.ts";

// What the glue read of the pull request, from the payload of the event.
export interface PullRequestFacts {
  number: number;
  // The commit at the head of its branch. The pages go on it, where the pull
  // request shows its checks.
  head: string;
  // The commit of the base branch the comparison starts from.
  base: string;
  // The name of the base branch, for the words.
  baseRef: string;
  // Its branch lives in another repository, or the payload does not say
  // where it lives. Either is a fork here.
  fromFork: boolean;
}

export interface PreviewEvent {
  // `GITHUB_EVENT_NAME`.
  name: string;
  // The pull request of the payload, when the event carries one.
  pullRequest?: PullRequestFacts | undefined;
}

export type PreviewRefusal =
  | { kind: "not-a-pull-request"; event: string }
  | { kind: "pull-request-target" }
  | { kind: "fork" };

// Nothing when the pull request may be previewed.
export function refusePullRequestPreview(event: PreviewEvent): PreviewRefusal | undefined {
  if (event.name === "pull_request_target") return { kind: "pull-request-target" };
  if (event.name !== "pull_request" || event.pullRequest === undefined) {
    return { kind: "not-a-pull-request", event: event.name };
  }
  if (event.pullRequest.fromFork) return { kind: "fork" };
  return undefined;
}

// GitHub's comparison of the base and the head lists at most this many
// files, and a list this long may be missing some (record 0010).
export const PULL_REQUEST_FILE_CAP = COMPARE_FILE_CAP;

export type StacksOfPullRequest =
  | {
      kind: "claimed";
      // In stack id order, as the pool previews them.
      stackIds: string[];
      // The files no stack claims, in the order of the comparison. The scan
      // after the merge previews every stack for them (record 0010).
      unclaimed: string[];
    }
  | { kind: "too-many-files" };

// The stacks the pull request claims, by the claim rule of a narrowed scan
// (record 0010): a changed file inside a stack's directory or among its
// inputs, a renamed file under both paths, and a file `scan.unrelated` covers
// claims nothing. Unlike a narrowed scan, a file no stack claims does not turn
// this into a preview of every stack: a preview per pull request per push is
// runner time, and the scan after the merge is the full scan.
export function stacksOfPullRequest(
  stacks: Claimant[],
  comparison: Comparison,
  unrelated: string[],
): StacksOfPullRequest {
  if (comparison.files.length >= PULL_REQUEST_FILE_CAP) return { kind: "too-many-files" };
  const paths = comparison.files.flatMap(({ path, previousPath }) =>
    previousPath === undefined ? [path] : [path, previousPath],
  );
  const claims = claim(stacks, paths, unrelated);
  return {
    kind: "claimed",
    stackIds: stacks.map(({ id }) => id).filter((id) => claims.claims.has(id)),
    unclaimed: claims.unclaimed,
  };
}
