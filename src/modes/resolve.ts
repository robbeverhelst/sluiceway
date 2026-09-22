// The resolve mode (records 0017, 0025 and 0035): the job that an issue edit
// starts. It wires config, discovery, the walk through the edit history, the
// tick rule, the deployment records, the renderers and the GitHub port
// together and holds no rules of its own. It is handed no tool environment and
// no process runner, so it cannot run the tool (record 0014, promise 4).

import type { Adapter } from "../adapters/adapter.ts";
import {
  applyConfig,
  type Config,
  type ConfiguredStack,
  type IgnoredStack,
  ignoredStacks,
} from "../core/config.ts";
import { loadConfig } from "../core/config-file.ts";
import {
  type DeployFact,
  deployFacts,
  deploymentPayload,
  deploymentTask,
  lastDeployedCommit,
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
import { capDeploys, type MatrixEntry, matrixOutput } from "../core/resolve.ts";
import { stackId } from "../core/stack.ts";
import { type AttributionSource, attributionSource } from "../github/attribution.ts";
import { isBotIssueWithRootMarker } from "../github/dashboard.ts";
import { readDeploymentRecords, settleEndedRuns } from "../github/deployments.ts";
import { editedIssue } from "../github/event.ts";
import type { JobLog } from "../github/job-log.ts";
import type { GitHubPort } from "../github/port.ts";
import { commentOnRefusedTicks, judgeTicks, type Tick, type TickOutcome } from "../github/ticks.ts";
import type { WorkflowRef } from "../github/workflow-ref.ts";
import { writeBody } from "../github/write-loop.ts";
import { BODY_LIMIT, type BudgetOptions, fitBody } from "../render/budget.ts";
import { clearTick } from "../render/clear-tick.ts";
import { logGroupTitle } from "../render/log-text.ts";
import { MARKER_VERSION, type ParsedRow, parseDashboard } from "../render/marker.ts";
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

// A deploy this run started: the record exists.
interface Started {
  stackId: string;
  environment: string;
  deployment: number;
  ticker: string;
}

// A box this run clears, on the row that is still ticked at this hash.
interface Clear {
  hash: string;
  // With the note that asks for a fresh tick (record 0025). A refused tick
  // gets a comment instead (record 0018).
  note: boolean;
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
    log.info("The event that started this job is not about an issue. Nothing to do.");
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
  for (let reads = 1; ; reads++) {
    const first = await github.readEditHistory(issue.number, {
      size: HISTORY_PAGE_SIZE,
      after: undefined,
    });
    const { root } = parseDashboard(first.body);
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

  // A stack with an open deployment is taken (record 0003): a second tick for
  // it is dropped, whoever made it.
  const hashes = new Map<string, string>();
  for (const { tick } of named) if (tick.kind === "row") hashes.set(tick.stackId, tick.hash);
  const ticked = [...hashes.keys()].flatMap((id) => stacks?.get(id) ?? []);
  const open = await openDeployments(context, ticked);

  const dropped: string[] = [];
  const clear = new Map<string, Clear>();
  const toJudge: Tick[] = [];
  // The rescan box sits outside the row blocks, so it is cleared by writing
  // the body again.
  let rescanHandled = false;
  for (const { tick, ticker } of named) {
    const name = tick.kind === "row" ? logGroupTitle(tick.stackId) : "The rescan box";
    const fact = tick.kind === "row" ? open.get(tick.stackId) : undefined;
    if (tick.kind === "row" && fact) {
      dropped.push(tick.stackId);
      log.info(
        `${name} is ticked and already has an open deployment, ticked by ${fact.ticker} in run ${fact.run}. The tick is dropped.`,
      );
    } else if (ticker.named) {
      const stack = tick.kind === "row" ? stacks?.get(tick.stackId) : undefined;
      toJudge.push({
        target: stack
          ? { kind: "stack", stackId: stackId(stack.stack), rule: stack.tickers }
          : { kind: "rescan" },
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
      else rescanHandled = true;
    }
  }

  const outcomes = await judgeTicks(github, toJudge);
  const allowed: { stackId: string; ticker: string }[] = [];
  let rescan = false;
  for (const outcome of outcomes) {
    const { target, editor } = outcome.tick;
    const name = target.kind === "stack" ? logGroupTitle(target.stackId) : "The rescan box";
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
      else rescan = true;
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

  // From here on a failure does not stop the run: what was started is handed
  // on and shown first, and the job goes red at the end.
  const failures: string[] = [];

  // The record comes first, as `queued` (record 0003): from now on the stack
  // is taken. A record without a status is an open deployment too, so one
  // whose status failed is still handed on.
  const started: Started[] = [];
  for (const { stackId: id, ticker } of start) {
    const stack = stacks?.get(id);
    const hash = hashes.get(id);
    if (!stack || hash === undefined) continue;
    try {
      const record = await github.createDeployment({
        sha: context.sha,
        task: deploymentTask(id),
        environment: stack.environment,
        payload: deploymentPayload({ hash, ticker, run: context.runId }),
      });
      started.push({ stackId: id, environment: stack.environment, deployment: record.id, ticker });
      await github.createDeploymentStatus(record.id, { state: "queued", logUrl: runUrl(context) });
      log.info(`${logGroupTitle(id)}: deployment record ${record.id} is queued.`);
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
    started.map(({ stackId: stack, environment, deployment }) => ({
      stack,
      environment,
      deployment,
    })),
  );

  if (rescan) {
    try {
      await dispatchScan(context);
      log.info("Started a full scan for the rescan box.");
    } catch (error) {
      failures.push(message(error));
    }
  }

  // The body write comes before the comment. The comment says the box is
  // cleared, and it is only written once that is true. When the write fails
  // the boxes stay ticked, and the next run refuses them again and says so
  // then.
  let written = true;
  if (started.length > 0 || dropped.length > 0 || clear.size > 0 || rescanHandled) {
    try {
      const attribution = new Map<string, AttributionSource>();
      const result = await writeBody(github, issue.number, (liveBody) =>
        swapRows(
          context,
          config,
          [...(stacks?.values() ?? [])],
          ignored,
          liveBody,
          { started, dropped, clear },
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
      await commentOnRefusedTicks(github, issue.number, outcomes);
    } catch (error) {
      failures.push(`The comment about the refused ticks could not be written: ${message(error)}.`);
    }
  }

  // An unverified tick fails closed and turns the job red (record 0018).
  const unverified = outcomes.filter(({ outcome }) => outcome === "unverified");
  if (unverified.length > 0) failures.push(unverifiedMessage(unverified));
  if (failures.length > 0) throw new Error(failures.join("\n"));
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
  const found = await context.adapter.discover(context.root);
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
      recentlyDeployed: facts.succeeded.map(({ stackId: id, ticker, run, at }) => ({
        stackId: id,
        ticker,
        at,
        runUrl: `${context.repoUrl}/actions/runs/${run}`,
      })),
      repoUrl: context.repoUrl,
      actionRef: context.actionRef,
      personality: config.dashboard.personality,
      readOnly: config.dashboard.readOnly,
      ignored,
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
