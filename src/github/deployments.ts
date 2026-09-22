// Reading deployment records for a render, and ending the ones whose run is
// over (record 0003). Every mode that renders the body will use both.

import { queueState } from "../core/dependencies.ts";
import {
  type DeploymentRecord,
  deployFacts,
  deploymentTask,
  taskStackId,
} from "../core/deployment.ts";
import { deployFailureText } from "../core/failure-reason.ts";
import type { GitHubPort } from "./port.ts";

// A stack whose newest record has to be known even when it is not on the page
// of its environment: a pending stack, or one whose live row says deploying.
export interface FallBackStack {
  stackId: string;
  environment: string;
}

// The bounded reads of record 0003: one GraphQL page of the newest records
// per environment name, then the REST fall back for a stack that is not on
// the page of its environment. A page that is not full holds every record of
// its environment, so a stack that is not on it has none and costs nothing.
// REST gives a record without its status, so the fall back is two requests
// for a stack with a record and one for a stack without. The stacks of the
// fall back can be handed over as a function, which is called only when an
// environment holds more than its page.
export async function readDeploymentRecords(
  github: GitHubPort,
  environments: readonly string[],
  fallBack: readonly FallBackStack[] | (() => Promise<readonly FallBackStack[]>),
): Promise<DeploymentRecord[]> {
  const records: DeploymentRecord[] = [];
  const more = new Set<string>();
  for (const environment of [...new Set(environments)]) {
    const page = await github.listNewestDeployments(environment);
    records.push(...page.records);
    if (page.more) more.add(environment);
  }
  if (more.size === 0) return records;

  const onAPage = new Set(records.map(({ task }) => task));
  const stacks = typeof fallBack === "function" ? await fallBack() : fallBack;
  for (const { stackId, environment } of stacks) {
    const task = deploymentTask(stackId);
    if (!more.has(environment) || onAPage.has(task)) continue;
    const newest = await github.newestDeploymentOfTask(task);
    if (!newest) continue;
    records.push({ ...newest, status: await github.latestDeploymentStatus(newest.id) });
    onAPage.add(task);
  }
  return records;
}

export interface Settled {
  // The records, with the new status on the ones that were ended.
  records: DeploymentRecord[];
  // The stacks whose open deployment was ended here.
  stackIds: string[];
}

// A record is never ended by a timeout, because a job can wait on a reviewer
// for days. It lives as long as its workflow run: any render that meets an
// open deployment whose run is over gives it the result `error` (record
// 0003). A run GitHub no longer has is over too.
//
// A queued record (record 0056) outlives its run on purpose: it waits for the
// stacks it depends on, and a later `resolve` starts it under a record of its
// own run. It is ended only when one of them did not go out, with that reason
// and as `failure`, after the records of runs that are over got theirs.
export async function settleEndedRuns(
  github: GitHubPort,
  records: readonly DeploymentRecord[],
  repoUrl: string,
): Promise<Settled> {
  const settled: Settled = { records: [...records], stackIds: [] };
  const end = async (stackId: string, deployment: number, run: string, dead: boolean) => {
    const status = await github.createDeploymentStatus(deployment, {
      state: dead ? "failure" : "error",
      description: deployFailureText({ kind: dead ? "dependency-failed" : "run-ended" }),
      logUrl: `${repoUrl}/actions/runs/${run}`,
    });
    settled.records = settled.records.map((record) =>
      record.id === deployment && taskStackId(record.task) === stackId
        ? { ...record, status }
        : record,
    );
    settled.stackIds.push(stackId);
  };
  for (const [stackId, fact] of deployFacts(records).byStack) {
    // A merge record outlives the run of `resolve` that opened it. The scan
    // after the merge ends it (record 0054).
    if (fact.kind !== "open" || fact.behind || fact.merge !== undefined) continue;
    const run = await github.getWorkflowRun(fact.run);
    if (run && !run.completed) continue;
    await end(stackId, fact.deployment, fact.run, false);
  }
  // In stack id order, again and again, so a chain ends from its first stack on.
  for (let ended = true; ended; ) {
    ended = false;
    const queued = [...deployFacts(settled.records).byStack].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    for (const [stackId, fact] of queued) {
      if (fact.kind !== "open" || !fact.behind) continue;
      if (queueState(fact.behind, settled.records) !== "dead") continue;
      await end(stackId, fact.deployment, fact.run, true);
      ended = true;
    }
  }
  return settled;
}
