import type { getOctokit } from "@actions/github";
import type { CheckRun, GitHubPort } from "./port.ts";

type Octokit = ReturnType<typeof getOctokit>;

// The check run calls of the preview pages on real GitHub (record 0050). As
// in octokit-port.ts, each is one call and a translation.
export type CheckCalls = Pick<GitHubPort, "listCheckRuns" | "createCheckRun" | "updateCheckRun">;

interface ApiCheckRun {
  id: number;
  name: string;
  html_url: string | null;
}

function toCheckRun(run: ApiCheckRun): CheckRun {
  return { id: run.id, name: run.name, htmlUrl: run.html_url ?? "" };
}

export function checkCalls(octokit: Octokit, repo: { owner: string; repo: string }): CheckCalls {
  return {
    async listCheckRuns(sha) {
      // Octokit pages this list by its `check_runs` key.
      const runs = await octokit.paginate(octokit.rest.checks.listForRef, {
        ...repo,
        ref: sha,
        filter: "latest",
        per_page: 100,
      });
      return runs.map(toCheckRun);
    },

    async createCheckRun({ sha, name, output }) {
      const { data } = await octokit.rest.checks.create({
        ...repo,
        name,
        head_sha: sha,
        status: "completed",
        conclusion: "neutral",
        output,
      });
      return toCheckRun(data);
    },

    async updateCheckRun(id, output) {
      const { data } = await octokit.rest.checks.update({ ...repo, check_run_id: id, output });
      return toCheckRun(data);
    },
  };
}
