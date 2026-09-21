import type { Deployment, DeploymentStatus } from "../../src/github/port.ts";
import type { FakeGitHub } from "./fake-github.ts";
import type { Answer, Route } from "./server.ts";

// The deployment calls of the fake GitHub server, in GitHub's form: what the
// Octokit port sends for deployment records, their statuses and a workflow
// run, and the one GraphQL page of an environment.

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function apiDeployment(deployment: Deployment): unknown {
  return {
    id: deployment.id,
    task: deployment.task,
    environment: deployment.environment,
    sha: deployment.sha,
    ref: deployment.sha,
    payload: deployment.payload,
    created_at: deployment.createdAt,
  };
}

function apiStatus(status: DeploymentStatus): unknown {
  return { state: status.state, description: status.description, created_at: status.createdAt };
}

export function deploymentRoutes(fake: FakeGitHub, repo: string): [string, RegExp, Route][] {
  return [
    [
      "POST",
      new RegExp(`^${repo}/deployments$`),
      async ({ body }) => {
        const payload = body.payload;
        const created = await fake.createDeployment({
          sha: text(body.ref),
          task: text(body.task),
          environment: text(body.environment),
          payload:
            typeof payload === "object" && payload !== null
              ? (payload as Record<string, unknown>)
              : {},
        });
        return { status: 201, json: apiDeployment(created) };
      },
    ],
    [
      "GET",
      new RegExp(`^${repo}/deployments$`),
      async ({ query }) => {
        // The port asks for the newest record of one task and nothing else.
        const found = await fake.newestDeploymentOfTask(query.get("task") ?? "");
        return { status: 200, json: found ? [apiDeployment(found)] : [] };
      },
    ],
    [
      "GET",
      new RegExp(`^${repo}/deployments/(\\d+)$`),
      async (_call, id) => {
        try {
          return { status: 200, json: apiDeployment(await fake.getDeployment(Number(id))) };
        } catch {
          return { status: 404, json: { message: "Not Found" } };
        }
      },
    ],
    [
      "POST",
      new RegExp(`^${repo}/deployments/(\\d+)/statuses$`),
      async ({ body }, id) => {
        // GitHub's default is true, so a writer that leaves it out flips the
        // earlier successes of the environment (issue 27).
        const written = await fake.createDeploymentStatus(
          Number(id),
          { state: text(body.state) as "queued", description: text(body.description) },
          body.auto_inactive !== false,
        );
        return { status: 201, json: apiStatus(written) };
      },
    ],
    [
      "GET",
      new RegExp(`^${repo}/deployments/(\\d+)/statuses$`),
      async (_call, id) => {
        const latest = await fake.latestDeploymentStatus(Number(id));
        return { status: 200, json: latest ? [apiStatus(latest)] : [] };
      },
    ],
    [
      "GET",
      new RegExp(`^${repo}/actions/runs/(\\d+)$`),
      async (_call, runId) => {
        const run = await fake.getWorkflowRun(runId);
        if (!run) return { status: 404, json: { message: "Not Found" } };
        return {
          status: 200,
          json: { id: Number(runId), status: run.completed ? "completed" : "in_progress" },
        };
      },
    ],
  ];
}

export function isDeploymentsQuery(query: string): boolean {
  return query.includes("deployments(");
}

// GraphQL gives the payload encoded twice and shouts the state (seen in the
// lab on 2026-09-21). A record without a payload has null there.
export async function deploymentsQuery(fake: FakeGitHub, variables: unknown): Promise<Answer> {
  const environment = text((variables as { environment?: unknown } | undefined)?.environment);
  const page = await fake.listNewestDeployments(environment);
  const empty = (payload: unknown) =>
    typeof payload === "object" && payload !== null && Object.keys(payload).length === 0;
  return {
    status: 200,
    json: {
      data: {
        repository: {
          deployments: {
            pageInfo: { hasNextPage: page.more },
            nodes: page.records.map((record) => ({
              databaseId: record.id,
              task: record.task,
              environment: record.environment,
              commitOid: record.sha,
              payload: empty(record.payload)
                ? null
                : JSON.stringify(JSON.stringify(record.payload)),
              createdAt: record.createdAt,
              latestStatus: record.status
                ? {
                    state: record.status.state.toUpperCase(),
                    description: record.status.description || null,
                    createdAt: record.status.createdAt,
                  }
                : null,
            })),
          },
        },
      },
    },
  };
}
