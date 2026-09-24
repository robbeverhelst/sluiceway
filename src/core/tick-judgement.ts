// The judgement of the ticks of one `resolve` run (records 0018, 0025, 0035,
// 0051, 0054, 0056, 0064, 0067, 0071, 0083 and 0104). `resolve` hands over what it read:
// the ticks the edit history names, the stacks discovery knows, the open
// deployments, the pending rows and two lines of config. It gets back which
// stacks deploy and which wait behind others, which merge ticks go on to their
// pull request, which ticks are dropped, which boxes are cleared with which
// note, whether the rescan box asks for a scan, and what it found for the job
// log, tick by tick. A tick on a confirm box is first handed on as one tick
// per stack it names (`handOnConfirms`). Nothing here reads or writes, and nothing here writes a
// sentence: the mode does the reads, the records, the merges, the dispatch and
// the write, in the order of record 0035, and says in its own words what each
// finding means.
//
// The permission lookups are reads too (record 0018). `ticksToLookUp` says
// which ticks need one, `resolve` makes them, and their answers come back into
// `judgeTicks` as data. A merge tick is judged a second time against its live
// pull request (record 0054), which `resolve` reads only after the hand-off,
// so that is a call of its own: `judgeMerges`.

import type { ClearTickOptions } from "../render/clear-tick.ts";
import type { BulkSection, ParsedRow } from "../render/marker.ts";
import type { MergeNote } from "../render/merge-row.ts";
import { type BulkAct, bulkRows, sectionChanges } from "./bulk.ts";
import type { ConfiguredStack } from "./config.ts";
import { planDeploys } from "./dependencies.ts";
import { windowState } from "./deploy-window.ts";
import type { DeployFact } from "./deployment.ts";
import type { Tick as BodyTick, NobodyReason, Ticker } from "./edit-history.ts";
import {
  type MergeMethod,
  type NotQualified,
  type OpenPullRequest,
  qualify,
} from "./merge-and-deploy.ts";
import { type PhaseGroup, waitsByPhase } from "./phases.ts";
import { capDeploys } from "./resolve.ts";
import { stackId } from "./stack.ts";
import type { Editor, RefusalReason, TickTarget } from "./tick-rule.ts";

export type MergeTick = Extract<BodyTick, { kind: "merge" }>;
export type OpenDeployment = Extract<DeployFact, { kind: "open" }>;

// A tick of the live body and whoever the edit history names for it.
export interface NamedTick {
  tick: BodyTick;
  ticker: Ticker;
  // A stack's tick that a tick on the confirm box of this section made
  // (record 0083).
  via?: BulkSection | undefined;
}

// What `resolve` read before it judges.
export interface TicksRead {
  // In the order of the body.
  named: readonly NamedTick[];
  // Every stack discovery knows, by id, with the dependencies its row read
  // (record 0059).
  stacks: ReadonlyMap<string, ConfiguredStack>;
  // The open deployments of the ticked stacks and of the stacks they depend
  // on (`stacksToRead`), after the ones whose run is over got their result.
  open: ReadonlyMap<string, OpenDeployment>;
  // The rows of the live body.
  rows: readonly ParsedRow[];
  // `deploys` and `phases` of sluiceway.yaml.
  deploys: boolean;
  phases: readonly string[];
  // When the run judges, and the dashboard zone a deploy window is written in
  // (record 0104). The clock is the mode's, so a test gives the same verdict
  // on every run.
  clock: { now: Date; timeZone: string };
}

// A tick and the ticker its permission lookup is for (record 0018).
export interface TickToJudge {
  target: TickTarget;
  editor: Editor;
  // The tick came from the confirm box of this section, and the comment says
  // so (record 0083).
  via?: BulkSection | undefined;
}

// GitHub's live answer for one tick, as the lookup hands it back (record
// 0018): the tick rule allows it, refuses it, the lookup failed, or the editor
// is not a person and nobody was looked up.
export type LookedUp = { tick: TickToJudge } & (
  | { outcome: "allowed" }
  | { outcome: "refused"; reason: RefusalReason | "no-account" }
  | { outcome: "unverified"; error: unknown }
  | { outcome: "not-a-person" }
);

// A box this run clears, on the row that is still ticked at this hash. With
// the note that asks for a fresh tick (record 0025), the one that says deploys
// are turned off (record 0051), or the one that names what the tick waits on
// (records 0056 and 0067). A refused tick gets a comment instead (record 0018).
export interface Clear {
  hash: string;
  note: ClearTickOptions["note"];
  // The tick came from the confirm box, so the row itself is not ticked. Its
  // note, when it has one, still goes on the row (record 0083).
  unticked?: boolean | undefined;
}

// A deployment record to open. With `behind` it is queued behind those stacks
// and not handed on (record 0056). With `window` it is queued for the stack's
// deploy window and not handed on either (record 0104).
export interface Deploy {
  stackId: string;
  environment: string;
  ticker: string;
  hash: string;
  drift: boolean;
  // The value fingerprint of the ticked row (record 0102), when it has one.
  fingerprint?: string | undefined;
  behind: string[] | undefined;
  window?: true | undefined;
}

// A merge tick every stack of it allowed (record 0071).
export interface AllowedMerge {
  tick: MergeTick;
  ticker: string;
}

// What the judgement found, one line of the job log each, in the order the
// log tells them.
export type Finding =
  // The stack has an open deployment (record 0003). A row tick is dropped. A
  // merge tick merges nothing and its box is cleared (record 0054).
  | { kind: "taken"; tick: BodyTick; fact: OpenDeployment }
  // `deploys: false` (record 0051). The box is cleared.
  | { kind: "deploys-off"; tick: BodyTick }
  // The body moved under the walk after the last read. Left for the run that
  // edit woke (record 0025).
  | { kind: "moving"; tick: BodyTick }
  // The history names nobody. The box is cleared, with no comment.
  | { kind: "nameless"; tick: BodyTick; reason: NobodyReason }
  // The answers of the lookups (record 0018).
  | { kind: "not-a-person"; target: TickTarget; editor: Editor }
  | { kind: "allowed"; target: TickTarget; login: string }
  // An allowed bulk box: the confirm box in its place names these rows as
  // they are, or it goes when fewer than two are left (record 0083).
  | { kind: "bulk-allowed"; section: BulkSection; login: string; rows: string[] }
  | {
      kind: "refused";
      target: TickTarget;
      login: string;
      reason: RefusalReason | "no-account";
    }
  | { kind: "unverified"; target: TickTarget; login: string; error: unknown }
  // More allowed ticks than one run starts (record 0035). Those over the cap
  // are cleared and need a fresh tick.
  | { kind: "over-cap"; started: number; over: number }
  // A dependency has a change waiting that nobody ticked (records 0056 and
  // 0067). The box is cleared with a note that names them.
  // `waitingOn` holds every one of them, `named` those the note names by id
  // and `phases` the rest, by phase.
  | {
      kind: "waits-on";
      stackId: string;
      waitingOn: string[];
      named: string[];
      phases: PhaseGroup[];
    }
  // The stack's deploy window is closed (record 0104). The record waits for
  // it, and opens at `opens`, or at no known time when no window ever opens.
  | { kind: "window-closed"; stackId: string; opens: Date | undefined }
  // A confirm box whose rows changed since it was drawn deploys nothing, and
  // the bulk box asks for a fresh tick (record 0083).
  | {
      kind: "confirm-stale";
      tick: BodyTick;
      changes: { added: string[]; gone: string[]; moved: string[] };
    }
  // A stack of a confirm box whose row is ticked on its own keeps that tick.
  | { kind: "confirm-own-row"; stackId: string }
  // A stack of a confirm box that discovery does not know is left alone.
  | { kind: "confirm-unknown"; stackId: string; section: BulkSection }
  // A confirm box handed on as a tick on each of these stacks.
  | { kind: "confirm-handed-on"; tick: BodyTick; login: string; stackIds: string[] };

export interface Judgement {
  findings: Finding[];
  // The records to open, in the order they are opened: the stacks that start
  // now, then the queued ones.
  deploys: Deploy[];
  // Row ticks on a stack that is taken. Their rows are swapped for the
  // deploying row of the open record (record 0004).
  dropped: string[];
  // Row boxes to clear, by stack id.
  clear: Map<string, Clear>;
  // Merge boxes to clear, by pull request, with the note of a tick cleared
  // without a comment (record 0064).
  clearMerges: Map<number, MergeNote | undefined>;
  // The merge ticks that go on to their pull request (record 0054).
  merges: AllowedMerge[];
  // What became of the ticks on the bulk boxes, for the body writer (record
  // 0083).
  bulk: BulkAct[];
  // The rescan box was ticked by someone allowed to: a full scan.
  rescan: boolean;
  // The rescan box is cleared by writing the body again (record 0025).
  rescanHandled: boolean;
  // The ticks whose lookup gave no answer. They turn the job red (record
  // 0018).
  unverified: LookedUp[];
}

// The ticks of the body that discovery knows the stacks of, and the others,
// with the ids it does not know. A tick on a stack no file names is left
// alone: the next scan drops its row (record 0025).
export function knownTicks<T extends BodyTick>(
  ticks: readonly T[],
  stacks: ReadonlyMap<string, ConfiguredStack>,
): { known: T[]; unknown: { tick: T; stackIds: string[] }[] } {
  const known: T[] = [];
  const unknown: { tick: T; stackIds: string[] }[] = [];
  for (const tick of ticks) {
    // The stacks of a confirm box are checked one by one when it is handed
    // on (record 0083).
    if (tick.kind !== "row" && tick.kind !== "merge") {
      known.push(tick);
      continue;
    }
    const ids = (tick.kind === "merge" ? tick.stackIds : [tick.stackId]).filter(
      (id) => !stacks.has(id),
    );
    if (ids.length === 0) known.push(tick);
    else unknown.push({ tick, stackIds: ids });
  }
  return { known, unknown };
}

// The row ticks by stack id, the ones whose hash covers drift (record 0055)
// and the merge ticks by pull request. Of two ticks for one key the last one
// counts, and the key keeps the place of the first.
function indexTicks(named: readonly NamedTick[]) {
  const hashes = new Map<string, string>();
  const drifted = new Set<string>();
  // The value fingerprint of each ticked row (record 0102).
  const fingerprints = new Map<string, string>();
  for (const { tick } of named) {
    if (tick.kind !== "row") continue;
    hashes.set(tick.stackId, tick.hash);
    if (tick.drift) drifted.add(tick.stackId);
    if (tick.fingerprint === undefined) fingerprints.delete(tick.stackId);
    else fingerprints.set(tick.stackId, tick.fingerprint);
  }
  const mergeTicks = new Map<number, MergeTick>();
  for (const { tick } of named) if (tick.kind === "merge") mergeTicks.set(tick.pr, tick);
  return { hashes, drifted, fingerprints, mergeTicks };
}

// What the confirm boxes of one run come to (record 0083).
export interface ConfirmsHandedOn {
  // The ticks to judge: every tick but the confirm boxes, and one tick per
  // stack of a confirm box that was handed on, by its ticker.
  named: NamedTick[];
  acts: BulkAct[];
  // A confirm box went stale under its tick, so the body is written again.
  stale: boolean;
  findings: Finding[];
}

// A tick on a confirm box goes through the same path as a tick on each row it
// names (record 0083). It is handed on only while the rows of its section are
// still the stacks at the hashes it names: a stale box deploys nothing, and
// the bulk box that takes its place says what changed. A stack whose row is
// ticked on its own keeps that tick and its ticker. A stack discovery does not
// know is left out, as a tick on its row would be.
export function handOnConfirms(
  read: Pick<TicksRead, "named" | "stacks" | "rows" | "deploys">,
): ConfirmsHandedOn {
  const result: ConfirmsHandedOn = { named: [], acts: [], stale: false, findings: [] };
  const rowTicks = new Set(
    read.named.flatMap(({ tick }) => (tick.kind === "row" ? [tick.stackId] : [])),
  );
  for (const one of read.named) {
    const { tick, ticker } = one;
    if (tick.kind !== "confirm") {
      result.named.push(one);
      continue;
    }
    if (!read.deploys) {
      result.findings.push({ kind: "deploys-off", tick });
      result.acts.push({ tick, outcome: "clear" });
      continue;
    }
    if (!ticker.named) {
      if (ticker.reason === "not-in-newest-entry") {
        result.findings.push({ kind: "moving", tick });
      } else {
        result.findings.push({ kind: "nameless", tick, reason: ticker.reason });
        result.acts.push({ tick, outcome: "clear", note: { kind: "orphan" } });
      }
      continue;
    }
    const changes = sectionChanges(tick.stacks, bulkRows(read.rows, tick.section));
    if (changes) {
      result.findings.push({ kind: "confirm-stale", tick, changes });
      result.stale = true;
      continue;
    }
    result.acts.push({ tick, outcome: "consumed" });
    const handed: string[] = [];
    for (const { stackId: id, hash } of tick.stacks) {
      if (rowTicks.has(id)) {
        result.findings.push({ kind: "confirm-own-row", stackId: id });
        continue;
      }
      if (!read.stacks.has(id)) {
        result.findings.push({ kind: "confirm-unknown", stackId: id, section: tick.section });
        continue;
      }
      handed.push(id);
      // The confirm box names hashes only: the value fingerprint comes from
      // the live row of the stack (record 0102).
      const fingerprint = read.rows.find((row) => row.known && row.stackId === id);
      result.named.push({
        tick: {
          kind: "row",
          stackId: id,
          hash,
          ...(tick.section === "drift" ? { drift: true as const } : {}),
          ...(fingerprint?.known && fingerprint.fingerprint !== undefined
            ? { fingerprint: fingerprint.fingerprint }
            : {}),
        },
        ticker,
        via: tick.section,
      });
    }
    result.findings.push({
      kind: "confirm-handed-on",
      tick,
      login: ticker.editor.login,
      stackIds: handed,
    });
  }
  return result;
}

// The stacks whose open deployments the judgement needs: every ticked stack,
// a merge tick's too, since it ends in a deploy (record 0054), and the stacks
// they depend on, because a tick waits behind one that is deploying (record
// 0056).
export function stacksToRead(
  named: readonly NamedTick[],
  stacks: ReadonlyMap<string, ConfiguredStack>,
): ConfiguredStack[] {
  const { hashes, mergeTicks } = indexTicks(named);
  const tickedIds = new Set([
    ...hashes.keys(),
    ...[...mergeTicks.values()].flatMap((one) => one.stackIds),
  ]);
  const ticked = [...tickedIds].flatMap((id) => stacks.get(id) ?? []);
  const dependencies = ticked.flatMap(({ dependsOn }) =>
    (dependsOn ?? []).flatMap((id) => stacks.get(id) ?? []),
  );
  return [...ticked, ...dependencies];
}

// What happens to each tick before anybody is looked up.
interface Triage {
  findings: Finding[];
  bulk: BulkAct[];
  toJudge: TickToJudge[];
  dropped: string[];
  clear: Map<string, Clear>;
  clearMerges: Map<number, MergeNote | undefined>;
  rescanHandled: boolean;
}

// A stack that is taken drops the tick, whoever made it, and `deploys: false`
// clears it: in neither case is anybody looked up or mentioned (records 0025
// and 0051). A merge tick is judged by the rule of every stack it deploys
// (record 0071), one target per stack. A tick the history names nobody for
// is cleared with the note, and the job stays green (record 0025).
function triage(read: TicksRead): Triage {
  const out: Triage = {
    findings: [],
    bulk: [],
    toJudge: [],
    dropped: [],
    clear: new Map(),
    clearMerges: new Map(),
    rescanHandled: false,
  };
  for (const { tick, ticker, via } of read.named) {
    const fact =
      tick.kind === "row"
        ? read.open.get(tick.stackId)
        : tick.kind === "merge"
          ? tick.stackIds.map((id) => read.open.get(id)).find((one) => one !== undefined)
          : undefined;
    if (tick.kind === "bulk" || tick.kind === "confirm") {
      // The bulk box deploys nothing, so it needs a person with write access,
      // as the rescan box does (record 0083). A confirm box never gets here:
      // `handOnConfirms` handed it on.
      if (!read.deploys) {
        out.findings.push({ kind: "deploys-off", tick });
        out.bulk.push({ tick, outcome: "clear" });
      } else if (ticker.named) {
        out.toJudge.push({
          target: { kind: "bulk", section: tick.section },
          editor: ticker.editor,
        });
      } else if (ticker.reason === "not-in-newest-entry") {
        out.findings.push({ kind: "moving", tick });
      } else {
        out.findings.push({ kind: "nameless", tick, reason: ticker.reason });
        out.bulk.push({ tick, outcome: "clear", note: { kind: "orphan" } });
      }
      continue;
    }
    if (tick.kind === "merge" && (fact || !read.deploys)) {
      // A merge row has no room for a note of its own words, so it gets the
      // short one, and the job log says more (record 0064).
      out.findings.push(fact ? { kind: "taken", tick, fact } : { kind: "deploys-off", tick });
      out.clearMerges.set(tick.pr, fact ? "deploying" : "deploys-off");
    } else if (tick.kind === "row" && fact) {
      out.dropped.push(tick.stackId);
      out.findings.push({ kind: "taken", tick, fact });
    } else if (tick.kind === "row" && !read.deploys) {
      out.findings.push({ kind: "deploys-off", tick });
      out.clear.set(tick.stackId, { hash: tick.hash, note: "deploys-off" });
    } else if (ticker.named && tick.kind === "merge") {
      for (const id of tick.stackIds) {
        const stack = read.stacks.get(id);
        if (!stack) continue;
        out.toJudge.push({
          target: { kind: "merge", pr: tick.pr, stackIds: [id], rule: stack.tickers },
          editor: ticker.editor,
        });
      }
    } else if (ticker.named) {
      const stack = tick.kind === "row" ? read.stacks.get(tick.stackId) : undefined;
      out.toJudge.push({
        target: !stack
          ? { kind: "rescan" }
          : { kind: "stack", stackId: stackId(stack.stack), rule: stack.tickers },
        editor: ticker.editor,
        ...(via ? { via } : {}),
      });
    } else if (ticker.reason === "not-in-newest-entry") {
      out.findings.push({ kind: "moving", tick });
    } else {
      out.findings.push({ kind: "nameless", tick, reason: ticker.reason });
      if (tick.kind === "row") out.clear.set(tick.stackId, { hash: tick.hash, note: true });
      else if (tick.kind === "merge") out.clearMerges.set(tick.pr, "orphan");
      else out.rescanHandled = true;
    }
  }
  return out;
}

// The ticks that need a permission lookup, in the order they are judged. The
// lookup of each ticker, and its one retry, is the caller's (record 0018).
export function ticksToLookUp(read: TicksRead): TickToJudge[] {
  return triage(read).toJudge;
}

// The verdict on every tick of the run, from what was read and the answers
// of the lookups `ticksToLookUp` asked for, in that order.
export function judgeTicks(read: TicksRead, lookedUp: readonly LookedUp[]): Judgement {
  const { hashes, drifted, fingerprints, mergeTicks } = indexTicks(read.named);
  const { findings, bulk, dropped, clear, clearMerges, ...triaged } = triage(read);
  let rescanHandled = triaged.rescanHandled;

  const allowed: { stackId: string; ticker: string }[] = [];
  // Merge ticks by pull request whose every stack allowed them so far.
  const mergesAllowed = new Map<number, string>();
  let rescan = false;
  for (const answer of lookedUp) {
    const { target, editor } = answer.tick;
    if (answer.outcome === "not-a-person") {
      // No comment and no row swap. The next scan clears it as an orphan tick
      // (record 0018).
      findings.push({ kind: "not-a-person", target, editor });
      continue;
    }
    if (answer.outcome === "allowed" && target.kind === "bulk") {
      // The confirm box in its place names the rows as they are (record
      // 0083). The scan run is the one of the body it is drawn into, which
      // the body writer sets at its late read.
      findings.push({
        kind: "bulk-allowed",
        section: target.section,
        login: editor.login,
        rows: bulkRows(read.rows, target.section).map(({ stackId: id }) => id),
      });
      bulk.push({
        tick: { kind: "bulk", section: target.section },
        outcome: "confirm",
        by: editor.login,
        scanRun: "",
      });
      continue;
    }
    if (answer.outcome === "allowed") {
      findings.push({ kind: "allowed", target, login: editor.login });
      if (target.kind === "stack") allowed.push({ stackId: target.stackId, ticker: editor.login });
      else if (target.kind === "merge") mergesAllowed.set(target.pr, editor.login);
      else rescan = true;
    } else {
      findings.push(
        answer.outcome === "refused"
          ? { kind: "refused", target, login: editor.login, reason: answer.reason }
          : { kind: "unverified", target, login: editor.login, error: answer.error },
      );
      // Cleared without a note: the comment is the message (record 0018).
      const hash = target.kind === "stack" ? hashes.get(target.stackId) : undefined;
      if (target.kind === "stack" && hash !== undefined) {
        clear.set(target.stackId, { hash, note: false });
      }
      if (target.kind === "merge") clearMerges.set(target.pr, undefined);
      if (target.kind === "bulk") {
        bulk.push({ tick: { kind: "bulk", section: target.section }, outcome: "clear" });
      }
    }
    if (target.kind === "rescan") rescanHandled = true;
  }
  // A merge tick goes ahead when no stack of it refused (record 0071).
  const merges: AllowedMerge[] = [];
  for (const [pr, ticker] of mergesAllowed) {
    const tick = mergeTicks.get(pr);
    if (tick && !clearMerges.has(pr)) merges.push({ tick, ticker });
  }

  // A workflow run holds at most 256 matrix jobs (record 0035).
  const { start, over } = capDeploys(allowed);
  for (const { stackId: id } of over) {
    const hash = hashes.get(id);
    if (hash !== undefined) clear.set(id, { hash, note: true });
  }
  if (over.length > 0)
    findings.push({ kind: "over-cap", started: start.length, over: over.length });

  // Dependencies (record 0056): a tick whose dependency has a change waiting
  // that nobody ticked starts nothing, and ticks in one chain go out one layer
  // at a time. The rest get a queued record that waits behind the stacks
  // before them, and a later `resolve` starts them.
  const plan = planDeploys({
    allowed: start.map(({ stackId: id }) => id),
    dependsOn: dependsOnOf(read.stacks),
    pending: pendingOf(read.rows),
    open: new Set(read.open.keys()),
  });
  // A stack waits on a phase through every stack in it, and the note names
  // the phase (record 0067).
  const phaseOf = new Map(
    [...read.stacks.values()].flatMap((one) =>
      one.phase === undefined ? [] : [[stackId(one.stack), one.phase] as const],
    ),
  );
  for (const { stackId: id, waitingOn } of plan.refused) {
    const { named, phases } = waitsByPhase({
      phases: read.phases,
      phaseOf,
      stackId: id,
      waitingOn,
    });
    findings.push({ kind: "waits-on", stackId: id, waitingOn, named, phases });
    const hash = hashes.get(id);
    if (hash !== undefined) {
      clear.set(id, {
        hash,
        note: { dependsOn: named, ...(phases.length === 0 ? {} : { phases }) },
      });
    }
  }

  // A tick the confirm box made leaves no box on the row to clear, and its
  // note still goes on the row (record 0083).
  const fromConfirm = new Set(
    read.named.flatMap(({ tick, via }) => (via && tick.kind === "row" ? [tick.stackId] : [])),
  );
  for (const [id, one] of clear) if (fromConfirm.has(id)) one.unticked = true;

  const tickers = new Map(start.map(({ stackId: id, ticker }) => [id, ticker]));
  const deploys = [
    ...plan.start.map((id) => ({ id, behind: undefined })),
    ...plan.queued.map(({ stackId: id, behind }) => ({ id, behind })),
  ].flatMap(({ id, behind }): Deploy[] => {
    const stack = read.stacks.get(id);
    const hash = hashes.get(id);
    const ticker = tickers.get(id);
    if (!stack || hash === undefined || ticker === undefined) return [];
    const fingerprint = fingerprints.get(id);
    // A stack that would start now waits for its deploy window when that is
    // closed (record 0104). A stack behind another is judged against the
    // window when it is started.
    const window =
      behind === undefined
        ? windowState(stack.deployWindows ?? [], read.clock.now, read.clock.timeZone)
        : undefined;
    if (window && !window.open) {
      findings.push({ kind: "window-closed", stackId: id, opens: window.opens });
    }
    return [
      {
        stackId: id,
        environment: stack.environment,
        ticker,
        hash,
        drift: drifted.has(id),
        ...(fingerprint === undefined ? {} : { fingerprint }),
        behind,
        ...(window && !window.open ? { window: true as const } : {}),
      },
    ];
  });

  return {
    findings,
    deploys,
    dropped,
    clear,
    clearMerges,
    merges,
    bulk,
    rescan,
    rescanHandled,
    unverified: lookedUp.filter(({ outcome }) => outcome === "unverified"),
  };
}

// The stacks whose live row is pending: a change waits that has not gone out.
function pendingOf(rows: readonly ParsedRow[]): Set<string> {
  return new Set(
    rows.flatMap((row) => (row.known && row.state === "pending" ? [row.stackId] : [])),
  );
}

function dependsOnOf(stacks: ReadonlyMap<string, ConfiguredStack>): Map<string, readonly string[]> {
  return new Map([...stacks.values()].map((one) => [stackId(one.stack), one.dependsOn ?? []]));
}

// What `resolve` read for the merges, after the hand-off (record 0054).
export interface MergesRead extends Pick<TicksRead, "stacks" | "open" | "rows"> {
  // The open pull requests, read again: the marker is text a person can
  // edit, and checks and files may have changed since the scan.
  pullRequests: readonly OpenPullRequest[];
  defaultBranch: string;
  // The method Renovate would use, as far as the repo allows one (record
  // 0064).
  method: MergeMethod | undefined;
  // `mergeAndDeploy.authors` and `scan.unrelated`.
  authors: readonly string[];
  unrelated: string[];
}

// Why a merge tick that the tick rule allowed merges nothing. Each gets the
// comment (record 0054).
export type MergeRefusal =
  // A stack it deploys depends on a stack with a change waiting or deploying
  // (record 0056).
  | { kind: "waits-on"; stackIds: string[] }
  | { kind: "closed" }
  | { kind: "head-moved" }
  // "other-stacks": it still qualifies, for other stacks than the marker
  // names.
  | { kind: "not-qualified"; why: NotQualified | "other-stacks" }
  | { kind: "no-method" }
  // GitHub refused the merge, in its own words.
  | { kind: "refused-by-github"; message: string };

// What a merge tick comes to before the merge call: merge with this method,
// or a refusal that is about the pull request. GitHub's own refusal only
// comes from the call.
export type MergeVerdict = AllowedMerge &
  (
    | { merge: true; method: MergeMethod }
    | { merge: false; refusal: Exclude<MergeRefusal, { kind: "refused-by-github" }> }
  );

// Each allowed merge tick judged against its live pull request again, by pull
// request number (record 0054). A merged change deploys on its own, so it
// waits for nothing: a stack whose dependency has a change waiting or
// deploying is not merged for (record 0056).
export function judgeMerges(read: MergesRead, ticks: readonly AllowedMerge[]): MergeVerdict[] {
  const claimants = [...read.stacks.values()].map(({ stack, inputs }) => ({
    id: stackId(stack),
    path: stack.path,
    inputs,
  }));
  const dependsOn = dependsOnOf(read.stacks);
  const pending = pendingOf(read.rows);
  const waitingOn = (id: string): string[] =>
    (read.stacks.get(id)?.dependsOn ?? []).filter((one) => pending.has(one) || read.open.has(one));
  return [...ticks]
    .sort((a, b) => a.tick.pr - b.tick.pr)
    .map((allowed): MergeVerdict => {
      const refuse = (
        refusal: Exclude<MergeRefusal, { kind: "refused-by-github" }>,
      ): MergeVerdict => ({
        ...allowed,
        merge: false,
        refusal,
      });
      const { tick } = allowed;
      const waits = [...new Set(tick.stackIds.flatMap(waitingOn))];
      if (waits.length > 0) return refuse({ kind: "waits-on", stackIds: waits });
      const pullRequest = read.pullRequests.find(({ number }) => number === tick.pr);
      if (!pullRequest) return refuse({ kind: "closed" });
      if (pullRequest.head !== tick.head) return refuse({ kind: "head-moved" });
      const qualified = qualify(pullRequest, {
        authors: read.authors,
        defaultBranch: read.defaultBranch,
        stacks: claimants,
        unrelated: read.unrelated,
        dependsOn,
      });
      if (!qualified.qualifies) return refuse({ kind: "not-qualified", why: qualified.why });
      if (JSON.stringify(qualified.stackIds) !== JSON.stringify(tick.stackIds)) {
        return refuse({ kind: "not-qualified", why: "other-stacks" });
      }
      if (read.method === undefined) return refuse({ kind: "no-method" });
      return { ...allowed, merge: true, method: read.method };
    });
}

// GitHub's answer to a merge it did not make. A 409 is a head commit that
// moved since the tick. Any other answer is GitHub's refusal, in its words
// (record 0054).
export function mergeAnswerRefusal(answer: { status: number; message: string }): MergeRefusal {
  return answer.status === 409
    ? { kind: "head-moved" }
    : { kind: "refused-by-github", message: answer.message };
}

// The scan after the ticks (records 0017, 0054 and 0064): the rescan box asks
// for a full one. A merge made with the workflow token starts no run of its
// push, so a merge alone asks for the scan that hands the merged change to
// `apply`, narrowed to what was merged when the workflow declares the input,
// else full.
export type ScanAfter =
  | { kind: "none" }
  | { kind: "rescan" }
  | { kind: "after-merge"; prs: number[]; narrowed: boolean };

export function scanAfter(input: {
  rescan: boolean;
  merged: ReadonlySet<number>;
  declaresMergeScanInput: boolean;
}): ScanAfter {
  if (input.rescan) return { kind: "rescan" };
  if (input.merged.size === 0) return { kind: "none" };
  return {
    kind: "after-merge",
    prs: [...input.merged].sort((a, b) => a - b),
    narrowed: input.declaresMergeScanInput,
  };
}
