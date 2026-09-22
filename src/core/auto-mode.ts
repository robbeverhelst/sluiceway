// Auto mode (record 0077): with no `mode` input, the action reads the event
// that started the run and picks the modes itself, so one job with one step
// runs the whole loop and the workflow needs no `if:` and no `needs:`. This
// holds the rule. The glue reads the event and runs what it says.

// The modes auto mode starts by itself. `apply` and `settle` follow from what
// `resolve` and the scan hand on, in the same step.
export type AutoMode = "scan" | "resolve" | "check";

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
}

export type AutoPlan = { modes: AutoMode[] } | { notice: string };

const NOTHING = "Nothing to do.";

export function autoModes(event: AutoEvent, config: { readOnly: boolean }): AutoPlan {
  switch (event.name) {
    case "push":
      // A scan writes the dashboard from the code it checked out, so only the
      // default branch counts. A payload that does not say keeps the old
      // behavior: the workflow's own branch filter decided.
      if (event.defaultBranch !== undefined && event.ref !== `refs/heads/${event.defaultBranch}`) {
        return {
          notice: `A push to ${event.ref ?? "an unknown ref"} is not a push to the default branch, ${event.defaultBranch}. Sluiceway scans only the default branch. ${NOTHING}`,
        };
      }
      return { modes: ["scan"] };
    case "schedule":
      return { modes: ["scan"] };
    case "workflow_dispatch":
      // resolve first: it starts the next layer of a chain (record 0056). A
      // read-only dashboard never queues anything (record 0045).
      return { modes: config.readOnly ? ["scan"] : ["resolve", "scan"] };
    case "issues":
      if (event.action !== "edited") {
        return {
          notice: `An issue was ${event.action ?? "changed"}. Sluiceway acts only on an edit of its dashboard. ${NOTHING}`,
        };
      }
      if (config.readOnly) {
        return {
          notice: `The dashboard is read only (dashboard.readOnly), so an issue edit asks nothing of Sluiceway. ${NOTHING}`,
        };
      }
      return { modes: ["resolve"] };
    case "pull_request":
    case "merge_group":
      return { modes: ["check"] };
    default:
      return {
        notice: `Sluiceway has nothing to do on a ${event.name} event. It scans on push, schedule and workflow_dispatch, acts on an edit of its dashboard, and checks a pull request. ${NOTHING}`,
      };
  }
}
