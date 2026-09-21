// What `resolve` hands to `apply` (record 0035): one matrix entry per deploy it
// started, and never more of them than one workflow run can hold.

// `stack` and `environment` are for the workflow: the per stack concurrency
// group needs the stack id, and the optional job level `environment:` key
// needs a name. The action itself takes everything from the record.
export interface MatrixEntry {
  stack: string;
  // The label on the record: the stack's configured environment, else the
  // fixed name `sluiceway` (record 0003).
  environment: string;
  // The id of the deployment record, which `apply` takes as `deployment-id`.
  deployment: number;
}

// Key order is fixed so the output is byte-identical for the same deploys.
export function matrixOutput(entries: readonly MatrixEntry[]): string {
  return JSON.stringify(
    entries.map(({ stack, environment, deployment }) => ({ stack, environment, deployment })),
  );
}

// A workflow run has at most 256 matrix jobs.
export const MAX_DEPLOYS_PER_RUN = 256;

// The deploys one run starts, in stack id order, and the ticks beyond the cap.
// Those are cleared with the note that asks for a fresh tick.
export function capDeploys<T extends { stackId: string }>(
  allowed: readonly T[],
): { start: T[]; over: T[] } {
  const sorted = [...allowed].sort((a, b) =>
    a.stackId < b.stackId ? -1 : a.stackId > b.stackId ? 1 : 0,
  );
  return { start: sorted.slice(0, MAX_DEPLOYS_PER_RUN), over: sorted.slice(MAX_DEPLOYS_PER_RUN) };
}
