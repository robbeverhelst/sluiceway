import { escapeText } from "./escape.ts";

// The job summary of `resolve` (slice 5.9): what the job log says about every
// tick of the run, and the scan it started. The lines are Sluiceway's own
// words: `resolve` runs no tool, so nothing of a tool's output is in them
// (record 0022). The dashboard and the comment say it to the people it
// concerns; this page is for whoever opens the run.

export interface ResolveSummary {
  // The lines of the job log about the ticks, in order.
  lines: readonly string[];
  // The page of the scan this run started, when GitHub named it.
  scanUrl?: string | undefined;
  // A scan was started, named or not.
  scanStarted?: boolean | undefined;
}

export function resolveSummary({ lines, scanUrl, scanStarted }: ResolveSummary): string {
  const parts = [
    "### Sluiceway resolve",
    lines.length === 0
      ? "Nothing to report."
      : lines.map((line) => `- ${escapeText(line)}`).join("\n"),
  ];
  if (scanUrl !== undefined) parts.push(`It started [a scan](${scanUrl}).`);
  else if (scanStarted) parts.push("It started a scan.");
  return `${parts.join("\n\n")}\n`;
}
