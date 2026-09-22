// Deploys made outside the dashboard, found in the tool's own history (record
// 0073). A deploy there is Sluiceway's own when a deployment record of the
// same stack carries the GitHub Actions run it ran in. Every other one is an
// outside deploy and gets a line on the trail. The lines decide nothing.

import { type DeploymentRecord, readDeploymentPayload, taskStackId } from "./deployment.ts";

// One deploy of the tool's history, as its adapter hands it over. The same
// shape as the adapter's `ToolDeploy`, spelled here because the core does not
// import the adapters.
export interface HistoryDeploy {
  kind: "deploy" | "destroy";
  endedAt: Date;
  commit?: { sha: string; dirty: boolean };
  runId?: string;
}

// An outside deploy on the trail. Every writer carries it in its line's
// marker, because only a full scan can read the tool's history.
export interface OutsideDeploy {
  stackId: string;
  kind: "deploy" | "destroy";
  // When it ended, by the clock of the machine that ran it.
  at: Date;
  // The commit that was checked out, whole.
  commit?: string | undefined;
  // The tree held changes that are in no commit.
  dirty?: boolean | undefined;
}

// The runs on every deployment record of Sluiceway's that this version can
// read, per stack, whatever its result: a deploy of any of them may be in
// the history.
export function ownRuns(records: readonly DeploymentRecord[]): Map<string, Set<string>> {
  const runs = new Map<string, Set<string>>();
  for (const record of records) {
    const stackId = taskStackId(record.task);
    const payload = readDeploymentPayload(record.payload);
    if (stackId === undefined || payload === undefined) continue;
    const set = runs.get(stackId) ?? new Set<string>();
    set.add(payload.run);
    runs.set(stackId, set);
  }
  return runs;
}

// The deploys of one stack's history that are not Sluiceway's, newest first.
export function outsideDeploys(
  stackId: string,
  history: readonly HistoryDeploy[],
  own: ReadonlySet<string> | undefined,
): OutsideDeploy[] {
  return history
    .filter((deploy) => deploy.runId === undefined || !own?.has(deploy.runId))
    .map((deploy) => ({
      stackId,
      kind: deploy.kind,
      at: deploy.endedAt,
      ...(deploy.commit ? { commit: deploy.commit.sha } : {}),
      ...(deploy.commit?.dirty ? { dirty: true } : {}),
    }));
}

// The outside deploys a writer puts on the trail: for a stack whose history
// this scan read, what it found, and for every other stack of the repo the
// lines the live body has. A stack the repo no longer has keeps none, like
// its row.
export function trailOutside(
  stackIds: readonly string[],
  read: ReadonlyMap<string, readonly OutsideDeploy[]>,
  live: readonly OutsideDeploy[],
): OutsideDeploy[] {
  const stacks = new Set(stackIds);
  return [
    ...live.filter((deploy) => stacks.has(deploy.stackId) && !read.has(deploy.stackId)),
    ...[...read.entries()].filter(([id]) => stacks.has(id)).flatMap(([, deploys]) => deploys),
  ].sort(
    (a, b) =>
      b.at.getTime() - a.at.getTime() ||
      (a.stackId < b.stackId ? -1 : a.stackId > b.stackId ? 1 : 0),
  );
}
