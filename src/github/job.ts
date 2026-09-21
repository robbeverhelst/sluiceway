// The facts of the running job, read once from its environment and passed on
// as data (build plan, section 5). The name of the event is one of them. No
// event payload is read here.

export interface Job {
  // The directory of the checked-out repo.
  root: string;
  owner: string;
  repo: string;
  // `https://github.com/<owner>/<repo>`, or the same on another server.
  repoUrl: string;
  runId: string;
  // Which attempt of the run this is. A re-run is a new attempt, with new jobs
  // and new summaries (record 0044).
  runAttempt: string;
  // The commit the job checked out.
  sha: string;
  // What started the run, as GitHub names it: "push", "schedule" and so on.
  event: string;
  // The file name of the running workflow, such as `sluiceway.yml`. GitHub
  // takes it where it asks for the id of a workflow.
  workflow: string;
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
  // `<owner>/<repo>/.github/workflows/<file>@<ref>`. Workflow files sit in one
  // directory, and a ref may hold an `@` of its own.
  const workflowRef = need("GITHUB_WORKFLOW_REF");
  const workflow = /^[^/]+\/[^/]+\/\.github\/workflows\/([^/]+?\.ya?ml)@/.exec(workflowRef)?.[1];
  if (!workflow) {
    throw new Error(
      `GITHUB_WORKFLOW_REF is ${JSON.stringify(workflowRef)}, which names no workflow file.`,
    );
  }
  const server = (env.GITHUB_SERVER_URL || "https://github.com").replace(/\/+$/, "");
  return {
    root,
    owner,
    repo,
    repoUrl: `${server}/${owner}/${repo}`,
    runId: need("GITHUB_RUN_ID"),
    runAttempt: need("GITHUB_RUN_ATTEMPT"),
    sha: need("GITHUB_SHA"),
    event: need("GITHUB_EVENT_NAME"),
    workflow,
  };
}
