// The diff of a stack as lines for the job log (record 0037). Every scan
// prints every previewed stack's diff there, so whatever a row or the summary
// had to cut, the log has in full. The lines hold what a row could show and
// nothing more (record 0021): ops, tracking changes, types, names and property
// names, in Sluiceway's own words, and the values a row shows at paths that
// `dashboard.showValues` lists (record 0052). Never the tool's text.

import type { ToolDiffResult } from "../adapters/adapter.ts";
import type { Change, Diff } from "../core/diff.ts";
import { previewFailureText } from "../core/failure-reason.ts";
import { orderChanges } from "./changes.ts";
import {
  counts,
  driftCounts,
  driftWord,
  isDestroy,
  sortedDrift,
  sortedKeys,
  valueSuffix,
} from "./row.ts";

// A line of the job log that starts with `::` or `##[` is a command to the
// runner. Text from outside is never trusted with a line of its own: a control
// character, a line separator or a paragraph separator becomes a space, and
// every line starts with a word of Sluiceway's.
function oneLine(text: string): string {
  return text.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ");
}

// The title of the group that holds everything the log says about one stack.
// The summary names it as the place where nothing is cut.
export function logGroupTitle(stackId: string): string {
  return oneLine(stackId);
}

function changeLogLine(change: Change): string {
  const word = [change.op === "none" ? undefined : change.op, change.tracking]
    .filter((part) => part !== undefined)
    .join(" + ");
  const forcingKeys = sortedKeys(change.replaceKeys);
  const withValue = (key: string) => oneLine(key) + valueSuffix(change, key, oneLine);
  const forcing = forcingKeys.map(withValue);
  const others = sortedKeys(change.changedKeys)
    .filter((key) => !forcingKeys.includes(key))
    .map(withValue);
  const parts = [
    `${isDestroy(change) ? word.toUpperCase() : word} ${oneLine(change.type)} ${oneLine(change.name)}`,
  ];
  if (forcing.length > 0) parts.push(`forced by ${forcing.join(", ")}`);
  if (others.length > 0)
    parts.push(`${forcing.length > 0 ? "also changes " : ""}${others.join(", ")}`);
  return parts.join(" · ");
}

export function diffLogLines(diff: Diff): string[] {
  const { deletes, replaces, others } = orderChanges(diff);
  const changes = [...deletes, ...replaces, ...others];
  // The row's counts are Sluiceway's own words, so the only stars in them are
  // the bold of a replace or a delete, which a log cannot show.
  const lines =
    changes.length === 0
      ? ["no changes"]
      : [counts(changes).replaceAll("*", ""), ...changes.map(changeLogLine)];
  // Drift, when the drift check found some (record 0055).
  const drift = sortedDrift(diff);
  if (drift.length === 0) return lines;
  return [...lines, driftCounts(drift), ...drift.map(driftLogLine)];
}

function driftLogLine(change: Change): string {
  const keys = sortedKeys(change.changedKeys).map(oneLine);
  const head = `${driftWord(change)} ${oneLine(change.type)} ${oneLine(change.name)}`;
  return keys.length > 0 ? `${head} · ${keys.join(", ")}` : head;
}

// Sluiceway's own words about the tool's own diff of a stack (record 0048).
// The diff itself is printed after them, verbatim, with workflow commands
// stopped, and never passes through here. A second run that failed says why,
// and changes nothing else.
export function toolDiffLogLines(toolDiff: ToolDiffResult | undefined): string[] {
  if (toolDiff === undefined) return [];
  if (toolDiff.ok) {
    return [
      "The tool's own diff follows, values included, because scan.logDiff is on in sluiceway.yaml:",
    ];
  }
  return [
    `The tool's own diff could not be shown: ${previewFailureText(toolDiff.reason)}. The row and the diff hash come from the preview above and do not depend on it.`,
  ];
}

// The warning on the run of a public repo with `scan.logDiff` on (record
// 0048). Its words are Sluiceway's own.
export const PUBLIC_LOG_DIFF = {
  title: "Values in the job log of a public repo",
  message:
    "scan.logDiff is on and this repository is public, so anyone can read the values in the tool's own diff in this job log. Turn it off in sluiceway.yaml unless that is what you want.",
};
