import type { getOctokit } from "@actions/github";
import type { Deployment, DeploymentStatus } from "./deployment-calls.ts";
import type { GitHubPort } from "./port.ts";

type Octokit = ReturnType<typeof getOctokit>;

// The deployment calls of the port on real GitHub (record 0003). As in
// octokit-port.ts, each is one call and a translation.
export type DeploymentCalls = Pick<
  GitHubPort,
  | "createDeployment"
  | "createDeploymentStatus"
  | "listNewestDeployments"
  | "newestDeploymentOfTask"
  | "latestDeploymentStatus"
  | "getDeployment"
  | "getWorkflowRun"
>;

// GraphQL has no filter on `task`, which is why a stack that is not on this
// page needs the REST fall back.
const NEWEST_DEPLOYMENTS = `query ($owner: String!, $repo: String!, $environment: String!) {
  repository(owner: $owner, name: $repo) {
    deployments(environments: [$environment], first: 100, orderBy: {field: CREATED_AT, direction: DESC}) {
      pageInfo {
        hasNextPage
      }
      nodes {
        databaseId
        task
        environment
        commitOid
        payload
        createdAt
        latestStatus {
          state
          description
          createdAt
        }
        statuses(first: 2) {
          nodes {
            state
            createdAt
          }
        }
      }
    }
  }
}`;

interface ApiDeployment {
  id: number;
  task: string;
  environment: string;
  sha: string;
  payload: unknown;
  created_at: string;
}

interface ApiStatus {
  state: string;
  description?: string | null;
  created_at: string;
}

interface DeploymentNode {
  databaseId: number | null;
  task: string | null;
  environment: string | null;
  commitOid: string;
  payload: string | null;
  createdAt: string;
  latestStatus: { state: string; description: string | null; createdAt: string } | null;
  // Newest first, as GitHub lists them (seen in the lab repo on 2026-09-22).
  statuses?: { nodes: ({ state: string; createdAt: string } | null)[] | null } | null;
}

interface NewestDeployments {
  repository: {
    deployments: { pageInfo: { hasNextPage: boolean }; nodes: (DeploymentNode | null)[] };
  } | null;
}

// REST gives the payload as the JSON it was sent as. GraphQL gives a string
// that holds the JSON text of a JSON string, so it is encoded twice (seen in
// the lab on 2026-09-21). Text that is no JSON stays the text it is.
function parsePayload(payload: unknown): unknown {
  let parsed = payload;
  for (let depth = 0; depth < 2 && typeof parsed === "string"; depth++) {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      break;
    }
  }
  return parsed;
}

function toDeployment(deployment: ApiDeployment): Deployment {
  return {
    id: deployment.id,
    task: deployment.task,
    environment: deployment.environment,
    sha: deployment.sha,
    payload: parsePayload(deployment.payload),
    createdAt: deployment.created_at,
  };
}

function toStatus(status: ApiStatus): DeploymentStatus {
  return {
    state: status.state,
    description: status.description ?? "",
    createdAt: status.created_at,
  };
}

// GitHub writes `inactive` when another writer's success supersedes a record
// (record 0003), so the latest status holds that moment and not when the
// deploy ended. The status right under it, newest first, is the success,
// while GitHub keeps it (record 0062).
function withSucceededAt(
  latest: DeploymentStatus,
  newestFirst: readonly ({ state: string; createdAt: string } | null)[],
): DeploymentStatus {
  if (latest.state !== "inactive") return latest;
  const under = newestFirst[1];
  return under?.state.toLowerCase() === "success"
    ? { ...latest, succeededAt: under.createdAt }
    : latest;
}

export function deploymentCalls(
  octokit: Octokit,
  repo: { owner: string; repo: string },
): DeploymentCalls {
  return {
    async createDeployment({ sha, task, environment, payload }) {
      const { data } = await octokit.rest.repos.createDeployment({
        ...repo,
        ref: sha,
        task,
        environment,
        payload,
        // The record is about a commit that is already on the default branch,
        // and no check of another workflow decides whether Sluiceway deploys.
        auto_merge: false,
        required_contexts: [],
      });
      // GitHub answers 202 with only a message when it merged the default
      // branch into the ref first. With `auto_merge: false` it never does.
      if (!("id" in data)) throw new Error("GitHub created no deployment record.");
      return toDeployment(data);
    },

    async createDeploymentStatus(id, { state, description, logUrl }) {
      const { data } = await octokit.rest.repos.createDeploymentStatus({
        ...repo,
        deployment_id: id,
        state,
        auto_inactive: false,
        ...(description === undefined ? {} : { description }),
        ...(logUrl === undefined ? {} : { log_url: logUrl }),
      });
      return toStatus(data);
    },

    async listNewestDeployments(environment) {
      const { repository } = await octokit.graphql<NewestDeployments>(NEWEST_DEPLOYMENTS, {
        ...repo,
        environment,
      });
      if (!repository) throw new Error("GitHub gave no repository to read deployments from.");
      return {
        records: repository.deployments.nodes.flatMap((node) =>
          node === null || node.databaseId === null
            ? []
            : {
                id: node.databaseId,
                task: node.task ?? "",
                environment: node.environment ?? "",
                sha: node.commitOid,
                payload: parsePayload(node.payload),
                createdAt: node.createdAt,
                status: node.latestStatus
                  ? withSucceededAt(
                      {
                        // GraphQL shouts the words REST writes in lower case.
                        state: node.latestStatus.state.toLowerCase(),
                        description: node.latestStatus.description ?? "",
                        createdAt: node.latestStatus.createdAt,
                      },
                      node.statuses?.nodes ?? [],
                    )
                  : undefined,
              },
        ),
        more: repository.deployments.pageInfo.hasNextPage,
      };
    },

    async newestDeploymentOfTask(task) {
      // GitHub lists deployments newest first.
      const { data } = await octokit.rest.repos.listDeployments({ ...repo, task, per_page: 1 });
      return data[0] ? toDeployment(data[0]) : undefined;
    },

    async latestDeploymentStatus(id) {
      const { data } = await octokit.rest.repos.listDeploymentStatuses({
        ...repo,
        deployment_id: id,
        // Two, for the success under an inactive (record 0062).
        per_page: 2,
      });
      return data[0]
        ? withSucceededAt(
            toStatus(data[0]),
            data.map(({ state, created_at }) => ({ state, createdAt: created_at })),
          )
        : undefined;
    },

    async getDeployment(id) {
      const { data } = await octokit.rest.repos.getDeployment({ ...repo, deployment_id: id });
      return toDeployment(data);
    },

    async getWorkflowRun(runId) {
      try {
        const { data } = await octokit.rest.actions.getWorkflowRun({
          ...repo,
          run_id: Number(runId),
        });
        return { completed: data.status === "completed" };
      } catch (error) {
        if ((error as { status?: unknown }).status === 404) return undefined;
        throw error;
      }
    },
  };
}
