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
// The most files GitHub lists of one commit or one pull request.
const FILE_LIMIT = 3_000;

export interface ChangedFile {
  path: string;
  previousPath?: string;
}

function entries(
  files: readonly (string | { path: string; previousPath: string })[],
): ChangedFile[] {
  return files
    .slice(0, FILE_LIMIT)
    .map((file) => (typeof file === "string" ? { path: file } : file));
}

function pageOf(
  listed: ChangedFile[],
  page: number,
  size: number,
): { files: ChangedFile[]; more: boolean } {
  return { files: listed.slice((page - 1) * size, page * size), more: page * size < listed.length };
}

// The paths of a whole list, a renamed file under both. A list of 3,000
// entries or more may be missing files, so it gives nothing.
export function whole(files: readonly ChangedFile[]): string[] | undefined {
  if (files.length >= FILE_LIMIT) return undefined;
  return files.flatMap((file) =>
    file.previousPath === undefined ? [file.path] : [file.path, file.previousPath],
  );
}

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

  // One page of a commit's changed files, 300 to a page as GitHub gives them
  // without a page size, up to 3,000 (slice 5.9). A renamed file is one entry
  // with its old path. Nothing for a commit the repo lacks.
  commitFilesPage(sha: string, page: number): { files: ChangedFile[]; more: boolean } | undefined {
    const commit = this.#commits.find((one) => one.sha === sha);
    if (!commit) return undefined;
    return pageOf(entries(commit.files), page, COMMIT_FILES_PAGE);
  }

  // One page of a pull request's changed files as REST gives them, 100 to a
  // page. Nothing for a pull request the repo lacks.
  pullRequestFilesPage(
    number: number,
    page: number,
  ): { files: ChangedFile[]; more: boolean } | undefined {
    const pullRequest = this.#pullRequests.find((one) => one.number === number);
    if (!pullRequest) return undefined;
    return pageOf(entries(pullRequest.files), page, PULL_REQUEST_FILES_PAGE);
  }
}
