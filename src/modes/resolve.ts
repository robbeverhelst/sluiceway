// The resolve mode (records 0017, 0025 and 0035): the job that an issue edit
// starts. It wires config, discovery, the walk through the edit history, the
// tick rule, the deployment records, the renderers and the GitHub port
// together and holds no rules of its own. It is handed no tool environment and
// no process runner, so it cannot run the tool (record 0014, promise 4).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Adapter } from "../adapters/adapter.ts";
import {
  applyConfig,
  type Config,
  type ConfiguredStack,
  type IgnoredStack,
  ignoredStacks,
} from "../core/config.ts";
import { loadConfig } from "../core/config-file.ts";
import { planDeploys, queueState, withReadDependencies } from "../core/dependencies.ts";
import {
  type DeployFact,
  deployFacts,
  deploymentPayload,
  deploymentTask,
  HANDED_ON_DESCRIPTION,
  lastDeployedCommit,
  mergePayload,
  readDeploymentPayload,
  taskStackId,
} from "../core/deployment.ts";
import {
  type Tick as BodyTick,
  HISTORY_PAGE_SIZE,
  type NobodyReason,
  nameTickers,
  type Ticker,
  ticksIn,
} from "../core/edit-history.ts";
import { type MergeMethod, mergeMethod, NOT_QUALIFIED, qualify } from "../core/merge-and-deploy.ts";
import { renovateMergeSetting } from "../core/renovate-config.ts";
import { capDeploys, type MatrixEntry, matrixOutput } from "../core/resolve.ts";
import { stackId } from "../core/stack.ts";
import { type AttributionSource, attributionSource } from "../github/attribution.ts";
import { findDashboard, isBotIssueWithRootMarker } from "../github/dashboard.ts";
import { readDeploymentRecords, settleEndedRuns } from "../github/deployments.ts";
import { editedIssue } from "../github/event.ts";
import type { JobLog } from "../github/job-log.ts";
import type { GitHubPort } from "../github/port.ts";
import { commentOnRefusedTicks, judgeTicks, type Tick, type TickOutcome } from "../github/ticks.ts";
import type { WorkflowRef } from "../github/workflow-ref.ts";
import { writeBody } from "../github/write-loop.ts";
import { BODY_LIMIT, type BudgetOptions, fitBody } from "../render/budget.ts";
import { type ClearTickOptions, clearTick } from "../render/clear-tick.ts";
import { logGroupTitle } from "../render/log-text.ts";
import {
  MARKER_VERSION,
  type ParsedMerge,
  type ParsedRow,
  parseDashboard,
} from "../render/marker.ts";
import { clearMergeTick, type MergeNote } from "../render/merge-row.ts";
import type { RefusedTick } from "../render/refused-ticks.ts";
import { type DeployingRow, plural, type Row } from "../render/row.ts";

export interface ResolveContext {
  // The directory of the checked-out repo.
  root: string;
  // Discovery reads files only and never asks a backend (record 0014).
  adapter: Pick<Adapter, "discover">;
  github: GitHubPort;
  log: JobLog;
  // `https://github.com/<owner>/<repo>`.
  repoUrl: string;
  runId: string;
  // The commit the job checked out: the head of the default branch, because an
  // `issues` event always runs there (record 0003).
  sha: string;
  actionRef: string;
  // The payload of the event that woke the job. Only a wake-up (record 0025).
  event: unknown;
  // The workflow the rescan box dispatches, or nothing when the runner did not
  // say which one this is.
  workflow: WorkflowRef | undefined;
  setOutput: (name: string, value: string) => void;
  // Only a test has a reason to set this.
  limits?: { body?: BudgetOptions } | undefined;
}

// `resolve` always sets `matrix`, to `[]` when it started nothing (record
// 0035), also when it fails before it got that far.
export async function resolve(context: ResolveContext): Promise<void> {
  let handedOn = false;
  const handOn = (entries: readonly MatrixEntry[]) => {
    context.setOutput("matrix", matrixOutput(entries));
    handedOn = true;
  };
  try {
    await resolveTicks(context, handOn);
  } finally {
    if (!handedOn) handOn([]);
  }
}

// How often the body and the history are read when the body moved between
// the read and the walk (record 0025). Every edit by a person wakes another
// run, so a tick that is still moving then is that run's.
const MAX_READS = 3;

interface NamedTick {
  tick: BodyTick;
  ticker: Ticker;
}

// A deploy this run started: the record exists. With `behind` it is queued
// behind those stacks and not handed on (record 0056).
interface Started {
  stackId: string;
  environment: string;
  deployment: number;
  ticker: string;
  behind?: string[] | undefined;
}

// A box this run clears, on the row that is still ticked at this hash.
interface Clear {
  hash: string;
  // With the note that asks for a fresh tick (record 0025), or the one that
  // says deploys are turned off (record 0051). A refused tick gets a comment
  // instead (record 0018).
  note: ClearTickOptions["note"];
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function resolveTicks(
  context: ResolveContext,
  handOn: (entries: readonly MatrixEntry[]) => void,
): Promise<void> {
  const { log, github } = context;

  // The cheap check (record 0017): the edited issue is judged from the payload
  // alone, green and without an API call, because `issues.edited` fires for
  // every issue of the repo. The half that needs no config comes first, so a
  // broken `sluiceway.yaml` never turns an edit of an ordinary issue red.
  const issue = editedIssue(context.event);
  if (!issue) {
    await startQueued(context, handOn);
    return;
  }
  const notTheDashboard = `Issue #${issue.number} is not the open dashboard. Nothing to do.`;
  if (issue.state !== "open" || !isBotIssueWithRootMarker(issue)) {
    log.info(notTheDashboard);
    return;
  }
  const config = loadConfig(context.root);
  if (!issue.labels.includes(config.dashboard.label)) {
    log.info(notTheDashboard);
    return;
  }

  // Nothing else is taken from the payload (record 0025). The body and the
  // history come from one query, so they describe one moment, and the run acts
  // on every ticked row it finds, whoever's edit woke it.
  let stacks: Map<string, ConfiguredStack> | undefined;
  let ignored: IgnoredStack[] = [];
  let named: NamedTick[] = [];
  let liveRows: ParsedRow[] = [];
  for (let reads = 1; ; reads++) {
    const first = await github.readEditHistory(issue.number, {
      size: HISTORY_PAGE_SIZE,
      after: undefined,
    });
    const { root, rows } = parseDashboard(first.body);
    liveRows = rows;
    if (!root) {
      log.info(`The body of #${issue.number} has no root marker any more. Nothing to do.`);
      return;
    }
    if (root.version !== MARKER_VERSION) {
      // A body of another version is not touched (record 0009). The scan
      // writes it again in its own version and clears the ticks on it.
      log.info(
        `The dashboard is written in marker version ${root.version} and this is version ${MARKER_VERSION}. Its body is left alone, and a full scan is started to write it again.`,
      );
      await dispatchScan(context);
      return;
    }
    const ticks = ticksIn(first.body);
    if (ticks.length === 0) {
      log.info("No box is ticked. Nothing to do.");
      return;
    }

    // Discovery reads files only (record 0014). A stack that no file names
    // does not exist, and a tick on its row is left for the scan, which drops
    // the row.
    if (!stacks) ({ stacks, ignored } = await discover(context, config));
    const known = ticks.filter((tick) => {
      if (tick.kind === "rescan" || stacks?.has(tick.stackId)) return true;
      log.info(
        `${logGroupTitle(tick.stackId)} is ticked, and discovery knows no such stack. Left alone.`,
      );
      return false;
    });
    const tickers = await nameTickers(known, (after) =>
      after === undefined
        ? Promise.resolve(first)
        : github.readEditHistory(issue.number, { size: HISTORY_PAGE_SIZE, after }),
    );
    named = known.flatMap((tick, index) => {
      const ticker = tickers[index];
      return ticker ? [{ tick, ticker }] : [];
    });
    const moved = named.some(
      ({ ticker }) => !ticker.named && ticker.reason === "not-in-newest-entry",
    );
    if (!moved || reads === MAX_READS) break;
    log.info("The body moved between the read and the walk. Reading again.");
  }

  // What the rows say the previews read from stack references (record 0059).
  if (stacks) stacks = withRowDependencies(context, stacks, liveRows);

  // A stack with an open deployment is taken (record 0003): a second tick for
  // it is dropped, whoever made it.
  const hashes = new Map<string, string>();
  // The ticked rows whose hash covers drift (record 0055).
  const drifted = new Set<string>();
  for (const { tick } of named) {
    if (tick.kind !== "row") continue;
    hashes.set(tick.stackId, tick.hash);
    if (tick.drift) drifted.add(tick.stackId);
  }
  // A merge tick ends in a deploy of its stack, so it is taken the same way
  // (record 0054).
  const mergeTicks = new Map<number, MergeTick>();
  for (const { tick } of named) if (tick.kind === "merge") mergeTicks.set(tick.pr, tick);
  const tickedIds = new Set([
    ...hashes.keys(),
    ...[...mergeTicks.values()].map((one) => one.stackId),
  ]);
  const ticked = [...tickedIds].flatMap((id) => stacks?.get(id) ?? []);
  // The stacks they depend on too: a tick waits behind one that is deploying
  // (record 0056).
  const dependencies = ticked.flatMap(({ dependsOn }) =>
    (dependsOn ?? []).flatMap((id) => stacks?.get(id) ?? []),
  );
  const open = await openDeployments(context, [...ticked, ...dependencies]);

  const dropped: string[] = [];
  const clear = new Map<string, Clear>();
  // Merge rows whose box this run clears, by pull request number, with the
  // note of a tick cleared without a comment (record 0064).
  const clearMerges = new Map<number, MergeNote | undefined>();
  const toJudge: Tick[] = [];
  // The rescan box sits outside the row blocks, so it is cleared by writing
  // the body again.
  let rescanHandled = false;
  for (const { tick, ticker } of named) {
    const name = tickName(tick);
    const fact = tick.kind === "rescan" ? undefined : open.get(tick.stackId);
    if (tick.kind === "merge" && (fact || !config.deploys)) {
      // Nothing is merged for a stack that is taken, or while deploys are off
      // (record 0054). Nobody gets a comment, so the row gets a note (record
      // 0064), and the job log says more.
      log.info(
        fact
          ? `${name} is ticked, and the stack already has an open deployment, ticked by ${fact.ticker} in run ${fact.run}. Nothing is merged and the box is cleared. Tick it again once that deploy is over.`
          : `${name} is ticked, and deploys are turned off in sluiceway.yaml (deploys: false). Nothing is merged and the box is cleared.`,
      );
      clearMerges.set(tick.pr, fact ? "deploying" : "deploys-off");
    } else if (tick.kind === "row" && fact) {
      dropped.push(tick.stackId);
      log.info(
        `${name} is ticked and already has an open deployment, ticked by ${fact.ticker} in run ${fact.run}. The tick is dropped.`,
      );
    } else if (tick.kind === "row" && !config.deploys) {
      // One reviewed line stops every deploy (record 0051). Nothing could go
      // out whoever ticked, so nobody is looked up and nobody is mentioned.
      log.info(
        `${name} is ticked, and deploys are turned off in sluiceway.yaml (deploys: false). The box is cleared.`,
      );
      clear.set(tick.stackId, { hash: tick.hash, note: "deploys-off" });
    } else if (ticker.named) {
      const stack = tick.kind === "rescan" ? undefined : stacks?.get(tick.stackId);
      toJudge.push({
        target: !stack
          ? { kind: "rescan" }
          : tick.kind === "merge"
            ? { kind: "merge", pr: tick.pr, stackId: stackId(stack.stack), rule: stack.tickers }
            : { kind: "stack", stackId: stackId(stack.stack), rule: stack.tickers },
        editor: ticker.editor,
      });
    } else if (ticker.reason === "not-in-newest-entry") {
      log.info(`${name} is ticked in a body that kept moving. Left for the run that edit woke.`);
    } else {
      // Nobody certain to mention, so no comment, and the job stays green
      // (record 0025).
      log.info(
        `${name} is ticked and the edit history names nobody for it (${NOBODY[ticker.reason]}). The box is cleared.`,
      );
      if (tick.kind === "row") clear.set(tick.stackId, { hash: tick.hash, note: true });
      else if (tick.kind === "merge") clearMerges.set(tick.pr, "orphan");
      else rescanHandled = true;
    }
  }

  const outcomes = await judgeTicks(github, toJudge);
  const allowed: { stackId: string; ticker: string }[] = [];
  const allowedMerges: { tick: MergeTick; ticker: string }[] = [];
  let rescan = false;
  for (const outcome of outcomes) {
    const { target, editor } = outcome.tick;
    const name = targetName(target);
    if (outcome.outcome === "not-a-person") {
      // No comment and no row swap. The next scan clears it as an orphan tick
      // (record 0018).
      log.info(
        `${name} was ticked by ${editor.login || "nobody"}, who is not a person. Left alone.`,
      );
      continue;
    }
    if (outcome.outcome === "allowed") {
      log.info(`${name} was ticked by ${editor.login}.`);
      if (target.kind === "stack") allowed.push({ stackId: target.stackId, ticker: editor.login });
      else if (target.kind === "merge") {
        const tick = mergeTicks.get(target.pr);
        if (tick) allowedMerges.push({ tick, ticker: editor.login });
      } else rescan = true;
    } else {
      log.info(
        outcome.outcome === "refused"
          ? `${name} was ticked by ${editor.login}, who may not tick it (${outcome.reason}). The box is cleared.`
          : `${name} was ticked by ${editor.login}, and GitHub gave no answer about their access: ${message(outcome.error)}. The box is cleared.`,
      );
      const hash = target.kind === "stack" ? hashes.get(target.stackId) : undefined;
      if (target.kind === "stack" && hash !== undefined) {
        clear.set(target.stackId, { hash, note: false });
      }
      if (target.kind === "merge") clearMerges.set(target.pr, undefined);
    }
    if (target.kind === "rescan") rescanHandled = true;
  }

  // A workflow run holds at most 256 matrix jobs (record 0035).
  const { start, over } = capDeploys(allowed);
  for (const { stackId: id } of over) {
    const hash = hashes.get(id);
    if (hash !== undefined) clear.set(id, { hash, note: true });
  }
  if (over.length > 0) {
    log.info(
      `One run starts at most ${start.length} deploys. ${plural(over.length, "tick")} beyond that ${over.length === 1 ? "is" : "are"} cleared and ${over.length === 1 ? "needs" : "need"} a fresh tick.`,
    );
  }

  // Dependencies (record 0056): a tick whose dependency has a change waiting
  // that nobody ticked starts nothing, and ticks in one chain go out one layer
  // at a time. The rest get a queued record that waits behind the stacks
  // before them, and a later `resolve` starts them.
  const plan = planDeploys({
    allowed: start.map(({ stackId: id }) => id),
    dependsOn: new Map(
      [...(stacks?.values() ?? [])].map((one) => [stackId(one.stack), one.dependsOn ?? []]),
    ),
    pending: new Set(
      liveRows.flatMap((row) => (row.known && row.state === "pending" ? [row.stackId] : [])),
    ),
    open: new Set(open.keys()),
  });
  for (const { stackId: id, waitingOn } of plan.refused) {
    const one = waitingOn.length === 1;
    log.info(
      `${logGroupTitle(id)} is ticked, and it depends on ${waitingOn.map(logGroupTitle).join(" and ")}, which ${one ? "has a change" : "have changes"} waiting and ${one ? "is" : "are"} not ticked. The box is cleared.`,
    );
    const hash = hashes.get(id);
    if (hash !== undefined) clear.set(id, { hash, note: { dependsOn: waitingOn } });
  }
  const tickers = new Map(start.map(({ stackId: id, ticker }) => [id, ticker]));
  const toCreate = [
    ...plan.start.map((id) => ({ id, behind: undefined })),
    ...plan.queued.map(({ stackId: id, behind }) => ({ id, behind })),
  ];

  // From here on a failure does not stop the run: what was started is handed
  // on and shown first, and the job goes red at the end.
  const failures: string[] = [];

  // The record comes first, as `queued` (record 0003): from now on the stack
  // is taken. A record without a status is an open deployment too, so one
  // whose status failed is still handed on.
  const started: Started[] = [];
  for (const { id, behind } of toCreate) {
    const stack = stacks?.get(id);
    const hash = hashes.get(id);
    const ticker = tickers.get(id);
    if (!stack || hash === undefined || ticker === undefined) continue;
    try {
      const record = await github.createDeployment({
        sha: context.sha,
        task: deploymentTask(id),
        environment: stack.environment,
        payload: deploymentPayload({
          hash,
          ticker,
          run: context.runId,
          behind,
          ...(drifted.has(id) ? { drift: true } : {}),
        }),
      });
      started.push({
        stackId: id,
        environment: stack.environment,
        deployment: record.id,
        ticker,
        behind,
      });
      await github.createDeploymentStatus(record.id, { state: "queued", logUrl: runUrl(context) });
      log.info(
        behind
          ? `${logGroupTitle(id)}: deployment record ${record.id} is queued behind ${behind.map(logGroupTitle).join(" and ")}. A later run starts it once ${behind.length === 1 ? "that stack" : "those stacks"} went out.`
          : `${logGroupTitle(id)}: deployment record ${record.id} is queued.`,
      );
    } catch (error) {
      failures.push(
        `The deployment record of ${logGroupTitle(id)} could not be written: ${message(error)}. The resolve job needs the permission \`deployments: write\` (record 0003). No further deploy was started, and the ticks that are left stay for the next run.`,
      );
      break;
    }
  }

  // Directly after the records and before the body write, so a failed body
  // write does not lose the hand-off (record 0035).
  handOn(
    started.flatMap(({ stackId: stack, environment, deployment, behind }) =>
      behind ? [] : [{ stack, environment, deployment }],
    ),
  );

  // The merges come after the hand-off, so a merge that fails never costs a
  // deploy that was already started (record 0054).
  // A merged change deploys on its own, so it waits for nothing: a stack whose
  // dependency has a change waiting or deploying is not merged for (record
  // 0056).
  const pendingIds = new Set(
    liveRows.flatMap((row) => (row.known && row.state === "pending" ? [row.stackId] : [])),
  );
  const waitingOn = (id: string): string[] =>
    (stacks?.get(id)?.dependsOn ?? []).filter((one) => pendingIds.has(one) || open.has(one));
  const merging = await mergeAll(context, config, stacks, allowedMerges, waitingOn);
  if (merging.failure !== undefined) failures.push(merging.failure);
  for (const pr of merging.cleared) clearMerges.set(pr, undefined);
  const merged = merging.merged;

  // One full scan for the rescan box and for every merge: a merge made with
  // the workflow token starts no run of its push (record 0017), and the scan
  // is what hands the merged change to `apply` (record 0054).
  if (rescan || merging.mergedPrs.size > 0) {
    try {
      await dispatchScan(context);
      log.info(
        rescan
          ? "Started a full scan for the rescan box."
          : "Started a full scan, which previews the merged change and hands it to apply.",
      );
    } catch (error) {
      failures.push(message(error));
    }
  }

  // The body write comes before the comment. The comment says the box is
  // cleared, and it is only written once that is true. When the write fails
  // the boxes stay ticked, and the next run refuses them again and says so
  // then.
  let written = true;
  if (
    started.length > 0 ||
    dropped.length > 0 ||
    clear.size > 0 ||
    rescanHandled ||
    clearMerges.size > 0 ||
    merging.mergedPrs.size > 0
  ) {
    try {
      const attribution = new Map<string, AttributionSource>();
      const result = await writeBody(github, issue.number, (liveBody) =>
        swapRows(
          context,
          config,
          [...(stacks?.values() ?? [])],
          ignored,
          liveBody,
          {
            started: [...started, ...merged],
            dropped,
            clear,
            merges: { merged: merging.mergedPrs, clear: clearMerges },
          },
          attribution,
        ),
      );
      log.info(
        result.written
          ? `Wrote the dashboard (#${issue.number}).`
          : `The dashboard (#${issue.number}) already says all of this. Nothing was written.`,
      );
    } catch (error) {
      written = false;
      failures.push(message(error));
    }
  }
  if (written) {
    try {
      await commentOnRefusedTicks(github, issue.number, outcomes, merging.problems);
    } catch (error) {
      failures.push(`The comment about the refused ticks could not be written: ${message(error)}.`);
    }
  }

  // An unverified tick fails closed and turns the job red (record 0018).
  const unverified = outcomes.filter(({ outcome }) => outcome === "unverified");
  if (unverified.length > 0) failures.push(unverifiedMessage(unverified));
  if (failures.length > 0) throw new Error(failures.join("\n"));
}

type MergeTick = Extract<BodyTick, { kind: "merge" }>;

function tickName(tick: BodyTick): string {
  if (tick.kind === "row") return logGroupTitle(tick.stackId);
  if (tick.kind === "merge") return `The merge of #${tick.pr} for ${logGroupTitle(tick.stackId)}`;
  return "The rescan box";
}

function targetName(target: Tick["target"]): string {
  if (target.kind === "stack") return logGroupTitle(target.stackId);
  if (target.kind === "merge") {
    return `The merge of #${target.pr} for ${logGroupTitle(target.stackId)}`;
  }
  return "The rescan box";
}

// What the merges of one run came to (record 0054).
interface Merging {
  // The records that deploy after a merge, one per merged pull request whose
  // record could be written. They go on the dashboard as deploying rows, and
  // not in the matrix: the scan after the merge hands them on.
  merged: Started[];
  mergedPrs: Set<number>;
  // Allowed ticks that started nothing because of their pull request. Their
  // boxes are cleared and the comment says why.
  cleared: number[];
  problems: RefusedTick[];
  // Why the job goes red. The boxes of the merges not tried stay ticked for
  // the next run.
  failure?: string | undefined;
}

// The method Renovate would use, read from its config in the checkout as
// Renovate reads it on GitHub (record 0064). The job log says where it came
// from, and names the presets that were not read.
function renovateStrategyOf(context: ResolveContext): string | undefined {
  const [owner = "", repo = ""] = new URL(context.repoUrl).pathname.split("/").filter(Boolean);
  const setting = renovateMergeSetting(
    (path) => {
      try {
        return readFileSync(join(context.root, path), "utf8");
      } catch {
        return undefined;
      }
    },
    { owner, repo },
  );
  const one = setting.unread.length === 1;
  const unread =
    setting.unread.length === 0
      ? ""
      : ` The ${one ? "preset" : "presets"} ${setting.unread.map(logGroupTitle).join(" and ")} ${one ? "was" : "were"} not read: only a preset in a file of this repo is.`;
  const none =
    setting.file === undefined
      ? "No Renovate config sets automergeStrategy"
      : `Renovate's config ${logGroupTitle(setting.file)} sets no automergeStrategy`;
  context.log.info(
    setting.strategy === undefined
      ? `${none}, so the method is the first the repo allows of squash, merge and rebase, as Renovate picks it.${unread}`
      : `Renovate's config is ${logGroupTitle(setting.file ?? "")}, and it sets automergeStrategy to ${logGroupTitle(setting.strategy)}.${unread}`,
  );
  return setting.strategy;
}

// Judges each allowed merge tick against the live pull request again, merges
// the ones that still qualify at the commit that was ticked, and opens a
// record for each merge (record 0054). The pull request is read again because
// the marker is text a person can edit, and checks and files may have
// changed since the scan.
async function mergeAll(
  context: ResolveContext,
  config: Config,
  stacks: Map<string, ConfiguredStack> | undefined,
  ticks: readonly { tick: MergeTick; ticker: string }[],
  waitingOn: (stackId: string) => string[],
): Promise<Merging> {
  const { github, log } = context;
  const result: Merging = { merged: [], mergedPrs: new Set(), cleared: [], problems: [] };
  if (ticks.length === 0 || !stacks) return result;

  let open: Awaited<ReturnType<GitHubPort["listOpenPullRequests"]>>;
  let method: MergeMethod | undefined;
  try {
    open = await github.listOpenPullRequests();
  } catch (error) {
    result.failure = `The open pull requests could not be read: ${message(error)}. The resolve job needs the permission \`pull-requests: read\` (record 0054). Nothing was merged, and the boxes stay ticked for the next run.`;
    return result;
  }
  try {
    method = mergeMethod(await github.allowedMergeMethods(), renovateStrategyOf(context));
  } catch (error) {
    result.failure = `The merge settings of the repo could not be read: ${message(error)}. The resolve job needs the permission \`contents: write\` to merge (record 0054). Nothing was merged, and the boxes stay ticked for the next run.`;
    return result;
  }

  const claimants = [...stacks.values()].map(({ stack, inputs }) => ({
    id: stackId(stack),
    path: stack.path,
    inputs,
  }));
  const sorted = [...ticks].sort((a, b) => a.tick.pr - b.tick.pr);
  for (const { tick, ticker } of sorted) {
    const name = tickName(tick);
    const target = {
      kind: "merge" as const,
      pr: tick.pr,
      stackId: tick.stackId,
      rule: "write" as const,
    };
    const refuse = (reason: RefusedTick["reason"], detail?: string, waitsOn?: string[]) => {
      result.cleared.push(tick.pr);
      result.problems.push({ target, login: ticker, reason, detail, waitsOn });
    };
    const waits = waitingOn(tick.stackId);
    if (waits.length > 0) {
      log.info(
        `${name} was ticked by ${ticker}, and the stack depends on ${waits.map(logGroupTitle).join(" and ")}, which ${waits.length === 1 ? "has a change" : "have changes"} waiting. Nothing is merged.`,
      );
      refuse("waits-on", undefined, waits);
      continue;
    }
    const pullRequest = open.pullRequests.find(({ number }) => number === tick.pr);
    if (!pullRequest) {
      log.info(`${name} was ticked by ${ticker}, and the pull request is not open any more.`);
      refuse("not-qualified", "it is not open any more");
      continue;
    }
    if (pullRequest.head !== tick.head) {
      log.info(
        `${name} was ticked by ${ticker}, and the pull request has a new head commit since.`,
      );
      refuse("head-moved");
      continue;
    }
    const qualified = qualify(pullRequest, {
      authors: config.mergeAndDeploy.authors,
      defaultBranch: open.defaultBranch,
      stacks: claimants,
      unrelated: config.scan.unrelated,
    });
    const why = !qualified.qualifies
      ? NOT_QUALIFIED[qualified.why]
      : qualified.stackId !== tick.stackId
        ? "its files belong to another stack"
        : undefined;
    if (why !== undefined) {
      log.info(
        `${name} was ticked by ${ticker}, and the pull request no longer qualifies: ${why}.`,
      );
      refuse("not-qualified", why);
      continue;
    }
    if (method === undefined) {
      log.info(`${name} was ticked by ${ticker}, and the repo allows no merge method.`);
      refuse("merge-refused", "the repository allows no merge method");
      continue;
    }

    let answer: Awaited<ReturnType<GitHubPort["mergePullRequest"]>>;
    try {
      answer = await github.mergePullRequest(tick.pr, { head: tick.head, method });
    } catch (error) {
      result.failure = `#${tick.pr} could not be merged: ${message(error)}. The resolve job needs the permission \`contents: write\` to merge (record 0054). Nothing more was merged, and the boxes that are left stay ticked for the next run.`;
      return result;
    }
    if (!answer.merged) {
      log.info(
        `${name} was ticked by ${ticker}, and GitHub refused the merge (${answer.status}): ${answer.message}`,
      );
      if (answer.status === 409) refuse("head-moved");
      else refuse("merge-refused", answer.message);
      continue;
    }
    log.info(
      `${name} was ticked by ${ticker} and is merged (${method}) as ${answer.sha.slice(0, 7)}.`,
    );
    result.mergedPrs.add(tick.pr);

    // The record is written on the merge commit and waits for the scan after
    // the merge. It is not handed to `apply`: nothing was previewed yet.
    const stack = stacks.get(tick.stackId);
    if (!stack) continue;
    try {
      const record = await github.createDeployment({
        sha: answer.sha,
        task: deploymentTask(tick.stackId),
        environment: stack.environment,
        payload: mergePayload({ ticker, run: context.runId, merge: tick.pr }),
      });
      result.merged.push({
        stackId: tick.stackId,
        environment: stack.environment,
        deployment: record.id,
        ticker,
      });
      await github.createDeploymentStatus(record.id, { state: "queued", logUrl: runUrl(context) });
      log.info(
        `${logGroupTitle(tick.stackId)}: deployment record ${record.id} is queued and deploys after the scan of the merge.`,
      );
    } catch (error) {
      result.failure = `#${tick.pr} is merged, and the deployment record of ${logGroupTitle(tick.stackId)} could not be written: ${message(error)}. The resolve job needs the permission \`deployments: write\` (record 0003). Nothing deploys for it: the scan shows the stack as pending, and a tick on its row deploys it. Nothing more was merged.`;
      return result;
    }
  }
  return result;
}

const NOBODY: Record<NobodyReason, string> = {
  "entry-without-body": "an entry of the edit history has no body",
  "end-of-history": "the tick is older than the edit history GitHub keeps",
  "not-in-newest-entry": "the body kept moving",
};

function runUrl(context: ResolveContext): string {
  return `${context.repoUrl}/actions/runs/${context.runId}`;
}

function unverifiedMessage(unverified: TickOutcome[]): string {
  const logins = [...new Set(unverified.map(({ tick }) => tick.editor.login))].join(", ");
  return `GitHub gave no answer about the access of ${logins}, so ${plural(unverified.length, "tick")} could not be verified. Nothing was deployed for ${unverified.length === 1 ? "it" : "them"}, and the comment on the dashboard asks for a fresh tick (record 0018).`;
}

// The stacks that exist for Sluiceway, by id, and the ones an `ignore` entry
// with a reason leaves out, which the body lists (record 0051).
interface Discovered {
  stacks: Map<string, ConfiguredStack>;
  ignored: IgnoredStack[];
}

async function discover(context: ResolveContext, config: Config): Promise<Discovered> {
  const found = await context.adapter.discover(context.root, config);
  return {
    stacks: new Map(applyConfig(config, found).map((stack) => [stackId(stack.stack), stack])),
    ignored: ignoredStacks(config, found),
  };
}

// The rescan box, and a body of another version, start a full scan by
// dispatching this same workflow (records 0009 and 0017).
async function dispatchScan(context: ResolveContext): Promise<void> {
  if (!context.workflow) {
    throw new Error(
      "A full scan could not be started: GITHUB_WORKFLOW_REF is not set, so this job does not know which workflow it belongs to.",
    );
  }
  try {
    await context.github.dispatchWorkflow(context.workflow.file, context.workflow.ref);
  } catch (error) {
    throw new Error(
      `A full scan could not be started: ${message(error)}. The resolve job needs the permission \`actions: write\`, and the workflow (${context.workflow.file}) needs a \`workflow_dispatch\` trigger that runs the scan (record 0017).`,
    );
  }
}

type OpenDeployment = Extract<DeployFact, { kind: "open" }>;

async function readRecords(
  context: ResolveContext,
  environments: readonly string[],
  fallBack: readonly ConfiguredStack[],
) {
  try {
    return await readDeploymentRecords(
      context.github,
      environments,
      fallBack.map(({ stack, environment }) => ({ stackId: stackId(stack), environment })),
    );
  } catch (error) {
    throw new Error(
      `The deployment records could not be read: ${message(error)}. The resolve job needs the permissions \`deployments: write\` and \`actions: read\` next to \`contents: read\` and \`issues: write\` (record 0003).`,
    );
  }
}

// The open deployments of the ticked stacks. One whose run is over gets its
// result here (record 0003), so the fresh tick on that stack is not dropped
// for a deploy that will never report.
async function openDeployments(
  context: ResolveContext,
  ticked: readonly ConfiguredStack[],
): Promise<Map<string, OpenDeployment>> {
  if (ticked.length === 0) return new Map();
  const ids = new Set(ticked.map(({ stack }) => stackId(stack)));
  const records = await readRecords(
    context,
    ticked.map(({ environment }) => environment),
    ticked,
  );
  const theirs = records.filter((record) => ids.has(taskStackId(record.task) ?? ""));
  const settled = await settleEndedRuns(context.github, theirs, context.repoUrl);
  for (const id of settled.stackIds) {
    context.log.info(
      `Ended the open deployment of ${logGroupTitle(id)}: its run is over and never reported a result.`,
    );
  }
  const open = new Map<string, OpenDeployment>();
  for (const [id, fact] of deployFacts(settled.records).byStack) {
    if (fact.kind === "open") open.set(id, fact);
  }
  return open;
}

interface Swap {
  started: readonly Started[];
  dropped: readonly string[];
  clear: ReadonlyMap<string, Clear>;
  // The merge rows of pull requests this run merged go, and the ones whose
  // box it clears stay without their tick (record 0054).
  merges?:
    | { merged: ReadonlySet<number>; clear: ReadonlyMap<number, MergeNote | undefined> }
    | undefined;
}

// The builder of the write loop (record 0004): swap this run's own row blocks,
// carry every other block through byte for byte, and regenerate everything
// around the blocks with the renderer the scan uses (record 0009). It runs
// again on every try, so it does its own late read of the deployment records.
async function swapRows(
  context: ResolveContext,
  config: Config,
  stacks: readonly ConfiguredStack[],
  ignored: readonly IgnoredStack[],
  liveBody: string,
  swap: Swap,
  // By `scan-sha`, so the walk is made once however many tries the write takes.
  attribution: Map<string, AttributionSource>,
): Promise<string> {
  const live = parseDashboard(liveBody);
  const root = live.root;
  if (
    root?.version !== MARKER_VERSION ||
    root.scanSha === undefined ||
    root.scanRun === undefined ||
    root.scanAt === undefined
  ) {
    // Not a body this version wrote, so it is not touched (record 0009). The
    // next scan writes it again, and the deployment records hold the truth.
    context.log.info("The live body is not one this version can write again. It is left alone.");
    return liveBody;
  }

  const droppedStacks = stacks.filter(({ stack }) => swap.dropped.includes(stackId(stack)));
  const facts = deployFacts(
    await readRecords(
      context,
      stacks.map(({ environment }) => environment),
      droppedStacks,
    ),
  );

  // A row's text is never parsed, so the line of a deploying row is worked
  // out again, up to the commit the live body was scanned at (record 0026).
  // It needs the workflow token only, and it never blocks.
  const source =
    attribution.get(root.scanSha) ??
    attributionSource(
      context.github,
      {
        stacks: stacks.map(({ stack, inputs }) => ({
          id: stackId(stack),
          path: stack.path,
          inputs,
        })),
        unrelated: config.scan.unrelated,
        repoUrl: context.repoUrl,
        scanSha: root.scanSha,
      },
      (why) =>
        context.log.info(
          `Attribution was left off the rows: ${why}. It only explains a row, so nothing else changes (record 0026).`,
        ),
    );
  attribution.set(root.scanSha, source);
  const deployingIds = [
    ...swap.started.map((one) => one.stackId),
    ...swap.dropped.filter((id) => facts.byStack.get(id)?.kind === "open"),
  ];
  const lines = await source.attribute(
    new Map(deployingIds.map((id) => [id, lastDeployedCommit(facts, id)])),
  );

  const startedBy = new Map(swap.started.map((one) => [one.stackId, one]));
  const mine = (one: Started, destroys: number): DeployingRow => ({
    state: "deploying",
    stackId: one.stackId,
    ticker: one.ticker,
    runUrl: runUrl(context),
    // The record is `queued` until `apply` takes it.
    waiting: true,
    destroys,
    attribution: lines.get(one.stackId)?.lines,
    behind: one.behind,
  });

  const rows: Row[] = [];
  const carried: ParsedRow[] = [];
  const seen = new Set<string>();
  for (const row of live.rows) {
    // Of two blocks for one stack the first counts, as it does for the walk.
    const first = !seen.has(row.stackId);
    seen.add(row.stackId);
    const one = startedBy.get(row.stackId);
    const fact = facts.byStack.get(row.stackId);
    const wanted = swap.clear.get(row.stackId);
    // `destroys` is copied from the old marker, because the header needs it
    // and the row's text is never read (record 0031).
    const destroys = row.known ? row.destroys : 0;
    if (!first || !row.known) {
      carried.push(row);
    } else if (one) {
      rows.push(mine(one, destroys));
    } else if (
      swap.dropped.includes(row.stackId) &&
      fact?.kind === "open" &&
      row.state !== "deploying"
    ) {
      // A deploying row that a lost write turned back is repaired by the tick
      // that is dropped for it (record 0004).
      rows.push({
        state: "deploying",
        stackId: row.stackId,
        ticker: fact.ticker,
        runUrl: `${context.repoUrl}/actions/runs/${fact.run}`,
        waiting: fact.waiting,
        destroys,
        attribution: lines.get(row.stackId)?.lines,
        behind: fact.behind,
      });
    } else if (wanted && row.ticked && row.hash === wanted.hash) {
      carried.push(clearTick(row, { note: wanted.note }));
    } else {
      carried.push(row);
    }
  }
  // A row that was deleted by hand since the tick: the stack is deploying all
  // the same, and every deploying stack has a row.
  for (const one of swap.started) if (!seen.has(one.stackId)) rows.push(mine(one, 0));

  // Every other merge row is carried as it is. Of two lines for one pull
  // request the first counts.
  const merges: ParsedMerge[] = [];
  for (const merge of live.merges) {
    if (swap.merges?.merged.has(merge.pr) || merges.some((one) => one.pr === merge.pr)) continue;
    merges.push(
      swap.merges?.clear.has(merge.pr)
        ? clearMergeTick(merge, { note: swap.merges.clear.get(merge.pr) })
        : merge,
    );
  }

  const fitted = fitBody(
    {
      root: {
        scanSha: root.scanSha,
        scanRun: root.scanRun,
        scanAt: root.scanAt,
        fullScanAt: root.fullScanAt,
        fullScanRun: root.fullScanRun,
      },
      rows,
      carried,
      redact: config.dashboard.redact,
      recentlyDeployed: facts.trail.map(({ stackId: id, ticker, run, at, result, reason }) => ({
        stackId: id,
        result,
        reason,
        ticker,
        at,
        runUrl: `${context.repoUrl}/actions/runs/${run}`,
      })),
      repoUrl: context.repoUrl,
      actionRef: context.actionRef,
      recentLength: config.dashboard.recentlyDeployed,
      personality: config.dashboard.personality,
      readOnly: config.dashboard.readOnly,
      ignored,
      merges,
    },
    // A writer that swaps rows aims at the hard limit (record 0028).
    { ...context.limits?.body, target: Number.POSITIVE_INFINITY },
  );
  if (!fitted.fits) {
    throw new Error(
      `With these rows swapped the dashboard body is ${fitted.size.toLocaleString("en-US")} characters, and GitHub drops a body over ${BODY_LIMIT.toLocaleString("en-US")} without an error. Nothing was written. The deployment records hold what was started, and the next scan brings the rows in line.`,
    );
  }
  return fitted.body;
}

// `dependsOn: auto` (record 0059): a stack with auto depends on what the file
// names and on what its row says its last preview read from the program's
// stack references. A read that would close a circle is dropped and said.
function withRowDependencies(
  context: ResolveContext,
  stacks: Map<string, ConfiguredStack>,
  rows: readonly ParsedRow[],
): Map<string, ConfiguredStack> {
  const auto = new Set(
    [...stacks.values()].flatMap((one) => (one.dependsOnAuto ? [stackId(one.stack)] : [])),
  );
  if (auto.size === 0) return stacks;
  const read = new Map<string, string[]>();
  for (const row of rows) {
    if (row.known && row.dependsOn && !read.has(row.stackId)) read.set(row.stackId, row.dependsOn);
  }
  const { dependsOn, dropped } = withReadDependencies({
    configured: new Map([...stacks].map(([id, one]) => [id, one.dependsOn ?? []])),
    auto,
    read,
  });
  for (const { stackId: id, dependency } of dropped) {
    context.log.info(
      `${logGroupTitle(id)} reads ${logGroupTitle(dependency)} through its stack references, and ${logGroupTitle(dependency)} already depends on ${logGroupTitle(id)}. That would be a circle, so ${logGroupTitle(id)} does not wait on ${logGroupTitle(dependency)}.`,
    );
  }
  return new Map(
    [...stacks].map(([id, one]) => {
      const ids = dependsOn.get(id) ?? [];
      const { dependsOn: _, ...rest } = one;
      return [id, ids.length === 0 ? rest : { ...rest, dependsOn: ids }];
    }),
  );
}

// A `resolve` that no issue edit started: the one `settle` starts, and any
// other dispatch of the workflow (record 0056). It starts every queued stack
// whose dependencies went out, under a record of its own run, because `apply`
// deploys only a record of the run it is part of (record 0035). The approved
// hash and the ticker go on unchanged: the ticker was checked when the tick
// was made, as for any record `apply` takes. The old record ends as
// `inactive`, "started in a later run", which is no deploy fact.
async function startQueued(
  context: ResolveContext,
  handOn: (entries: readonly MatrixEntry[]) => void,
): Promise<void> {
  const { log, github } = context;
  const config = loadConfig(context.root);
  if (!config.stacks.some(({ dependsOn }) => dependsOn !== undefined)) {
    log.info(
      "The event that started this job is not about an issue, and no stack has dependsOn. Nothing to do.",
    );
    return;
  }
  const { stacks, ignored } = await discover(context, config);
  const all = [...stacks.values()];
  // A stack with auto may depend on any stack, and only its row knows which
  // (record 0059).
  const anyAuto = all.some(({ dependsOnAuto }) => dependsOnAuto);
  const involved = all.filter(
    ({ stack, dependsOn }) =>
      anyAuto ||
      dependsOn !== undefined ||
      all.some((other) => other.dependsOn?.includes(stackId(stack)) === true),
  );
  const settled = await settleEndedRuns(
    github,
    await readRecords(
      context,
      all.map(({ environment }) => environment),
      involved,
    ),
    context.repoUrl,
  );
  for (const id of settled.stackIds) {
    log.info(`Ended the open deployment of ${logGroupTitle(id)}: it can never start now.`);
  }
  const ready = [...deployFacts(settled.records).byStack]
    .flatMap(([id, fact]) =>
      fact.kind === "open" &&
      fact.behind &&
      stacks.has(id) &&
      queueState(fact.behind, settled.records) === "ready"
        ? [{ stackId: id, fact }]
        : [],
    )
    .sort((a, b) => (a.stackId < b.stackId ? -1 : a.stackId > b.stackId ? 1 : 0));
  if (ready.length === 0) {
    log.info("No queued stack is ready to start. Nothing to do.");
    return;
  }

  const failures: string[] = [];
  const started: Started[] = [];
  for (const { stackId: id, fact } of capDeploys(ready).start) {
    const stack = stacks.get(id);
    const old = settled.records.find((record) => record.id === fact.deployment);
    const payload = old && readDeploymentPayload(old.payload);
    if (!stack || !payload) continue;
    try {
      // The new record first: a stack is never without an open one.
      const record = await github.createDeployment({
        sha: context.sha,
        task: deploymentTask(id),
        environment: stack.environment,
        payload: deploymentPayload({
          hash: payload.hash,
          ticker: payload.ticker,
          run: context.runId,
        }),
      });
      started.push({
        stackId: id,
        environment: stack.environment,
        deployment: record.id,
        ticker: payload.ticker,
      });
      await github.createDeploymentStatus(record.id, { state: "queued", logUrl: runUrl(context) });
      await github.createDeploymentStatus(fact.deployment, {
        state: "inactive",
        description: HANDED_ON_DESCRIPTION,
        logUrl: runUrl(context),
      });
      log.info(
        `${logGroupTitle(id)}: what it waited behind went out, so it starts now. Deployment record ${record.id} is queued and takes over from record ${fact.deployment}.`,
      );
    } catch (error) {
      failures.push(
        `The deployment record of ${logGroupTitle(id)} could not be written: ${message(error)}. The resolve job needs the permission \`deployments: write\` (record 0003). No further deploy was started, and the queued stacks that are left wait for the next run.`,
      );
      break;
    }
  }
  handOn(
    started.map(({ stackId: stack, environment, deployment }) => ({
      stack,
      environment,
      deployment,
    })),
  );

  const dashboard =
    started.length > 0 ? await findDashboard(github, config.dashboard.label) : undefined;
  if (dashboard) {
    try {
      const result = await writeBody(github, dashboard.number, (liveBody) =>
        swapRows(
          context,
          config,
          all,
          ignored,
          liveBody,
          { started, dropped: [], clear: new Map() },
          new Map(),
        ),
      );
      log.info(
        result.written
          ? `Wrote the dashboard (#${dashboard.number}).`
          : `The dashboard (#${dashboard.number}) already says all of this. Nothing was written.`,
      );
    } catch (error) {
      failures.push(message(error));
    }
  }
  if (failures.length > 0) throw new Error(failures.join("\n"));
}
