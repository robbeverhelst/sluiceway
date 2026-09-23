// A deployment record's whole life through the port (record 0003): the
// bounded reads, opening one, `apply` claiming one, ending one, a queued one
// handed on to a later run, and settling the open ones whose run is over. A
// mode says which step it means. The status of each step, and how it is read
// back, is in core/deployment.ts, so no mode picks a state or its words.

import { queueState } from "../core/dependencies.ts";
import {
  type DeploymentPayload,
  type DeploymentRecord,
  type DeploymentStatus,
  deployFacts,
  deploymentPayload,
  deploymentTask,
  isOpenStatus,
  mergePayload,
  type RecordEnd,
  readDeploymentPayload,
  recordStatus,
  taskStackId,
} from "../core/deployment.ts";
import { openRecordsOfRun } from "../core/settle.ts";
import { runUrl } from "../render/links.ts";
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

// The run that writes: its id and attempt go on the payload of a record it
// opens, and its link on every status it writes (slice 5.9).
export interface RecordWriter {
  github: GitHubPort;
  // `https://github.com/<owner>/<repo>`.
  repoUrl: string;
  runId: string;
  // Absent where the runner did not say.
  runAttempt?: string | undefined;
}

function linkOf(writer: RecordWriter): string {
  return runUrl(writer.repoUrl, writer.runId, writer.runAttempt);
}

// A record to open, on the commit it deploys, for one stack.
export type Opening = {
  stackId: string;
  // Only a label (record 0003).
  environment: string;
  sha: string;
  ticker: string;
} & (
  | {
      // The diff hash the tick approved (record 0008).
      hash: string;
      // Queued behind these stacks (record 0056).
      behind?: string[] | undefined;
      // The hash covers drift (record 0055).
      drift?: boolean | undefined;
    }
  // The pull request a tick merged. No hash: nothing was previewed yet
  // (record 0054).
  | { merge: number }
);

export interface Opened {
  deployment: number;
  // The record exists, and a status after it could not be written. It is
  // still open, so it is still handed on (record 0035, slice 2.4), and the
  // caller goes red with this error.
  unfinished?: unknown;
}

// Opens a record as `queued`: from now on the stack is taken (record 0003).
// Throws when the record itself cannot be written.
export async function openRecord(writer: RecordWriter, opening: Opening): Promise<Opened> {
  const { github } = writer;
  const run = { ticker: opening.ticker, run: writer.runId, attempt: writer.runAttempt };
  const record = await github.createDeployment({
    sha: opening.sha,
    task: deploymentTask(opening.stackId),
    environment: opening.environment,
    payload:
      "merge" in opening
        ? mergePayload({ ...run, merge: opening.merge })
        : deploymentPayload({
            hash: opening.hash,
            ...run,
            behind: opening.behind,
            ...(opening.drift ? { drift: true } : {}),
          }),
  });
  try {
    await github.createDeploymentStatus(record.id, {
      ...recordStatus({ kind: "opened" }),
      logUrl: linkOf(writer),
    });
  } catch (error) {
    return { deployment: record.id, unfinished: error };
  }
  return { deployment: record.id };
}

// Starts a queued stack whose dependencies went out under a record of this
// run, because `apply` deploys only a record of its own run (records 0035 and
// 0056). The new record comes first, so a stack is never without an open
// one, and carries what the tick approved: the hash, the ticker, and whether
// the hash covers drift (record 0091). The run and its attempt are this run's,
// and it waits behind nothing. Then the queued record ends as handed on.
// Nothing when this version cannot read the queued record's payload.
export async function startQueuedRecord(
  writer: RecordWriter,
  queued: DeploymentRecord,
  // The commit this run deploys, and the stack's label.
  at: { sha: string; environment: string },
): Promise<(Opened & { ticker: string }) | undefined> {
  const stackId = taskStackId(queued.task);
  const payload = readDeploymentPayload(queued.payload);
  if (stackId === undefined || !payload) return undefined;
  const opened = await openRecord(writer, {
    stackId,
    environment: at.environment,
    sha: at.sha,
    ticker: payload.ticker,
    hash: payload.hash,
    drift: payload.drift,
  });
  const started = { ...opened, ticker: payload.ticker };
  if (opened.unfinished !== undefined) return started;
  try {
    await endRecord(writer, queued.id, { kind: "handed-on" });
  } catch (error) {
    return { ...started, unfinished: error };
  }
  return started;
}

// What `apply` finds when it takes the record it was handed (records 0019,
// 0035 and 0056). Only `claimed` may deploy.
export type Claim =
  // The record or its status could not be read.
  | { kind: "unread"; error: unknown }
  // It already has a result: a re-run never deploys (record 0019).
  | { kind: "ended"; state: string | undefined }
  // Its task does not start with `sluiceway:`.
  | { kind: "not-sluiceways" }
  | { kind: "unreadable-payload"; stackId: string }
  // It lives as long as another run (record 0003).
  | { kind: "other-run"; stackId: string; run: string }
  // A later `resolve` starts it (record 0056).
  | { kind: "queued"; stackId: string; behind: string[] }
  // Every check passed, and the `in_progress` status could not be written.
  | { kind: "unclaimed"; stackId: string; payload: DeploymentPayload; error: unknown }
  // It is this job's now, `in_progress`.
  | { kind: "claimed"; stackId: string; payload: DeploymentPayload };

// The latest status first, in one request, so a record that already ended
// costs exactly that (record 0019). The record after it. Nothing is written
// on a record this run may not deploy.
export async function claimRecord(writer: RecordWriter, id: number): Promise<Claim> {
  const { github } = writer;
  let status: DeploymentStatus | undefined;
  try {
    status = await github.latestDeploymentStatus(id);
  } catch (error) {
    return { kind: "unread", error };
  }
  if (!isOpenStatus(status)) return { kind: "ended", state: status?.state };
  let task: string;
  let payload: DeploymentPayload | undefined;
  try {
    const deployment = await github.getDeployment(id);
    task = deployment.task;
    payload = readDeploymentPayload(deployment.payload);
  } catch (error) {
    return { kind: "unread", error };
  }
  const stackId = taskStackId(task);
  if (stackId === undefined) return { kind: "not-sluiceways" };
  if (!payload) return { kind: "unreadable-payload", stackId };
  if (payload.run !== writer.runId) return { kind: "other-run", stackId, run: payload.run };
  if (payload.behind) return { kind: "queued", stackId, behind: payload.behind };
  try {
    await github.createDeploymentStatus(id, {
      ...recordStatus({ kind: "claimed" }),
      logUrl: linkOf(writer),
    });
  } catch (error) {
    return { kind: "unclaimed", stackId, payload, error };
  }
  return { kind: "claimed", stackId, payload };
}

// Gives a record its result, with the link to this run.
export async function endRecord(
  writer: RecordWriter,
  id: number,
  end: RecordEnd,
): Promise<DeploymentStatus> {
  return await writer.github.createDeploymentStatus(id, {
    ...recordStatus(end),
    logUrl: linkOf(writer),
  });
}

// One open record that a settle ended.
export interface EndedRecord {
  deployment: number;
  stackId: string;
  // The run of the deploy, which the status links to.
  run: string;
  // A queued record whose dependency did not go out (record 0056), rather
  // than one whose run ended.
  dead: boolean;
}

export interface Settled {
  // The records, with the new status on the ones that were ended.
  records: DeploymentRecord[];
  // In the order they were ended.
  ended: EndedRecord[];
}

// A status a settle could not write. It stops at the first one, so a missing
// `deployments: write` costs one request. The message is GitHub's.
export class RecordNotEnded extends Error {
  constructor(
    readonly stackId: string,
    readonly deployment: number,
    override readonly cause: unknown,
    // What was ended before it.
    readonly settled: Settled,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "RecordNotEnded";
  }
}

// A record is never ended by a timeout, because a job can wait on a reviewer
// for days. It lives as long as its workflow run: any render that meets an
// open deployment whose run is over gives it the result `error` (record
// 0003). A run GitHub no longer has is over too. Only the newest record of a
// stack is looked at.
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
  const open: OpenRecord[] = [];
  const queued: OpenRecord[] = [];
  for (const [stackId, fact] of deployFacts(records).byStack) {
    // A merge record outlives the run of `resolve` that opened it. The scan
    // after the merge ends it (record 0054).
    if (fact.kind !== "open" || fact.merge !== undefined) continue;
    const one = { deployment: fact.deployment, stackId, run: fact.run };
    if (fact.behind) queued.push({ ...one, behind: fact.behind });
    else open.push(one);
  }
  // In stack id order, so a chain ends from its first stack on.
  queued.sort((a, b) => (a.stackId < b.stackId ? -1 : a.stackId > b.stackId ? 1 : 0));
  return await settle(github, repoUrl, records, [...open, ...queued], async (id) => {
    const run = await github.getWorkflowRun(id);
    return !run || run.completed;
  });
}

// What `settle` ends (record 0035, slice 2.6): the open records of its own
// run, each judged on its own, so one that is not the newest of its stack is
// found too. It never asks whether its run is over: the `apply` jobs it
// waits for are. A record of another run is left alone, also one whose run
// is over: the next render ends that.
export async function settleRun(
  github: GitHubPort,
  records: readonly DeploymentRecord[],
  repoUrl: string,
  runId: string,
): Promise<Settled & { open: number }> {
  const open = openRecordsOfRun(records, runId).map(({ id, stackId, behind }) => ({
    deployment: id,
    stackId,
    run: runId,
    ...(behind ? { behind } : {}),
  }));
  const settled = await settle(github, repoUrl, records, open, async () => true);
  return { ...settled, open: open.length };
}

interface OpenRecord {
  deployment: number;
  stackId: string;
  run: string;
  behind?: string[];
}

// The one way an open record is settled. First every one that waits for no
// stack and whose run is over gets `error`. Then, again and again until
// nothing changes, every queued one whose stack's newest record is still open
// and that waits behind a stack that did not go out gets `failure`, so a whole
// chain ends. Each in the order given.
async function settle(
  github: GitHubPort,
  repoUrl: string,
  records: readonly DeploymentRecord[],
  open: readonly OpenRecord[],
  over: (run: string) => Promise<boolean>,
): Promise<Settled> {
  const settled: Settled = { records: [...records], ended: [] };
  const end = async (record: OpenRecord, dead: boolean): Promise<void> => {
    let status: DeploymentStatus;
    try {
      status = await github.createDeploymentStatus(record.deployment, {
        ...recordStatus({
          kind: "failed",
          reason: { kind: dead ? "dependency-failed" : "run-ended" },
        }),
        logUrl: `${repoUrl}/actions/runs/${record.run}`,
      });
    } catch (error) {
      throw new RecordNotEnded(record.stackId, record.deployment, error, settled);
    }
    settled.records = settled.records.map((one) =>
      one.id === record.deployment ? { ...one, status } : one,
    );
    settled.ended.push({
      deployment: record.deployment,
      stackId: record.stackId,
      run: record.run,
      dead,
    });
  };
  for (const record of open) {
    if (record.behind) continue;
    if (!(await over(record.run))) continue;
    await end(record, false);
  }
  const endedHere = () => new Set(settled.ended.map(({ deployment }) => deployment));
  for (let more = true; more; ) {
    more = false;
    for (const record of open) {
      if (!record.behind || endedHere().has(record.deployment)) continue;
      if (deployFacts(settled.records).byStack.get(record.stackId)?.kind !== "open") continue;
      if (queueState(record.behind, settled.records) !== "dead") continue;
      await end(record, true);
      more = true;
    }
  }
  return settled;
}
