// The preview page of a pending or a drifted stack (records 0050 and 0059): a check run on the
// scanned commit whose output is Sluiceway's own diff of that stack. It is
// rendered from the same diff as the row and the summary and shows nothing
// they could not show: addresses, ops, tracking changes and property paths,
// never a value (record 0021). The runner's masks do not reach a check run, so
// nothing from the tool's text ever goes on it.

import type { Diff } from "../core/diff.ts";
import { type PolicyOutcome, policyRunFailureText } from "../core/policy.ts";
import { orderChanges } from "./changes.ts";
import { escapeText } from "./escape.ts";
import {
  changeLine,
  counts,
  destroyWords,
  driftCounts,
  driftLine,
  policyFailureLine,
  sortedDrift,
} from "./row.ts";

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
  // The page shows the stack after the merge of a pull request, for its
  // reviewer, and nothing deploys from it (record 0101). The list of changes
  // is the same as on a scan's page; the words around it say what it is.
  pullRequest?: { number: number; baseRef: string } | undefined;
  // What the policies made of the change (record 0106). The page names every
  // failure whole, before the changes, and says when they could not run.
  policies?: PolicyOutcome | undefined;
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

// The words around a scan's page: what it is, and where the rest is.
function scanAbout(
  diff: Diff,
  links: PreviewPageLinks,
  also: string,
  id: string,
  options: PreviewPageOptions,
): string[] {
  return [
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
  ];
}

// The one sentence every page of a pull request preview carries (record
// 0101): the deploy happens after the merge, from a fresh preview, and
// refuses a change that moved, so a stale plan can never go out.
export function nothingDeploysLine(dashboard: string): string {
  return `**Nothing deploys from this page.** A deploy goes out only after the merge, from a fresh preview of the default branch, and is refused when the change moved since. What is merged and waiting is on the [dashboard](${dashboard}).`;
}

export function pullRequestWords(pullRequest: { number: number; baseRef: string }): string {
  return `the merge of #${pullRequest.number} into ${escapeText(pullRequest.baseRef)}`;
}

// The words around the page of a stack after the merge (record 0101).
function pullRequestAbout(
  diff: Diff,
  pullRequest: { number: number; baseRef: string },
  links: PreviewPageLinks,
  id: string,
): string[] {
  const values = diff.changes.some((change) => (change.values ?? []).length > 0)
    ? "with the old and new value only at the paths that <code>dashboard.showValues</code> lists"
    : "never what it changes to";
  return [
    `Sluiceway's own preview of this stack as it would be after ${pullRequestWords(pullRequest)}: what a deploy would change, ${values}, with every property path whole.`,
    nothingDeploysLine(links.dashboard),
    `Every stack this run previewed is in the [summary](${links.summary}) of the run, and the tool's own words are in the ${jobLog(links)}, in the group <code>${id}</code>.`,
  ];
}

// "a", "a and b", "a, b and c".
function listWords(words: readonly string[]): string {
  return words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function policyWords(count: number): string {
  return `${count} ${count === 1 ? "policy" : "policies"}`;
}

// The paragraph of the summary about the policies (record 0106), and nothing
// for a stack without any.
export function policySummaryLine(policies: PolicyOutcome | undefined): string | undefined {
  if (policies === undefined) return undefined;
  if (policies.kind === "not-run") {
    return `:warning: The policies did not run: ${policyRunFailureText(policies.reason)}. Nothing was checked, and the row keeps its box.`;
  }
  const { failures, warnings, passed, namespaces } = policies.report;
  if (policies.kind === "failed") {
    return `:no_entry: **${policyWords(failures.length)} failed**, so the row has no box until the change or the policies change. They are named first below, in the policies' own words.`;
  }
  const rules = `${passed} ${passed === 1 ? "rule" : "rules"}`;
  const where = namespaces.length === 0 ? "" : ` in ${listWords(namespaces.map(escapeText))}`;
  const warned =
    warnings.length === 0
      ? ""
      : `, with ${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}, named first below`;
  return `Every policy passed: ${rules}${where}${warned}.`;
}

// The lines of the text about the policies: every failure, whole, then every
// warning. They come before the changes and are never cut.
export function policyTextLines(policies: PolicyOutcome | undefined): string[] {
  if (policies === undefined || policies.kind === "not-run") return [];
  const { failures, warnings } = policies.report;
  return [
    ...failures.map((failure) => `- ${policyFailureLine(failure, true)}`),
    ...warnings.map(
      (warning) =>
        `- :warning: <code>${escapeText(warning.namespace)}</code> · ${escapeText(warning.message)}`,
    ),
  ];
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

  const policyLine = policySummaryLine(options.policies);
  const summary = [
    `**${id}** · ${counted.join(" · ")}`,
    ...(policyLine === undefined ? [] : [policyLine]),
    ...(destroys.length > 0
      ? [`:warning: **This deploy ${destroyWords(deletes.length, replaces.length)}.**`]
      : []),
    ...(options.pullRequest !== undefined
      ? pullRequestAbout(diff, options.pullRequest, links, id)
      : scanAbout(diff, links, also, id, options)),
  ].join("\n\n");

  // Destroys come first, so a cut takes them last (record 0024).
  const lines = [
    ...destroys.map((change) => `- :warning: ${changeLine(change)}\n`),
    ...others.map((change) => `- ${changeLine(change)}\n`),
    ...drift.map((change) => `- ${driftLine(change)}\n`),
  ];
  // The policy lines come first and are never cut (record 0106): the
  // changes give way to them, as they give way to the pointer.
  const policyLines = policyTextLines(options.policies);
  const head = policyLines.length === 0 ? "" : `${policyLines.join("\n")}\n\n`;
  const limit = (options.limit ?? PREVIEW_PAGE_FIELD_LIMIT) - byteLength(head);
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
    head +
    lines.slice(0, kept).join("") +
    (unlisted > 0 ? `\n${pointer(unlisted, id, links)}\n` : "");

  return {
    // The title is shown as plain text, so it only loses what could break a line.
    title: `${diff.stackId.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")}: ${counted.join(", ").replaceAll("**", "")}`,
    summary,
    text,
    unlisted,
  };
}
