// Everything outside the row blocks (records 0009 and 0029): a pure function
// of the root facts, the row blocks and the deployment records. Every writer
// regenerates it, and nothing in it is ever patched or carried through.

import { type BulkState, sectionBulk } from "../core/bulk.ts";
import {
  type Config,
  DASHBOARD_SECTIONS,
  type DashboardSection,
  type IgnoredStack,
} from "../core/config.ts";
import type { OutsideDeploy } from "../core/outside-deploy.ts";
import { renderBulkLine } from "./bulk-box.ts";
import {
  type CountsLineNumbers,
  type Crates,
  type DashboardFacts,
  type DestroySigns,
  dashboardFacts,
  type HeaderState,
  MAX_CRATES,
} from "./dashboard-facts.ts";
import { DOCS } from "./docs-site.ts";
import { COUNT_DOT, DOT_AT_ZERO, RESULT_DOT } from "./dots.ts";
import { escapeText } from "./escape.ts";
import { mascotUrl, urlPart } from "./images.ts";
import {
  outsideMarker,
  type ParsedMerge,
  type ParsedRow,
  type ParsedWaiting,
  parseDashboard,
  RESCAN_MARKER,
  type RootFacts,
  rootMarker,
} from "./marker.ts";
import { MERGE_FOLD_AFTER } from "./merge-row.ts";
import { type AttributionLines, INDENT, type Row, type RowOptions, renderRow } from "./row.ts";
import { scanRunningLine } from "./scan-running.ts";
import { minuteAt, trailMinute, yearIn, zoneLine } from "./time.ts";
import {
  DRIFTED_LINE,
  DRY,
  INSTRUCTION_LINE,
  MERGE_LINE,
  NO_DESTROY_NOTE,
  NOTHING_FROM_THE_CODE,
  NOTHING_TO_DEPLOY,
  PREVIEW_FAILED_LINE,
  READ_ONLY_LINE,
  shortenedNote,
  WAITING_ON_CHECKS_LINE,
  WARM,
} from "./voice.ts";
import { waitingRunLine } from "./waiting-run.ts";

// One successful deploy from the dashboard, from its deployment record
// (record 0003).
export interface RecentDeploy {
  stackId: string;
  ticker: string;
  at: Date;
  runUrl: string;
  // Absent for a deploy that went out (record 0051). A drift repair went out
  // too, and says so (record 0059). "failed" for a deploy that failed (record
  // 0062).
  result?: "in-sync" | "rehearsed" | "drift-repaired" | "drift-gone" | "failed" | undefined;
  // The failure reason of a failed deploy, as its failure line shows it. The
  // trail no longer shows it, to stay on one line (slice 5.10).
  reason?: string | undefined;
  // What a deploy that went out shipped (record 0072), worked out by the
  // core as a row's attribution is. Absent when there is nothing to say.
  shipped?: AttributionLines | undefined;
  // It went out on merge, and `ticker` is whoever merged (record 0095). The
  // line says merged by, where a ticked deploy names the ticker alone.
  onMerge?: boolean | undefined;
}

export interface BodyInput {
  root: RootFacts;
  // Every row block of the body, in any order. A writer hands over the blocks
  // it carries through as `parseDashboard` read them, and its own through
  // `rowBlock`.
  rows: readonly ParsedRow[];
  // Deployment records that ended, in any order. The newest are listed.
  recentlyDeployed: readonly RecentDeploy[];
  // Deploys made outside the dashboard (record 0073), in any order. A full
  // scan finds them in the tool's history, and every other writer carries
  // them as `parseDashboard` read them. They share the list and its length.
  outsideDeploys?: readonly OutsideDeploy[] | undefined;
  // How many lines Recently deployed lists, `dashboard.recentlyDeployed`
  // (record 0062). 0 leaves the section out. Ten when not given.
  recentLength?: number | undefined;
  // The repo the dashboard lives in, `https://github.com/<owner>/<repo>`.
  repoUrl: string;
  // The exact release tag of the running action, or its commit SHA (build
  // plan, section 3). Never a moving tag.
  actionRef: string;
  // `dashboard.personality` (record 0034).
  personality: boolean;
  // `dashboard.timeZone` (record 0089): the zone every time is shown in. The
  // markers keep UTC. UTC when absent.
  timeZone?: string | undefined;
  // `dashboard.readOnly` (slice 2.17): no rescan box, and the line under the
  // Pending heading says why pending rows have no box. The rows themselves
  // are rendered without one by `rowBlock`.
  readOnly?: boolean | undefined;
  // Stacks an `ignore` entry with a reason leaves out, from the config and
  // discovery (record 0051). Listed with the reason in a fold under In sync.
  // They have no row and no marker: every writer lists them from its own
  // config.
  ignored?: readonly IgnoredStack[] | undefined;
  // The updates waiting to merge (record 0054). The scan makes them, and
  // every other writer carries them as `parseDashboard` read them, less the
  // ones it merged.
  merges?: readonly ParsedMerge[] | undefined;
  // The updates waiting on their checks (record 0081), drawn and carried as
  // the merges are. A line for a pull request that has a merge row is left
  // out.
  waiting?: readonly ParsedWaiting[] | undefined;
  // The bulk boxes and confirm boxes under the pending and drifted rows
  // (record 0083). Without it the body has none.
  bulk?: BulkState | undefined;
  // The size budget's first cut after the spinners (record 0072): what each
  // deploy of the trail shipped becomes a count, as a row's names do.
  shortTrail?: boolean | undefined;
  // The layout keys of `dashboard` (record 0114). Absent, or any key of it
  // absent, is the body as it was before them. They change what is drawn and
  // where, never a row block: every block handed in is in the body.
  layout?: BodyLayout | undefined;
}

export type BodyLayout = Partial<
  Pick<
    Config["dashboard"],
    | "sections"
    | "deployingSection"
    | "driftedSection"
    | "inSyncSection"
    | "zeroCounts"
    | "destroyAlert"
    | "pendingDetail"
    | "deployAll"
    | "repairAll"
    | "rescanBox"
    | "footer"
  >
>;

export const RECENTLY_DEPLOYED = 10;

const ACTION_REPO = "sluiceway/sluiceway";
const ACTION_URL = `https://github.com/${ACTION_REPO}`;

// Plain and fixed per state. The pending, failing, deploying and queued
// pictures show how many stacks wait, so their alt texts say the same number
// in words (records 0047, 0066 and 0075).
const ALT: Record<Exclude<HeaderState, "pending">, string> = {
  failing: "Sluiceway: something failed",
  deploying: "Sluiceway: deploying",
  queued: "Sluiceway: queued behind dependencies",
  drift: "Sluiceway: something changed outside the code",
  "first-run": "Sluiceway: no stacks yet",
  "in-sync": "Sluiceway: everything is in sync",
};

function pendingWords(crates: Crates): string {
  if (crates === "more") return `more than ${MAX_CRATES} stacks are pending`;
  return crates === 1 ? "1 stack is pending" : `${crates} stacks are pending`;
}

// The four pictures that have one file per crate count, 0 to 20 and past it
// (records 0047, 0066 and 0075). A pending header always has a pending row.
const COUNTED = ["pending", "failing", "deploying", "queued"] as const;
type Counted = (typeof COUNTED)[number];
const isCounted = (state: HeaderState): state is Counted =>
  (COUNTED as readonly string[]).includes(state);

function countedAlt(state: Counted, crates: Crates): string {
  if (state === "pending") return `Sluiceway: ${pendingWords(crates)}`;
  return crates === 0 ? ALT[state] : `${ALT[state]}, ${pendingWords(crates)}`;
}

// The name part and the fact the signs add, for the states whose picture can
// carry them (records 0043, 0066 and 0075). The fact follows the alt text.
function signed(state: Counted, signs: DestroySigns): { suffix: string; fact: string } {
  const verb =
    signs.deletes && signs.replaces ? "delete or replace" : signs.deletes ? "delete" : "replace";
  const suffix = `${signs.deletes ? "-deletes" : ""}${signs.replaces ? "-replaces" : ""}`;
  const subject = state === "pending" ? "some" : "some changes";
  return { suffix, fact: suffix === "" ? "" : `, ${subject} ${verb} resources` };
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// A freshly rendered row as a row block. Its facts are read back from its own
// marker, so they are the ones every later writer will read.
export function rowBlock(row: Row, options: RowOptions = {}): ParsedRow {
  const [block] = parseDashboard(renderRow(row, options)).rows;
  if (!block) throw new Error("A rendered row did not read back as a row block.");
  return block;
}

// One file per theme, because `<picture>` follows the reader's GitHub theme
// and a media query inside an SVG follows the operating system (record 0033).
// Pending, failing, deploying and queued have one picture per crate count up
// to the maximum, and one past it, and each exists three more times with the
// signs: the delete sign, the replace sign, and both (records 0043, 0047, 0066
// and 0075). Drift, first run and in sync can hold no pending row, so they
// are one picture each. The picture is as wide as the issue and centered in
// it (record 0040).
function picture(
  state: HeaderState,
  crates: Crates,
  signs: DestroySigns,
  actionRef: string,
): string[] {
  let name: string = state;
  let alt: string;
  if (isCounted(state)) {
    const { suffix, fact } = signed(state, signs);
    name = `${state}-${crates}${suffix}`;
    alt = `${countedAlt(state, crates)}${fact}`;
  } else {
    alt = ALT[state];
  }
  const file = (theme: string) => mascotUrl(actionRef, `${name}-${theme}.svg`);
  return [
    '<p align="center">',
    "  <picture>",
    `    <source media="(prefers-color-scheme: dark)" srcset="${file("dark")}">`,
    `    <img alt="${alt}" width="880" src="${file("light")}">`,
    "  </picture>",
    "</p>",
  ];
}

// The count dots of record 0040 are shown whenever there is a header, also
// when the picture carries the destroy sign (record 0043).
// The four state counts always, so the line keeps its shape. Two more facts
// only when they are not 0. The non-breaking space keeps a dot and its count
// on one line in a narrow column.
// Without zero counts (record 0114) a state count of 0 is left out, except
// pending, which the line always starts with.
function countsLine(counts: CountsLineNumbers, dots: boolean, zeros = true): string {
  const { pending, drifted, deploying, previewFailed, inSync, destroying } = counts;
  const failed = counts.failedDeploys;
  const dot = (kind: keyof typeof COUNT_DOT, count: number) =>
    dots ? `${count === 0 ? DOT_AT_ZERO : COUNT_DOT[kind]}&nbsp;` : "";
  const shown = (count: number) => zeros || count > 0;
  const parts = [
    `${dot("pending", pending)}**${pending} pending**`,
    // Only when there is drift (record 0055), so a repo that never checks for
    // it keeps its counts line byte for byte.
    ...(drifted > 0 ? [`${dot("drift", drifted)}${drifted} drifted`] : []),
    ...(shown(deploying) ? [`${dot("deploying", deploying)}${deploying} deploying`] : []),
    ...(shown(previewFailed)
      ? [`${dot("preview-failed", previewFailed)}${previewFailed} preview failed`]
      : []),
    ...(shown(inSync) ? [`${dot("in-sync", inSync)}${inSync} in sync`] : []),
  ];
  // The warning keeps its `:warning:` and gets no dot. It says "delete or
  // replace", as the alert under Pending and the rows' own lines do.
  if (destroying > 0) {
    const words = destroying === 1 ? "stack deletes or replaces" : "stacks delete or replace";
    parts.push(`:warning: **${destroying} pending ${words} resources**`);
  }
  if (failed > 0) parts.push(`${dot("failed", failed)}${plural(failed, "failed deploy")}`);
  return parts.join(" · ");
}

// A writer other than the scan takes these facts from the live body, which a
// person can edit. A time that does not parse is left out, not thrown on.
function time(iso: string | undefined, timeZone: string | undefined): string | undefined {
  const at = new Date(iso ?? "");
  return Number.isNaN(at.getTime()) ? undefined : minuteAt(at, timeZone);
}

function scanLine(root: RootFacts, repoUrl: string, timeZone: string | undefined): string {
  const sha = `[\`${escapeText(root.scanSha.slice(0, 7))}\`](${repoUrl}/commit/${urlPart(root.scanSha)})`;
  const at = time(root.scanAt, timeZone);
  const fullAt = time(root.fullScanAt, timeZone);
  const parts = [
    `Scanned ${sha}${at ? ` on ${at}` : ""}`,
    `[run](${repoUrl}/actions/runs/${urlPart(root.scanRun)})`,
  ];
  if (fullAt) parts.push(`<sub>last full scan ${fullAt}</sub>`);
  return parts.join(" · ");
}

// The day of the scan the body shows picks the good-news line (record 0075).
// It rides on the root marker, so a writer that is not the scan keeps the
// line the scan wrote. A time that does not parse gives no day.
function scanDay(root: RootFacts): Date | undefined {
  const at = new Date(root.scanAt);
  return Number.isNaN(at.getTime()) ? undefined : at;
}

// The one line under the Pending heading (records 0029, 0032 and 0034).
function pendingLine(input: BodyInput, facts: DashboardFacts): string {
  if (facts.pending.length > 0) return input.readOnly ? READ_ONLY_LINE : INSTRUCTION_LINE;
  if (facts.drift.length > 0) return NOTHING_FROM_THE_CODE;
  const lines = input.personality ? WARM : DRY;
  if (facts.headerState === "first-run") return lines.firstRun;
  // A row of a state this version does not know is not known to be calm.
  if (facts.headerState === "in-sync" && facts.unknown.length === 0)
    return lines.goodNews(input.rows.length, scanDay(input.root));
  return NOTHING_TO_DEPLOY;
}

function blocks(rows: readonly ParsedRow[]): string {
  return rows.map((row) => row.text).join("\n");
}

// The trail fits on one line at GitHub's issue width for a stack id of about
// 40 characters (slice 5.10). The stack id is written whole, so the rest is
// short: one result word, none for a plain deploy, and the dot under a header
// already says the rest. A drift repair (record 0059), an empty fresh preview
// and a rehearsal (record 0051), a drift repair that found nothing to repair
// (record 0091), and a failed deploy (record 0062), whose reason stays on the
// row's failure line and in the run's log.
const RESULT_WORDS = {
  "in-sync": "no changes",
  rehearsed: "rehearsed",
  "drift-repaired": "drift fixed",
  "drift-gone": "drift gone",
  failed: "failed",
} as const;

// Under a header each line starts with the dot of its result (slice 4.5), as
// every count does (record 0040): green went out, white nothing to deploy,
// purple rehearsed, and red for a failed deploy (record 0062). Then the
// ticker's login alone and the time without the year of the scan.
function recentLine(
  deploy: RecentDeploy,
  dots: boolean,
  year: number | undefined,
  timeZone: string | undefined,
  short?: boolean,
): string {
  const result = deploy.result ? ` · ${RESULT_WORDS[deploy.result]}` : "";
  // A drift repair went out, so it is green like any deploy (record 0059).
  // Drift gone deployed nothing, so it is white like no changes (record 0091).
  const outcome =
    deploy.result === undefined || deploy.result === "drift-repaired"
      ? "deployed"
      : deploy.result === "drift-gone"
        ? "in-sync"
        : deploy.result;
  const dot = dots ? `${RESULT_DOT[outcome]}&nbsp;` : "";
  const shipped = deploy.shipped
    ? `\n${INDENT}${short ? deploy.shipped.counted : deploy.shipped.full}`
    : "";
  const who = `${deploy.onMerge ? "merged by " : ""}${escapeText(deploy.ticker)}`;
  return `- ${dot}${escapeText(deploy.stackId)}${result} · ${who} · ${trailMinute(
    deploy.at,
    year,
    timeZone,
  )} · [run](${deploy.runUrl})${shipped}`;
}

// The lines of the trail that are shown, newest first. Attribution works out
// what these shipped and no others (record 0072).
export function newestTrail<T extends { at: Date; stackId: string }>(
  deploys: readonly T[],
  length: number | undefined,
): T[] {
  return [...deploys]
    .sort((a, b) => b.at.getTime() - a.at.getTime() || byCodeUnit(a.stackId, b.stackId))
    .slice(0, length ?? RECENTLY_DEPLOYED);
}

// A deploy made outside the dashboard (record 0073): when and from which
// commit, never who. The tool's history does not say who, and the people
// behind the commit are not the person who deployed it. Green, because it
// went out. Its facts ride on the marker at the end, so every writer can
// draw the line again.
function outsideLine(
  deploy: OutsideDeploy,
  repoUrl: string,
  dots: boolean,
  year: number | undefined,
  timeZone: string | undefined,
): string {
  const dot = dots ? `${RESULT_DOT.deployed}&nbsp;` : "";
  const verb = deploy.kind === "destroy" ? "destroyed" : "deployed";
  const commit =
    deploy.commit === undefined
      ? ""
      : `, from [\`${deploy.commit.slice(0, 7)}\`](${repoUrl}/commit/${urlPart(deploy.commit)})${
          deploy.dirty ? " with uncommitted changes" : ""
        }`;
  return `- ${dot}${escapeText(deploy.stackId)} · ${verb} outside the dashboard${commit} · ${trailMinute(
    deploy.at,
    year,
    timeZone,
  )} ${outsideMarker(deploy)}`;
}

// A `v1.2.3` tag reads as itself, a commit SHA as its first seven characters.
function version(actionRef: string): string {
  return /^[0-9a-f]{40,}$/.test(actionRef) ? `\`${actionRef.slice(0, 7)}\`` : escapeText(actionRef);
}

// The sections in the order `dashboard.sections` gives. A list that leaves a
// section out, or one written before a section existed, gets it in the
// default place after the ones it names (record 0114).
function sectionOrder(layout: BodyLayout): DashboardSection[] {
  const named = layout.sections ?? [];
  return [...named, ...DASHBOARD_SECTIONS.filter((name) => !named.includes(name))];
}

// Deploying comes first by default while it has rows: what is going out is
// what the person is watching, and the section is gone when it is empty, so
// pending loses nothing (record 0063). Off, its rows go to the fold.
function deployingSection(facts: DashboardFacts, layout: BodyLayout, off: ParsedRow[]): string[] {
  const { deploying } = facts;
  if (deploying.length === 0) return [];
  if (layout.deployingSection === false) {
    off.push(...deploying);
    return [];
  }
  return ["## Deploying", blocks(deploying)];
}

// By default above Pending, because a tick there also ends in a deploy
// (record 0054). Of two lines for one pull request the first stays.
function updatesSection(input: BodyInput): string[] {
  const out: string[] = [];
  const merges = [...(input.merges ?? [])]
    .filter((merge, index, all) => all.findIndex((one) => one.pr === merge.pr) === index)
    .sort((a, b) => a.pr - b.pr);
  const waiting = [...(input.waiting ?? [])]
    .filter(
      (line, index, all) =>
        all.findIndex((one) => one.pr === line.pr) === index &&
        !merges.some((merge) => merge.pr === line.pr),
    )
    .sort((a, b) => a.pr - b.pr);
  // The section is gone when nothing waits at all.
  if (merges.length > 0 || waiting.length > 0) out.push("## Updates waiting to merge");
  if (merges.length > 0) {
    out.push(MERGE_LINE);
    out.push(
      merges
        .slice(0, MERGE_FOLD_AFTER)
        .map((merge) => merge.text)
        .join("\n"),
    );
    // The rest in a fold (record 0064). A box in it ticks like any other.
    const folded = merges.slice(MERGE_FOLD_AFTER);
    if (folded.length > 0) {
      out.push(
        `<details><summary>${folded.length} more ${folded.length === 1 ? "update" : "updates"} waiting to merge</summary>`,
        folded.map((merge) => merge.text).join("\n"),
        "</details>",
      );
    }
  }
  // Under the ones that can be merged, and outside the fold: they count
  // toward none of its numbers, since nothing can be ticked on them (record
  // 0081).
  if (waiting.length > 0) {
    out.push(WAITING_ON_CHECKS_LINE, waiting.map((line) => line.text).join("\n"));
  }
  return out;
}

// The line under a section's rows that deploys them all (record 0083), unless
// its key turns it off (record 0114).
function bulkLines(input: BodyInput, section: "pending" | "drift"): string[] {
  const wanted = section === "pending" ? input.layout?.deployAll : input.layout?.repairAll;
  if (wanted === false) return [];
  const line = input.bulk && sectionBulk(input.bulk, input.rows, section);
  return line ? [renderBulkLine(line)] : [];
}

// Pending is always shown, and cannot be turned off (record 0114).
function pendingSection(input: BodyInput, facts: DashboardFacts, layout: BodyLayout): string[] {
  const out = ["## Pending", pendingLine(input, facts)];
  // The destroy alert sits right above the pending list (records 0062 and
  // 0075). It names drifted stacks too. With `destroyAlert: always` a body
  // with nothing to warn about says so in its place (record 0114).
  if (facts.alert) out.push(facts.alert);
  else if (layout.destroyAlert === "always") out.push(NO_DESTROY_NOTE);
  if (facts.pending.length > 0) out.push(blocks(facts.pending));
  // Under the rows it deploys (record 0083).
  out.push(...bulkLines(input, "pending"));
  return out;
}

// By default right under Pending: its rows have boxes too (record 0055). Off,
// a row with a failure line or a resource gone stays open, since the destroy
// alert names it, and the rest go to the fold, with no repair all box.
function driftedSection(
  input: BodyInput,
  facts: DashboardFacts,
  layout: BodyLayout,
  off: ParsedRow[],
): string[] {
  const drifted = facts.drift;
  if (drifted.length === 0) return [];
  if (layout.driftedSection === false) {
    const open = drifted.filter((row) => row.failed || (row.known && (row.gone ?? 0) > 0));
    off.push(...drifted.filter((row) => !open.includes(row)));
    return open.length > 0 ? ["## Drifted", DRIFTED_LINE, blocks(open)] : [];
  }
  return ["## Drifted", DRIFTED_LINE, blocks(drifted), ...bulkLines(input, "drift")];
}

// Never turned off: a preview failure is what a person must see (record
// 0114).
function previewFailedSection(facts: DashboardFacts): string[] {
  const { previewFailed } = facts;
  if (previewFailed.length === 0) return [];
  return ["## Preview failed", PREVIEW_FAILED_LINE, blocks(previewFailed)];
}

// In sync rows are calm and sit in a fold. One with a failure line is not
// calm: it is listed open, above the fold, at every setting. Its state stays
// in sync. The stacks left out with a reason get a fold of their own under
// it. As a list every row is open; off, the calm rows go to the fold at the
// end of the sections and the ignored stacks are not listed (record 0114).
function inSyncSection(
  input: BodyInput,
  facts: DashboardFacts,
  layout: BodyLayout,
  off: ParsedRow[],
): string[] {
  const out: string[] = [];
  const shown = layout.inSyncSection ?? "fold";
  const { inSync } = facts;
  const ignored =
    shown === "off"
      ? []
      : [...(input.ignored ?? [])].sort((a, b) => byCodeUnit(a.stackId, b.stackId));
  const loud = inSync.filter((row) => row.failed);
  const quiet = inSync.filter((row) => !row.failed);
  if (shown === "off") off.push(...quiet);
  if (loud.length === 0 && ignored.length === 0 && (shown === "off" || quiet.length === 0))
    return out;
  out.push("## In sync");
  if (shown === "list") {
    if (inSync.length > 0) out.push(blocks([...loud, ...quiet]));
  } else {
    if (loud.length > 0) out.push(blocks(loud));
    if (quiet.length > 0 && shown === "fold") {
      const summary =
        loud.length > 0
          ? `${quiet.length} more in sync`
          : `${plural(quiet.length, "stack")} in sync`;
      out.push(`<details><summary>${summary}</summary>`, blocks(quiet), "</details>");
    }
  }
  if (ignored.length > 0) {
    out.push(
      `<details><summary>${plural(ignored.length, "stack")} left out by ignore</summary>`,
      ignored
        .map(({ stackId, reason }) => `- ${escapeText(stackId)} · ${escapeText(reason)}`)
        .join("\n"),
      "</details>",
    );
  }
  return out;
}

// The dashboard's own deploys and the ones made outside it, in one list by
// time (record 0073). Of two lines for one outside deploy the first stays.
// `dashboard.recentlyDeployed: 0` leaves it out (record 0062).
function recentSection(input: BodyInput): string[] {
  const outside = (input.outsideDeploys ?? []).filter(
    (deploy, index, all) =>
      all.findIndex(
        (one) =>
          one.stackId === deploy.stackId &&
          one.kind === deploy.kind &&
          one.at.getTime() === deploy.at.getTime(),
      ) === index,
  );
  // A time of the scan's year leaves its year out (slice 5.10). The scan
  // line shows the year, and one that does not parse leaves every year in.
  const scanAt = new Date(input.root.scanAt ?? "");
  const { timeZone } = input;
  const year = Number.isNaN(scanAt.getTime()) ? undefined : yearIn(scanAt, timeZone);
  const entries = [
    ...input.recentlyDeployed.map((deploy) => ({
      at: deploy.at,
      stackId: deploy.stackId,
      line: () => recentLine(deploy, input.personality, year, timeZone, input.shortTrail),
    })),
    ...outside.map((deploy) => ({
      at: deploy.at,
      stackId: deploy.stackId,
      line: () => outsideLine(deploy, input.repoUrl, input.personality, year, timeZone),
    })),
  ];
  const recent = newestTrail(entries, input.recentLength);
  if (recent.length === 0) return [];
  return [
    "## Recently deployed",
    zoneLine(timeZone),
    recent.map((entry) => entry.line()).join("\n"),
  ];
}

export function renderBody(input: BodyInput): string {
  const facts = dashboardFacts(input.rows);
  const layout = input.layout ?? {};

  // Paragraphs, each followed by a blank line.
  const out: string[] = [rootMarker(input.root)];
  // Under a header the two lines are one centered block, and the blank lines
  // inside it keep both rendered as Markdown (record 0040). Without a header
  // they are what record 0029 made them.
  const counts = countsLine(facts.counts, input.personality, layout.zeroCounts !== false);
  const scan = scanLine(input.root, input.repoUrl, input.timeZone);
  // A scan that is running comes right under the scan line, and a run that
  // waits for a runner under that (records 0108 and 0086).
  const running = scanRunningLine(input.root, input.repoUrl, input.timeZone);
  const runWaits = waitingRunLine(input.root, input.repoUrl, input.timeZone);
  const scanLines = [scan, running, runWaits].filter((line) => line !== undefined);
  if (input.personality)
    out.push(
      picture(facts.headerState, facts.crates, facts.signs, input.actionRef).join("\n"),
      '<div align="center">',
      counts,
      ...scanLines,
      "</div>",
    );
  else out.push(counts, ...scanLines);

  // The note about shortened rows (record 0028) is counted from the markers
  // like everything else up here, so it stays when a writer that is not the
  // scan regenerates the body.
  const { pending, shortened } = facts;
  if (shortened.pending + shortened.drift > 0) {
    out.push(
      shortenedNote([
        { section: "pending", shortened: shortened.pending, of: pending.length },
        { section: "drifted", shortened: shortened.drift, of: facts.drift.length },
      ]),
    );
  }

  // Each section in the order `dashboard.sections` gives, by default the one
  // of record 0063 (record 0114). A section with nothing to show is left out.
  const off: ParsedRow[] = [];
  const draw: Record<DashboardSection, () => string[]> = {
    deploying: () => deployingSection(facts, layout, off),
    updates: () => updatesSection(input),
    pending: () => pendingSection(input, facts, layout),
    drifted: () => driftedSection(input, facts, layout, off),
    previewFailed: () => previewFailedSection(facts),
    inSync: () => inSyncSection(input, facts, layout, off),
    recentlyDeployed: () => recentSection(input),
  };
  for (const name of sectionOrder(layout)) out.push(...draw[name]());

  // The rows of the sections that are off (record 0114). Every writer reads
  // and carries the row blocks, so they stay in the body, in one closed fold
  // at the end of the sections.
  if (off.length > 0) {
    out.push(
      `<details><summary>${plural(off.length, "stack")} in sections this dashboard does not show</summary>`,
      blocks(off),
      "</details>",
    );
  }

  // Rows of a state this version does not know: a plain list at the end of
  // the body (record 0009). The rule keeps it apart from the rescan box.
  const { unknown } = facts;
  const rescan = !input.readOnly && layout.rescanBox !== false;
  const footer = layout.footer !== false;
  if (rescan || footer || unknown.length > 0) out.push("---");
  // The rescan box needs a `resolve` job as much as a row's box does.
  if (rescan) out.push(`- [ ] Rescan all stacks ${RESCAN_MARKER}`);
  if (footer)
    out.push(
      `<sub>[Sluiceway](${ACTION_URL}) ${version(input.actionRef)} · [docs](${DOCS.home})</sub>`,
    );
  if (unknown.length > 0) out.push(blocks(unknown));

  return out.join("\n\n");
}
