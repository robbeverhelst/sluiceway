// The scan after a merge (record 0064). A merge made with the workflow token
// starts no run of its push, so `resolve` dispatches the scan itself, and
// names the pull requests it merged in a dispatch input. A scan that is given
// them narrows as a push does. A workflow must declare the input, or GitHub
// refuses the dispatch, so `resolve` sends it only to a workflow that does.

import { parse } from "yaml";

export const MERGE_SCAN_INPUT = "sluiceway-merged";

export function mergeScanInputs(pullRequests: readonly number[]): Record<string, string> {
  return { [MERGE_SCAN_INPUT]: pullRequests.join(",") };
}

// The numbers of the input, or none when it is empty or not what `resolve`
// writes.
export function readMergeScanInput(value: unknown): number[] {
  if (typeof value !== "string") return [];
  const parts = value.split(",").map((part) => part.trim());
  if (parts.some((part) => !/^[1-9]\d*$/.test(part))) return [];
  return parts.map(Number);
}

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

// Whether the workflow's `workflow_dispatch` trigger declares the input.
export function declaresMergeScanInput(workflowText: string): boolean {
  let workflow: unknown;
  try {
    workflow = parse(workflowText);
  } catch {
    return false;
  }
  const triggers = objectOf(objectOf(workflow)?.on);
  const inputs = objectOf(objectOf(triggers?.workflow_dispatch)?.inputs);
  return inputs !== undefined && Object.hasOwn(inputs, MERGE_SCAN_INPUT);
}
