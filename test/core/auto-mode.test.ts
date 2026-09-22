import { describe, expect, test } from "bun:test";
import { autoModes } from "../../src/core/auto-mode.ts";

// Slice 5.12 (record 0077): with no mode, the action reads the event and
// picks what to run itself, so the workflow needs no if: and no needs:.

const push = (ref: string, defaultBranch?: string) => ({
  name: "push",
  ref,
  ...(defaultBranch === undefined ? {} : { defaultBranch }),
});

describe("autoModes", () => {
  test("a push to the default branch scans", () => {
    expect(autoModes(push("refs/heads/main", "main"), { readOnly: false })).toEqual({
      modes: ["scan"],
    });
  });

  test("a push to another branch or a tag is not Sluiceway's", () => {
    expect(autoModes(push("refs/heads/feature", "main"), { readOnly: false })).toEqual({
      notice:
        "A push to refs/heads/feature is not a push to the default branch, main. Sluiceway scans only the default branch. Nothing to do.",
    });
    expect(autoModes(push("refs/tags/v1", "main"), { readOnly: false })).toHaveProperty("notice");
  });

  test("a push whose payload names no default branch scans, as before", () => {
    expect(autoModes(push("refs/heads/main"), { readOnly: false })).toEqual({ modes: ["scan"] });
  });

  test("the schedule scans", () => {
    expect(autoModes({ name: "schedule" }, { readOnly: false })).toEqual({ modes: ["scan"] });
  });

  // The rescan box, settle and resolve after a merge all start the workflow
  // again: resolve starts the next layer of a chain (record 0056), then the
  // scan runs (records 0035, 0054).
  test("a dispatch resolves first and then scans", () => {
    expect(autoModes({ name: "workflow_dispatch" }, { readOnly: false })).toEqual({
      modes: ["resolve", "scan"],
    });
  });

  // A read-only dashboard has no boxes (record 0045), so nothing is ever
  // queued, and a trial workflow may not have deployments: write.
  test("a dispatch of a read-only dashboard only scans", () => {
    expect(autoModes({ name: "workflow_dispatch" }, { readOnly: true })).toEqual({
      modes: ["scan"],
    });
  });

  test("an issue edit resolves", () => {
    expect(autoModes({ name: "issues", action: "edited" }, { readOnly: false })).toEqual({
      modes: ["resolve"],
    });
  });

  test("an issue edit on a read-only dashboard is not Sluiceway's", () => {
    expect(autoModes({ name: "issues", action: "edited" }, { readOnly: true })).toEqual({
      notice:
        "The dashboard is read only (dashboard.readOnly), so an issue edit asks nothing of Sluiceway. Nothing to do.",
    });
  });

  test("any other issue event is not Sluiceway's", () => {
    expect(autoModes({ name: "issues", action: "opened" }, { readOnly: false })).toEqual({
      notice:
        "An issue was opened. Sluiceway acts only on an edit of its dashboard. Nothing to do.",
    });
  });

  // Record 0042: the check is safe on any pull request, from forks too.
  test("a pull request and a merge queue run the check", () => {
    expect(autoModes({ name: "pull_request" }, { readOnly: false })).toEqual({ modes: ["check"] });
    expect(autoModes({ name: "merge_group" }, { readOnly: false })).toEqual({ modes: ["check"] });
  });

  // A deployment made with the workflow token starts no run, so Sluiceway's
  // own records never arrive as an event (record 0017).
  test.each(["deployment", "pull_request_target", "release", "issue_comment", "workflow_run"])(
    "%s is not Sluiceway's",
    (name) => {
      expect(autoModes({ name }, { readOnly: false })).toEqual({
        notice: `Sluiceway has nothing to do on a ${name} event. It scans on push, schedule and workflow_dispatch, acts on an edit of its dashboard, and checks a pull request. Nothing to do.`,
      });
    },
  );
});
