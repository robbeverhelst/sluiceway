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
                  ? {
                      // GraphQL shouts the words REST writes in lower case.
                      state: node.latestStatus.state.toLowerCase(),
                      description: node.latestStatus.description ?? "",
                      createdAt: node.latestStatus.createdAt,
                    }
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
        per_page: 1,
      });
      return data[0] ? toStatus(data[0]) : undefined;
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
