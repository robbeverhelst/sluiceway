import type { Stack } from "../../../src/core/stack.ts";

// The stacks of examples/helm-basic/sluiceway.yaml, as discovery gives them
// (record 0058).
export const WEB: Stack = {
  path: "web",
  options: {
    tool: "helm",
    release: "web",
    namespace: "sluiceway-web",
    chart: "../charts/web",
    valuesFiles: ["values.yaml"],
    chartDir: "charts/web",
    dependencies: false,
  },
};
export const WORKER: Stack = {
  path: "worker",
  options: {
    tool: "helm",
    release: "worker",
    namespace: "sluiceway-worker",
    chart: "../charts/worker",
    valuesFiles: ["values.yaml"],
    chartDir: "charts/worker",
    dependencies: true,
  },
};
