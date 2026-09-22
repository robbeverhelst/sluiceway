// Phases (record 0067): `phases` in sluiceway.yaml is an ordered list of
// names, and a stack says which one it is in. A stack in a phase depends on
// every stack in every earlier phase. The edges are derived here, and the
// rules of record 0056 work on them as on the ones `dependsOn` names. Pure.

import type { Config } from "./config.ts";

// The keys of a tool's own file that `phase: { from }` entries point at
// (record 0067). Discovery reads the text under these and nothing else.
export function phaseKeysOf(config: Config): string[] {
  return [
    ...new Set(
      config.stacks.flatMap((entry) => (typeof entry.phase === "object" ? [entry.phase.from] : [])),
    ),
  ];
}

// A phase name is a plain word, so it reads the same in a note, the check and
// the job log.
export const PHASE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// The stacks of one phase, in stack id order.
export interface PhaseGroup {
  phase: string;
  stackIds: string[];
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Every phase in the order of the file, with its stacks. A phase no stack is
// in is listed with none.
export function phaseGroups(
  phases: readonly string[],
  phaseOf: ReadonlyMap<string, string>,
): PhaseGroup[] {
  return phases.map((phase) => ({
    phase,
    stackIds: [...phaseOf].flatMap(([id, one]) => (one === phase ? [id] : [])).sort(byCodeUnit),
  }));
}

// Stack id to the stack ids of every earlier phase, for each stack in a
// phase. A stack without a phase has no entry: it neither waits on a phase
// nor holds one back.
export function phaseDependencies(
  phases: readonly string[],
  phaseOf: ReadonlyMap<string, string>,
): Map<string, string[]> {
  const index = (id: string) => phases.indexOf(phaseOf.get(id) ?? "");
  const edges = new Map<string, string[]>();
  for (const id of [...phaseOf.keys()].sort(byCodeUnit)) {
    const at = index(id);
    if (at === -1) continue;
    edges.set(
      id,
      [...phaseOf.keys()]
        .filter((other) => index(other) !== -1 && index(other) < at)
        .sort(byCodeUnit),
    );
  }
  return edges;
}

// Whether a stack waits on a dependency through its phase: both are in a
// phase, and the dependency's comes first.
export function throughPhase(
  phases: readonly string[],
  phaseOf: ReadonlyMap<string, string>,
  stackId: string,
  dependency: string,
): boolean {
  const own = phases.indexOf(phaseOf.get(stackId) ?? "");
  const theirs = phases.indexOf(phaseOf.get(dependency) ?? "");
  return own !== -1 && theirs !== -1 && theirs < own;
}

// The stacks a tick waits on, told as a person set them up: the ones it
// waits on through its phase grouped by their phase, in the order of the
// phases, and the rest by stack id. A refusal then names the phase, not every
// stack in it.
export function waitsByPhase(input: {
  phases: readonly string[];
  phaseOf: ReadonlyMap<string, string>;
  stackId: string;
  waitingOn: readonly string[];
}): { named: string[]; phases: PhaseGroup[] } {
  const { phases, phaseOf, stackId } = input;
  const named: string[] = [];
  const grouped = new Map<string, string[]>();
  for (const id of [...new Set(input.waitingOn)].sort(byCodeUnit)) {
    const phase = phaseOf.get(id);
    if (phase === undefined || !throughPhase(phases, phaseOf, stackId, id)) named.push(id);
    else grouped.set(phase, [...(grouped.get(phase) ?? []), id]);
  }
  return {
    named,
    phases: phases.flatMap((phase) => {
      const stackIds = grouped.get(phase);
      return stackIds ? [{ phase, stackIds }] : [];
    }),
  };
}
