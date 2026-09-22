import type {
  Deployment,
  DeploymentPage,
  DeploymentRecord,
  DeploymentStatus,
  NewDeployment,
  WorkflowRun,
} from "../../src/github/port.ts";
import { FakeGitHubError } from "./fake-github.ts";

// The deployment records of the fake GitHub, with the behavior the lab found
// (issue 27): with GitHub's default `auto_inactive`, a success flips every
// earlier success in the same environment to `inactive`, whatever its task,
// and a moment later, not at once. It has only the list filters GitHub has:
// the environment on the GraphQL page, the task on the REST list.

export const SEED_SHA = "0123456789abcdef0123456789abcdef01234567";
export const SEED_PAYLOAD = { v: 1, hash: "2b44350653e84a11", ticker: "alice", run: "4242" };

const PAGE_SIZE = 100;
// How many requests still see `success` before the flip lands.
const FLIP_AFTER_REQUESTS = 1;

export interface SeedDeployment {
  task: string;
  environment?: string;
  sha?: string;
  payload?: unknown;
  createdAt?: string;
  status?: { state: string; description?: string; createdAt?: string };
}

export interface FakeStatus {
  state: string;
  description?: string | undefined;
  // GitHub's default is true. The port always sends false.
  autoInactive?: boolean | undefined;
  createdAt?: string | undefined;
}

interface Stored {
  deployment: Deployment;
  statuses: DeploymentStatus[];
}

export class FakeDeployments {
  readonly #records = new Map<number, Stored>();
  readonly #runs = new Map<string, WorkflowRun>();
  #flips: { environment: string; except: number; requestsLeft: number }[] = [];
  #nextId = 1;

  constructor(private readonly now: () => string) {}

  // Called for every request the fake counts, before it is answered.
  onRequest(): void {
    const due = this.#flips.filter((flip) => flip.requestsLeft === 0);
    this.#flips = this.#flips
      .filter((flip) => flip.requestsLeft > 0)
      .map((flip) => ({ ...flip, requestsLeft: flip.requestsLeft - 1 }));
    for (const { environment, except } of due) {
      for (const { deployment, statuses } of this.#records.values()) {
        if (deployment.environment !== environment || deployment.id === except) continue;
        if (statuses.at(-1)?.state !== "success") continue;
        statuses.push({ state: "inactive", description: "", createdAt: this.now() });
      }
    }
  }

  create(deployment: NewDeployment | SeedDeployment): Deployment {
    const id = this.#nextId++;
    const created: Deployment = {
      id,
      task: deployment.task,
      environment: deployment.environment ?? "sluiceway",
      sha: deployment.sha ?? SEED_SHA,
      payload: structuredClone("payload" in deployment ? deployment.payload : SEED_PAYLOAD),
      createdAt: ("createdAt" in deployment ? deployment.createdAt : undefined) ?? this.now(),
    };
    this.#records.set(id, { deployment: created, statuses: [] });
    return structuredClone(created);
  }

  addStatus(id: number, status: FakeStatus): DeploymentStatus {
    const stored = this.#find(id);
    const added: DeploymentStatus = {
      state: status.state,
      description: status.description ?? "",
      createdAt: status.createdAt ?? this.now(),
    };
    stored.statuses.push(added);
    if (status.state === "success" && (status.autoInactive ?? true)) {
      this.#flips.push({
        environment: stored.deployment.environment,
        except: id,
        requestsLeft: FLIP_AFTER_REQUESTS,
      });
    }
    return { ...added };
  }

  record(id: number): DeploymentRecord {
    const { deployment, statuses } = this.#find(id);
    const latest = statuses.at(-1);
    return { ...structuredClone(deployment), status: latest ? { ...latest } : undefined };
  }

  statuses(id: number): DeploymentStatus[] {
    return this.#find(id).statuses.map((status) => ({ ...status }));
  }

  page(environment: string): DeploymentPage {
    const found = this.#newestFirst().filter(
      ({ deployment }) => deployment.environment === environment,
    );
    return {
      records: found.slice(0, PAGE_SIZE).map(({ deployment }) => this.record(deployment.id)),
      more: found.length > PAGE_SIZE,
    };
  }

  // Every record of an environment, oldest first, for a test to look at.
  all(environment: string): DeploymentRecord[] {
    return this.#newestFirst()
      .filter(({ deployment }) => deployment.environment === environment)
      .reverse()
      .map(({ deployment }) => this.record(deployment.id));
  }

  newestOfTask(task: string): Deployment | undefined {
    const found = this.#newestFirst().find(({ deployment }) => deployment.task === task);
    return found && structuredClone(found.deployment);
  }

  seedRun(runId: string, run: WorkflowRun): void {
    this.#runs.set(runId, { ...run });
  }

  run(runId: string): WorkflowRun | undefined {
    const run = this.#runs.get(runId);
    return run && { ...run };
  }

  #newestFirst(): Stored[] {
    return [...this.#records.values()].sort(
      (a, b) =>
        (a.deployment.createdAt < b.deployment.createdAt
          ? 1
          : a.deployment.createdAt > b.deployment.createdAt
            ? -1
            : 0) || b.deployment.id - a.deployment.id,
    );
  }

  #find(id: number): Stored {
    const stored = this.#records.get(id);
    if (!stored) throw new FakeGitHubError(404, "Not Found");
    return stored;
  }
}
