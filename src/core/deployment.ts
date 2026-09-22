// Deployment records (record 0003): one attempt to deploy one stack, kept in
// GitHub's Deployments API and nowhere else. This file holds the words of a
// record. It is declared here and not on the port because `core/` may not
// import `github/`.

// A record as GitHub holds it, in the port's words.
export interface Deployment {
  id: number;
  // `sluiceway:<stack id>` on a record of Sluiceway's. Anything else is not
  // Sluiceway's and is never read.
  task: string;
  // Only a label (record 0003).
  environment: string;
  // The commit of the default branch the deploy runs on.
  sha: string;
  // As GitHub gives it back, parsed. Read it with `readDeploymentPayload`.
  payload: unknown;
  // As GitHub writes it ("2026-09-21T08:52:10Z").
  createdAt: string;
}

export interface DeploymentStatus {
  // GitHub's word in lower case: `queued`, `in_progress`, `success`,
  // `failure`, `error`, `inactive`, or one Sluiceway never writes.
  state: string;
  // A failure reason from Sluiceway's fixed list, or "" (record 0022).
  description: string;
  createdAt: string;
}

// A record with its latest status, which is all GitHub keeps for 90 days and
// all the dashboard needs (record 0003). No status yet is `undefined`.
export interface DeploymentRecord extends Deployment {
  status: DeploymentStatus | undefined;
}

const TASK_PREFIX = "sluiceway:";

export function deploymentTask(stackId: string): string {
  return `${TASK_PREFIX}${stackId}`;
}

// The stack a record is about, or nothing for a record that is not
// Sluiceway's, such as the `deploy` record of a job level `environment:` key.
export function taskStackId(task: string): string | undefined {
  if (!task.startsWith(TASK_PREFIX) || task.length === TASK_PREFIX.length) return undefined;
  return task.slice(TASK_PREFIX.length);
}

export const PAYLOAD_VERSION = 1;

// What a preview cannot recompute and the record has to carry.
export interface DeploymentPayload {
  // The diff hash the tick approved (record 0008).
  hash: string;
  ticker: string;
  // The id of the workflow run that deploys. The record lives as long as that
  // run does (record 0003).
  run: string;
  // A queued record: the stacks it waits behind, which have to go out first
  // (records 0009 and 0056). Absent on every other record.
  behind?: string[] | undefined;
  // The pull request a tick merged (record 0054). Such a record has no hash,
  // read as "", because nothing was previewed yet: the scan after the merge
  // ends it and opens the record that deploys. It outlives its run, which is
  // the run of `resolve`.
  merge?: number | undefined;
}

export function deploymentPayload(payload: DeploymentPayload): Record<string, unknown> {
  return {
    v: PAYLOAD_VERSION,
    hash: payload.hash,
    ticker: payload.ticker,
    run: payload.run,
    ...(payload.behind && payload.behind.length > 0 ? { behind: payload.behind } : {}),
  };
}

// The payload of the record a merge tick opens (record 0054). No hash at all,
// so an older version of Sluiceway, which needs one, leaves the record alone.
export function mergePayload(payload: {
  ticker: string;
  run: string;
  merge: number;
}): Record<string, unknown> {
  return { v: PAYLOAD_VERSION, ticker: payload.ticker, run: payload.run, merge: payload.merge };
}

const RUN_ID = /^[1-9]\d*$/;

// A payload of another version, or one a person made up, is not read. A run
// that is not a run id is not read either, so no request and no link is ever
// built from text that came from outside.
export function readDeploymentPayload(payload: unknown): DeploymentPayload | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const { v, hash, ticker, run, behind, merge } = payload as Record<string, unknown>;
  if (v !== PAYLOAD_VERSION) return undefined;
  if (merge !== undefined) {
    const number = typeof merge === "number" && Number.isInteger(merge) && merge > 0;
    const plain = hash === undefined && behind === undefined;
    return number &&
      plain &&
      typeof ticker === "string" &&
      typeof run === "string" &&
      RUN_ID.test(run)
      ? { hash: "", ticker, run, merge }
      : undefined;
  }
  if (typeof hash !== "string" || typeof ticker !== "string" || typeof run !== "string") {
    return undefined;
  }
  if (!RUN_ID.test(run)) return undefined;
  if (behind === undefined) return { hash, ticker, run };
  const ids = Array.isArray(behind) ? behind : [];
  if (ids.length === 0 || !ids.every((id) => typeof id === "string" && id !== "")) {
    return undefined;
  }
  return { hash, ticker, run, behind: ids as string[] };
}

// What the newest record of a stack says about it (record 0003). A preview
// cannot recompute any of this.
export type DeployFact =
  // An open deployment: no result yet. The stack is deploying.
  | {
      kind: "open";
      deployment: number;
      // Not in progress yet. A queued record cannot tell a wait for a reviewer
      // from a wait for a runner (record 0027).
      waiting: boolean;
      ticker: string;
      run: string;
      // Queued behind these stacks (record 0056): it starts only after they
      // went out, in a later run.
      behind?: string[] | undefined;
      // The pull request a merge tick merged: the record waits for the scan
      // after the merge, not for its run (record 0054).
      merge?: number;
    }
  | {
      kind: "succeeded";
      ticker: string;
      run: string;
      at: Date;
      // The diff hash the tick approved, which is what went out (record 0008).
      hash: string;
      // The fresh preview had nothing to deploy, so nothing went out (record
      // 0051).
      inSync?: boolean;
    }
  | {
      kind: "failed";
      // Display text from the status. Nothing is decided from it.
      reason: string;
      ticker: string;
      run: string;
      at: Date;
    };

// One deploy that went out, for the recently deployed list (record 0029).
export interface SucceededDeploy {
  stackId: string;
  ticker: string;
  run: string;
  at: Date;
  // The commit that went out. Attribution starts there (record 0026).
  sha: string;
  // Absent for a deploy that went out. "in-sync": the fresh preview had
  // nothing to deploy. "rehearsed": a rehearsal, nothing went out (record
  // 0051).
  result?: "in-sync" | "rehearsed";
}

export interface DeployFacts {
  byStack: Map<string, DeployFact>;
  // Every success among the records, oldest first, and every rehearsal: the
  // trail of recently deployed (record 0051).
  succeeded: SucceededDeploy[];
  // Records of Sluiceway's whose payload this version cannot read. They are
  // left alone, as a body of another marker version is.
  unread: number;
}

// `inactive` is "succeeded, then superseded": GitHub writes it when another
// writer's success in the same environment came without `auto_inactive:
// false` (record 0003, issue 27).
const SUCCEEDED = new Set(["success", "inactive"]);
const FAILED = new Set(["failure", "error"]);

export const NO_REASON_RECORDED = "no reason was recorded";

// The description `apply` gives a success whose fresh preview was empty
// (record 0051). Sluiceway's own words, and the one description a reader
// tells a result by, so the trail can say that nothing went out.
export const IN_SYNC_DESCRIPTION = "nothing to deploy, already in sync";

// The description of the `inactive` status that ends a rehearsal (record
// 0051). `inactive` because nothing went live, so GitHub's own views and the
// Slack and Teams apps do not show it as a deploy. Told apart from GitHub's
// own `inactive` by these words, which GitHub never writes.
export const REHEARSED_DESCRIPTION = "rehearsed, nothing was deployed";

function isRehearsal(status: DeploymentStatus | undefined): boolean {
  return status?.state === "inactive" && status.description === REHEARSED_DESCRIPTION;
}

// The description of the `inactive` status that ends a queued record when the
// stack starts in a later run, under a record of that run (record 0056). The
// record says nothing about the stack: the new one does.
export const HANDED_ON_DESCRIPTION = "started in a later run";

// The description of the `inactive` status that ends a merge record once the
// scan after the merge opened the record that deploys (record 0054). Nothing
// went out under it, so it is no deploy fact and no line of the trail either:
// the record that deploys is.
export const MERGED_DESCRIPTION = "merged, the deploy follows in a record of its own";

export function isHandedOn(status: DeploymentStatus | undefined): boolean {
  return (
    status?.state === "inactive" &&
    (status.description === HANDED_ON_DESCRIPTION || status.description === MERGED_DESCRIPTION)
  );
}

// A record with no status, or with a state that is no result, is an open
// deployment (record 0003). `apply` deploys only on one (record 0019).
export function isOpenStatus(status: DeploymentStatus | undefined): boolean {
  const state = status?.state ?? "";
  return !SUCCEEDED.has(state) && !FAILED.has(state);
}

export function newestLast(a: DeploymentRecord, b: DeploymentRecord): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id;
}

// A state that is no result is open, also one GitHub adds tomorrow: a stack
// that may be deploying never gets a box.
function factOf(record: DeploymentRecord, payload: DeploymentPayload): DeployFact {
  const { ticker, run } = payload;
  const state = record.status?.state ?? "";
  const at = new Date(record.status?.createdAt ?? record.createdAt);
  if (SUCCEEDED.has(state)) {
    const inSync = state === "success" && record.status?.description === IN_SYNC_DESCRIPTION;
    return {
      kind: "succeeded",
      ticker,
      run,
      at,
      hash: payload.hash,
      ...(inSync ? { inSync } : {}),
    };
  }
  if (FAILED.has(state)) {
    return {
      kind: "failed",
      reason: record.status?.description || NO_REASON_RECORDED,
      ticker,
      run,
      at,
    };
  }
  return {
    kind: "open",
    deployment: record.id,
    waiting: state !== "in_progress",
    ticker,
    run,
    ...(payload.behind ? { behind: payload.behind } : {}),
    ...(payload.merge === undefined ? {} : { merge: payload.merge }),
  };
}

export function deployFacts(records: readonly DeploymentRecord[]): DeployFacts {
  const facts: DeployFacts = { byStack: new Map(), succeeded: [], unread: 0 };
  for (const record of [...records].sort(newestLast)) {
    const stackId = taskStackId(record.task);
    if (stackId === undefined) continue;
    const payload = readDeploymentPayload(record.payload);
    if (!payload) {
      facts.unread++;
      continue;
    }
    if (isHandedOn(record.status)) continue;
    const fact = factOf(record, payload);
    // A rehearsal changed nothing about the stack: it is only a line of the
    // trail, and the fact before it stands.
    if (isRehearsal(record.status)) {
      facts.succeeded.push({
        stackId,
        ticker: payload.ticker,
        run: payload.run,
        at: new Date(record.status?.createdAt ?? record.createdAt),
        sha: record.sha,
        result: "rehearsed",
      });
      continue;
    }
    // Newest last, so the newest record of a stack is the one that stays.
    facts.byStack.set(stackId, fact);
    if (fact.kind === "succeeded") {
      facts.succeeded.push({
        stackId,
        ticker: fact.ticker,
        run: fact.run,
        at: fact.at,
        sha: record.sha,
        ...(fact.inSync ? { result: "in-sync" as const } : {}),
      });
    }
  }
  return facts;
}

// The commit on a stack's last successful deployment record, where its
// attribution starts (record 0026). Nothing when the bounded reads of record
// 0003 hold no success of the stack: no extra page is read to look for one.
export function lastDeployedCommit(facts: DeployFacts, stackId: string): string | undefined {
  return facts.succeeded.findLast(
    (deploy) => deploy.stackId === stackId && deploy.result !== "rehearsed",
  )?.sha;
}

// A pending stack whose newest record is a deploy that went out with this
// same diff hash (onboarding log, hurdle 21). The deploy did not bring it in
// sync, which is what a program does that makes a value that differs on every
// run. It explains a row and decides nothing: the tick and the hash check work
// as they always do.
export function pendingAgain(fact: DeployFact | undefined, hash: string): boolean {
  return fact?.kind === "succeeded" && !fact.inSync && fact.hash === hash;
}

// One stack as a scan sees it at its late read (record 0004).
export interface StackAtLateRead {
  // When this scan started its newest preview of the stack, or nothing when
  // it has not previewed it.
  previewedAt: Date | undefined;
  // The row state on the stack's block in the live body, as the marker holds
  // it, or nothing when the body has no block for it.
  liveState: string | undefined;
  fact: DeployFact | undefined;
  // This scan gave the record its result, because its run was over. No other
  // writer comes after that with a row of its own.
  settledHere?: boolean | undefined;
  // This scan already previewed the stack a second time for a deploy that
  // ended under it.
  again?: boolean | undefined;
}

export type RowAtLateRead =
  // No box, whatever the preview says. The live row is the one `resolve` or
  // `apply` wrote. Without one the row is made from the record.
  | { row: "deploying"; from: "live" | "record" }
  // The live row block, byte for byte.
  | { row: "live" }
  // The row of this scan's preview.
  | { row: "fresh" }
  // Preview the stack now and return to the late read (record 0011).
  | { row: "preview-first"; why: PreviewFirstWhy };

export type PreviewFirstWhy =
  // The live body has no row for the stack (record 0011).
  | "no-row"
  // Its live row says deploying and no deployment is open.
  | "no-open-deployment"
  // A deploy of it ended after its preview started, and no live row tells
  // how it ended.
  | "deploy-ended";

// At its late read the scan defers to fresher facts (record 0004). A stack
// with an open deployment is deploying. A stack whose deploy ended after its
// preview started keeps its live row, because the preview predates the deploy
// and `apply` or `settle` wrote a row that does not. A row is deploying
// exactly as long as a deployment is open: a deploying row that outlived its
// record is previewed, because the writer that would have replaced it is gone.
export function rowAtLateRead(stack: StackAtLateRead): RowAtLateRead {
  const { previewedAt, liveState, fact } = stack;
  if (fact?.kind === "open") {
    // A queued record gives a queued row (record 0056).
    const taken = fact.behind ? "queued" : "deploying";
    return { row: "deploying", from: liveState === taken ? "live" : "record" };
  }
  const usableLive = liveState !== undefined && liveState !== "deploying" && liveState !== "queued";
  if (previewedAt === undefined) {
    if (usableLive) return { row: "live" };
    return { row: "preview-first", why: liveState === undefined ? "no-row" : "no-open-deployment" };
  }

  const predates = fact !== undefined && !stack.settledHere && fact.at > previewedAt;
  if (!predates) return { row: "fresh" };
  if (usableLive) return { row: "live" };
  // Once. A clock that runs behind GitHub's would otherwise ask again and
  // again, and the next scan repairs what is left.
  return stack.again ? { row: "fresh" } : { row: "preview-first", why: "deploy-ended" };
}
