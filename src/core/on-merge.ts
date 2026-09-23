// Deploy on merge (record 0095): a stack whose config says `deploy: on-merge`
// goes out after the scan of a merge found it pending, through the path a
// tick takes. This decides which stacks go and which wait for a tick, and
// why. It reads nothing and opens nothing: the scan hands it what it has at
// its late read and opens the records it returns, as `resolve` opens the
// records of a tick.

import type { PreviewResult } from "../adapters/adapter.ts";
import { isDestroy } from "../render/row.ts";
import { planDeploys } from "./dependencies.ts";
import type { Diff } from "./diff.ts";
import { diffHash } from "./diff-hash.ts";
import { type PhaseGroup, waitsByPhase } from "./phases.ts";
import type { Deploy } from "./tick-judgement.ts";

// `stacks[].deploy`. The default is a tick.
export type DeployOn = "on-tick" | "on-merge";

export interface OnMergeInput {
  // The person whose push to the default branch started this scan, as the
  // event names them. Absent for every other scan: only a merge deploys on
  // merge.
  mergedBy: string | undefined;
  // `deploys` and `dashboard.readOnly` of the config.
  deploys: boolean;
  readOnly: boolean;
  // Every stack of the repo, with what its config says.
  stacks: readonly {
    id: string;
    environment: string;
    deploy: DeployOn;
    dependsOn?: readonly string[] | undefined;
    phase?: string | undefined;
  }[];
  // What this scan previewed, by stack id.
  previewed: ReadonlyMap<string, PreviewResult>;
  // The stacks this scan did not preview whose live row is pending.
  livePending: ReadonlySet<string>;
  // The stacks with an open deployment, queued or deploying, from any run.
  open: ReadonlySet<string>;
  // `phases` of the config, for a note that names a phase.
  phases: readonly string[];
}

// Why a stack set to on-merge waits for a tick after all. Its row says so.
// A destroy deserves a look (record 0024), and drift is reality that moved,
// which only a person should put back (record 0055).
// `deploys: false` stops every deploy, and a scan that no merge started
// found the change, so there is no merge to deploy on (record 0095).
export type OnMergeWait =
  | { kind: "deploys-off" }
  | { kind: "destroy" }
  | { kind: "drift" }
  | { kind: "not-merged" }
  // A stack it depends on has a change that is not going out now (records
  // 0056 and 0067), named as a refused tick names it.
  | { kind: "depends-on"; named: string[]; phases: PhaseGroup[] };

export interface OnMergeDecision {
  // The records to open: `behind` queues one behind the stacks before it.
  deploys: Deploy[];
  // The stacks set to on-merge that are pending and wait for a tick.
  waits: Map<string, OnMergeWait>;
}

export function onMergeDeploys(input: OnMergeInput): OnMergeDecision {
  const waits = new Map<string, OnMergeWait>();
  // A read-only dashboard deploys nothing and has no boxes, and its line
  // under the Pending heading says so once (record 0045).
  if (input.readOnly) return { deploys: [], waits };
  const hashes = new Map<string, string>();
  for (const stack of input.stacks) {
    if (stack.deploy !== "on-merge" || input.open.has(stack.id)) continue;
    const result = input.previewed.get(stack.id);
    if (!result?.ok || result.diff.changes.length === 0) continue;
    const wait = waitOf(input, result.diff);
    if (wait) waits.set(stack.id, wait);
    else hashes.set(stack.id, diffHash(result.diff));
  }

  // The order of a chain, and what holds a stack back, are the rules of a
  // tick (records 0056 and 0067): the stacks that go are the ones ticked
  // together, and every other pending row is a change nobody ticked.
  const pending = new Set(input.livePending);
  for (const [id, result] of input.previewed) {
    if (result.ok && result.diff.changes.length > 0) pending.add(id);
  }
  const plan = planDeploys({
    allowed: [...hashes.keys()],
    dependsOn: new Map(input.stacks.map(({ id, dependsOn }) => [id, dependsOn ?? []])),
    pending,
    open: input.open,
  });
  const phaseOf = new Map(
    input.stacks.flatMap(({ id, phase }) => (phase === undefined ? [] : [[id, phase] as const])),
  );
  for (const { stackId, waitingOn } of plan.refused) {
    waits.set(stackId, {
      kind: "depends-on",
      ...waitsByPhase({ phases: input.phases, phaseOf, stackId, waitingOn }),
    });
  }

  const environments = new Map(input.stacks.map(({ id, environment }) => [id, environment]));
  const ticker = input.mergedBy ?? "";
  const deploys = [
    ...plan.start.map((stackId) => ({ stackId, behind: undefined })),
    ...plan.queued,
  ].map(
    ({ stackId, behind }): Deploy => ({
      stackId,
      environment: environments.get(stackId) ?? "",
      ticker,
      hash: hashes.get(stackId) ?? "",
      drift: false,
      behind,
    }),
  );
  return { deploys, waits };
}

// What holds one stack back by itself, in the order a person most needs to
// read it: nothing deploys at all, then what a deploy would do, then how the
// change was found.
function waitOf(input: OnMergeInput, diff: Diff): OnMergeWait | undefined {
  if (!input.deploys) return { kind: "deploys-off" };
  if (diff.changes.some(isDestroy)) return { kind: "destroy" };
  if ((diff.drift ?? []).length > 0) return { kind: "drift" };
  if (input.mergedBy === undefined) return { kind: "not-merged" };
  return undefined;
}
