// The words of the check (record 0042): its summary, and the pieces of text
// the job log shares with it. Everything here is a name Sluiceway derived from
// the repo's files. Nothing comes from the tool, and no value (records 0021,
// 0022).

import type { CheckReport, IgnoreReport, UnclaimedGroup } from "../core/check.ts";
import type { ConfiguredStack } from "../core/config.ts";
import { stackId } from "../core/stack.ts";
import { escapeText } from "./escape.ts";
import { plural } from "./row.ts";

export const VALID = "The setup is valid.";
export const NO_CONFIG_FILE = "No sluiceway.yaml, so every setting is its default.";
// The one sentence record 0042 asks for.
export const CANNOT_TELL =
  "A check reads files only, so it cannot say that a preview will work: a stack that does not exist in the backend, a missing credential or a registry the runner cannot reach shows only in a scan.";
export const WHERE_FILES_BELONG =
  "A file that some stacks read belongs under the inputs of those stacks in sluiceway.yaml. A file that no stack reads can be listed under scan.unrelated.";
export const PASTE_NOTE =
  "The block below keeps what scan.unrelated has and adds globs for the files that look like docs and tooling. Sluiceway does not decide this for you: leave out any glob that covers a file one of your programs reads.";

// A summary lists this many files of a directory. The job log lists them all.
const FILES_PER_DIRECTORY = 20;

export function foundText(count: number): string {
  return count === 0 ? "Found no stacks." : `Found ${plural(count, "stack")}.`;
}

// The settings of one stack, in the words of sluiceway.yaml.
export function settingsText(configured: ConfiguredStack): string {
  const { environment, tickers, inputs } = configured;
  const rule = typeof tickers === "string" ? tickers : tickers.join(", ");
  const claims = inputs.length === 0 ? "no inputs" : `inputs ${inputs.join(", ")}`;
  const waits = dependsOnWords(configured);
  return `environment ${environment}, tickers ${rule}, ${claims}${waits === undefined ? "" : `, depends on ${waits}`}`;
}

// What a stack depends on (records 0056 and 0059): the stack ids the file
// names, and auto, whose stacks only a preview can read. Undefined for none.
function dependsOnWords({ dependsOn, dependsOnAuto }: ConfiguredStack): string | undefined {
  const parts = [
    ...(dependsOn ?? []),
    ...(dependsOnAuto ? ["the stacks its stack references name, read at each preview (auto)"] : []),
  ];
  return parts.length === 0 ? undefined : parts.join(", ");
}

function dependsOnCell({ dependsOn, dependsOnAuto }: ConfiguredStack): string {
  const parts = [
    ...(dependsOn ?? []),
    ...(dependsOnAuto ? ["auto: its stack references, read at each preview"] : []),
  ];
  return parts.length === 0 ? "none" : parts.join(", ");
}

export function ignoreText({ glob, stacks }: IgnoreReport): string {
  return `ignore ${JSON.stringify(glob)} leaves out ${plural(stacks.length, "stack")}: ${stacks.join(", ")}.`;
}

// A glob that leaves out nothing. The hint is onboarding log hurdle 4.
export function unmatchedText(entry: IgnoreReport): string {
  return `ignore ${JSON.stringify(entry.glob)} matches no stack. ${unmatchedWhy(entry)}`;
}

function unmatchedWhy({ hint }: IgnoreReport): string {
  const why = "It is matched against the stack id, not the directory.";
  return hint === undefined
    ? why
    : `${why} ${JSON.stringify(hint.glob)} would leave out ${hint.stacks.join(", ")}.`;
}

export function unclaimedText(count: number): string {
  return `${plural(count, "file")} ${count === 1 ? "is" : "are"} claimed by no stack. A push that changes one of them gives a full scan.`;
}

// Ready to paste over the scan block of sluiceway.yaml. Every glob is written
// as a JSON string, which YAML reads as a double quoted string, so no glob can
// end the block or start a line of its own.
export function unrelatedBlock(existing: string[], suggested: string[]): string[] {
  const globs = [...new Set([...existing, ...suggested])];
  return ["scan:", "  unrelated:", ...globs.map((glob) => `    - ${JSON.stringify(glob)}`)];
}

export interface CheckFacts {
  report: CheckReport;
  // The scan.unrelated globs the config has.
  unrelated: string[];
  hasConfigFile: boolean;
}

export function renderCheckSummary({ report, unrelated, hasConfigFile }: CheckFacts): string {
  const parts = ["## Sluiceway check", VALID];
  if (!hasConfigFile) parts.push(NO_CONFIG_FILE);

  parts.push("### Stacks", foundText(report.stacks.length));
  if (report.stacks.length > 0) {
    // The column is there only when a stack depends on another, so a setup
    // without dependsOn keeps its table.
    const waits = report.stacks.some(
      (configured) => configured.dependsOn !== undefined || configured.dependsOnAuto,
    );
    parts.push(
      [
        `| Stack | Environment | Tickers | Inputs |${waits ? " Depends on |" : ""}`,
        `|---|---|---|---|${waits ? "---|" : ""}`,
        ...report.stacks.map((configured) => {
          const { environment, tickers, inputs } = configured;
          return row([
            stackId(configured.stack),
            environment,
            typeof tickers === "string" ? tickers : tickers.join(", "),
            inputs.length === 0 ? "none" : inputs.join(", "),
            ...(waits ? [dependsOnCell(configured)] : []),
          ]);
        }),
      ].join("\n"),
    );
  }

  if (report.ignore.length > 0) {
    parts.push(
      "### Ignore",
      [
        "| Glob | Leaves out |",
        "|---|---|",
        ...report.ignore.map((entry) =>
          row([
            entry.glob,
            entry.stacks.length > 0 ? entry.stacks.join(", ") : `No stack. ${unmatchedWhy(entry)}`,
          ]),
        ),
      ].join("\n"),
    );
  }

  parts.push("### Files that no stack claims");
  const count = report.unclaimed.reduce((sum, group) => sum + group.files.length, 0);
  if (count === 0) {
    parts.push("Every file is claimed by a stack or covered by scan.unrelated.");
  } else {
    parts.push(
      unclaimedText(count),
      report.unclaimed.map(groupLine).join("\n"),
      WHERE_FILES_BELONG,
    );
    if (report.suggested.length > 0) {
      parts.push(
        PASTE_NOTE,
        ["```yaml", ...unrelatedBlock(unrelated, report.suggested), "```"].join("\n"),
      );
    }
  }

  parts.push("### What a check cannot tell", CANNOT_TELL);
  return `${parts.join("\n\n")}\n`;
}

// The summary of a setup that is not valid: the problems, each on its own
// line, in the loader's or discovery's own words.
export function renderCheckFailure(kind: "config" | "discovery", problems: string[]): string {
  const title =
    kind === "config"
      ? "sluiceway.yaml is not valid."
      : "Could not work out the stacks of this repo.";
  return `${[
    "## Sluiceway check",
    title,
    problems.map((problem) => `- ${escapeText(problem)}`).join("\n"),
    "Fix these and run the check again. A scan stops at the same place.",
  ].join("\n\n")}\n`;
}

function groupLine({ directory, files }: UnclaimedGroup): string {
  const where = directory === "." ? "The repo root" : escapeText(`${directory}/`);
  const shown = files.slice(0, FILES_PER_DIRECTORY).map(escapeText).join(", ");
  const rest = files.length - FILES_PER_DIRECTORY;
  const more = rest > 0 ? `, and ${plural(rest, "more file")}. The job log lists them all.` : "";
  return `- ${where}, ${plural(files.length, "file")}: ${shown}${more}`;
}

function row(cells: string[]): string {
  return `| ${cells.map(escapeText).join(" | ")} |`;
}
