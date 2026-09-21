// The words of the port's deployment calls (record 0003). The records
// themselves are declared in core/deployment.ts, because the core reads them.

import type { DeploymentRecord } from "../core/deployment.ts";

export type { Deployment, DeploymentRecord, DeploymentStatus } from "../core/deployment.ts";

export interface NewDeployment {
  // The commit of the default branch the deploy runs on.
  sha: string;
  // `sluiceway:<stack id>`.
  task: string;
  // Only a label. GitHub makes an Environment entry of that name as a side
  // effect, also on a private repo on the Free plan (issue 27).
  environment: string;
  payload: Record<string, unknown>;
}

export interface NewDeploymentStatus {
  state: "queued" | "in_progress" | "success" | "failure" | "error";
  // A failure reason from Sluiceway's fixed list (record 0022). GitHub takes
  // at most 140 characters.
  description?: string | undefined;
  // The run of the deploy.
  logUrl?: string | undefined;
}

export interface DeploymentPage {
  // Newest first.
  records: DeploymentRecord[];
  // The environment holds more records than this page.
  more: boolean;
}

export interface WorkflowRun {
  // The run is over: no job of it will write a result any more.
  completed: boolean;
}
