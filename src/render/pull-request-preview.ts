// The words of the pull request preview (record 0101): the page of each
// stack the pull request claims, and the part of the check's job log and
// summary that lists them. Everything here is a name Sluiceway derived from
// the repo's files or from its own preview, and no value (records 0021,
// 0022). The tool's own words stay in the job log, one link away.

import { previewFailureText } from "../core/failure-reason.ts";
import type { PreviewRefusal } from "../core/pull-request-preview.ts";
import type { PreviewResult } from "../core/tool-result.ts";
import type { CheckLogEntry, CheckPart } from "./check.ts";
import { escapeText } from "./escape.ts";
import { logGroupTitle } from "./log-text.ts";
import {
  nothingDeploysLine,
  type PreviewPage,
  type PreviewPageLinks,
  pullRequestWords,
  renderPreviewPage,
} from "./preview-page.ts";
import { plural } from "./row.ts";

export type PullRequestPreviewLinks = PreviewPageLinks;

export interface PullRequestWords {
  number: number;
  baseRef: string;
}

function jobLog(links: PreviewPageLinks): string {
  return links.log === undefined ? "job log of the run" : `[job log](${links.log})`;
}

function plainTitle(stackId: string, rest: string): string {
  // The title is shown as plain text, so it only loses what could break a line.
  return `${stackId.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")}: ${rest}`;
}

// The page of one stack after the merge: the scan's page with the words of a
// pull request preview for a diff, and a page of its own for a stack the
// merge would not change and for a preview that failed, so every stack the
// pull request claims shows in its checks, whatever the preview found.
export function renderPullRequestPage(
  stackId: string,
  result: PreviewResult,
  pullRequest: PullRequestWords,
  links: PullRequestPreviewLinks,
): PreviewPage {
  const id = escapeText(stackId);
  const where = `Every stack this run previewed is in the [summary](${links.summary}) of the run, and the tool's own words are in the ${jobLog(links)}, in the group <code>${id}</code>.`;
  if (!result.ok) {
    const reason = previewFailureText(result.reason);
    return {
      title: plainTitle(stackId, `preview failed, ${reason}`),
      summary: [
        `**${id}** · preview failed`,
        `The preview of this stack after ${pullRequestWords(pullRequest)} did not produce a diff: ${reason}. The tool's own words are in the ${jobLog(links)}, in the group <code>${id}</code>.`,
        nothingDeploysLine(links.dashboard),
      ].join("\n\n"),
      text: "",
      unlisted: 0,
    };
  }
  if (result.diff.changes.length === 0) {
    return {
      title: plainTitle(stackId, "no changes"),
      summary: [
        `**${id}** · no changes`,
        `A deploy of this stack after ${pullRequestWords(pullRequest)} would change nothing.`,
        nothingDeploysLine(links.dashboard),
        where,
      ].join("\n\n"),
      text: "",
      unlisted: 0,
    };
  }
  return renderPreviewPage(result.diff, links, { pullRequest });
}

// What the preview found for one stack, in the words of the counts line.
export interface PreviewedStack {
  stackId: string;
  outcome: string;
  // The address of its page. Absent when the page could not be written.
  pageUrl?: string | undefined;
}

export interface PagesWritten {
  created: number;
  updated: number;
  failed: { stackId: string; message: string }[];
  refused?: { message: string; permission: boolean } | undefined;
}

export type PullRequestPreviewOutcome =
  | { kind: "refused"; refusal: PreviewRefusal }
  | { kind: "too-many-files" }
  | { kind: "nothing-claimed"; unclaimed: string[] }
  | { kind: "previewed"; stacks: PreviewedStack[]; unclaimed: string[]; pages: PagesWritten };

export interface PullRequestPreviewFacts {
  // Absent when the run was started by no pull request.
  pullRequest?: (PullRequestWords & { head: string }) | undefined;
  outcome: PullRequestPreviewOutcome;
}

const TITLE = "### The pull request preview";

function refusalText(refusal: PreviewRefusal, pullRequest: PullRequestWords | undefined): string {
  switch (refusal.kind) {
    case "fork":
      return `#${pullRequest?.number ?? "?"} comes from a fork, so Sluiceway refuses to preview it: a preview runs the pull request's code with the credentials of this job, and that never relies on GitHub withholding them. Nothing was previewed.`;
    case "pull-request-target":
      return "This run was started by pull_request_target, which Sluiceway never previews on: it runs with the secrets of the base branch against code that is not merged. Run the preview on the pull_request event. Nothing was previewed.";
    case "not-a-pull-request":
      return `This run was started by a ${refusal.event} event, which names no pull request, so there is nothing to preview. pull-request-preview: true acts on the pull_request event only.`;
  }
}

function unclaimedText(unclaimed: string[], show: (path: string) => string): string[] {
  if (unclaimed.length === 0) return [];
  const listed = unclaimed.slice(0, 20).map(show);
  const more = unclaimed.length > 20 ? `, and ${unclaimed.length - 20} more` : "";
  return [
    `Files no stack claims, for which the scan after the merge previews every stack: ${listed.join(", ")}${more}.`,
  ];
}

function noPagesText(refused: { message: string; permission: boolean }, code: boolean): string {
  const permission = code ? "`checks: write`" : "checks: write";
  const why = refused.permission
    ? `${permission} in the workflow's permissions gives each stack its page in the pull request's checks.`
    : "Every stack the pull request claims is listed here instead.";
  return `No preview page could be written: GitHub answered ${JSON.stringify(refused.message)}. ${why}`;
}

// The part of the check about the pull request preview, as the job log and
// the summary show it (record 0042: the job log holds everything the summary
// holds).
export function pullRequestPreviewPart(facts: PullRequestPreviewFacts): CheckPart {
  const { pullRequest, outcome } = facts;
  const one = (text: string): CheckPart => ({ log: [{ info: text }], summary: [TITLE, text] });
  switch (outcome.kind) {
    case "refused":
      return one(refusalText(outcome.refusal, pullRequest));
    case "too-many-files":
      return one(
        `#${pullRequest?.number ?? "?"} changes 300 files or more, more than GitHub's comparison lists, so Sluiceway cannot tell which stacks it claims and previewed nothing. The scan after the merge previews every stack.`,
      );
    case "nothing-claimed": {
      const text = `#${pullRequest?.number ?? "?"} changes no file that a stack claims, so there is nothing to preview.`;
      return {
        log: [text, ...unclaimedText(outcome.unclaimed, logGroupTitle)].map((info) => ({ info })),
        summary: [TITLE, text, ...unclaimedText(outcome.unclaimed, (path) => `\`${path}\``)],
      };
    }
    case "previewed":
      return previewedPart(pullRequest, outcome);
  }
}

function previewedPart(
  pullRequest: PullRequestPreviewFacts["pullRequest"],
  outcome: Extract<PullRequestPreviewOutcome, { kind: "previewed" }>,
): CheckPart {
  const merge = pullRequest === undefined ? "the merge" : pullRequestWords(pullRequest);
  const head = pullRequest?.head.slice(0, 7) ?? "";
  const { pages } = outcome;
  const written =
    pages.refused === undefined
      ? `Wrote the preview pages of ${plural(outcome.stacks.length, "stack")} on ${head}: ${pages.created} created, ${pages.updated} updated.`
      : undefined;
  const log: CheckLogEntry[] = [
    {
      info: `Previewed ${plural(outcome.stacks.length, "stack")} after ${merge}, at its head commit ${head}. Nothing deploys from a pull request preview.`,
    },
    ...outcome.stacks.map(({ stackId, outcome: found }) => ({
      info: `${logGroupTitle(stackId)}: ${found.replaceAll("**", "")}.`,
    })),
    ...(written === undefined ? [] : [{ info: written }]),
    ...(pages.refused === undefined ? [] : [{ info: noPagesText(pages.refused, false) }]),
    ...pages.failed.map(({ stackId, message }) => ({
      info: `The preview page of ${logGroupTitle(stackId)} could not be written: ${message}`,
    })),
    ...unclaimedText(outcome.unclaimed, logGroupTitle).map((info) => ({ info })),
  ];
  const table = [
    "| Stack | After the merge | Page |",
    "|---|---|---|",
    ...outcome.stacks.map(
      ({ stackId, outcome: found, pageUrl }) =>
        `| ${escapeText(stackId)} | ${found} | ${pageUrl === undefined ? "none" : `[preview](${pageUrl})`} |`,
    ),
  ].join("\n");
  const summary = [
    TITLE,
    `What ${merge} would change, previewed at its head commit ${head}. Nothing deploys from it: a deploy goes out only after the merge, from a fresh preview, and is refused when the change moved since.`,
    table,
    ...(pages.refused === undefined
      ? []
      : [`${noPagesText(pages.refused, true)} The summary of the run holds the same.`]),
    ...unclaimedText(outcome.unclaimed, (path) => `\`${escapeText(path)}\``),
  ];
  return { log, summary };
}
