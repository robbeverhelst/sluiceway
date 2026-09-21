import type { FakeGitHub } from "./fake-github.ts";
import type { Route } from "./server.ts";

// The call of the orphan tick sweep on the fake GitHub server, in GitHub's
// form: the runs of one workflow file that an `issues` event started.
export function runRoutes(fake: FakeGitHub, repo: string): [string, RegExp, Route][] {
  return [
    [
      "GET",
      new RegExp(`^${repo}/actions/workflows/([^/]+)/runs$`),
      async ({ query }, workflow = "") => {
        // The fake keeps the runs of one event. A reader that asks for
        // another would get an answer that means nothing.
        if (query.get("event") !== "issues") {
          return { status: 400, json: { message: "The fake lists only runs of the issues event" } };
        }
        const runs = await fake.listIssuesRuns(decodeURIComponent(workflow));
        return {
          status: 200,
          json: {
            total_count: runs.length,
            workflow_runs: runs.map((run) => ({
              id: Number(run.id),
              event: "issues",
              status: run.completed ? "completed" : "in_progress",
            })),
          },
        };
      },
    ],
  ];
}
