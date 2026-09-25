// Writing rows into the dashboard (records 0004, 0009, 0011 and 0028). Every
// mode that writes the body does it here: the live read, the rows of this
// version, the carried rows, the trail, the size budget and the write loop.
// A writer hands over the rows it has and gets back what was written, with
// the counts and the header state of that body, so nobody parses a body they
// just rendered.

import type { BulkState } from "../core/bulk.ts";
import type { Config, IgnoredStack } from "../core/config.ts";
import type { ShownFreeze } from "../core/deploy-window.ts";
import type { DeployFacts, TrailEntry } from "../core/deployment.ts";
import type { OutsideDeploy } from "../core/outside-deploy.ts";
import { carriedWaitingRun } from "../core/waiting-run.ts";
import { type BudgetOptions, type FittedBody, fitBody } from "../render/budget.ts";
import { dashboardFacts, type HeaderState } from "../render/dashboard-facts.ts";
import { runUrl } from "../render/links.ts";
import {
  MARKER_VERSION,
  type ParsedDashboard,
  type ParsedMerge,
  type ParsedRow,
  type ParsedWaiting,
  parseDashboard,
  type RootFacts,
  type ScanRunningFacts,
} from "../render/marker.ts";
import { type DashboardCounts, dashboardCounts } from "../render/result-file.ts";
import type { AttributionLines, Row } from "../render/row.ts";
import { type DashboardResult, writeDashboard } from "./dashboard.ts";
import type { JobLog } from "./job-log.ts";
import type { GitHubPort } from "./port.ts";
import { type WriteResult, writeBody } from "./write-loop.ts";

// What every write needs, the same on every try.
export interface DashboardWriter {
  github: GitHubPort;
  // The run this writer is part of. A swap drops the line about a run that
  // waits for a runner when that run is this one (record 0086).
  runId: string;
  log: Pick<JobLog, "info">;
  // `https://github.com/<owner>/<repo>`.
  repoUrl: string;
  actionRef: string;
  dashboard: Config["dashboard"];
  // `deploys` of the config: the bulk boxes are drawn only while it is on
  // (record 0083).
  deploys: boolean;
  // Stacks an `ignore` entry with a reason leaves out (record 0051).
  ignored: readonly IgnoredStack[];
  // The deploy freezes that hold or start within a week, by the writer's
  // clock (record 0115). Every writer names them, so a swap never drops the
  // freeze line.
  freezes: readonly ShownFreeze[];
  // Only a test has a reason to set this.
  budget?: BudgetOptions | undefined;
}

// The live body as a writer's late read gets it, read once per try.
export interface LiveDashboard extends ParsedDashboard {
  body: string;
  // The root marker is of this version, so its rows and merges are ones this
  // version can carry (record 0009).
  current: boolean;
  // The first block of every stack, whatever its version or state: of two
  // blocks for one stack the first counts (record 0025).
  first: ReadonlyMap<string, ParsedRow>;
}

// What a writer puts on the dashboard at one late read.
export interface Rows {
  // The deployment records as this try read them. The trail is drawn from
  // them (record 0062).
  facts: Pick<DeployFacts, "trail">;
  // The rows this writer renders, by stack id. Only these are shortened.
  rows: ReadonlyMap<string, Row>;
  // Row blocks it writes as they are, by stack id: a live block, or one with
  // its tick cleared. Never read inside and never shortened (record 0028).
  carried?: ReadonlyMap<string, ParsedRow> | undefined;
  // What each deploy of the trail shipped (record 0072), by entry.
  shipped?: ReadonlyMap<TrailEntry, AttributionLines> | undefined;
  // The updates waiting to merge. A swap that leaves them out carries the
  // live ones as they stand: only a scan lists them (record 0054).
  merges?: readonly ParsedMerge[] | undefined;
  // The updates waiting on their checks. A swap that leaves them out carries
  // the live ones as they stand: only a scan draws them (record 0081).
  waiting?: readonly ParsedWaiting[] | undefined;
  // The outside deploys of the trail. A swap that leaves them out carries
  // the live ones: only a full scan reads the tool's history (record 0073).
  outside?: readonly OutsideDeploy[] | undefined;
  // What the writer did with a bulk box or a confirm box, and for a scan the
  // facts it sweeps them by (record 0083). A swap draws them from the live
  // lines; a scan hands over the live lines it read.
  bulk?: Partial<Omit<BulkState, "on">> | undefined;
  // A scan's first write says the scan is running (record 0108). Every other
  // writer leaves it out and carries what the live root marker holds.
  running?: ScanRunningFacts | undefined;
}

// A scan writes the root marker, and a row for every stack it knows and
// nothing else (record 0011).
export interface ScanRows extends Rows {
  root: RootFacts;
  merges: readonly ParsedMerge[];
  waiting: readonly ParsedWaiting[];
  outside: readonly OutsideDeploy[];
}

// What was written, or found already written.
export interface Written extends WriteResult {
  // How many of the writer's own rows are shortened.
  shortened: number;
  // The counts line of the body, and its header state.
  counts: DashboardCounts;
  header: HeaderState;
  // How many updates waiting to merge the body had no room for (record 0071).
  mergesLeftOut: number;
}

// A body over the hard limit is never handed to GitHub (record 0028). Nothing
// was written, and the writer decides what that means for it.
export interface DoesNotFit {
  fits: false;
  // The size of the body with every row of the writer cut as far as it goes.
  size: number;
}

export type SwapAnswer = ({ fits: true } & Written) | DoesNotFit;
export type ScanAnswer = ({ fits: true } & Written & DashboardResult) | DoesNotFit;

// A row swap of `resolve` and `apply` (record 0009): the writer's own rows
// take the place of the first block of their stack, every other block is
// carried byte for byte, and everything around the blocks is regenerated. A
// live body that this version did not write is left alone. `rows` runs at the
// late read of every try, so it does its own reads of the deployment records.
export async function swapRows(
  writer: DashboardWriter,
  issue: number,
  // The root facts are the live ones, which a swap carries through.
  rows: (live: LiveDashboard, root: RootFacts) => Promise<Rows>,
): Promise<SwapAnswer> {
  let last: Drawn | undefined;
  const answer = await doesItFit(() =>
    writeBody(writer.github, issue, async (body) => {
      const live = liveDashboard(body);
      const root = live.current ? live.root : undefined;
      if (root?.scanSha === undefined || root.scanRun === undefined || root.scanAt === undefined) {
        // Not a body this version wrote, so it is not touched (record 0009).
        // The next scan writes it again, and the deployment records hold the
        // truth.
        writer.log.info("The live body is not one this version can write again. It is left alone.");
        last = { rows: live.rows, shortened: 0, mergesLeftOut: 0 };
        return body;
      }
      const kept: RootFacts = {
        scanSha: root.scanSha,
        scanRun: root.scanRun,
        scanAt: root.scanAt,
        fullScanAt: root.fullScanAt,
        fullScanRun: root.fullScanRun,
        waitingRun: carriedWaitingRun(root.waitingRun, writer.runId),
        // Only the scan that wrote it takes it away (record 0108).
        scanRunning: root.scanRunning,
      };
      const mine = await rows(live, kept);
      const drawn = fitted(
        fit(
          writer,
          {
            root: mine.running ? { ...kept, scanRunning: mine.running } : kept,
            ...swapped(live, mine),
            facts: mine.facts,
            shipped: mine.shipped,
            merges: mine.merges ?? live.merges,
            waiting: mine.waiting ?? live.waiting,
            outside: mine.outside ?? live.outside,
            bulk: { live: live.bulk, ...mine.bulk },
          },
          // A writer that swaps rows aims at the hard limit (record 0028).
          false,
        ),
      );
      last = drawn;
      return drawn.body;
    }),
  );
  if (!answer.fits) return answer;
  return { ...answer.written, ...counted(last), fits: true };
}

// The write of a scan (records 0011 and 0017): it finds, reopens or creates
// the dashboard, and writes the rows it hands over and nothing else. A full
// scan aims at the target of the size budget, and a narrowed one at the hard
// limit, like any writer that carries rows (record 0028).
export async function writeScan(
  writer: DashboardWriter,
  full: boolean,
  rows: (live: LiveDashboard) => Promise<ScanRows>,
): Promise<ScanAnswer> {
  let last: Drawn | undefined;
  const answer = await doesItFit(() =>
    writeDashboard(writer.github, writer.dashboard, async (body) => {
      const drawn = fitted(fitScan(writer, full, await rows(liveDashboard(body))));
      last = drawn;
      return drawn.body;
    }),
  );
  if (!answer.fits) return answer;
  return { ...answer.written, ...counted(last), fits: true };
}

// The body a scan's rows make, without a request. A full scan checks it
// before its late read: with a fresh row for every stack it depends on the
// live body only through the deployment records.
export function fitScan(writer: DashboardWriter, full: boolean, mine: ScanRows): FittedBody {
  return fit(
    writer,
    {
      root: mine.root,
      rows: [...mine.rows.values()],
      carried: [...(mine.carried?.values() ?? [])],
      facts: mine.facts,
      shipped: mine.shipped,
      merges: mine.merges,
      waiting: mine.waiting,
      outside: mine.outside,
      bulk: { live: [], ...mine.bulk },
    },
    full,
  );
}

// The live body read as a writer needs it. With no dashboard it is "".
export function liveDashboard(body: string): LiveDashboard {
  const parsed = parseDashboard(body);
  const first = new Map<string, ParsedRow>();
  for (const row of parsed.rows) if (!first.has(row.stackId)) first.set(row.stackId, row);
  return { ...parsed, body, current: parsed.root?.version === MARKER_VERSION, first };
}

// The carried-row rule of a swap. Of two blocks for one stack the first
// counts, as it does for the walk (record 0025), and only a first block this
// version knows is swapped. A stack with no row at all gets one: it was
// deleted by hand, and every stack has a row.
function swapped(live: LiveDashboard, mine: Rows): { rows: Row[]; carried: ParsedRow[] } {
  const rows: Row[] = [];
  const carried: ParsedRow[] = [];
  for (const row of live.rows) {
    const first = row.known && live.first.get(row.stackId) === row;
    const own = first ? mine.rows.get(row.stackId) : undefined;
    if (own) rows.push(own);
    else carried.push((first && mine.carried?.get(row.stackId)) || row);
  }
  for (const [id, row] of mine.rows) if (!live.first.has(id)) rows.push(row);
  return { rows, carried };
}

interface Drawn {
  rows: readonly ParsedRow[];
  shortened: number;
  mergesLeftOut: number;
}

interface Body {
  root: RootFacts;
  rows: readonly Row[];
  carried: readonly ParsedRow[];
  facts: Pick<DeployFacts, "trail">;
  shipped?: ReadonlyMap<TrailEntry, AttributionLines> | undefined;
  merges: readonly ParsedMerge[];
  waiting: readonly ParsedWaiting[];
  outside: readonly OutsideDeploy[];
  bulk: Omit<BulkState, "on">;
}

function fit(writer: DashboardWriter, body: Body, aimAtTarget: boolean): FittedBody {
  const { dashboard, repoUrl } = writer;
  return fitBody(
    {
      root: body.root,
      rows: body.rows,
      carried: body.carried,
      redact: dashboard.redact,
      recentlyDeployed: body.facts.trail.map((entry) => ({
        stackId: entry.stackId,
        result: entry.result,
        reason: entry.reason,
        ticker: entry.ticker,
        at: entry.at,
        runUrl: runUrl(repoUrl, entry.run, entry.attempt),
        shipped: body.shipped?.get(entry),
        ...(entry.onMerge ? { onMerge: true } : {}),
      })),
      repoUrl,
      actionRef: writer.actionRef,
      recentLength: dashboard.recentlyDeployed,
      personality: dashboard.personality,
      timeZone: dashboard.timeZone,
      readOnly: dashboard.readOnly,
      ignored: writer.ignored,
      freezes: writer.freezes,
      merges: body.merges,
      waiting: body.waiting,
      outsideDeploys: body.outside,
      bulk: { ...body.bulk, on: writer.deploys && !dashboard.readOnly },
      // The layout keys (record 0114). Every writer draws the same layout, so
      // a swap by `resolve`, `apply` or `settle` never moves a section.
      layout: {
        sections: dashboard.sections,
        deployingSection: dashboard.deployingSection,
        driftedSection: dashboard.driftedSection,
        inSyncSection: dashboard.inSyncSection,
        zeroCounts: dashboard.zeroCounts,
        destroyAlert: dashboard.destroyAlert,
        pendingDetail: dashboard.pendingDetail,
        deployAll: dashboard.deployAll,
        repairAll: dashboard.repairAll,
        rescanBox: dashboard.rescanBox,
        footer: dashboard.footer,
      },
    },
    // The room between the target and the limit exists for a writer that
    // carries rows (record 0028).
    aimAtTarget ? writer.budget : { ...writer.budget, target: Number.POSITIVE_INFINITY },
  );
}

// The counts and the header state of the body of the last try, from the row
// blocks it was drawn from.
function counted(
  last: Drawn | undefined,
): Pick<Written, "shortened" | "counts" | "header" | "mergesLeftOut"> {
  const rows = last?.rows ?? [];
  return {
    shortened: last?.shortened ?? 0,
    counts: dashboardCounts(rows),
    header: dashboardFacts(rows).headerState,
    mergesLeftOut: last?.mergesLeftOut ?? 0,
  };
}

// The body of one try, when it fits.
function fitted(body: FittedBody): FittedBody {
  if (!body.fits) throw new NotWritten(body.size);
  return body;
}

// Stops the write loop from inside the builder. It never leaves this module:
// a body that does not fit is an answer, not an error.
class NotWritten extends Error {
  constructor(readonly size: number) {
    super("The dashboard body does not fit.");
    this.name = "NotWritten";
  }
}

async function doesItFit<T>(
  write: () => Promise<T>,
): Promise<{ fits: true; written: T } | DoesNotFit> {
  try {
    return { fits: true, written: await write() };
  } catch (error) {
    if (error instanceof NotWritten) return { fits: false, size: error.size };
    throw error;
  }
}
