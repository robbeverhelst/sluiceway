// A run of the dashboard's own workflow that has waited for a runner for a
// long time (record 0086). GitHub can leave a run queued for as long as no
// runner takes its job, and no Sluiceway code runs until one does, so from the
// dashboard such a run looks exactly like nothing happening. A scan that did
// get a runner says so in one line under the scan line. It decides nothing and
// holds nothing back.

import type { WaitingRunFacts } from "../render/marker.ts";

export type { WaitingRunFacts };

// A short queue says nothing: a runner that is busy with another job, or one
// that an autoscaler is starting, takes a few minutes. Ten is past both.
export const RUN_WAIT_MINUTES = 10;

// One run of the workflow as the port lists it.
export interface RunOfTheWorkflow {
  id: string;
  // GitHub's status of the run. Only `queued` waits for a runner: a run that
  // waits for its concurrency group is `pending`, one that waits for a
  // reviewer is `waiting`.
  status: string;
  // When the run, or its newest attempt, started waiting. ISO 8601.
  since: string;
}

// The run that waited longest, when it waited at least the threshold by
// `now`, and how many more waited that long. The scan's own run is running,
// so it is never one of them.
export function waitingRun(
  runs: readonly RunOfTheWorkflow[],
  now: Date,
  ownRunId: string,
): WaitingRunFacts | undefined {
  const limit = now.getTime() - RUN_WAIT_MINUTES * 60_000;
  const long = runs
    .filter((run) => run.status === "queued" && run.id !== ownRunId)
    .map((run) => ({ id: run.id, at: new Date(run.since) }))
    .filter(({ at }) => !Number.isNaN(at.getTime()) && at.getTime() <= limit)
    .sort(
      (a, b) =>
        a.at.getTime() - b.at.getTime() ||
        a.id.length - b.id.length ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  const [first] = long;
  if (!first) return undefined;
  return { run: first.id, since: first.at.toISOString(), more: long.length - 1 };
}

// Only a scan lists the runs. Every other writer carries the line it finds,
// except when the run it names is the writer's own: that run has a runner now.
export function carriedWaitingRun(
  facts: WaitingRunFacts | undefined,
  ownRunId: string,
): WaitingRunFacts | undefined {
  return facts?.run === ownRunId ? undefined : facts;
}
