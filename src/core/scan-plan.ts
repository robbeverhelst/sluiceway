// The scan plan: which stacks a scan previews (records 0010 and 0011). A scan
// that follows a push is a narrowed scan, and it is a full scan whenever the
// comparison it would narrow by cannot be trusted. Previewing too much is never
// wrong, so every doubt ends in a full scan.

import { type Claimant, claim } from "./claim.ts";
import { CONFIG_FILE } from "./config-file.ts";

// GitHub's compare call lists at most this many files. A list this long may
// be missing files (record 0010).
export const COMPARE_FILE_CAP = 300;

// Why a scan previews every stack.
export type FullScanReason =
  | { kind: "event"; event: string }
  | { kind: "no-dashboard" }
  | { kind: "no-root-marker" }
  | { kind: "other-version"; version: number }
  | { kind: "no-scan-sha" }
  | { kind: "compare-failed" }
  // status is GitHub's own word for the comparison.
  | { kind: "not-a-straight-line"; status: string }
  | { kind: "file-cap" }
  | { kind: "unclaimed"; files: string[] }
  // Found at the write, not at the first read: the body is over the hard limit
  // and a carried row cannot be shortened (record 0028).
  | { kind: "does-not-fit"; carried: number };

// What the first read found of the dashboard. `root` is absent when the first
// line of the body is no root marker that reads.
export interface FirstRead {
  root: { version: number; scanSha?: string | undefined } | undefined;
}

// A commit id in full, SHA-1 or SHA-256. Anything else on the marker was not
// written by a scan.
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

// A scan that follows a push is a narrowed scan, and so is the scan `resolve`
// dispatches after a merge, which names the pull requests it merged (record
// 0064). A scan on schedule, on manual dispatch or from the rescan box is
// always a full scan (record 0010).
export function narrowsOn(event: string, afterMerge: readonly number[] = []): boolean {
  return event === "push" || (event === "workflow_dispatch" && afterMerge.length > 0);
}

// Decided from the event and the first read, before any request for a
// comparison. `dashboard` is undefined when there is no dashboard yet.
export function comparisonBase(
  event: string,
  dashboard: FirstRead | undefined,
  markerVersion: number,
  // The pull requests `resolve` merged before it dispatched this scan.
  afterMerge: readonly number[] = [],
): { kind: "compare"; from: string } | FullScanReason {
  if (!narrowsOn(event, afterMerge)) return { kind: "event", event };
  if (dashboard === undefined) return { kind: "no-dashboard" };
  const { root } = dashboard;
  if (root === undefined) return { kind: "no-root-marker" };
  if (root.version !== markerVersion) return { kind: "other-version", version: root.version };
  if (root.scanSha === undefined || !COMMIT.test(root.scanSha)) return { kind: "no-scan-sha" };
  return { kind: "compare", from: root.scanSha };
}

// The comparison from the `scan-sha` of the dashboard to the checked-out
// commit, as the glue hands it over.
export interface Comparison {
  // "ahead", "behind", "identical" or "diverged", as GitHub writes it.
  status: string;
  files: { path: string; previousPath?: string | undefined }[];
}

// The list of paths the claim rule gets. A renamed file counts under both its
// old and its new path (record 0010).
export function changedPaths(
  comparison: Comparison,
): { kind: "changed"; paths: string[] } | FullScanReason {
  // "identical" is the same commit scanned again, a straight line of no length.
  if (comparison.status !== "ahead" && comparison.status !== "identical") {
    return { kind: "not-a-straight-line", status: comparison.status };
  }
  if (comparison.files.length >= COMPARE_FILE_CAP) return { kind: "file-cap" };
  return {
    kind: "changed",
    paths: comparison.files.flatMap(({ path, previousPath }) =>
      previousPath === undefined ? [path] : [path, previousPath],
    ),
  };
}

// Why a narrowed scan previews one stack.
export type PreviewWhy =
  | { kind: "claims"; files: string[] }
  // A discovered stack that has no row on the live dashboard.
  | { kind: "no-row" }
  // The one thing a scan reads a row state for (record 0010): a transient
  // failure heals on the next push.
  | { kind: "preview-failed" };

export type ScanPlan =
  | { kind: "full"; why: FullScanReason }
  // In the order of the stacks.
  | { kind: "narrowed"; previews: { id: string; why: PreviewWhy }[] };

export function planScan(
  stacks: Claimant[],
  changed: string[],
  unrelated: string[],
  rows: { stackId: string; state: string }[],
): ScanPlan {
  const { claims, unclaimed } = claim(stacks, changed, unrelated);
  if (unclaimed.length > 0) return { kind: "full", why: { kind: "unclaimed", files: unclaimed } };

  const states = new Map(rows.map((row) => [row.stackId, row.state]));
  const previews = stacks.flatMap(({ id }): { id: string; why: PreviewWhy }[] => {
    const files = claims.get(id);
    if (files) return [{ id, why: { kind: "claims", files } }];
    if (!states.has(id)) return [{ id, why: { kind: "no-row" } }];
    if (states.get(id) === "preview-failed") return [{ id, why: { kind: "preview-failed" } }];
    return [];
  });
  return { kind: "narrowed", previews };
}

export interface RowsToWrite {
  // Stacks whose row block is taken from the live body as it is.
  carried: string[];
  // Stacks with neither a fresh preview nor a live row. They are previewed
  // now, and the scan returns to its late read.
  missing: string[];
  // Live rows of stacks that discovery does not know.
  dropped: string[];
}

// The rule that keeps rows from being lost (record 0011): after any scan the
// dashboard has exactly one row for every discovered stack and no others. It
// runs on the late read, just before the write.
export function oneRowPerStack(
  discovered: string[],
  fresh: ReadonlySet<string>,
  live: string[],
): RowsToWrite {
  const onDashboard = new Set(live);
  const known = new Set(discovered);
  const stale = discovered.filter((id) => !fresh.has(id));
  return {
    carried: stale.filter((id) => onDashboard.has(id)),
    missing: stale.filter((id) => !onDashboard.has(id)),
    dropped: [...onDashboard].filter((id) => !known.has(id)),
  };
}

// The unclaimed files that ask for `inputs` or `scan.unrelated`: all of them
// but the config file, which no stack is meant to claim (onboarding log,
// hurdle 14).
export function unclaimedToPlace(files: string[]): string[] {
  return files.filter((file) => file !== CONFIG_FILE);
}

function noClaimant(files: string[]): string {
  const [first = "", ...rest] = files;
  return rest.length === 0
    ? `no stack claims ${first}`
    : `no stack claims ${first} and ${rest.length} more changed ${rest.length === 1 ? "file" : "files"}`;
}

// For the job log, after "This is a full scan:". Lower case and no full stop,
// so the place that prints it builds its own sentence.
export function fullScanReasonText(reason: FullScanReason): string {
  switch (reason.kind) {
    case "event":
      return `the event is ${reason.event}, and only a push, or the scan resolve starts after a merge, gives a narrowed scan`;
    case "no-dashboard":
      return "there is no dashboard yet";
    case "no-root-marker":
      return "the dashboard has no root marker that can be read";
    case "other-version":
      return `the root marker of the dashboard has version ${reason.version}, which this version of Sluiceway does not write`;
    case "no-scan-sha":
      return "the root marker of the dashboard names no commit to compare from";
    case "compare-failed":
      return "GitHub did not give the comparison from the commit of the last scan";
    case "not-a-straight-line":
      return `the checked-out commit does not follow the commit of the last scan in a straight line (GitHub calls it ${JSON.stringify(reason.status)}), as after a force push or a re-run of an older run`;
    case "file-cap":
      return `the comparison lists ${COMPARE_FILE_CAP} files, the most GitHub gives, so files may be missing from it`;
    case "unclaimed": {
      // The config file lies outside every stack, so changing it is a full
      // scan with no special case (record 0010). Only the words differ: no
      // stack is meant to claim it (onboarding log, hurdle 14).
      const others = unclaimedToPlace(reason.files);
      if (others.length === reason.files.length) return noClaimant(others);
      const changed = `${CONFIG_FILE} changed, so every stack is previewed`;
      return others.length === 0 ? changed : `${changed}, and ${noClaimant(others)}`;
    }
    case "does-not-fit":
      return `the body does not fit in one issue with ${reason.carried} ${reason.carried === 1 ? "row" : "rows"} carried through, and only a fresh row can be shortened`;
  }
}
