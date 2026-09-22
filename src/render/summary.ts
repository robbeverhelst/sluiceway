// The summary of a scan (records 0021 and 0037): the page of the workflow run
// that shows every previewed stack's diff, so a shortened or redacted row has a
// full version to link to. It is rendered from the same diffs as the rows and
// shows nothing a row could not show. It is never redacted (record 0023).

import type { Diff } from "../core/diff.ts";
import { orderChanges } from "./changes.ts";
import { PASTE_NOTE, unrelatedBlock, whereFilesBelong } from "./check.ts";
import { escapeText } from "./escape.ts";
import {
  byCodeUnit,
  changeLine,
  counts,
  destroyWords,
  driftCounts,
  driftLine,
  plural,
  sortedDrift,
} from "./row.ts";

// A merged pull request or a direct push that a stack claims since its last
// successful deploy (record 0026). The core works them out and the glue hands
// them over as data. The summary has room for what a row leaves out: the title
// of a pull request and the first line of a direct push's message.
export type SummaryMerge =
  | { kind: "pull-request"; number: number; title: string; url: string; author?: string }
  | { kind: "push"; sha: string; message: string; url: string; author?: string };

// One previewed stack: its diff, or why there is none. A diff without changes
// is a stack in sync.
export type SummaryStack =
  | {
      kind: "diff";
      diff: Diff;
      // Newest first. Absent when the lookup failed: attribution never blocks.
      merges?: SummaryMerge[] | undefined;
    }
  | {
      kind: "preview-failed";
      stackId: string;
      // A failure reason from the fixed list (record 0022), as display text.
      reason: string;
      // The `ignore` glob that takes the stack off the dashboard, for a stack
      // that does not exist in the backend (onboarding log, hurdle 9).
      ignore?: string | undefined;
    };

type FailedStack = Extract<SummaryStack, { kind: "preview-failed" }>;

type DiffStack = Extract<SummaryStack, { kind: "diff" }>;

// GitHub drops a step summary over 1 MiB whole (record 0037). Counted in UTF-8
// bytes on the final text.
export const SUMMARY_BUDGET = 1_000_000;

export interface Summary {
  text: string;
  // The size of `text` in UTF-8 bytes.
  bytes: number;
  // How many pending stacks show less than their whole diff.
  shortened: number;
  // False when the text is over the budget with every stack cut as far as it
  // goes. GitHub would drop it whole, so the caller does not write it. The job
  // log still holds every diff.
  fits: boolean;
}

export interface SummaryOptions {
  budget?: number | undefined;
  // The page of the job whose log holds every stack's group (record 0044).
  // Without it the summary names the job log and does not link it.
  jobLogUrl?: string | undefined;
  // The job log holds the tool's own diff of every pending stack (record
  // 0048), and the summary says so under its counts.
  toolDiffInLog?: boolean | undefined;
  // A push that fell back to a full scan because no stack claims some of its
  // changed files (record 0010). The summary names them and offers the block
  // the check prints (record 0042, onboarding log hurdle 5).
  unclaimed?: UnclaimedFiles | undefined;
}

export interface UnclaimedFiles {
  // The changed files that no stack claims, the config file left out.
  files: string[];
  // The scan.unrelated globs the config has.
  unrelated: string[];
  // The globs offered for the files, from the check's fixed list.
  suggested: string[];
  // The lockfiles and package manifests among the files, which the hint names
  // as ones to keep off scan.unrelated (issue 164).
  shared: string[];
}

// The anchor of a stack's entry (record 0044). GitHub keeps the id of an
// `<a>` in a summary, with `user-content-` in front, and gives a heading no id
// of its own. A lower case letter or a digit stays as it is, and every other
// character is written as its code point in hex between two dashes, so two
// stack ids never share an anchor.
export function stackAnchor(stackId: string): string {
  let encoded = "";
  for (const char of stackId) {
    encoded += /^[a-z0-9]$/.test(char) ? char : `-${char.codePointAt(0)?.toString(16)}-`;
  }
  return `sluiceway-${encoded}`;
}

function anchorTag(stackId: string): string {
  return `<a id="${stackAnchor(stackId)}"></a>`;
}

function indexLink(stackId: string): string {
  return `[${escapeText(stackId)}](#user-content-${stackAnchor(stackId)})`;
}

function jobLog(options: SummaryOptions): string {
  return options.jobLogUrl === undefined ? "job log" : `[job log](${options.jobLogUrl})`;
}

// How much of a pending stack the summary shows (record 0037). The pull request
// list goes before any change line, and destroys are cut last, all or none.
//   0  in full
//   1  the list of pull requests and direct pushes becomes a count
//   2  the changes that destroy nothing become one line with their count
//   3  no change lines at all, and the warning carries the count of destroys
type SummaryLevel = 0 | 1 | 2 | 3;
const LEVELS: SummaryLevel[] = [0, 1, 2, 3];

function firstLine(message: string): string {
  return message.split(/\r?\n/, 1)[0] ?? "";
}

function mergeLine(merge: SummaryMerge): string {
  const label =
    merge.kind === "pull-request"
      ? `#${merge.number} ${escapeText(merge.title)}`
      : `${merge.sha.slice(0, 7)} ${escapeText(firstLine(merge.message))}`;
  const by = merge.author === undefined ? "" : ` by ${escapeText(merge.author)}`;
  return `- [${label}](${merge.url})${by}`;
}

function mergeCounts(merges: SummaryMerge[]): string {
  const of = (kind: SummaryMerge["kind"]) => merges.filter((merge) => merge.kind === kind).length;
  return [
    of("pull-request") && plural(of("pull-request"), "pull request"),
    of("push") && `${of("push")} direct push${of("push") === 1 ? "" : "es"}`,
  ]
    .filter(Boolean)
    .join(" and ");
}

// The parts of one stack's entry. Parts are joined by a blank line, so a list
// never runs into the list before it.
function diffParts(stack: DiffStack, level: SummaryLevel, options: SummaryOptions): string[] {
  const { deletes, replaces, others } = orderChanges(stack.diff);
  const destroys = [...deletes, ...replaces];
  const parts = [
    `#### ${anchorTag(stack.diff.stackId)}${escapeText(stack.diff.stackId)}`,
    counts([...destroys, ...others]),
  ];
  if (destroys.length > 0) {
    parts.push(
      level >= 3
        ? `:warning: **${destroyWords(deletes.length, replaces.length)}, too many to list here.** Read the ${jobLog(options)} before you tick.`
        : destroys.map((change) => `- :warning: ${changeLine(change)}`).join("\n"),
    );
  }
  if (others.length > 0) {
    const inside = plural(others.length, destroys.length > 0 ? "other change" : "change");
    if (level >= 2) parts.push(`${inside} not listed here, see the ${jobLog(options)}.`);
    else {
      parts.push(
        `<details><summary>${inside}</summary>`,
        others.map((change) => `- ${changeLine(change)}`).join("\n"),
        "</details>",
      );
    }
  }
  // The drift the row also shows, in full at every level (record 0055).
  const drift = sortedDrift(stack.diff);
  if (drift.length > 0) {
    parts.push(
      `${driftCounts(drift)}:`,
      drift.map((change) => `- ${driftLine(change)}`).join("\n"),
    );
  }
  const merges = stack.merges ?? [];
  if (merges.length > 0) {
    if (level >= 1) parts.push(`From ${mergeCounts(merges)}, not listed here.`);
    else parts.push(`From ${mergeCounts(merges)}:`, merges.map(mergeLine).join("\n"));
  }
  return parts;
}

// The glob is written as a quoted string, which is valid YAML whatever the
// stack id holds, so it can be pasted under `ignore` as it is.
function failedLine(stack: FailedStack, options: SummaryOptions): string {
  const id = escapeText(stack.stackId);
  let line = `- ${anchorTag(stack.stackId)}**${id}** · ${escapeText(stack.reason)}`;
  if (options.jobLogUrl !== undefined) {
    line += ` · the tool's own words are in the ${jobLog(options)}, in the group <code>${id}</code>`;
  }
  if (stack.ignore === undefined) return line;
  const glob = escapeText(JSON.stringify(stack.ignore));
  return `${line} · create it, or take it off the dashboard with <code>${glob}</code> under <code>ignore</code> in <code>sluiceway.yaml</code>`;
}

function stackIdOf(stack: SummaryStack): string {
  return stack.kind === "diff" ? stack.diff.stackId : stack.stackId;
}

const ENCODER = new TextEncoder();

function byteLength(text: string): number {
  return ENCODER.encode(text).length;
}

// Parts are joined by a blank line, so each part costs its own bytes and two.
function cost(parts: string[]): number {
  return parts.reduce((sum, part) => sum + byteLength(part) + 2, 0);
}

function note(shortened: number, pending: number, options: SummaryOptions): string {
  const shows = shortened === 1 ? "shows less than its" : "show less than their";
  return `> **This summary is shortened: ${shortened} of ${plural(pending, "pending stack")} ${shows} whole diff.** Every diff is in full in the ${jobLog(options)} of this run, in the group that has the stack id as its title. Deletes and replaces are cut last.`;
}

interface Entry {
  stackId: string;
  parts: string[][];
  costs: number[];
  level: SummaryLevel;
}

// Gives every pending stack its level, the way the dashboard does (record
// 0028): level by level the biggest stacks give way first until the text fits,
// then the smallest stacks get back what there is room for. Ties are broken by
// stack id, so the same input gives the same text. Sizes are sums of bytes, so
// no text is put together until the levels are known.
function fitToBudget(entries: Entry[], frameCost: (shortened: number) => number, budget: number) {
  let blocks = entries.reduce((sum, entry) => sum + (entry.costs[0] ?? 0), 0);
  let shortened = 0;
  const move = (entry: Entry, level: SummaryLevel) => {
    blocks += (entry.costs[level] ?? 0) - (entry.costs[entry.level] ?? 0);
    shortened += Number(level > 0) - Number(entry.level > 0);
    entry.level = level;
  };
  // The last part has one line break after it, not two.
  const fits = () => frameCost(shortened) + blocks - 1 <= budget;
  const bySize = (level: (entry: Entry) => number, direction: 1 | -1) => (a: Entry, b: Entry) =>
    direction * ((a.costs[level(a)] ?? 0) - (b.costs[level(b)] ?? 0)) ||
    byCodeUnit(a.stackId, b.stackId);

  for (const level of LEVELS.slice(1)) {
    for (const entry of [...entries].sort(bySize((entry) => entry.level, -1))) {
      if (fits()) break;
      move(entry, level);
    }
  }
  if (!fits()) return;

  for (const entry of [...entries].sort(bySize(() => 0, 1))) {
    const reached = entry.level;
    for (const level of LEVELS.slice(0, reached)) {
      move(entry, level);
      if (fits()) break;
      move(entry, reached);
    }
  }
}

// A summary names this many unclaimed files. The job log names them all.
const UNCLAIMED_FILES_SHOWN = 20;

function unclaimedParts({ files, unrelated, suggested, shared }: UnclaimedFiles): string[] {
  const shown = files.slice(0, UNCLAIMED_FILES_SHOWN).map(escapeText).join(", ");
  const rest = files.length - UNCLAIMED_FILES_SHOWN;
  const more = rest > 0 ? `, and ${plural(rest, "more file")}. The job log lists them all` : "";
  const parts = [
    "### Why this was a full scan",
    `This push fell back to a full scan, because no stack claims ${files.length} of the changed files: ${shown}${more}. A push that changes one of them previews every stack.`,
    whereFilesBelong(shared, escapeText),
  ];
  if (suggested.length > 0) {
    parts.push(PASTE_NOTE, ["```yaml", ...unrelatedBlock(unrelated, suggested), "```"].join("\n"));
  }
  return parts;
}

function toolDiffLine(options: SummaryOptions): string {
  const log = options.jobLogUrl === undefined ? "job log" : `[job log](${options.jobLogUrl})`;
  return `The tool's own diff of every pending stack, values included, is in the ${log}, in the stack's group.`;
}

export function renderSummary(stacks: SummaryStack[], options: SummaryOptions = {}): Summary {
  const sorted = [...stacks].sort((a, b) => byCodeUnit(stackIdOf(a), stackIdOf(b)));
  const diffs = sorted.filter((stack) => stack.kind === "diff");
  const pending = diffs.filter((stack) => stack.diff.changes.length > 0);
  const hasDrift = (stack: DiffStack) => (stack.diff.drift ?? []).length > 0;
  const drifted = diffs.filter((stack) => stack.diff.changes.length === 0 && hasDrift(stack));
  const inSync = diffs.filter((stack) => stack.diff.changes.length === 0 && !hasDrift(stack));
  const failed = sorted.filter((stack) => stack.kind === "preview-failed");

  const counted =
    stacks.length === 0
      ? "No stacks previewed."
      : `${plural(stacks.length, "stack")} previewed: ${[
          pending.length && `${pending.length} pending`,
          drifted.length && `${drifted.length} drifted`,
          failed.length && `${failed.length} preview failed`,
          inSync.length && `${inSync.length} in sync`,
        ]
          .filter(Boolean)
          .join(", ")}.`;
  const tail: string[] = [];
  // Drifted stacks (record 0055), in full: their rows link here.
  if (drifted.length > 0) {
    tail.push("### Drifted");
    for (const stack of drifted) {
      const drift = sortedDrift(stack.diff);
      tail.push(
        `#### ${anchorTag(stack.diff.stackId)}${escapeText(stack.diff.stackId)}`,
        driftCounts(drift),
        drift.map((change) => `- ${driftLine(change)}`).join("\n"),
      );
    }
  }
  if (failed.length > 0) {
    tail.push("### Preview failed", failed.map((stack) => failedLine(stack, options)).join("\n"));
  }
  if (inSync.length > 0) {
    tail.push(
      "### In sync",
      inSync
        .map((stack) => `- ${anchorTag(stack.diff.stackId)}${escapeText(stack.diff.stackId)}`)
        .join("\n"),
    );
  }
  if (options.unclaimed !== undefined && options.unclaimed.files.length > 0) {
    tail.push(...unclaimedParts(options.unclaimed));
  }
  // The index lists, in the order of the dashboard, every stack a row links
  // to: the pending ones and the preview failures (record 0044). A stack in
  // sync has no link on its row.
  const index = [
    pending.length > 0 &&
      `- Pending: ${pending.map((stack) => indexLink(stack.diff.stackId)).join(" · ")}`,
    drifted.length > 0 &&
      `- Drifted: ${drifted.map((stack) => indexLink(stack.diff.stackId)).join(" · ")}`,
    failed.length > 0 &&
      `- Preview failed: ${failed.map((stack) => indexLink(stack.stackId)).join(" · ")}`,
  ].filter((line) => line !== false);
  const frame = (shortened: number) => [
    "## Sluiceway scan",
    ...(shortened > 0 ? [note(shortened, pending.length, options)] : []),
    counted,
    ...(options.toolDiffInLog && pending.length > 0 ? [toolDiffLine(options)] : []),
    ...(index.length > 0 ? [index.join("\n")] : []),
    ...(pending.length > 0 ? ["### Pending"] : []),
  ];

  const entries = pending.map((stack): Entry => {
    const parts = LEVELS.map((level) => diffParts(stack, level, options));
    return { stackId: stack.diff.stackId, parts, costs: parts.map(cost), level: 0 };
  });
  const tailCost = cost(tail);
  fitToBudget(
    entries,
    (shortened) => cost(frame(shortened)) + tailCost,
    options.budget ?? SUMMARY_BUDGET,
  );

  const shortened = entries.filter((entry) => entry.level > 0).length;
  const text = `${[
    ...frame(shortened),
    ...entries.flatMap((entry) => entry.parts[entry.level] ?? []),
    ...tail,
  ].join("\n\n")}\n`;
  const bytes = byteLength(text);
  return { text, bytes, shortened, fits: bytes <= (options.budget ?? SUMMARY_BUDGET) };
}
