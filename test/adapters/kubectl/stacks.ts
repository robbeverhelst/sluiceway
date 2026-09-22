import type { Stack } from "../../../src/core/stack.ts";

// The stacks of examples/kubernetes-basic/sluiceway.yaml, as discovery gives
// them (record 0060).
export const WEB: Stack = {
  path: "web",
  options: { tool: "kubectl", namespace: "sluiceway-example" },
};
export const CACHE: Stack = { path: "cache", options: { tool: "kubectl" } };

// web with the options of part 2 (record 0070), as the part 2 scenarios of
// scripts/fixtures/kubectl-scenarios.ts record it.
export const PRUNED_WEB: Stack = {
  path: "web",
  options: { tool: "kubectl", namespace: "sluiceway-example", prune: true },
};
export const FORCED_WEB: Stack = {
  path: "web",
  options: {
    tool: "kubectl",
    namespace: "sluiceway-example",
    forceConflicts: true,
    fieldManager: "sluiceway-web",
  },
};
export const RECURSIVE_WEB: Stack = {
  path: "web",
  options: { tool: "kubectl", namespace: "sluiceway-example", recursive: true },
};
