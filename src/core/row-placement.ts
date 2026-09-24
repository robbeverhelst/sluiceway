// The rows of a scan at its late read (records 0004, 0011, 0025, 0054, 0062,
// 0073, 0076 and 0081). A scan hands over what it has so far, its previews,
// and what the late read found: the live body, the deployment records and
// whether a `resolve` run is on its way. It gets back a row for every
// discovered stack, the merge and waiting lines and the outside trail, with
// what it did for the job log. Or it gets back the stacks it has to preview
// first, and returns to its late read after that. Nothing here reads or
// writes: the scan does the preview, the read and the write.

import type { PreviewResult, ToolDeploy } from "../adapters/adapter.ts";
import { type RunLinks, runUrl } from "../render/links.ts";
import type {
  ParsedBulk,
  ParsedDashboard,
  ParsedMerge,
  ParsedRow,
  ParsedWaiting,
  RootFacts,
  WaitingRunFacts,
} from "../render/marker.ts";
import {
  type BranchPreview,
  clearMergeTick,
  mergeBlock,
  tickedMergeBlock,
} from "../render/merge-row.ts";
import { previewRow } from "../render/preview-result.ts";
import {
  type AttributionLines,
  byCodeUnit,
  type FailureLine,
  isDestroy,
  type Row,
} from "../render/row.ts";
import { waitingBlock } from "../render/waiting-line.ts";
import type { Attribution } from "./attribution.ts";
import type { BulkState } from "./bulk.ts";
import {
  type DeployFact,
  type DeployFacts,
  type PreviewFirstWhy,
  pendingAgain,
  rowAtLateRead,
  standingFailure,
  type TrailEntry,
} from "./deployment.ts";
import type { WaitingUpdate } from "./merge-and-deploy.ts";
import type { OnMergeWait } from "./on-merge.ts";
import { type TickAtLateRead, tickAtLateRead } from "./orphan-tick.ts";
import { type OutsideDeploy, outsideDeploys, trailOutside } from "./outside-deploy.ts";
import { oneRowPerStack } from "./scan-plan.ts";
import { differsEveryRun, valueFingerprint } from "./value-fingerprint.ts";

// One stack this scan previewed.
export interface PreviewedStack {
  result: PreviewResult;
  // When the preview started. A deploy that ended after it is fresher than
  // the preview (record 0004).
  startedAt: Date;
}

// What the scan knows of the updates waiting to merge (record 0054): nothing
// to list, because the setting is off or nothing could be merged or ticked
// here; the list; or a list that could not be read, which keeps the live rows.
// The updates waiting on their checks come with the list (record 0081).
export type Listing =
  | { kind: "off" }
  | { kind: "listed"; updates: WaitingUpdate[]; onChecks: WaitingUpdate[] }
  | { kind: "failed" };

// What the scan has when it reaches its late read. The maps are read at the
// call, so a later round hands the same ones again with more in them.
export interface ScanSoFar {
  // Every discovered stack, in discovery order.
  ids: readonly string[];
  // The root marker a scan writes, less the keys of a full scan.
  // `waitingRun`: a run of the workflow that waits for a runner, as the scan
  // found it (record 0086).
  scan: { sha: string; runId: string; at: string; waitingRun?: WaitingRunFacts | undefined };
  // `https://github.com/<owner>/<repo>`.
  repoUrl: string;
  links: RunLinks;
  // The `scan.logDiff` setting (record 0048).
  logDiff: boolean;
  // `dashboard.readOnly` and `dashboard.redact` of the config.
  readOnly: boolean;
  redact: boolean;
  listing: Listing;
  // Each listed update as it would be after the merge (record 0071).
  branchPreviews: ReadonlyMap<number, readonly BranchPreview[]>;
  previewed: ReadonlyMap<string, PreviewedStack>;
  // Stacks this scan previewed a second time for a deploy that ended under it.
  again: ReadonlySet<string>;
  // The preview page of every pending stack that has one (record 0050).
  pageUrls: ReadonlyMap<string, string>;
  // The tools' own histories, once a full scan read them (record 0073).
  histories: ReadonlyMap<string, readonly ToolDeploy[]> | undefined;
}

// The deploy facts of one late read (record 0003).
export interface LateDeploys {
  facts: DeployFacts;
  // Stacks whose open deployment this scan ended, because its run was over.
  settled: ReadonlySet<string>;
  // The runs on the records of each stack, which tell its own deploys in the
  // tool's history apart (record 0073).
  runs: ReadonlyMap<string, ReadonlySet<string>>;
}

export const NO_DEPLOYS: LateDeploys = {
  facts: { byStack: new Map(), succeeded: [], trail: [], unread: 0 },
  settled: new Set(),
  runs: new Map(),
};

// What one late read found.
export interface LateRead {
  // The live body. Its rows and merges are ones this version can carry only
  // when `current` (record 0009). `first` is the first block of every stack,
  // whatever its version or state (record 0025).
  live: Pick<ParsedDashboard, "root" | "merges" | "waiting" | "outside" | "bulk"> & {
    current: boolean;
    first: ReadonlyMap<string, ParsedRow>;
  };
  deploys: LateDeploys;
  // A run that an issue edit started is queued or in progress (record 0025).
  resolveWaits: boolean;
  // What attribution found, by stack id. A stack is missing when the lookup
  // failed, and its row then has no such line (record 0026).
  attributed: ReadonlyMap<string, Pick<Attribution, "lines">>;
  // What each deploy of the trail shipped (record 0072).
  shipped?: ReadonlyMap<TrailEntry, AttributionLines> | undefined;
  // The stacks set to on-merge whose change waits for a tick after all, and
  // why (record 0095). Their pending rows say so.
  waitsOnMerge?: ReadonlyMap<string, OnMergeWait> | undefined;
}

// Why a stack is previewed at the late read: for its deployment records
// (record 0004), because its row holds an orphan tick and only a fresh row
// can carry the note (record 0025), or because a merge waits for its fresh
// diff (record 0054).
export type LateWhy = PreviewFirstWhy | "orphan-tick" | "merged";

// These stacks have to be previewed before the dashboard can be written. The
// scan previews them and returns to its late read (record 0011).
export interface PreviewFirst {
  kind: "preview-first";
  stacks: { id: string; why: LateWhy }[];
}

// The rows a scan writes: the root marker, and a row for every stack it knows
// and nothing else (record 0011).
export interface PlacedRows {
  root: RootFacts;
  facts: DeployFacts;
  shipped: ReadonlyMap<TrailEntry, AttributionLines>;
  // Fresh rows, by stack id.
  rows: Map<string, Row>;
  // Live row blocks written as they are, by stack id (record 0004).
  carried: Map<string, ParsedRow>;
  merges: ParsedMerge[];
  waiting: ParsedWaiting[];
  outside: OutsideDeploy[];
  // The live bulk lines and the facts the scan sweeps them by (record 0083).
  bulk: Omit<BulkState, "on">;
}

// What the late read placed, besides the rows, for the job log.
export interface Placed {
  // Stacks this scan did not preview, whose live row stays as it is.
  carried: string[];
  // Every live row block the scan carried, previewed or not.
  carriedBlocks: number;
  // Live rows of stacks that discovery does not know.
  dropped: string[];
  // Stacks with an open deployment.
  deploying: string[];
  // Previewed stacks that keep their live row, because a deploy of them ended
  // after the preview started.
  deferred: string[];
  // What became of every tick the scan met on a stack with no open deployment
  // (record 0025). `box` says whether the row it wrote has a box.
  ticks: { id: string; tick: Exclude<TickAtLateRead, "preview-first">; box: boolean }[];
  // The same for the ticks on updates waiting to merge (record 0054).
  mergeTicks: { pr: number; tick: "carry" | "sweep" }[];
  // A run that an issue edit started was queued or in progress.
  resolveWaits: boolean;
  // Deployment records with a payload this version cannot read.
  unread: number;
  // The bulk lines of the live body, for what the scan did with them (record
  // 0083).
  bulk: readonly ParsedBulk[];
}

export type RowsAtLateRead = { kind: "placed"; rows: PlacedRows; placed: Placed } | PreviewFirst;

// A full scan is a scan that previews every stack, whatever row each stack
// then gets (record 0011).
export function isFullScan(so: Pick<ScanSoFar, "ids" | "previewed">): boolean {
  return so.ids.every((id) => so.previewed.has(id));
}

// A fresh row for every previewed stack, the live row block for every other,
// byte for byte (record 0011), and at every stack the scan defers to fresher
// facts (record 0004).
export function placeRows(so: ScanSoFar, late: LateRead): RowsAtLateRead {
  const { ids, previewed, links, logDiff } = so;
  const { live, deploys, resolveWaits: waits, attributed } = late;
  const full = isFullScan(so);
  // Rows under a root marker that is missing or of another version are not
  // rows this version can carry. Every stack then counts as having none,
  // which makes the scan a full one by itself (record 0011). One row per
  // stack: of two blocks with one stack id the first stays.
  const liveRows: ReadonlyMap<string, ParsedRow> = live.current ? live.first : new Map();
  const { dropped } = oneRowPerStack([...ids], new Set(previewed.keys()), [...liveRows.keys()]);
  // A tick is read whatever the version of the body: a scan that writes the
  // body again in its own version clears the ticks it meets with the note
  // (record 0009). Of two blocks for one stack the first counts.
  const liveTicks = new Map<string, string | undefined>();
  // On a read-only dashboard no row has a box, so a tick left from before the
  // switch goes with the box, with no note and nobody asked (slice 2.17). The
  // switch changes the config file, so this scan is full.
  for (const [id, row] of so.readOnly ? [] : live.first) {
    if (row.known && row.ticked) liveTicks.set(id, row.hash);
  }

  const { merges, mergeTicks } = mergeRows(
    so.listing,
    so.branchPreviews,
    live.current ? live.merges : [],
    waits,
    so.redact,
  );
  const waiting = waitingLines(so.listing, live.current ? live.waiting : [], so.redact);

  // What this scan read of the tools' histories, and for every other stack
  // the lines the live body has (record 0073). A row's failure line stands
  // only while none of them ended after the failure (record 0076).
  const outside = trailOutside(
    ids,
    new Map(
      [...(so.histories ?? [])].map(([id, history]) => [
        id,
        outsideDeploys(id, history, deploys.runs.get(id)),
      ]),
    ),
    live.current ? live.outside : [],
  );

  const rows = new Map<string, Row>();
  const carried = new Map<string, ParsedRow>();
  const first: PreviewFirst["stacks"] = [];
  const deploying: string[] = [];
  const deferred: string[] = [];
  const ticks: Placed["ticks"] = [];
  for (const id of ids) {
    const mine = previewed.get(id);
    const liveRow = liveRows.get(id);
    const fact = deploys.facts.byStack.get(id);
    const decided = rowAtLateRead({
      previewedAt: mine?.startedAt,
      liveState: liveRow?.state,
      fact,
      settledHere: deploys.settled.has(id),
      again: so.again.has(id),
    });
    // A stack with an open deployment gets the deploying row below, so a tick
    // only matters on the two branches that write a box.
    const ticked = liveTicks.has(id);
    if (decided.row === "preview-first") first.push({ id, why: decided.why });
    else if (decided.row === "fresh" && mine) {
      const fresh = previewRow(id, mine.result, links, failureLine(so.repoUrl, id, fact, outside), {
        toolDiffInLog: logDiff,
        pageUrl: so.pageUrls.get(id),
      });
      // A value the row does not show differed between this preview and the
      // live row's, at the commit of the live body's last scan (record 0102).
      const everyRun =
        (fresh.state === "pending" || fresh.state === "drift") &&
        liveRow?.known === true &&
        liveRow.hash !== undefined &&
        differsEveryRun(
          { hash: liveRow.hash, fingerprint: liveRow.fingerprint },
          { hash: fresh.hash, fingerprint: valueFingerprint(fresh.diff) },
          live.root?.scanSha === so.scan.sha,
        );
      const row =
        fresh.state === "pending"
          ? {
              ...fresh,
              attribution: attributed.get(id)?.lines,
              pendingAgain: pendingAgain(fact, fresh.hash)
                ? { logUrl: logDiff ? links.log : undefined }
                : undefined,
              ...(everyRun ? { valueEveryRun: true } : {}),
              ...(late.waitsOnMerge?.has(id) ? { waitsOnMerge: late.waitsOnMerge.get(id) } : {}),
            }
          : fresh.state === "drift" && everyRun
            ? { ...fresh, valueEveryRun: true }
            : fresh;
      if (!ticked) {
        rows.set(id, row);
        continue;
      }
      // Only a pending or a drifted row has a box, for a tick or for the note
      // (record 0055).
      const box = row.state === "pending" || row.state === "drift";
      const carry =
        tickAtLateRead({
          liveHash: liveTicks.get(id),
          writes: { row: "fresh", hash: box ? row.hash : undefined },
          resolveOnItsWay: waits,
        }) === "carry";
      ticks.push({ id, tick: carry ? "carry" : "sweep", box });
      rows.set(id, !box ? row : carry ? { ...row, ticked: true } : { ...row, orphanTick: true });
    } else if (decided.row === "deploying" && decided.from === "record" && fact?.kind === "open") {
      deploying.push(id);
      rows.set(id, {
        state: "deploying",
        stackId: id,
        ticker: fact.ticker,
        runUrl: runUrl(so.repoUrl, fact.run, fact.attempt),
        waiting: fact.waiting,
        destroys: destroysOf(mine, liveRow),
        deletes: deletesOf(mine, liveRow),
        attribution: attributed.get(id)?.lines,
        behind: fact.behind,
        ...(fact.onMerge ? { onMerge: true } : {}),
      });
    } else if (liveRow) {
      if (ticked && decided.row === "live") {
        const tick = tickAtLateRead({
          liveHash: liveTicks.get(id),
          writes: { row: "live", previewed: mine !== undefined },
          resolveOnItsWay: waits,
        });
        if (tick === "preview-first") {
          first.push({ id, why: "orphan-tick" });
          continue;
        }
        ticks.push({ id, tick, box: true });
      }
      if (decided.row === "deploying") deploying.push(id);
      else if (mine) deferred.push(id);
      carried.set(id, liveRow);
    }
  }
  if (first.length > 0) return { kind: "preview-first", stacks: first };

  return {
    kind: "placed",
    rows: {
      root: {
        scanSha: so.scan.sha,
        scanRun: so.scan.runId,
        scanAt: so.scan.at,
        // Written by a full scan, carried through by every other writer.
        fullScanAt: full ? so.scan.at : live.root?.fullScanAt,
        fullScanRun: full ? so.scan.runId : live.root?.fullScanRun,
        // Only the scan lists the runs, so it writes what it found, or no line.
        waitingRun: so.scan.waitingRun,
      },
      facts: deploys.facts,
      shipped: late.shipped ?? new Map(),
      rows,
      carried,
      merges,
      waiting,
      outside,
      // The live lines of a body this version wrote, swept by this scan's
      // facts (record 0083).
      bulk: {
        live: live.current ? live.bulk : [],
        scan: { liveScanRun: live.root?.scanRun, resolveOnItsWay: waits },
      },
    },
    placed: {
      carried: [...carried.keys()].filter((id) => !previewed.has(id)),
      carriedBlocks: carried.size,
      dropped,
      deploying,
      deferred,
      ticks,
      mergeTicks,
      resolveWaits: waits,
      unread: deploys.facts.unread,
      bulk: live.current ? live.bulk : [],
    },
  };
}

// A record `resolve` opened for a merge, which waits for this scan.
export interface WaitingMerge {
  id: string;
  fact: Extract<DeployFact, { kind: "open" }> & { merge: number };
}

// The merges that wait for this scan (record 0054), by stack id. A stack of
// one that this scan has not previewed is previewed first, and then the fresh
// diff goes to a record of its own.
export function mergesAtLateRead(
  so: Pick<ScanSoFar, "ids" | "previewed">,
  facts: DeployFacts,
): { kind: "hand-off"; waiting: WaitingMerge[] } | PreviewFirst {
  const waiting: WaitingMerge[] = [];
  for (const [id, fact] of facts.byStack) {
    if (fact.kind === "open" && fact.merge !== undefined) {
      waiting.push({ id, fact: { ...fact, merge: fact.merge } });
    }
  }
  waiting.sort((a, b) => byCodeUnit(a.id, b.id));
  const toPreview = waiting.filter(({ id }) => so.ids.includes(id) && !so.previewed.has(id));
  if (toPreview.length > 0) {
    return { kind: "preview-first", stacks: toPreview.map(({ id }) => ({ id, why: "merged" })) };
  }
  return { kind: "hand-off", waiting };
}

// A deploy fact from the deployment record, never from the old row. It stands
// while no deploy of the stack ended after it, outside the dashboard included
// (record 0076). A link to a run lands on the attempt that created the record,
// when the record says (slice 5.9).
function failureLine(
  repoUrl: string,
  id: string,
  deployFact: DeployFact | undefined,
  outside: readonly OutsideDeploy[],
): FailureLine | undefined {
  const fact = standingFailure(id, deployFact, outside);
  if (fact === undefined) return undefined;
  return {
    reason: fact.reason,
    ticker: fact.ticker,
    at: fact.at,
    runUrl: runUrl(repoUrl, fact.run, fact.attempt),
    ...(fact.onMerge ? { onMerge: true } : {}),
  };
}

// The header and the counts line need to know whether a deploying stack
// destroys something (record 0027). The preview knows. Without one, the
// marker of the row that is replaced does.
function destroysOf(mine: PreviewedStack | undefined, liveRow: ParsedRow | undefined): number {
  if (mine?.result.ok) return mine.result.diff.changes.filter(isDestroy).length;
  return liveRow?.known ? liveRow.destroys : 0;
}

// And how many of those are deletes, for the delete sign (record 0075). A
// marker an older version wrote does not say.
function deletesOf(
  mine: PreviewedStack | undefined,
  liveRow: ParsedRow | undefined,
): number | undefined {
  if (mine?.result.ok)
    return mine.result.diff.changes.filter((change) => change.op === "delete").length;
  return liveRow?.known ? liveRow.deletes : undefined;
}

// The merge rows of this scan. A tick on a live row carries over while a
// `resolve` run is on its way and the row still shows the same pull request at
// the same head commit, for the same stack. Otherwise it goes, as an orphan
// tick does (record 0025).
function mergeRows(
  listing: Listing,
  previews: ReadonlyMap<number, readonly BranchPreview[]>,
  live: readonly ParsedMerge[],
  waits: boolean,
  redact: boolean,
): { merges: ParsedMerge[]; mergeTicks: Placed["mergeTicks"] } {
  if (listing.kind === "off") return { merges: [], mergeTicks: [] };
  if (listing.kind === "failed") return { merges: [...live], mergeTicks: [] };
  const mergeTicks: Placed["mergeTicks"] = [];
  const merges = listing.updates.map(({ pullRequest, stackIds }) => {
    const block = mergeBlock(
      {
        pr: pullRequest.number,
        stackIds,
        head: pullRequest.head,
        title: pullRequest.title,
        author: pullRequest.author,
        preview: previews.get(pullRequest.number),
      },
      { redact },
    );
    const ticked = live.find((one) => one.pr === block.pr);
    if (!ticked?.ticked) return block;
    const same =
      ticked.head === block.head &&
      JSON.stringify(ticked.stackIds) === JSON.stringify(block.stackIds);
    const carry = same && waits;
    mergeTicks.push({ pr: block.pr, tick: carry ? "carry" : "sweep" });
    // A tick swept away gets the orphan note, as a stack's row does (record
    // 0064).
    return carry
      ? tickedMergeBlock(block)
      : clearMergeTick(tickedMergeBlock(block), { note: "orphan" });
  });
  return { merges, mergeTicks };
}

// The lines of the updates waiting on their checks (record 0081), drawn fresh
// from the list, or kept as the live body has them when the list could not be
// read. They have no box, so there is no tick to carry.
function waitingLines(
  listing: Listing,
  live: readonly ParsedWaiting[],
  redact: boolean,
): ParsedWaiting[] {
  if (listing.kind === "off") return [];
  if (listing.kind === "failed") return [...live];
  return listing.onChecks.map(({ pullRequest, stackIds }) =>
    waitingBlock(
      {
        pr: pullRequest.number,
        stackIds,
        title: pullRequest.title,
        author: pullRequest.author,
      },
      { redact },
    ),
  );
}
