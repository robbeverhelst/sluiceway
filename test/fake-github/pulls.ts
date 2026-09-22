import type {
  AllowedMethods,
  MergeAnswer,
  MergeMethod,
  OpenPullRequest,
  OpenPullRequests,
} from "../../src/github/port.ts";

// The open pull requests of the fake and the merge call (record 0054). A
// merge moves the pull request out of the open list and gives the commit it
// made on the default branch.

export type SeedOpenPullRequest = Partial<OpenPullRequest> & { number: number };

export interface FakeMerge {
  number: number;
  head: string;
  method: MergeMethod;
  sha: string;
}

export class FakePulls {
  readonly #open = new Map<number, OpenPullRequest>();
  readonly #refusals = new Map<number, { status: number; message: string }>();
  readonly merges: FakeMerge[] = [];
  allowed: AllowedMethods = { squash: true, rebase: true, merge: true };

  seed(seed: SeedOpenPullRequest): OpenPullRequest {
    const pullRequest: OpenPullRequest = {
      title: `Update something (#${seed.number})`,
      author: "renovate[bot]",
      draft: false,
      base: "main",
      head: seed.number.toString(16).padStart(40, "a"),
      mergeable: "mergeable",
      checks: "success",
      files: [],
      filesComplete: true,
      fromFork: false,
      ...seed,
    };
    this.#open.set(seed.number, pullRequest);
    return pullRequest;
  }

  // What branch protection, a required review or a missing check answers.
  refuse(number: number, status: number, message: string): void {
    this.#refusals.set(number, { status, message });
  }

  list(): OpenPullRequests {
    return {
      defaultBranch: "main",
      pullRequests: [...this.#open.values()]
        .sort((a, b) => a.number - b.number)
        .map((pullRequest) => ({ ...pullRequest, files: [...pullRequest.files] })),
    };
  }

  // The answers GitHub gives, in the order it checks: a pull request that is
  // not open, a refusal, a method the repo does not allow, a head that moved.
  merge(number: number, head: string, method: MergeMethod): MergeAnswer {
    const pullRequest = this.#open.get(number);
    if (!pullRequest)
      return { merged: false, status: 405, message: "Pull Request is not mergeable" };
    const refusal = this.#refusals.get(number);
    if (refusal) return { merged: false, ...refusal };
    if (this.allowed[method] === false) {
      return {
        merged: false,
        status: 405,
        message: `${method === "merge" ? "Merge commits" : method === "squash" ? "Squash merges" : "Rebase merges"} are not allowed on this repository.`,
      };
    }
    if (pullRequest.head !== head) {
      return {
        merged: false,
        status: 409,
        message: "Head branch was modified. Review and try the merge again.",
      };
    }
    this.#open.delete(number);
    const sha = (0xe0000 + number).toString(16).padStart(40, "e");
    this.merges.push({ number, head, method, sha });
    return { merged: true, sha };
  }
}
