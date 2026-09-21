import type { getOctokit } from "@actions/github";
import type { GitHubPort } from "./port.ts";

type Octokit = ReturnType<typeof getOctokit>;

// The call of the orphan tick sweep on real GitHub (record 0025). As in
// octokit-port.ts, it is one call and a translation.
export type RunCalls = Pick<GitHubPort, "listIssuesRuns">;

export function runCalls(octokit: Octokit, repo: { owner: string; repo: string }): RunCalls {
  return {
    async listIssuesRuns(workflow) {
      // GitHub takes the file name of a workflow where it asks for an id, and
      // lists runs newest first. Checked against real GitHub on 2026-09-21.
      const { data } = await octokit.rest.actions.listWorkflowRuns({
        ...repo,
        workflow_id: workflow,
        event: "issues",
        per_page: 100,
      });
      return data.workflow_runs.map((run) => ({
        id: String(run.id),
        completed: run.status === "completed",
      }));
    },
  };
}
