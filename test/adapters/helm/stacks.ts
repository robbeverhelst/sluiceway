import type { Stack } from "../../../src/core/stack.ts";

// The stacks of examples/helm-basic/sluiceway.yaml, as discovery gives them
// (records 0058 and 0069).
export const WEB: Stack = {
  path: "web",
  options: {
    tool: "helm",
    release: "web",
    namespace: "sluiceway-web",
    chart: "../charts/web",
    valuesFiles: ["values.yaml"],
    createNamespace: false,
    chartDir: "charts/web",
    builds: [],
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
    createNamespace: false,
    chartDir: "charts/worker",
    builds: [{ chart: "charts/worker", level: 1 }],
  },
};

// worker in the dependencies-nested scenario: its dependency web depends on
// base, so web's dependencies are built before worker's (record 0069).
export const WORKER_NESTED: Stack = {
  ...WORKER,
  options: {
    ...WORKER.options,
    builds: [
      { chart: "charts/web", level: 1 },
      { chart: "charts/worker", level: 2 },
    ],
  },
};

// web in a namespace the deploy makes, as the create-namespace scenario
// installs it (record 0069).
export const WEB_NEW_NAMESPACE: Stack = {
  ...WEB,
  options: { ...WEB.options, namespace: "sluiceway-new", createNamespace: true },
};
