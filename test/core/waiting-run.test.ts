import { describe, expect, test } from "bun:test";
import {
  carriedWaitingRun,
  RUN_WAIT_MINUTES,
  type RunOfTheWorkflow,
  waitingRun,
} from "../../src/core/waiting-run.ts";

// The scan runs as run 4242 at 14:40 UTC.
const NOW = new Date("2026-09-23T14:40:00Z");
const OWN = "4242";

function queued(id: string, since: string): RunOfTheWorkflow {
  return { id, status: "queued", since };
}

describe("a run of the workflow that waits for a runner (record 0086)", () => {
  test("the threshold is ten minutes", () => {
    expect(RUN_WAIT_MINUTES).toBe(10);
  });

  test("no runs: nothing to say", () => {
    expect(waitingRun([], NOW, OWN)).toBeUndefined();
  });

  test("no run is queued: nothing to say, however old the runs are", () => {
    expect(
      waitingRun(
        [
          { id: "7", status: "in_progress", since: "2026-09-23T12:00:00Z" },
          { id: "6", status: "completed", since: "2026-09-23T11:00:00Z" },
          { id: "5", status: "pending", since: "2026-09-23T11:00:00Z" },
          { id: "4", status: "waiting", since: "2026-09-23T11:00:00Z" },
        ],
        NOW,
        OWN,
      ),
    ).toBeUndefined();
  });

  test("one run queued for 32 minutes is named with the time it started waiting", () => {
    expect(waitingRun([queued("8", "2026-09-23T14:08:00Z")], NOW, OWN)).toEqual({
      run: "8",
      since: "2026-09-23T14:08:00.000Z",
      more: 0,
    });
  });

  test("a queued run that is young says nothing: a short queue is a busy runner", () => {
    expect(waitingRun([queued("8", "2026-09-23T14:30:01Z")], NOW, OWN)).toBeUndefined();
    expect(waitingRun([queued("8", "2026-09-23T14:39:00Z")], NOW, OWN)).toBeUndefined();
  });

  test("exactly ten minutes is long enough", () => {
    expect(waitingRun([queued("8", "2026-09-23T14:30:00Z")], NOW, OWN)?.run).toBe("8");
  });

  test("several: the one that waited longest is named, and the others that waited long are counted", () => {
    expect(
      waitingRun(
        [
          queued("12", "2026-09-23T14:35:00Z"),
          queued("11", "2026-09-23T14:20:00Z"),
          queued("10", "2026-09-23T13:50:00Z"),
          queued("9", "2026-09-23T14:05:00Z"),
          { id: "3", status: "in_progress", since: "2026-09-23T13:00:00Z" },
        ],
        NOW,
        OWN,
      ),
    ).toEqual({ run: "10", since: "2026-09-23T13:50:00.000Z", more: 2 });
  });

  test("two that started waiting at the same moment: the lower run id is named", () => {
    expect(
      waitingRun(
        [queued("20", "2026-09-23T14:00:00Z"), queued("19", "2026-09-23T14:00:00Z")],
        NOW,
        OWN,
      ),
    ).toEqual({ run: "19", since: "2026-09-23T14:00:00.000Z", more: 1 });
  });

  test("the scan's own run is never the one that waits", () => {
    expect(waitingRun([queued(OWN, "2026-09-23T13:00:00Z")], NOW, OWN)).toBeUndefined();
  });

  test("a run whose time does not parse is left out, not thrown on", () => {
    expect(waitingRun([queued("8", "not a time")], NOW, OWN)).toBeUndefined();
  });
});

describe("a writer that is not the scan carries the line (record 0086)", () => {
  const line = { run: "8", since: "2026-09-23T14:08:00.000Z", more: 1 };

  test("nothing to carry", () => {
    expect(carriedWaitingRun(undefined, OWN)).toBeUndefined();
  });

  test("another run's line is carried as it is", () => {
    expect(carriedWaitingRun(line, OWN)).toEqual(line);
  });

  test("the line goes when the run it names is the writer's own: that run has started", () => {
    expect(carriedWaitingRun(line, "8")).toBeUndefined();
  });
});
