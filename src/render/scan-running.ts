// The words about a scan that is running (record 0108). The scan writes them
// as its first act, so a person who just pushed or ticked the rescan box sees
// that something is happening, and takes them away when it writes the body at
// the end. The line says since when, so a line a dead scan left reads as
// stale.

import { urlPart } from "./images.ts";
import type { RootFacts, ScanRunningFacts } from "./marker.ts";
import { minuteAt } from "./time.ts";

function runUrl(facts: ScanRunningFacts, repoUrl: string): string {
  return `${repoUrl}/actions/runs/${urlPart(facts.run)}`;
}

// The line under the scan line. The time stands alone, so it says its offset
// in the repo's zone (record 0089), and the run is linked as the scan line
// links its own. Facts edited by hand that give no time leave the line out.
export function scanRunningLine(
  root: RootFacts,
  repoUrl: string,
  timeZone?: string,
): string | undefined {
  const facts = root.scanRunning;
  if (facts === undefined) return undefined;
  const since = new Date(facts.since);
  if (Number.isNaN(since.getTime())) return undefined;
  return `A scan is running since ${minuteAt(since, timeZone)} · [run](${runUrl(facts, repoUrl)})`;
}

// The job log line of the scan that wrote it.
export function scanRunningLogLine(facts: ScanRunningFacts, repoUrl: string): string {
  return `The dashboard says a scan is running, under the scan line, until this scan writes the body (record 0108): ${runUrl(facts, repoUrl)}`;
}
