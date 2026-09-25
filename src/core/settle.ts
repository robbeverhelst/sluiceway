// What `settle` ends (records 0003 and 0035): the open deployment records of
// its own workflow run, and nothing else. A record of another run is left
// alone, even one whose run is over: that is for the next render to see.

import { type DeploymentRecord, deployFacts, taskStackId } from "./deployment.ts";

export interface OpenRecordOfRun {
  id: number;
  stackId: string;
  // A queued record waits behind these stacks (record 0056).
  behind?: string[];
  // A queued record waits for the deploy window (record 0104).
  window?: true;
}

// Each record is read on its own, so a record of this run is found whether or
// not it is the newest of its stack. A record that is not Sluiceway's, or whose
// payload this version cannot read, is never one of them (record 0003).
export function openRecordsOfRun(
  records: readonly DeploymentRecord[],
  runId: string,
): OpenRecordOfRun[] {
  const found = new Map<number, OpenRecordOfRun>();
  for (const record of records) {
    const stackId = taskStackId(record.task);
    if (stackId === undefined) continue;
    const fact = deployFacts([record]).byStack.get(stackId);
    // A merge record waits for the scan after the merge (record 0054).
    if (fact?.kind !== "open" || fact.run !== runId || fact.merge !== undefined) continue;
    found.set(record.id, {
      id: record.id,
      stackId,
      ...(fact.behind ? { behind: fact.behind } : {}),
      ...(fact.window ? { window: true as const } : {}),
    });
  }
  return [...found.values()].sort((a, b) => a.id - b.id);
}

// The open records of a run that `apply` may take (record 0109): each names
// the run and waits behind no stack, for no window and for no scan. A
// `resolve` that no issue edit started hands them on, so a record a writer
// outside Sluiceway opened in the published shape (record 0096) for a run it
// dispatched is deployed by that run, through the fresh preview and the hash
// check as any record is. What waits is `startQueued`'s, not this.
export function deployableRecordsOfRun(
  records: readonly DeploymentRecord[],
  runId: string,
): OpenRecordOfRun[] {
  return openRecordsOfRun(records, runId).filter(
    ({ behind, window }) => behind === undefined && window === undefined,
  );
}
