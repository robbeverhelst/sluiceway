// The summary of an `apply` (records 0021 and 0037): the stack, the result, the
// counts by op, the changes and the run, in the words of a row. It is rendered
// from the diff alone, which has no field for a value or a stack output, and
// the result is a reason from the fixed list (record 0022). It needs no
// budget: it is about one stack.

import { IN_SYNC_DESCRIPTION, REHEARSED_DESCRIPTION } from "../core/deployment.ts";
import type { Diff } from "../core/diff.ts";
import { orderChanges } from "./changes.ts";
import { escapeText } from "./escape.ts";
import { changeLine, counts, plural } from "./row.ts";

// What a preview of the stack gave: its diff, or the reason it gave none.
export type AppliedPreview =
  | { kind: "diff"; diff: Diff }
  | { kind: "preview-failed"; reason: string };

export type ApplyOutcome =
  // `diff` is the fresh preview whose hash the tick approved.
  | { kind: "deployed"; diff: Diff }
  // The fresh preview was empty: nothing to deploy (record 0051).
  | { kind: "in-sync" }
  // A rehearsal: `diff` is the fresh preview whose hash the tick approved,
  // what a deploy would have sent (record 0051).
  | { kind: "rehearsed"; diff: Diff }
  | {
      kind: "not-deployed";
      // A deploy failure reason from the fixed list, as display text.
      reason: string;
      // The fresh preview that was held against the tick, when there was one.
      checked?: AppliedPreview | undefined;
      // The preview after a deploy that failed half way: what the row shows now.
      after?: AppliedPreview | undefined;
    };

export interface ApplySummaryInput {
  stackId: string;
  ticker: string;
  runUrl: string;
  outcome: ApplyOutcome;
}

// Record 0019: a re-run of a deploy that already has a result deploys nothing
// and says this. The record was read and nothing more, so there is no stack to
// name.
export const ALREADY_ENDED =
  "This deploy already ended. Tick the box on the dashboard to try again.";

const IN_SYNC_LINE =
  "The fresh preview shows no change, so nothing was deployed. The stack is already as its code says, most likely from a deploy outside the dashboard.";

const REHEARSED_LINE =
  "This was a rehearsal (`dry-run: true`). The fresh preview matched the tick, and nothing was deployed. The row is pending again, and a tick in a workflow without `dry-run` deploys it.";

const NOT_DEPLOYED =
  "Nothing was deployed from this deployment record, and nothing will be. The job log of this run holds the tool's own words. A fresh tick on the dashboard tries again.";

// The changes as the summary of a scan lists them: counts, then every delete
// and replace in the open, then the rest behind a fold.
function diffParts(diff: Diff, empty: string): string[] {
  if (diff.changes.length === 0) return [empty];
  const { deletes, replaces, others } = orderChanges(diff);
  const destroys = [...deletes, ...replaces];
  const parts = [counts([...destroys, ...others])];
  if (destroys.length > 0) {
    parts.push(destroys.map((change) => `- :warning: ${changeLine(change)}`).join("\n"));
  }
  if (others.length > 0) {
    parts.push(
      `<details><summary>${plural(others.length, destroys.length > 0 ? "other change" : "change")}</summary>`,
      others.map((change) => `- ${changeLine(change)}`).join("\n"),
      "</details>",
    );
  }
  return parts;
}

function previewParts(preview: AppliedPreview, empty: string): string[] {
  return preview.kind === "diff"
    ? diffParts(preview.diff, empty)
    : [`The preview failed: ${escapeText(preview.reason)}.`];
}

export function renderApplySummary(input: ApplySummaryInput): string {
  const { outcome } = input;
  const result =
    outcome.kind === "deployed"
      ? "deployed"
      : outcome.kind === "in-sync"
        ? IN_SYNC_DESCRIPTION
        : outcome.kind === "rehearsed"
          ? REHEARSED_DESCRIPTION
          : `not deployed: ${escapeText(outcome.reason)}`;
  const parts = [
    "## Sluiceway apply",
    `**${escapeText(input.stackId)}** · ${result} · ticked by ${escapeText(input.ticker)} · [run](${input.runUrl})`,
  ];
  if (outcome.kind === "deployed") {
    parts.push("### What went out", ...diffParts(outcome.diff, "No changes."));
  } else if (outcome.kind === "in-sync") {
    parts.push(IN_SYNC_LINE);
  } else if (outcome.kind === "rehearsed") {
    parts.push(
      REHEARSED_LINE,
      "### What a deploy would send",
      ...diffParts(outcome.diff, "No changes."),
    );
  } else {
    parts.push(NOT_DEPLOYED);
    if (outcome.checked) {
      parts.push(
        "### What the fresh preview showed",
        ...previewParts(outcome.checked, "No changes."),
      );
    }
    if (outcome.after) {
      parts.push(
        "### What is pending now",
        ...previewParts(outcome.after, "Nothing. The stack is in sync."),
      );
    }
  }
  return `${parts.join("\n\n")}\n`;
}
