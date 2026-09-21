// The summary of a scan (records 0021 and 0037): the page of the workflow run
// that shows every previewed stack's diff, so a shortened or redacted row has a
// full version to link to. It is rendered from the same diffs as the rows and
// shows nothing a row could not show. It is never redacted (record 0023).

import type { Diff } from "../core/diff.ts";
import { orderChanges } from "./changes.ts";
import { escapeText } from "./escape.ts";
import { byCodeUnit, changeLine, counts, destroyWords, plural } from "./row.ts";

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
function diffParts(stack: DiffStack, level: SummaryLevel): string[] {
  const { deletes, replaces, others } = orderChanges(stack.diff);
  const destroys = [...deletes, ...replaces];
  const parts = [`#### ${escapeText(stack.diff.stackId)}`, counts([...destroys, ...others])];
  if (destroys.length > 0) {
    parts.push(
      level >= 3
        ? `:warning: **${destroyWords(deletes.length, replaces.length)}, too many to list here.** Read the job log before you tick.`
        : destroys.map((change) => `- :warning: ${changeLine(change)}`).join("\n"),
    );
  }
  if (others.length > 0) {
    const inside = plural(others.length, destroys.length > 0 ? "other change" : "change");
    if (level >= 2) parts.push(`${inside} not listed here, see the job log.`);
    else {
      parts.push(
        `<details><summary>${inside}</summary>`,
        others.map((change) => `- ${changeLine(change)}`).join("\n"),
        "</details>",
      );
    }
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
function failedLine(stack: FailedStack): string {
  const line = `- **${escapeText(stack.stackId)}** · ${escapeText(stack.reason)}`;
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

function note(shortened: number, pending: number): string {
  const shows = shortened === 1 ? "shows less than its" : "show less than their";
  return `> **This summary is shortened: ${shortened} of ${plural(pending, "pending stack")} ${shows} whole diff.** Every diff is in full in the job log of this run, in the group that has the stack id as its title. Deletes and replaces are cut last.`;
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

export function renderSummary(stacks: SummaryStack[], options: SummaryOptions = {}): Summary {
  const sorted = [...stacks].sort((a, b) => byCodeUnit(stackIdOf(a), stackIdOf(b)));
  const diffs = sorted.filter((stack) => stack.kind === "diff");
  const pending = diffs.filter((stack) => stack.diff.changes.length > 0);
  const inSync = diffs.filter((stack) => stack.diff.changes.length === 0);
  const failed = sorted.filter((stack) => stack.kind === "preview-failed");

  const counted =
    stacks.length === 0
      ? "No stacks previewed."
      : `${plural(stacks.length, "stack")} previewed: ${[
          pending.length && `${pending.length} pending`,
          failed.length && `${failed.length} preview failed`,
          inSync.length && `${inSync.length} in sync`,
        ]
          .filter(Boolean)
          .join(", ")}.`;
  const tail: string[] = [];
  if (failed.length > 0) {
    tail.push("### Preview failed", failed.map(failedLine).join("\n"));
  }
  if (inSync.length > 0) {
    tail.push(
      "### In sync",
      inSync.map((stack) => `- ${escapeText(stack.diff.stackId)}`).join("\n"),
    );
  }
  const frame = (shortened: number) => [
    "## Sluiceway scan",
    ...(shortened > 0 ? [note(shortened, pending.length)] : []),
    counted,
    ...(pending.length > 0 ? ["### Pending"] : []),
  ];

  const entries = pending.map((stack): Entry => {
    const parts = LEVELS.map((level) => diffParts(stack, level));
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
