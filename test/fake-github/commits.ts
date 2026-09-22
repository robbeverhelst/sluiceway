import { LOOKBACK } from "../../src/core/attribution.ts";
import type { CommitWalk } from "../../src/github/port.ts";

// The commits and pull requests of the fake repo (record 0026). The fake keeps
// the history itself and answers the walk from it, so a test builds a repo and
// not an answer.

export interface SeedCommit {
  sha: string;
  parents?: string[];
  // The login of the author, or nothing for an author with no account.
  author?: string | undefined;
  message?: string;
  // What the commit changed. A renamed file has its old path too.
  files?: (string | { path: string; previousPath: string })[];
}

export interface SeedPullRequest {
  number: number;
  title?: string;
  // The login as the site writes it, `[bot]` included.
  author?: string | undefined;
  base?: string;
  merged?: boolean;
  // What it changed. A renamed file has its old path too, which GraphQL
  // leaves out and REST gives (record 0072).
  files: (string | { path: string; previousPath: string })[];
  // The commits GitHub associates with it: a squash commit, the commits of a
  // rebase merge, or a merge commit and the branch commits under it.
  commits: string[];
}

const PULL_REQUEST_FILES_PAGE = 100;
const COMMIT_FILES_PAGE = 300;

export class FakeCommits {
  readonly defaultBranch = "main";
  // In the order they were seeded, which stands for the order in time.
  readonly #commits: Required<SeedCommit>[] = [];
  readonly #pullRequests: SeedPullRequest[] = [];

  seedCommit(commit: SeedCommit): void {
    this.#commits.push({
      parents: [],
      author: "someone",
      message: `commit ${commit.sha.slice(0, 7)}`,
      files: [],
      ...commit,
    });
  }

  seedPullRequest(pullRequest: SeedPullRequest): void {
    this.#pullRequests.push(pullRequest);
  }

  // The newest commits that can be reached from `head`, newest first, which
  // lists children before parents. Nothing for a commit the repo lacks.
  walk(head: string, lookback = LOOKBACK): CommitWalk | undefined {
    const bySha = new Map(this.#commits.map((commit) => [commit.sha, commit]));
    if (!bySha.has(head)) return undefined;
    const reached = new Set<string>();
    const queue = [head];
    for (let sha = queue.pop(); sha !== undefined; sha = queue.pop()) {
      if (reached.has(sha)) continue;
      reached.add(sha);
      queue.push(...(bySha.get(sha)?.parents ?? []));
    }
    const commits = [...this.#commits]
      .reverse()
      .filter(({ sha }) => reached.has(sha))
      .slice(0, lookback)
      .map((commit) => ({
        sha: commit.sha,
        parents: [...commit.parents],
        author: commit.author,
        message: commit.message,
        pullRequests: this.#pullRequests
          .filter((pullRequest) => pullRequest.commits.includes(commit.sha))
          .map((pullRequest) => ({
            number: pullRequest.number,
            title: pullRequest.title ?? `Pull request ${pullRequest.number}`,
            author: "author" in pullRequest ? pullRequest.author : "someone",
            base: pullRequest.base ?? this.defaultBranch,
            merged: pullRequest.merged ?? true,
            changedFiles: pullRequest.files.length,
            files: pullRequest.files
              .slice(0, PULL_REQUEST_FILES_PAGE)
              .map((file) => (typeof file === "string" ? file : file.path)),
            renamed: pullRequest.files.some((file) => typeof file !== "string"),
          })),
      }));
    return { defaultBranch: this.defaultBranch, commits };
  }

  // The files of one pull request as REST gives them, a renamed file under
  // both paths. Nothing for a pull request the repo lacks.
  pullRequestFiles(number: number): string[] | undefined {
    return this.#pullRequests
      .find((pullRequest) => pullRequest.number === number)
      ?.files.slice(0, PULL_REQUEST_FILES_PAGE)
      .flatMap((file) => (typeof file === "string" ? [file] : [file.path, file.previousPath]));
  }

  files(sha: string): string[] | undefined {
    const commit = this.#commits.find((one) => one.sha === sha);
    return commit?.files
      .slice(0, COMMIT_FILES_PAGE)
      .flatMap((file) => (typeof file === "string" ? [file] : [file.path, file.previousPath]));
  }
}
