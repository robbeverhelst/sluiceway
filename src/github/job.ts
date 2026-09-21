// The facts of the running job, read once from its environment and passed on
// as data (build plan, section 5). No event payload is read here.

export interface Job {
  // The directory of the checked-out repo.
  root: string;
  owner: string;
  repo: string;
  // `https://github.com/<owner>/<repo>`, or the same on another server.
  repoUrl: string;
  runId: string;
  // The commit the job checked out.
  sha: string;
}

export function readJob(env: Readonly<Record<string, string | undefined>>): Job {
  const need = (name: string): string => {
    const value = env[name];
    if (!value) {
      throw new Error(`${name} is not set. Sluiceway runs as a step of a GitHub Actions job.`);
    }
    return value;
  };
  const root = need("GITHUB_WORKSPACE");
  const repository = need("GITHUB_REPOSITORY");
  const [owner, repo, ...rest] = repository.split("/");
  if (!owner || !repo || rest.length > 0) {
    throw new Error(
      `GITHUB_REPOSITORY is ${JSON.stringify(repository)}, which is not an owner and a repo.`,
    );
  }
  const server = (env.GITHUB_SERVER_URL || "https://github.com").replace(/\/+$/, "");
  return {
    root,
    owner,
    repo,
    repoUrl: `${server}/${owner}/${repo}`,
    runId: need("GITHUB_RUN_ID"),
    sha: need("GITHUB_SHA"),
  };
}
