import type { Stack } from "../../../src/core/stack.ts";

// The stacks of examples/kubernetes-basic/sluiceway.yaml, as discovery gives
// them (record 0060).
export const WEB: Stack = {
  path: "web",
  options: { tool: "kubectl", namespace: "sluiceway-example" },
};
export const CACHE: Stack = { path: "cache", options: { tool: "kubectl" } };
