// The part 2 scenarios (record 0070), each replayed the way Sluiceway runs
// the adapter through it: previews, drift checks and deploys in the order the
// recorder ran them. The tests of part2.test.ts hold what comes out to what
// the scenario did, and the canary test holds it to showing no value.
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  ApplyResult,
  DriftResult,
  PreviewOptions,
  PreviewResult,
  SavedPlan,
} from "../../../src/adapters/adapter.ts";
import { kubectl } from "../../../src/adapters/kubectl/index.ts";
import type { Stack } from "../../../src/core/stack.ts";
import { type Replay, ROOT, replay } from "./replay.ts";
import { FORCED_WEB, PRUNED_WEB, RECURSIVE_WEB } from "./stacks.ts";

export type Step =
  | { kind: "preview"; result: PreviewResult }
  | { kind: "drift"; result: DriftResult | undefined }
  | { kind: "apply"; result: ApplyResult };

export interface Flow {
  stack: Stack;
  // The example as the scenario changed it, where the adapter reads it.
  files?: { remove?: string[]; write?: Record<string, string> };
  // "keep" is a preview that keeps its set, as `apply` asks, and "deploy"
  // deploys the kept set and lets it go.
  steps: ("preview" | "drift" | "keep" | "deploy")[];
}

export const PART_2: Record<string, Flow> = {
  "prune-first": { stack: PRUNED_WEB, steps: ["preview"] },
  prune: {
    stack: PRUNED_WEB,
    files: { remove: ["web/configmap.yaml"] },
    steps: ["keep", "deploy", "preview"],
  },
  "drift-deleted": { stack: PRUNED_WEB, steps: ["preview", "drift"] },
  "drift-changed": { stack: FORCED_WEB, steps: ["keep", "drift", "deploy", "preview"] },
  "drift-conflict": {
    stack: { path: "web", options: { tool: "kubectl", namespace: "sluiceway-example" } },
    steps: ["preview"],
  },
  recursive: {
    stack: RECURSIVE_WEB,
    files: {
      write: {
        "web/more/extra.yaml":
          "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: web-more\ndata:\n  motd: CANARY-VALUE\n",
      },
    },
    steps: ["preview"],
  },
};

// A copy of the example with the scenario's changes, or the example itself.
export function exampleFor(flow: Flow): { root: string; done: () => void } {
  if (flow.files === undefined) return { root: ROOT, done: () => {} };
  const root = mkdtempSync(join(tmpdir(), "sluiceway-kubectl-example-"));
  cpSync(ROOT, root, { recursive: true });
  for (const file of flow.files.remove ?? []) rmSync(join(root, file));
  for (const [file, text] of Object.entries(flow.files.write ?? {})) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}

// Runs the flow, the way the scan and `apply` run the adapter.
export async function runFlow(
  version: string,
  scenario: string,
  extra: Partial<PreviewOptions> = {},
): Promise<{ steps: Step[]; replay: Replay }> {
  const flow = PART_2[scenario];
  if (flow === undefined) throw new Error(`No flow for ${scenario}.`);
  const { root, done } = exampleFor(flow);
  const runner = replay(version, scenario, root);
  const options: PreviewOptions = {
    root,
    env: { PATH: "/usr/bin", KUBECONFIG: "/kube/config" },
    run: runner.run,
    timeoutMinutes: 10,
    ...extra,
  };
  const steps: Step[] = [];
  let kept: SavedPlan | undefined;
  try {
    for (const step of flow.steps) {
      if (step === "preview" || step === "keep") {
        const result = await kubectl.preview(flow.stack, {
          ...options,
          savePlan: step === "keep",
        });
        if (result.ok) kept = result.plan;
        steps.push({ kind: "preview", result });
      } else if (step === "drift") {
        steps.push({ kind: "drift", result: await kubectl.detectDrift?.(flow.stack, options) });
      } else {
        steps.push({ kind: "apply", result: await kubectl.apply(flow.stack, options, kept) });
        await kept?.dispose();
        kept = undefined;
      }
    }
  } finally {
    await kept?.dispose();
    done();
  }
  return { steps, replay: runner };
}
