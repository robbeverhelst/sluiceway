// Deployment records (record 0003): one attempt to deploy one stack, kept in
// GitHub's Deployments API and nowhere else. This file holds the words of a
// record: the status each step of its life writes and how a status is read
// back. It is declared here and not on the port because `core/` may not
// import `github/`. `github/deployments.ts` writes and reads the records
// through the port in these words.

import { z } from "zod";
import { type DeployFailureReason, deployFailureText } from "./failure-reason.ts";
import type { OutsideDeploy } from "./outside-deploy.ts";

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
  // On an `inactive` status that superseded a success: when that success was
  // written, while GitHub still keeps it. It is when the deploy really ended
  // (record 0062). The port reads it from the status before the latest, in
  // the same request.
  succeededAt?: string | undefined;
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
  // The attempt of that run which created the record, so a link lands on it
  // after a re-run (slice 5.9). An added key, so the version stays 1. Absent
  // on a record written before.
  attempt?: string | undefined;
  // A queued record: the stacks it waits behind, which have to go out first
  // (records 0009 and 0056). Absent on every other record.
  behind?: string[] | undefined;
  // The pull request a tick merged (record 0054). Such a record has no hash,
  // read as "", because nothing was previewed yet: the scan after the merge
  // ends it and opens the record that deploys. It outlives its run, which is
  // the run of `resolve`.
  merge?: number | undefined;
  // The hash covers drift (record 0055): `apply` checks drift again before it
  // compares, and the deploy puts the drift back. An added key, so the
  // version stays 1. A reader that does not know it compares without drift,
  // which ends as a moved change: the safe direction.
  drift?: boolean | undefined;
  // The record was opened after the scan of a merge, for a stack set to
  // on-merge, and `ticker` is whoever merged (record 0095). An added key, so
  // the version stays 1. A reader that does not know it reads the record as
  // a tick by that person, which deploys the same.
  onMerge?: boolean | undefined;
  // The value fingerprint the tick approved (record 0102): a hash of the
  // values the row did not show. An added key, so the version stays 1. Absent
  // on a record written before, or with the check off for the stack: a fresh
  // preview that gives one then refuses the deploy, the safe direction.
  fingerprint?: string | undefined;
  // The record waits for the stack's deploy window (record 0104): a queued
  // record that waits for a time and not for a stack. A run inside the window
  // starts it under a record of its own. An added key, so the version stays
  // 1. A reader that does not know it reads an open deployment, which is what
  // it is.
  window?: boolean | undefined;
}

// The payload as a schema (record 0096): what every writer writes, checked
// before it is sent, and published as schema/deployment-payload.schema.json
// for anyone who reads the records. Strict, so a key that is not named here
// cannot ride along, and none of its fields can hold a property value or a
// secret: a hash, a login, run ids, stack ids, a pull request number and
// flags.
const runId = () => z.string().regex(/^[1-9]\d*$/);
const v = z
  .literal(PAYLOAD_VERSION)
  .describe("The version of the payload. A reader checks it first.");
const ticker = z
  .string()
  .min(1)
  .describe(
    "The login of the person whose tick started the deploy, plain, without @. On a deploy on merge, whoever merged.",
  );
const run = runId().describe(
  "The id of the workflow run that deploys. The record is open as long as that run is.",
);
const attempt = runId()
  .optional()
  .describe("The attempt of that run which created the record. Absent on older records.");

// In the order the payload has always been written.
const tickPayloadSchema = z
  .strictObject({
    v,
    hash: z
      .string()
      .regex(/^[0-9a-f]{16}$/)
      .describe(
        "The diff hash the tick approved: the first 16 hex characters of a SHA-256. The deploy goes out only when a fresh preview gives the same hash.",
      ),
    ticker,
    run,
    attempt,
    behind: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe(
        "A queued record: the stack ids it waits behind, which have to go out first. Absent otherwise.",
      ),
    drift: z
      .literal(true)
      .optional()
      .describe("The hash covers drift, and the deploy puts it back. Absent otherwise."),
    onMerge: z
      .literal(true)
      .optional()
      .describe(
        "The record was opened after the scan of a merge, for a stack set to deploy on merge. Absent otherwise.",
      ),
    fingerprint: z
      .string()
      .regex(/^[0-9a-f]{16}$/)
      .optional()
      .describe(
        "The value fingerprint the tick approved: the first 16 hex characters of a SHA-256 over the values of the diff that the row did not show. The deploy goes out only when a fresh preview gives the same one. Absent on a record written before the key came, or with the check off for the stack.",
      ),
    window: z
      .literal(true)
      .optional()
      .describe(
        "A queued record that waits for the stack's deploy window, which a run inside the window starts. Absent otherwise.",
      ),
  })
  .describe(
    "The record of a tick, a queued stack, a drift repair, a deploy on merge or a deploy that waits for its window.",
  );

const mergeRecordSchema = z
  .strictObject({
    v,
    ticker,
    run,
    attempt,
    merge: z
      .int()
      .positive()
      .describe(
        "The pull request a tick merged. The record carries no hash, never deploys, and ends when the scan after the merge opens the record that does.",
      ),
  })
  .describe("The record of a tick that merged a pull request.");

export const deploymentPayloadSchema = z.union([tickPayloadSchema, mergeRecordSchema]);

// The JSON schema of the payload, for a reader that wants to check one. Only
// scripts/generate-schema.ts calls this, never the action.
export function deploymentPayloadJsonSchema(): Record<string, unknown> {
  const { $schema, ...rest } = z.toJSONSchema(deploymentPayloadSchema, { target: "draft-7" });
  return {
    $schema,
    title: "Sluiceway deployment record payload",
    description:
      "The payload of a GitHub deployment record whose task is sluiceway:<stack id>. It holds no property value, no secret and none of the tool's own words.",
    ...rest,
  };
}

export function deploymentPayload(payload: DeploymentPayload): Record<string, unknown> {
  return tickPayloadSchema.parse({
    v: PAYLOAD_VERSION,
    hash: payload.hash,
    ticker: payload.ticker,
    run: payload.run,
    ...(payload.attempt === undefined ? {} : { attempt: payload.attempt }),
    ...(payload.behind && payload.behind.length > 0 ? { behind: payload.behind } : {}),
    ...(payload.drift ? { drift: true } : {}),
    ...(payload.onMerge ? { onMerge: true } : {}),
    ...(payload.fingerprint === undefined ? {} : { fingerprint: payload.fingerprint }),
    ...(payload.window ? { window: true } : {}),
  });
}

// The payload of the record a merge tick opens (record 0054). No hash at all,
// so an older version of Sluiceway, which needs one, leaves the record alone.
export function mergePayload(payload: {
  ticker: string;
  run: string;
  attempt?: string | undefined;
  merge: number;
}): Record<string, unknown> {
  return mergeRecordSchema.parse({
    v: PAYLOAD_VERSION,
    ticker: payload.ticker,
    run: payload.run,
    ...(payload.attempt === undefined ? {} : { attempt: payload.attempt }),
    merge: payload.merge,
  });
}

const RUN_ID = /^[1-9]\d*$/;

// A payload of another version, or one a person made up, is not read. A run
// that is not a run id is not read either, so no request and no link is ever
// built from text that came from outside.
export function readDeploymentPayload(payload: unknown): DeploymentPayload | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const { v, hash, ticker, run, behind, merge, drift, attempt, onMerge, fingerprint, window } =
    payload as Record<string, unknown>;
  if (v !== PAYLOAD_VERSION) return undefined;
  // Only a number is kept, so no link is built from text that came from
  // outside. Anything else leaves the attempt out, not the record.
  const attempted = typeof attempt === "string" && RUN_ID.test(attempt) ? { attempt } : {};
  if (merge !== undefined) {
    const number = typeof merge === "number" && Number.isInteger(merge) && merge > 0;
    const plain = hash === undefined && behind === undefined;
    return number &&
      plain &&
      typeof ticker === "string" &&
      typeof run === "string" &&
      RUN_ID.test(run)
      ? { hash: "", ticker, run, ...attempted, merge }
      : undefined;
  }
  if (typeof hash !== "string" || typeof ticker !== "string" || typeof run !== "string") {
    return undefined;
  }
  if (!RUN_ID.test(run)) return undefined;
  const read: DeploymentPayload = { hash, ticker, run, ...attempted };
  if (drift === true) read.drift = true;
  if (onMerge === true) read.onMerge = true;
  // Only a fingerprint is kept, so nothing that came from outside is ever
  // compared as one (record 0102).
  if (typeof fingerprint === "string" && /^[0-9a-f]{16}$/.test(fingerprint)) {
    read.fingerprint = fingerprint;
  }
  if (window === true) read.window = true;
  if (behind === undefined) return read;
  const ids = Array.isArray(behind) ? behind : [];
  if (ids.length === 0 || !ids.every((id) => typeof id === "string" && id !== "")) {
    return undefined;
  }
  return { ...read, behind: ids as string[] };
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
      attempt?: string | undefined;
      // Queued behind these stacks (record 0056): it starts only after they
      // went out, in a later run.
      behind?: string[] | undefined;
      // Queued for the stack's deploy window (record 0104): a run inside the
      // window starts it.
      window?: true;
      // The pull request a merge tick merged: the record waits for the scan
      // after the merge, not for its run (record 0054).
      merge?: number;
      // Opened on merge, and `ticker` is whoever merged (record 0095).
      onMerge?: true;
    }
  | {
      kind: "succeeded";
      ticker: string;
      run: string;
      attempt?: string | undefined;
      at: Date;
      // The diff hash the tick approved, which is what went out (record 0008).
      hash: string;
      // The fresh preview had nothing to deploy, so nothing went out (record
      // 0051).
      inSync?: boolean;
      onMerge?: true;
    }
  | {
      kind: "failed";
      // Display text from the status. Nothing is decided from it.
      reason: string;
      ticker: string;
      run: string;
      attempt?: string | undefined;
      at: Date;
      onMerge?: true;
    };

// One deploy that went out, for the recently deployed list (record 0029).
export interface SucceededDeploy {
  stackId: string;
  ticker: string;
  run: string;
  attempt?: string | undefined;
  at: Date;
  // The commit that went out. Attribution starts there (record 0026).
  sha: string;
  // Absent for a deploy that went out. "in-sync": the fresh preview had
  // nothing to deploy. "rehearsed": a rehearsal, nothing went out (record
  // 0051). "drift-repaired": it went out, and the approved hash covered
  // drift, which it put back (record 0059). "drift-gone": the approved hash
  // covered drift, and the drift check and the fresh preview found nothing to
  // deploy, so nothing was repaired (record 0091).
  result?: "in-sync" | "rehearsed" | "drift-repaired" | "drift-gone";
  // It went out on merge (record 0095).
  onMerge?: true;
}

// One line of the recently deployed list (records 0029 and 0062): a deploy
// that ended, whichever way.
export interface TrailEntry {
  stackId: string;
  ticker: string;
  run: string;
  // The attempt of the run, when the record says (slice 5.9).
  attempt?: string | undefined;
  at: Date;
  // Absent for a deploy that went out. "in-sync", "rehearsed",
  // "drift-repaired" and "drift-gone" as on `SucceededDeploy`, "failed" for a
  // record that ended as `failure` or `error` (record 0062).
  result?: "in-sync" | "rehearsed" | "drift-repaired" | "drift-gone" | "failed";
  // It went out on merge, and `ticker` is whoever merged (record 0095).
  onMerge?: true;
  // The failure reason of a failed deploy, as the failure line shows it.
  reason?: string;
  // For a deploy that went out: the commit of the stack's success before it
  // and its own, the range attribution says it shipped (record 0072). Absent
  // when the records read hold no success before it: there is no guess.
  shipped?: { from: string; to: string };
}

export interface DeployFacts {
  byStack: Map<string, DeployFact>;
  // Every success among the records, oldest first, and every rehearsal: the
  // trail of recently deployed (record 0051).
  succeeded: SucceededDeploy[];
  // Every deploy that ended, oldest first: the successes and rehearsals above
  // and every failed deploy (record 0062).
  trail: TrailEntry[];
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

// A step of a record's life that Sluiceway writes as a status. Each step has
// one status, so the readers above tell them apart again: the state words and
// the descriptions are chosen here and nowhere else.
export type RecordStep =
  // `resolve` or the scan after a merge opened it: the stack is taken
  // (record 0003).
  | { kind: "opened" }
  // `apply` took it and runs the fresh preview (record 0019).
  | { kind: "claimed" }
  | RecordEnd;

// How a record ends.
export type RecordEnd =
  // The deploy went out.
  | { kind: "deployed" }
  // The fresh preview had nothing to deploy (record 0051).
  | { kind: "in-sync" }
  // A rehearsal: nothing went out (record 0051).
  | { kind: "rehearsed" }
  // A queued record whose stack starts under a record of a later run (record
  // 0056).
  | { kind: "handed-on" }
  // A merge record whose deploy follows in a record of its own (record 0054).
  | { kind: "merged" }
  // Nothing went out, or not all of it, for a reason of the fixed list
  // (record 0022).
  | { kind: "failed"; reason: DeployFailureReason };

export interface StatusToWrite {
  state: "queued" | "in_progress" | "success" | "failure" | "error" | "inactive";
  // A failure reason from the fixed list (record 0022), or the words that
  // tell a result apart. GitHub takes at most 140 characters.
  description?: string | undefined;
}

// A change that moved and a run that ended are `error`: the deploy never
// started (record 0003). Every other reason is `failure`.
export function recordStatus(step: RecordStep): StatusToWrite {
  switch (step.kind) {
    case "opened":
      return { state: "queued" };
    case "claimed":
      return { state: "in_progress" };
    case "deployed":
      return { state: "success", description: undefined };
    case "in-sync":
      return { state: "success", description: IN_SYNC_DESCRIPTION };
    case "rehearsed":
      return { state: "inactive", description: REHEARSED_DESCRIPTION };
    case "handed-on":
      return { state: "inactive", description: HANDED_ON_DESCRIPTION };
    case "merged":
      return { state: "inactive", description: MERGED_DESCRIPTION };
    case "failed":
      return {
        state:
          step.reason.kind === "moved" ||
          step.reason.kind === "value-changed" ||
          step.reason.kind === "run-ended"
            ? "error"
            : "failure",
        description: deployFailureText(step.reason),
      };
  }
}

export function newestLast(a: DeploymentRecord, b: DeploymentRecord): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id;
}

// A state that is no result is open, also one GitHub adds tomorrow: a stack
// that may be deploying never gets a box.
function factOf(record: DeploymentRecord, payload: DeploymentPayload): DeployFact {
  const { ticker } = payload;
  // The run and, when the record says, its attempt (slice 5.9).
  const run =
    payload.attempt === undefined
      ? { run: payload.run }
      : { run: payload.run, attempt: payload.attempt };
  const state = record.status?.state ?? "";
  const at = new Date(record.status?.createdAt ?? record.createdAt);
  const onMerge = payload.onMerge ? { onMerge: true as const } : {};
  if (SUCCEEDED.has(state)) {
    // GitHub's `inactive` status is written when the deploy was superseded,
    // so its time is not when the deploy ended. The success before it is,
    // while GitHub keeps it (record 0062).
    const ended =
      state === "inactive" && record.status?.succeededAt ? new Date(record.status.succeededAt) : at;
    const inSync = state === "success" && record.status?.description === IN_SYNC_DESCRIPTION;
    return {
      kind: "succeeded",
      ticker,
      ...run,
      at: Number.isNaN(ended.getTime()) ? at : ended,
      hash: payload.hash,
      ...(inSync ? { inSync } : {}),
      ...onMerge,
    };
  }
  if (FAILED.has(state)) {
    return {
      kind: "failed",
      reason: record.status?.description || NO_REASON_RECORDED,
      ticker,
      ...run,
      at,
      ...onMerge,
    };
  }
  return {
    kind: "open",
    deployment: record.id,
    waiting: state !== "in_progress",
    ticker,
    ...run,
    ...(payload.behind ? { behind: payload.behind } : {}),
    ...(payload.window ? { window: true as const } : {}),
    ...(payload.merge === undefined ? {} : { merge: payload.merge }),
    ...onMerge,
  };
}

export function deployFacts(records: readonly DeploymentRecord[]): DeployFacts {
  const facts: DeployFacts = { byStack: new Map(), succeeded: [], trail: [], unread: 0 };
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
      const rehearsed = {
        stackId,
        ticker: payload.ticker,
        run: payload.run,
        ...(payload.attempt === undefined ? {} : { attempt: payload.attempt }),
        at: new Date(record.status?.createdAt ?? record.createdAt),
        result: "rehearsed" as const,
      };
      facts.succeeded.push({ ...rehearsed, sha: record.sha });
      facts.trail.push(rehearsed);
      continue;
    }
    // Newest last, so the newest record of a stack is the one that stays.
    facts.byStack.set(stackId, fact);
    if (fact.kind === "succeeded") {
      const before = lastDeployedCommit(facts, stackId);
      const wentOut = !fact.inSync;
      const succeeded = {
        stackId,
        ticker: fact.ticker,
        run: fact.run,
        ...(fact.attempt === undefined ? {} : { attempt: fact.attempt }),
        at: fact.at,
        ...(fact.onMerge ? { onMerge: true as const } : {}),
        ...(fact.inSync
          ? { result: payload.drift ? ("drift-gone" as const) : ("in-sync" as const) }
          : payload.drift
            ? { result: "drift-repaired" as const }
            : {}),
      };
      facts.succeeded.push({ ...succeeded, sha: record.sha });
      facts.trail.push({
        ...succeeded,
        ...(wentOut && before !== undefined ? { shipped: { from: before, to: record.sha } } : {}),
      });
    }
    // A failure keeps its failure line on the row and is a line of the trail
    // too, so the trail is every deploy that ended (record 0062).
    if (fact.kind === "failed") {
      facts.trail.push({
        stackId,
        ticker: fact.ticker,
        run: fact.run,
        ...(fact.attempt === undefined ? {} : { attempt: fact.attempt }),
        at: fact.at,
        result: "failed",
        reason: fact.reason,
        ...(fact.onMerge ? { onMerge: true as const } : {}),
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

// The failed deploy a stack's row shows its failure line for, or nothing
// (record 0076). The line stands while no deploy of the stack ended after the
// failure. A later deploy from the dashboard is already the newest record, so
// the fact is no longer the failure. A deploy outside the dashboard is only in
// the tool's history, so it is checked here: a deploy or a destroy of the
// stack that ended after the failure took the failure's place. The trail
// keeps the failed deploy either way.
export function standingFailure(
  stackId: string,
  fact: DeployFact | undefined,
  outside: readonly OutsideDeploy[],
): Extract<DeployFact, { kind: "failed" }> | undefined {
  if (fact?.kind !== "failed") return undefined;
  const after = outside.some(
    (deploy) => deploy.stackId === stackId && deploy.at.getTime() > fact.at.getTime(),
  );
  return after ? undefined : fact;
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
    // A queued record gives a queued row (records 0056 and 0104).
    const taken = fact.behind || fact.window ? "queued" : "deploying";
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
