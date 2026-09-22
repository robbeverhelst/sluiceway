// The preview page of a pending or a drifted stack (records 0050 and 0059): a check run on the
// scanned commit whose output is Sluiceway's own diff of that stack. It is
// rendered from the same diff as the row and the summary and shows nothing
// they could not show: addresses, ops, tracking changes and property paths,
// never a value (record 0021). The runner's masks do not reach a check run, so
// nothing from the tool's text ever goes on it.

import type { Diff } from "../core/diff.ts";
import { orderChanges } from "./changes.ts";
import { escapeText } from "./escape.ts";
import { changeLine, counts, destroyWords, driftCounts, driftLine, sortedDrift } from "./row.ts";

// GitHub refuses a summary or a text over 65,535 characters, and a summary
// over 65,535 UTF-8 bytes. A text over 65,535 bytes is cut without an error,
// anywhere in a line (research, preview-page.md). Counting bytes covers both
// limits, because no character takes fewer bytes than code units.
export const PREVIEW_PAGE_FIELD_LIMIT = 65_535;

// Stable, so the next scan of the same commit finds the page and updates it
// in place instead of adding one (record 0050).
export function previewPageName(stackId: string): string {
  return `sluiceway / ${stackId}`;
}

export interface PreviewPageLinks {
  // Where the dashboard is found.
  dashboard: string;
  // The summary of the attempt that previewed the stack (record 0044).
  summary: string;
  // The page of the job whose log holds the stack's group. Absent where the
  // runner does not know the job's id.
  log?: string | undefined;
}

export interface PreviewPageOptions {
  // The job log holds the tool's own diff of the stack (record 0048).
  toolDiffInLog?: boolean | undefined;
  // Only a test has a reason to set it.
  limit?: number | undefined;
}

export interface PreviewPage {
  title: string;
  summary: string;
  text: string;
  // How many changes the text leaves out to stay inside the limit.
  unlisted: number;
}

const ENCODER = new TextEncoder();

function byteLength(text: string): number {
  return ENCODER.encode(text).length;
}

function jobLog(links: PreviewPageLinks): string {
  return links.log === undefined ? "job log of the scan" : `[job log](${links.log})`;
}

function pointer(unlisted: number, id: string, links: PreviewPageLinks): string {
  const are = unlisted === 1 ? "change is" : "changes are";
  return `**${unlisted} more ${are} not listed here**: a preview page holds at most 65,535 bytes. Every change is in the ${jobLog(links)}, in the group <code>${id}</code>, and in the [summary](${links.summary}) of the scan when it fits there.`;
}

// A stack id is a path and a name from the repo's files, so the summary is
// far from the limit and is never cut.
export function renderPreviewPage(
  diff: Diff,
  links: PreviewPageLinks,
  options: PreviewPageOptions = {},
): PreviewPage {
  const id = escapeText(diff.stackId);
  const { deletes, replaces, others } = orderChanges(diff);
  const destroys = [...deletes, ...replaces];
  // Drift is listed after the changes, like on the row (record 0059). A
  // resource gone outside the code is no destroy: a deploy creates it again.
  const drift = sortedDrift(diff);
  const counted = [
    ...(diff.changes.length > 0 ? [counts([...destroys, ...others])] : []),
    ...(drift.length > 0 ? [driftCounts(drift)] : []),
  ];
  const also =
    drift.length > 0
      ? " The deploy also puts back what changed outside the code, listed last."
      : "";

  const summary = [
    `**${id}** · ${counted.join(" · ")}`,
    ...(destroys.length > 0
      ? [`:warning: **This deploy ${destroyWords(deletes.length, replaces.length)}.**`]
      : []),
    diff.changes.length === 0
      ? `Sluiceway's own list of what changed in real infrastructure outside the code, never what it changed to. The code has nothing to deploy, and a deploy puts these back as the code says. It is the drift the stack's row on the [dashboard](${links.dashboard}) shows, with every property path whole.`
      : diff.changes.some((change) => (change.values ?? []).length > 0)
        ? `Sluiceway's own diff of this stack: what a deploy would change, with the old and new value only at the paths that <code>dashboard.showValues</code> lists. It is the diff the stack's row on the [dashboard](${links.dashboard}) shows, with every property path whole.${also}`
        : `Sluiceway's own diff of this stack: what a deploy would change, never what it changes to. It is the diff the stack's row on the [dashboard](${links.dashboard}) shows, with every property path whole.${also}`,
    `Every stack this scan previewed is in the [summary](${links.summary}) of the scan, and the tool's own words are in the ${jobLog(links)}, in the group <code>${id}</code>.`,
    ...(options.toolDiffInLog
      ? [
          `The tool's own diff of this stack, values included, is in the ${jobLog(links)}, in the group <code>${id}</code>. It is not on this page.`,
        ]
      : []),
  ].join("\n\n");

  // Destroys come first, so a cut takes them last (record 0024).
  const lines = [
    ...destroys.map((change) => `- :warning: ${changeLine(change)}\n`),
    ...others.map((change) => `- ${changeLine(change)}\n`),
    ...drift.map((change) => `- ${driftLine(change)}\n`),
  ];
  const limit = options.limit ?? PREVIEW_PAGE_FIELD_LIMIT;
  const sizes = lines.map(byteLength);
  const whole = sizes.reduce((sum, size) => sum + size, 0);
  let kept = lines.length;
  if (whole > limit) {
    // The pointer is longest with the most changes left out, so room for that
    // one is room for any.
    const room = limit - byteLength(`\n${pointer(lines.length, id, links)}\n`);
    let used = 0;
    kept = 0;
    while (kept < lines.length && used + (sizes[kept] ?? 0) <= room) used += sizes[kept++] ?? 0;
  }
  const unlisted = lines.length - kept;
  const text =
    lines.slice(0, kept).join("") + (unlisted > 0 ? `\n${pointer(unlisted, id, links)}\n` : "");

  return {
    // The title is shown as plain text, so it only loses what could break a line.
    title: `${diff.stackId.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")}: ${counted.join(", ").replaceAll("**", "")}`,
    summary,
    text,
    unlisted,
  };
}
