// The sweep for orphan ticks that every scan does at its late read (record
// 0025). A row is an orphan when it is ticked, its stack has no open
// deployment, and no run that an issue edit started is queued or in progress.
// A scan clears an orphan tick and asks for a fresh one. It never deploys it.

// One run of the workflow that an `issues` event started.
export interface IssuesRun {
  id: string;
  // The run is over: no job of it will start any more.
  completed: boolean;
}

// An issue edit is what wakes `resolve`, and any `resolve` run handles every
// tick (record 0025). So as long as one such run is not over, a tick may still
// be picked up. Whatever is not over counts: waiting for its concurrency
// group, for a runner or for a reviewer, or running. The scan's own run is
// never the run it waits for.
export function resolveOnItsWay(runs: readonly IssuesRun[], ownRunId: string): boolean {
  return runs.some((run) => !run.completed && run.id !== ownRunId);
}

// One ticked row as a scan sees it at its late read. Its stack has no open
// deployment.
export interface TickedRow {
  // The diff hash on the live row. A ticked row without one holds no tick
  // that `resolve` would act on.
  liveHash: string | undefined;
  // What the scan is about to write for the stack: a fresh row from its own
  // preview, with the diff hash when that row is pending, or the live row
  // block as it is.
  writes: { row: "fresh"; hash: string | undefined } | { row: "live"; previewed: boolean };
  resolveOnItsWay: boolean;
}

export type TickAtLateRead =
  // Hands off: the tick stays, on the live row or on a fresh row of the same
  // diff hash. A bot entry inside the stretch is normal.
  | "carry"
  // The fresh row is unticked and carries the note that asks for a fresh tick.
  | "sweep"
  // Preview the stack now and return to the late read. Only a fresh row can
  // carry the note, because a row block is never patched inside (record 0004).
  | "preview-first"
  // An orphan on a live row that the scan keeps although it previewed the
  // stack, because a deploy ended under the preview. The next scan sweeps it.
  | "next-scan";

export function tickAtLateRead(row: TickedRow): TickAtLateRead {
  const { writes } = row;
  if (writes.row === "live") {
    if (row.resolveOnItsWay) return "carry";
    return writes.previewed ? "next-scan" : "preview-first";
  }
  // A tick is a row ticked at one diff hash. On a row of another hash it would
  // be a tick nobody made.
  const sameTick = writes.hash !== undefined && writes.hash === row.liveHash;
  return row.resolveOnItsWay && sameTick ? "carry" : "sweep";
}
