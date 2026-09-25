// Auto mode (record 0077): with no `mode` input, the action reads the event
// that started the run and picks the modes itself, so one job with one step
// runs the whole loop and the workflow needs no `if:` and no `needs:`. This
// holds the rule. The glue reads the event and runs what it says, and the
// check reads the triggers of a workflow file and asks the same rule which
// modes its step may run.

import { MERGE_SCAN_INPUT } from "./merge-scan.ts";

// Every mode of the action, in the order the docs list them. The entry point,
// the check and its words all read this one list.
export const MODES = ["auto", "scan", "resolve", "apply", "settle", "check", "init"] as const;

export type Mode = (typeof MODES)[number];

export function isMode(value: string): value is Mode {
  return (MODES as readonly string[]).includes(value);
}

// The modes auto mode starts by itself. `apply` and `settle` follow from what
// `resolve` and the scan hand on, in the same step.
export type AutoMode = Extract<Mode, "scan" | "resolve" | "check">;

// What each event starts, in the order it runs them, before
// `dashboard.readOnly` takes `resolve` out. An event not here starts nothing.
// A dispatch resolves first: it starts the next layer of a chain (record 0056).
// So does the schedule: it is the run that falls inside a deploy window and
// starts what waited for it (record 0104).
const STARTS: Readonly<Record<string, readonly AutoMode[]>> = {
  push: ["scan"],
  schedule: ["resolve", "scan"],
  workflow_dispatch: ["resolve", "scan"],
  issues: ["resolve"],
  pull_request: ["check"],
  merge_group: ["check"],
};

// The modes an event starts. A read-only dashboard never queues anything
// (record 0045). Undefined for an event Sluiceway has nothing to do on.
function startedBy(event: string, config: { readOnly: boolean }): AutoMode[] | undefined {
  if (!Object.hasOwn(STARTS, event)) return undefined;
  const modes = STARTS[event] ?? [];
  return config.readOnly ? modes.filter((mode) => mode !== "resolve") : [...modes];
}

// What the glue read of the event, as data.
export interface AutoEvent {
  // `GITHUB_EVENT_NAME`, such as "push" or "issues".
  name: string;
  // The payload's `action`, for an `issues` event.
  action?: string | undefined;
  // For a push: the ref pushed, and the repo's default branch when the
  // payload names it.
  ref?: string | undefined;
  defaultBranch?: string | undefined;
  // For a dispatch: the names of the inputs it carried, whatever their values.
  inputs?: readonly string[] | undefined;
}

export type AutoPlan = { modes: AutoMode[] } | { notice: string };

const NOTHING = "Nothing to do.";

export function autoModes(event: AutoEvent, config: { readOnly: boolean }): AutoPlan {
  const modes = startedBy(event.name, config);
  if (modes === undefined) {
    return {
      notice: `Sluiceway has nothing to do on a ${event.name} event. It scans on push, schedule and workflow_dispatch, acts on an edit of its dashboard, and checks a pull request. ${NOTHING}`,
    };
  }
  // A scan writes the dashboard from the code it checked out, so only the
  // default branch counts. A payload that does not say keeps the old
  // behavior: the workflow's own branch filter decided.
  if (
    event.name === "push" &&
    event.defaultBranch !== undefined &&
    event.ref !== `refs/heads/${event.defaultBranch}`
  ) {
    return {
      notice: `A push to ${event.ref ?? "an unknown ref"} is not a push to the default branch, ${event.defaultBranch}. Sluiceway scans only the default branch. ${NOTHING}`,
    };
  }
  if (event.name === "issues") {
    if (event.action !== "edited") {
      return {
        notice: `An issue was ${event.action ?? "changed"}. Sluiceway acts only on an edit of its dashboard. ${NOTHING}`,
      };
    }
    if (modes.length === 0) {
      return {
        notice: `The dashboard is read only (dashboard.readOnly), so an issue edit asks nothing of Sluiceway. ${NOTHING}`,
      };
    }
  }
  return { modes };
}

// What `resolve` handed on, as auto mode counts it: every matrix entry, and
// how many of them were outside records (record 0109).
export interface HandedOn {
  entries: number;
  outsideRecords: number;
}

// Whether the scan that follows `resolve` on a dispatch is skipped (record
// 0109), as the line for the job log, or nothing when the scan runs. A run
// that a writer dispatched to deploy the records it opened has nothing to
// scan for: the deploys write their own rows, and a scan per deploy is the
// cost the split workflow avoided. The scan runs when `resolve` also started
// a queued stack, whose run always scanned after the layer, when the dispatch
// named the merged pull requests, which the scan after a merge reads (record
// 0064), and on the schedule, whose scan is the drift check and the window.
export function scanSkippedAfterResolve(event: AutoEvent, handedOn: HandedOn): string | undefined {
  if (event.name !== "workflow_dispatch") return undefined;
  if (handedOn.outsideRecords === 0 || handedOn.outsideRecords !== handedOn.entries) {
    return undefined;
  }
  if ((event.inputs ?? []).includes(MERGE_SCAN_INPUT)) return undefined;
  const count = handedOn.outsideRecords;
  const one = count === 1;
  return `The scan of this run is skipped: resolve handed on ${count} deployment ${one ? "record" : "records"} that another writer opened for this run, and the dispatch named no merged pull requests, so there is nothing to scan for. The ${one ? "deploy writes its own row" : "deploys write their own rows"}, and the next push, schedule or dispatch scans (record 0109).`;
}

// The events a workflow file can be started on, as the check reads its `on:`.
export interface AutoTriggers {
  // The events by name. `issues` only when it takes an edit: any other issue
  // event starts nothing.
  events: readonly string[];
  // `workflow_call`: a reusable workflow gets its events from its caller.
  called: boolean;
}

// Every mode an auto step may run over the life of its file, in the order of
// MODES, by the same table as autoModes: the question of the check (records
// 0061, 0077), where autoModes answers for one event that happened.
export function autoModesOn(triggers: AutoTriggers, config: { readOnly: boolean }): Mode[] {
  // A caller may start a reusable workflow on any event of the loop, which is
  // every event that starts more than the check.
  const events = triggers.called
    ? [
        ...triggers.events,
        ...Object.entries(STARTS)
          .filter(([, modes]) => modes.some((mode) => mode !== "check"))
          .map(([event]) => event),
      ]
    : triggers.events;
  const runs = new Set<Mode>(events.flatMap((event) => startedBy(event, config) ?? []));
  // Without issue edits nothing is ever ticked, so a dispatch finds nothing
  // to resolve.
  if (!events.includes("issues")) runs.delete("resolve");
  // What resolve hands on deploys and settles in the same step.
  if (runs.has("resolve")) {
    runs.add("apply");
    runs.add("settle");
  }
  return MODES.filter((mode) => runs.has(mode));
}
