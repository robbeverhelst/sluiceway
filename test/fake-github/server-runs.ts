import type { FakeGitHub } from "./fake-github.ts";
import type { Route } from "./server.ts";

// The calls of the orphan tick sweep and of the waiting run line on the fake
// GitHub server, in GitHub's form: the runs of one workflow file that an
// `issues` event started, or the ones that are queued (record 0086).
export function runRoutes(fake: FakeGitHub, repo: string): [string, RegExp, Route][] {
  return [
    [
      "GET",
      new RegExp(`^${repo}/actions/workflows/([^/]+)/runs$`),
      async ({ query }, workflow = "") => {
        if (query.get("status") === "queued" && !query.has("event")) {
          const queued = await fake.listQueuedRuns(decodeURIComponent(workflow));
          return {
            status: 200,
            json: {
              total_count: queued.length,
              // GitHub gives both times. The fake keeps one, so a run that
              // was never re-run has them equal, as on GitHub.
              workflow_runs: queued.map((run) => ({
                id: Number(run.id),
                status: run.status,
                created_at: run.since,
                run_started_at: run.since,
              })),
            },
          };
        }
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
