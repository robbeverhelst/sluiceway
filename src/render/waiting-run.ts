// The words about a run of the dashboard's own workflow that has waited long
// for a runner (record 0086). They say what is true, that the run waits for a
// runner, and never why: a runner that is busy, offline or never handed the
// job looks the same from here.

import { RUN_WAIT_MINUTES } from "../core/waiting-run.ts";
import { urlPart } from "./images.ts";
import type { RootFacts, WaitingRunFacts } from "./marker.ts";
import { utcMinute } from "./time.ts";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// `42 minutes`, `1 hour`, `2 hours and 5 minutes`.
function duration(minutes: number): string {
  if (minutes < 60) return plural(minutes, "minute");
  const hours = plural(Math.floor(minutes / 60), "hour");
  const rest = minutes % 60;
  return rest === 0 ? hours : `${hours} and ${plural(rest, "minute")}`;
}

// Whole minutes from when the run started waiting to the scan, or nothing
// when the times do not give a number that makes sense.
function waited(facts: WaitingRunFacts, scanAt: string): number | undefined {
  const minutes = Math.floor(
    (new Date(scanAt).getTime() - new Date(facts.since).getTime()) / 60_000,
  );
  return Number.isNaN(minutes) || minutes < 0 ? undefined : minutes;
}

function runUrl(facts: WaitingRunFacts, repoUrl: string): string {
  return `${repoUrl}/actions/runs/${urlPart(facts.run)}`;
}

// The line under the scan line. How long is counted to the scan, whose time
// the scan line shows, so a writer that carries the line says the same.
// Facts edited by hand that give no time leave the line out.
export function waitingRunLine(root: RootFacts, repoUrl: string): string | undefined {
  const facts = root.waitingRun;
  if (facts === undefined) return undefined;
  const since = new Date(facts.since);
  if (Number.isNaN(since.getTime())) return undefined;
  const minutes = waited(facts, root.scanAt);
  const long = minutes === undefined ? "" : ` for ${duration(minutes)},`;
  const run = `[A run of this dashboard's workflow](${runUrl(facts, repoUrl)})`;
  const line = `${run} has been waiting for a runner${long} since ${utcMinute(since)}.`;
  if (facts.more === 0) return line;
  const more =
    facts.more === 1 ? "1 more run has been waiting" : `${facts.more} more runs have been waiting`;
  return `${line} ${more} for a runner for ${RUN_WAIT_MINUTES} minutes or more.`;
}

// The job log line of the scan that found the run.
export function waitingRunLogLine(
  facts: WaitingRunFacts,
  scanAt: string,
  workflow: string,
  repoUrl: string,
): string {
  const minutes = waited(facts, scanAt) ?? RUN_WAIT_MINUTES;
  const more =
    facts.more === 0
      ? ""
      : ` ${plural(facts.more, "more run")} of it waited ${RUN_WAIT_MINUTES} minutes or more too.`;
  return `Run ${facts.run} of ${workflow} has been waiting for a runner for ${duration(minutes)}.${more} The dashboard says so under the scan line until it starts (record 0086): ${runUrl(facts, repoUrl)}`;
}
