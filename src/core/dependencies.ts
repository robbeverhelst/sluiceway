// Stack dependencies (record 0056): `dependsOn` in sluiceway.yaml names the
// stacks a stack depends on. A stack waits only on those it names, and only
// on a change that can still go out: a pending row, an open deployment, or a
// tick in the same run. Pure: the modes hand in what they read.

import {
  type DeploymentRecord,
  isHandedOn,
  isOpenStatus,
  newestLast,
  taskStackId,
} from "./deployment.ts";

export interface DeployPlanInput {
  // The ticks that passed the tick rule and the cap, by stack id.
  allowed: readonly string[];
  // Stack id to the stack ids it depends on, from config.
  dependsOn: ReadonlyMap<string, readonly string[]>;
  // Stacks whose live row is pending: a change waits that has not gone out.
  pending: ReadonlySet<string>;
  // Stacks with an open deployment, queued or deploying, from any run.
  open: ReadonlySet<string>;
}

export interface DeployPlan {
  // Deploys now: the first layer, handed to `apply`.
  start: string[];
  // Gets a queued record that waits behind these stacks.
  queued: { stackId: string; behind: string[] }[];
  // Starts nothing: a stack it depends on has a change waiting that nobody
  // ticked. The box is cleared with a note that names them.
  refused: { stackId: string; waitingOn: string[] }[];
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Which ticks start, which are queued and which are refused. A refusal
// travels down a chain: a stack whose dependency was refused in this run
// waits on a change that is not going out either.
export function planDeploys(input: DeployPlanInput): DeployPlan {
  const ids = [...new Set(input.allowed)].sort(byCodeUnit);
  const going = new Set(ids);
  const refused = new Map<string, string[]>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const id of ids) {
      if (refused.has(id)) continue;
      const waitingOn = (input.dependsOn.get(id) ?? []).filter(
        (dependency) =>
          !input.open.has(dependency) &&
          !going.has(dependency) &&
          (input.pending.has(dependency) || refused.has(dependency)),
      );
      if (waitingOn.length === 0) continue;
      refused.set(id, [...waitingOn].sort(byCodeUnit));
      going.delete(id);
      changed = true;
    }
  }

  const start: string[] = [];
  const queued: DeployPlan["queued"] = [];
  for (const id of ids) {
    if (refused.has(id)) continue;
    const behind = (input.dependsOn.get(id) ?? [])
      .filter((dependency) => going.has(dependency) || input.open.has(dependency))
      .sort(byCodeUnit);
    if (behind.length === 0) start.push(id);
    else queued.push({ stackId: id, behind });
  }
  return {
    start,
    queued,
    refused: [...refused].map(([stackId, waitingOn]) => ({ stackId, waitingOn })),
  };
}

// Where a queued record stands, from the newest record of each stack it waits
// behind. A record handed on to a later run is skipped, so the one of that run
// counts. `inactive` covers a rehearsal, whose chain rehearses on.
//   waiting  one of them is still open
//   ready    every one of them went out, or had nothing to deploy
//   dead     one of them failed, or has no record at all
export type QueueState = "waiting" | "ready" | "dead";

export function queueState(
  behind: readonly string[],
  records: readonly DeploymentRecord[],
): QueueState {
  const newest = new Map<string, DeploymentRecord>();
  for (const record of [...records].sort(newestLast)) {
    const id = taskStackId(record.task);
    if (id !== undefined && !isHandedOn(record.status)) newest.set(id, record);
  }
  let waiting = false;
  for (const id of behind) {
    const record = newest.get(id);
    if (!record) return "dead";
    if (isOpenStatus(record.status)) waiting = true;
    else if (record.status?.state === "failure" || record.status?.state === "error") return "dead";
  }
  return waiting ? "waiting" : "ready";
}

export interface ReadDependenciesInput {
  // Stack id to the stack ids sluiceway.yaml names, for every stack that
  // discovery found and ignore kept.
  configured: ReadonlyMap<string, readonly string[]>;
  // The stacks with `dependsOn: auto`.
  auto: ReadonlySet<string>;
  // Stack id to the stack ids its row says its preview read.
  read: ReadonlyMap<string, readonly string[]>;
}

// `dependsOn: auto` (record 0059): what a stack with auto depends on is what
// the file names and what its row says its preview read from the program's
// stack references. `resolve` never previews, so the row is its one source,
// as it is for the pending state (record 0056). A read that names a stack
// discovery does not know, or the stack itself, is left out. The file's list
// has no circle (the loader refuses one), and a read that would close one is
// dropped, in stack id order, so a chain never waits on itself.
export function withReadDependencies(input: ReadDependenciesInput): {
  dependsOn: Map<string, string[]>;
  dropped: { stackId: string; dependency: string }[];
} {
  const dependsOn = new Map([...input.configured].map(([id, ids]) => [id, [...ids]]));
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set<string>();
    const walk = (at: string): boolean => {
      if (at === to) return true;
      if (seen.has(at)) return false;
      seen.add(at);
      return (dependsOn.get(at) ?? []).some(walk);
    };
    return walk(from);
  };
  const dropped: { stackId: string; dependency: string }[] = [];
  for (const id of [...input.auto].sort(byCodeUnit)) {
    const list = dependsOn.get(id);
    if (list === undefined) continue;
    for (const dependency of [...(input.read.get(id) ?? [])].sort(byCodeUnit)) {
      if (dependency === id || !dependsOn.has(dependency) || list.includes(dependency)) continue;
      if (reaches(dependency, id)) dropped.push({ stackId: id, dependency });
      else list.push(dependency);
    }
    list.sort(byCodeUnit);
  }
  return { dependsOn, dropped };
}
