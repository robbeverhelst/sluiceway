// Everything outside the row blocks (records 0009 and 0029): a pure function
// of the root facts, the row blocks and the deployment records. Every writer
// regenerates it, and nothing in it is ever patched or carried through.

import type { IgnoredStack } from "../core/config.ts";
import { IN_SYNC_DESCRIPTION, REHEARSED_DESCRIPTION } from "../core/deployment.ts";
import type { OutsideDeploy } from "../core/outside-deploy.ts";
import { destroyAlert } from "./destroy-alert.ts";
import { destroySign } from "./destroy-sign.ts";
import { COUNT_DOT, DOT_AT_ZERO, RESULT_DOT } from "./dots.ts";
import { escapeText } from "./escape.ts";
import { type HeaderState, headerState } from "./header-state.ts";
import { mascotUrl, urlPart } from "./images.ts";
import {
  outsideMarker,
  type ParsedMerge,
  type ParsedRow,
  parseDashboard,
  RESCAN_MARKER,
  type RootFacts,
  rootMarker,
} from "./marker.ts";
import { MERGE_FOLD_AFTER } from "./merge-row.ts";
import { type Crates, MAX_CRATES, pendingCrates } from "./pending-crates.ts";
import { type Row, type RowOptions, renderRow } from "./row.ts";
import { utcMinute } from "./time.ts";
import {
  DRIFTED_LINE,
  DRY,
  INSTRUCTION_LINE,
  MERGE_LINE,
  NOTHING_FROM_THE_CODE,
  NOTHING_TO_DEPLOY,
  PREVIEW_FAILED_LINE,
  READ_ONLY_LINE,
  shortenedNote,
  WARM,
} from "./voice.ts";

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
  result?: "in-sync" | "rehearsed" | "drift-repaired" | "failed" | undefined;
  // The failure reason of a failed deploy, as its failure line shows it.
  reason?: string | undefined;
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
}

export const RECENTLY_DEPLOYED = 10;

const ACTION_REPO = "sluiceway/sluiceway";
const ACTION_URL = `https://github.com/${ACTION_REPO}`;

// Plain and fixed per state. The pending, failing and deploying pictures show
// how many stacks wait, so their alt texts say the same number in words
// (records 0047 and 0066).
const ALT: Record<Exclude<HeaderState, "pending">, string> = {
  failing: "Sluiceway: something failed",
  deploying: "Sluiceway: deploying",
  drift: "Sluiceway: something changed outside the code",
  "first-run": "Sluiceway: no stacks yet",
  "in-sync": "Sluiceway: everything is in sync",
};

function pendingWords(crates: Crates): string {
  if (crates === "more") return `more than ${MAX_CRATES} stacks are pending`;
  return crates === 1 ? "1 stack is pending" : `${crates} stacks are pending`;
}

// The three pictures that have one file per crate count, 0 to 12 and past it
// (records 0047 and 0066). A pending header always has a pending row.
const COUNTED = ["pending", "failing", "deploying"] as const;
type Counted = (typeof COUNTED)[number];
const isCounted = (state: HeaderState): state is Counted =>
  (COUNTED as readonly string[]).includes(state);

function countedAlt(state: Counted, crates: Crates): string {
  if (state === "pending") return `Sluiceway: ${pendingWords(crates)}`;
  return crates === 0 ? ALT[state] : `${ALT[state]}, ${pendingWords(crates)}`;
}

// The alt text plus the fact, for the three states whose picture can carry
// the destroy sign (records 0043 and 0066).
const SIGNED_FACT: Record<Counted, string> = {
  pending: ", some delete or replace resources",
  failing: ", some changes delete or replace resources",
  deploying: ", some changes delete or replace resources",
};

type KnownRow = Extract<ParsedRow, { known: true }>;

// A queued row is counted as deploying (record 0056).
function placed(row: KnownRow): KnownRow["state"] {
  return row.state === "queued" ? "deploying" : row.state;
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
// Pending, failing and deploying have one picture per crate count up to the
// maximum, and one past it, and each exists once more with the destroy sign
// (records 0043, 0047 and 0066). Drift, first run and in sync can hold no
// pending row, so they are one picture each. The picture is as wide as the
// issue and centered in it (record 0040).
function picture(state: HeaderState, crates: Crates, sign: boolean, actionRef: string): string[] {
  const counted = isCounted(state);
  const base = counted ? `${state}-${crates}` : state;
  const signed = sign && counted;
  const name = signed ? `${base}-destroys` : base;
  const plainAlt = counted ? countedAlt(state, crates) : ALT[state];
  const alt = signed ? `${plainAlt}${SIGNED_FACT[state]}` : plainAlt;
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
function countsLine(rows: KnownRow[], dots: boolean): string {
  const of = (state: KnownRow["state"]) => rows.filter((row) => placed(row) === state).length;
  const dot = (kind: keyof typeof COUNT_DOT, count: number) =>
    dots ? `${count === 0 ? DOT_AT_ZERO : COUNT_DOT[kind]}&nbsp;` : "";
  const destroying = rows.filter((row) => row.state === "pending" && row.destroys > 0).length;
  const failed = rows.filter((row) => row.failed).length;
  const parts = [
    `${dot("pending", of("pending"))}**${of("pending")} pending**`,
    // Only when there is drift (record 0055), so a repo that never checks for
    // it keeps its counts line byte for byte.
    ...(of("drift") > 0 ? [`${dot("drift", of("drift"))}${of("drift")} drifted`] : []),
    `${dot("deploying", of("deploying"))}${of("deploying")} deploying`,
    `${dot("preview-failed", of("preview-failed"))}${of("preview-failed")} preview failed`,
    `${dot("in-sync", of("in-sync"))}${of("in-sync")} in sync`,
  ];
  // The warning keeps its `:warning:` and gets no dot.
  if (destroying > 0) {
    const words = destroying === 1 ? "stack destroys" : "stacks destroy";
    parts.push(`:warning: **${destroying} pending ${words} resources**`);
  }
  if (failed > 0) parts.push(`${dot("failed", failed)}${plural(failed, "failed deploy")}`);
  return parts.join(" · ");
}

// A writer other than the scan takes these facts from the live body, which a
// person can edit. A time that does not parse is left out, not thrown on.
function time(iso: string | undefined): string | undefined {
  const at = new Date(iso ?? "");
  return Number.isNaN(at.getTime()) ? undefined : utcMinute(at);
}

function scanLine(root: RootFacts, repoUrl: string): string {
  const sha = `[\`${escapeText(root.scanSha.slice(0, 7))}\`](${repoUrl}/commit/${urlPart(root.scanSha)})`;
  const at = time(root.scanAt);
  const fullAt = time(root.fullScanAt);
  const parts = [
    `Scanned ${sha}${at ? ` on ${at}` : ""}`,
    `[run](${repoUrl}/actions/runs/${urlPart(root.scanRun)})`,
  ];
  if (fullAt) parts.push(`<sub>last full scan ${fullAt}</sub>`);
  return parts.join(" · ");
}

// The one line under the Pending heading (records 0029, 0032 and 0034).
function pendingLine(input: BodyInput, state: HeaderState, pending: number): string {
  if (pending > 0) return input.readOnly ? READ_ONLY_LINE : INSTRUCTION_LINE;
  if (input.rows.some((row) => row.known && row.state === "drift")) return NOTHING_FROM_THE_CODE;
  const lines = input.personality ? WARM : DRY;
  if (state === "first-run") return lines.firstRun;
  // A row of a state this version does not know is not known to be calm.
  if (state === "in-sync" && input.rows.every((row) => row.known))
    return lines.goodNews(input.rows.length);
  return NOTHING_TO_DEPLOY;
}

function blocks(rows: readonly ParsedRow[]): string {
  return rows.map((row) => row.text).join("\n");
}

// The trail of record 0051: a line whose record found nothing to deploy, or
// was a rehearsal, says so. So does a deploy that put drift back (record
// 0059), in the words the Drifted section uses.
const DRIFT_REPAIRED_WORDS = "put back what changed outside the code";

const RESULT_WORDS = {
  "in-sync": IN_SYNC_DESCRIPTION,
  rehearsed: REHEARSED_DESCRIPTION,
  "drift-repaired": DRIFT_REPAIRED_WORDS,
} as const;

// Under a header each line starts with the dot of its result (slice 4.5), as
// every count does (record 0040): green went out, white nothing to deploy,
// purple rehearsed, and red for a failed deploy (record 0062).
function recentLine(deploy: RecentDeploy, dots: boolean): string {
  // A failed deploy says so with its reason, as its failure line does (record
  // 0062). The reason is display text from the record, never trusted.
  const words =
    deploy.result === "failed"
      ? `failed: ${escapeText(deploy.reason ?? "")}`
      : deploy.result && RESULT_WORDS[deploy.result];
  const result = words ? ` · ${words}` : "";
  // A drift repair went out, so it is green like any deploy (record 0059).
  const outcome =
    deploy.result === undefined || deploy.result === "drift-repaired" ? "deployed" : deploy.result;
  const dot = dots ? `${RESULT_DOT[outcome]}&nbsp;` : "";
  return `- ${dot}${escapeText(deploy.stackId)} · ticked by ${escapeText(deploy.ticker)}${result} · ${utcMinute(
    deploy.at,
  )} · [run](${deploy.runUrl})`;
}

// A deploy made outside the dashboard (record 0073): when and from which
// commit, never who. The tool's history does not say who, and the people
// behind the commit are not the person who deployed it. Green, because it
// went out. Its facts ride on the marker at the end, so every writer can
// draw the line again.
function outsideLine(deploy: OutsideDeploy, repoUrl: string, dots: boolean): string {
  const dot = dots ? `${RESULT_DOT.deployed}&nbsp;` : "";
  const verb = deploy.kind === "destroy" ? "destroyed" : "deployed";
  const commit =
    deploy.commit === undefined
      ? ""
      : `, from commit [\`${deploy.commit.slice(0, 7)}\`](${repoUrl}/commit/${urlPart(deploy.commit)})${
          deploy.dirty ? " with uncommitted changes" : ""
        }`;
  return `- ${dot}${escapeText(deploy.stackId)} · ${verb} outside the dashboard${commit} · ${utcMinute(
    deploy.at,
  )} ${outsideMarker(deploy)}`;
}

// A `v1.2.3` tag reads as itself, a commit SHA as its first seven characters.
function version(actionRef: string): string {
  return /^[0-9a-f]{40,}$/.test(actionRef) ? `\`${actionRef.slice(0, 7)}\`` : escapeText(actionRef);
}

export function renderBody(input: BodyInput): string {
  const rows = [...input.rows].sort((a, b) => byCodeUnit(a.stackId, b.stackId));
  const known = rows.filter((row) => row.known);
  const of = (state: KnownRow["state"]) => known.filter((row) => row.state === state);
  const state = headerState(rows);

  // Paragraphs, each followed by a blank line.
  const out: string[] = [rootMarker(input.root)];
  // Under a header the two lines are one centered block, and the blank lines
  // inside it keep both rendered as Markdown (record 0040). Without a header
  // they are what record 0029 made them.
  const counts = countsLine(known, input.personality);
  const scan = scanLine(input.root, input.repoUrl);
  if (input.personality)
    out.push(
      picture(state, pendingCrates(rows), destroySign(rows), input.actionRef).join("\n"),
      '<div align="center">',
      counts,
      scan,
      "</div>",
    );
  else out.push(counts, scan);

  // The note about shortened rows (record 0028) is counted from the markers
  // like everything else up here, so it stays when a writer that is not the
  // scan regenerates the body.
  const pending = of("pending");
  const shortened = pending.filter((row) => row.shortened > 0).length;
  if (shortened > 0) out.push(shortenedNote(shortened, pending.length));

  // Deploying comes first while it has rows: what is going out is what the
  // person is watching, and the section is gone when it is empty, so pending
  // loses nothing (record 0063).
  const deploying = [...of("deploying"), ...of("queued")].sort((a, b) =>
    byCodeUnit(a.stackId, b.stackId),
  );
  if (deploying.length > 0) out.push("## Deploying", blocks(deploying));

  // Above Pending, because a tick there also ends in a deploy (record 0054).
  // Of two lines for one pull request the first stays.
  const merges = [...(input.merges ?? [])]
    .filter((merge, index, all) => all.findIndex((one) => one.pr === merge.pr) === index)
    .sort((a, b) => a.pr - b.pr);
  if (merges.length > 0) {
    out.push("## Updates waiting to merge", MERGE_LINE);
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

  // Pending is always shown. The other sections are left out when empty.
  out.push("## Pending", pendingLine(input, state, pending.length));
  // The destroy alert sits right above the pending list (record 0062).
  const alert = destroyAlert(pending);
  if (alert) out.push(alert);
  if (pending.length > 0) out.push(blocks(pending));

  // Drift sits right under Pending: its rows have boxes too (record 0055).
  const drifted = of("drift");
  if (drifted.length > 0) out.push("## Drifted", DRIFTED_LINE, blocks(drifted));

  const previewFailed = of("preview-failed");
  if (previewFailed.length > 0)
    out.push("## Preview failed", PREVIEW_FAILED_LINE, blocks(previewFailed));

  // In sync rows are calm and sit in a fold. One with a failure line is not
  // calm: it is listed open, above the fold. Its state stays in sync. The
  // stacks left out with a reason get a fold of their own under it.
  const inSync = of("in-sync");
  const ignored = [...(input.ignored ?? [])].sort((a, b) => byCodeUnit(a.stackId, b.stackId));
  if (inSync.length > 0 || ignored.length > 0) {
    const loud = inSync.filter((row) => row.failed);
    const quiet = inSync.filter((row) => !row.failed);
    out.push("## In sync");
    if (loud.length > 0) out.push(blocks(loud));
    if (quiet.length > 0) {
      const summary =
        loud.length > 0
          ? `${quiet.length} more in sync`
          : `${plural(quiet.length, "stack")} in sync`;
      out.push(`<details><summary>${summary}</summary>`, blocks(quiet), "</details>");
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
  }

  // The dashboard's own deploys and the ones made outside it, in one list by
  // time (record 0073). Of two lines for one outside deploy the first stays.
  const outside = (input.outsideDeploys ?? []).filter(
    (deploy, index, all) =>
      all.findIndex(
        (one) =>
          one.stackId === deploy.stackId &&
          one.kind === deploy.kind &&
          one.at.getTime() === deploy.at.getTime(),
      ) === index,
  );
  const recent = [
    ...input.recentlyDeployed.map((deploy) => ({
      at: deploy.at,
      stackId: deploy.stackId,
      line: () => recentLine(deploy, input.personality),
    })),
    ...outside.map((deploy) => ({
      at: deploy.at,
      stackId: deploy.stackId,
      line: () => outsideLine(deploy, input.repoUrl, input.personality),
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime() || byCodeUnit(a.stackId, b.stackId))
    .slice(0, input.recentLength ?? RECENTLY_DEPLOYED);
  if (recent.length > 0)
    out.push("## Recently deployed", recent.map((entry) => entry.line()).join("\n"));

  // The rescan box needs a `resolve` job as much as a row's box does.
  out.push("---");
  if (!input.readOnly) out.push(`- [ ] Rescan all stacks ${RESCAN_MARKER}`);
  out.push(
    `<sub>[Sluiceway](${ACTION_URL}) ${version(input.actionRef)} · [docs](${ACTION_URL}#readme)</sub>`,
  );

  // Rows of a state this version does not know: a plain list at the end of
  // the body (record 0009). The footer line keeps it apart from the rescan box.
  const unknown = rows.filter((row) => !row.known);
  if (unknown.length > 0) out.push(blocks(unknown));

  return out.join("\n\n");
}
