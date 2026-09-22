import type { Stack } from "../../../src/core/stack.ts";

// The stacks of examples/opentofu-basic/sluiceway.yaml, as discovery gives
// them (record 0053).
export const DEV: Stack = {
  path: "network",
  name: "dev",
  options: { tool: "opentofu", workspace: "dev", varFiles: ["dev.tfvars"] },
};
export const PROD: Stack = {
  path: "network",
  name: "prod",
  options: { tool: "opentofu", workspace: "prod", varFiles: ["prod.tfvars"] },
};
export const DNS: Stack = { path: "dns", options: { tool: "opentofu", varFiles: [] } };
