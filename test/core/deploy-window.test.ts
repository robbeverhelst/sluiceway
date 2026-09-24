import { describe, expect, test } from "bun:test";
import {
  type DeployWindow,
  minutesOf,
  queuedWindow,
  windowProblem,
  windowState,
} from "../../src/core/deploy-window.ts";

// Deploy windows (record 0104): when a stack may go out, written in the
// dashboard zone (record 0089). Whether an instant falls inside one, and when
// the next one opens, as fixed vectors worked out by hand from the zone's own
// clock, never from the code.

const OFFICE_HOURS: DeployWindow[] = [
  { days: ["monday", "tuesday", "wednesday", "thursday"], from: "09:00", to: "17:00" },
];

const at = (iso: string) => new Date(iso);

describe("windowState in Europe/Brussels, Monday to Thursday 09:00 to 17:00", () => {
  const brussels = (now: string) => windowState(OFFICE_HOURS, at(now), "Europe/Brussels");

  test("a Friday evening is outside, and the window opens Monday 09:00 CEST", () => {
    // 2026-09-25 is a Friday, 18:00 in Brussels.
    expect(brussels("2026-09-25T16:00:00Z")).toEqual({
      open: false,
      opens: at("2026-09-28T07:00:00Z"),
    });
  });

  test("a Tuesday morning is inside", () => {
    expect(brussels("2026-09-22T08:00:00Z")).toEqual({ open: true });
  });

  test("the start is inside and the end is outside", () => {
    expect(brussels("2026-09-22T07:00:00Z")).toEqual({ open: true });
    expect(brussels("2026-09-22T15:00:00Z")).toEqual({
      open: false,
      opens: at("2026-09-23T07:00:00Z"),
    });
  });

  test("a Monday before nine opens later the same day", () => {
    expect(brussels("2026-09-28T05:30:00Z")).toEqual({
      open: false,
      opens: at("2026-09-28T07:00:00Z"),
    });
  });

  test("the offset is the zone's at the instant the window opens, across a change of daylight saving", () => {
    // Brussels leaves summer time on 2026-10-25. Friday 2026-10-23 evening is
    // still CEST, Monday 2026-10-26 09:00 is CET, which is 08:00 UTC.
    expect(brussels("2026-10-23T16:00:00Z")).toEqual({
      open: false,
      opens: at("2026-10-26T08:00:00Z"),
    });
  });
});

describe("windowState elsewhere", () => {
  test("a window is written in the zone's clock, also at a half hour offset", () => {
    // Monday 09:00 in Kolkata is Monday 03:30 UTC. 2026-09-27 is a Sunday.
    const kolkata = windowState(
      [{ days: ["monday"], from: "09:00", to: "12:00" }],
      at("2026-09-27T02:00:00Z"),
      "Asia/Kolkata",
    );
    expect(kolkata).toEqual({ open: false, opens: at("2026-09-28T03:30:00Z") });
  });

  test("UTC never asks the zone data and reads the same", () => {
    const sunday = [{ days: ["sunday"] as DeployWindow["days"], from: "00:00", to: "24:00" }];
    expect(windowState(sunday, at("2026-09-27T12:00:00Z"), "UTC")).toEqual({ open: true });
    expect(windowState(sunday, at("2026-09-28T00:00:00Z"), "UTC")).toEqual({
      open: false,
      opens: at("2026-10-04T00:00:00Z"),
    });
  });

  test("24:00 is the end of the day, and midnight belongs to the next day", () => {
    const friday: DeployWindow[] = [{ days: ["friday"], from: "20:00", to: "24:00" }];
    expect(windowState(friday, at("2026-09-25T21:00:00Z"), "Europe/Brussels")).toEqual({
      open: true,
    });
    expect(windowState(friday, at("2026-09-25T22:00:00Z"), "Europe/Brussels")).toEqual({
      open: false,
      opens: at("2026-10-02T18:00:00Z"),
    });
  });

  test("of several windows the next to open counts", () => {
    const twice: DeployWindow[] = [
      { days: ["tuesday"], from: "14:00", to: "15:00" },
      { days: ["tuesday"], from: "10:00", to: "11:00" },
    ];
    expect(windowState(twice, at("2026-09-22T09:00:00Z"), "Europe/Brussels")).toEqual({
      open: false,
      opens: at("2026-09-22T12:00:00Z"),
    });
    expect(windowState(twice, at("2026-09-22T08:30:00Z"), "Europe/Brussels")).toEqual({
      open: true,
    });
  });

  test("no window at all is always open", () => {
    expect(windowState([], at("2026-09-25T16:00:00Z"), "Europe/Brussels")).toEqual({ open: true });
  });

  test("a window in New York on a summer Monday opens at 13:00 UTC", () => {
    expect(
      windowState(
        [{ days: ["monday"], from: "09:00", to: "17:00" }],
        at("2026-09-26T12:00:00Z"),
        "America/New_York",
      ),
    ).toEqual({ open: false, opens: at("2026-09-28T13:00:00Z") });
  });
});

describe("the clock of a window", () => {
  test("is HH:MM on a 24 hour clock, and 24:00 is allowed as an end", () => {
    expect(minutesOf("09:00")).toBe(540);
    expect(minutesOf("00:00")).toBe(0);
    expect(minutesOf("23:59")).toBe(1439);
    expect(minutesOf("24:00")).toBe(1440);
  });

  test.each(["9:00", "09:60", "25:00", "24:01", "0900", "9am", ""])("refuses %j", (text) => {
    expect(minutesOf(text)).toBeUndefined();
  });
});

describe("what is wrong with a window", () => {
  test("nothing, for a plain one", () => {
    expect(windowProblem({ days: ["monday"], from: "09:00", to: "17:00" })).toBeUndefined();
  });

  test("an end that is not after the start, which a window over midnight would need", () => {
    expect(windowProblem({ days: ["monday"], from: "17:00", to: "09:00" })).toEqual({
      kind: "window-ends-first",
      from: "17:00",
      to: "09:00",
    });
    expect(windowProblem({ days: ["monday"], from: "09:00", to: "09:00" })).toEqual({
      kind: "window-ends-first",
      from: "09:00",
      to: "09:00",
    });
  });
});

// What a queued row says about the window (record 0104): a record that waits
// for the window says when it opens, or that it is open and the next run
// starts it; a record behind a stack says so too while the window is closed,
// because it could not start now either; anything else says nothing.
describe("the window words of a queued record", () => {
  const FRIDAY = new Date("2026-09-25T16:00:00Z");
  const TUESDAY = new Date("2026-09-22T08:00:00Z");
  const MONDAY_NINE = new Date("2026-09-28T07:00:00Z");
  const zone = "Europe/Brussels";

  test("a record that waits for the window, while it is closed and once it is open", () => {
    expect(queuedWindow({ window: true }, OFFICE_HOURS, FRIDAY, zone)).toEqual({
      opens: MONDAY_NINE,
    });
    expect(queuedWindow({ window: true }, OFFICE_HOURS, TUESDAY, zone)).toEqual({
      opens: undefined,
    });
    // The repo took its windows away: the next run starts it.
    expect(queuedWindow({ window: true }, undefined, FRIDAY, zone)).toEqual({ opens: undefined });
  });

  test("a record behind a stack, only while the window is closed", () => {
    expect(queuedWindow({ behind: ["a:prod"] }, OFFICE_HOURS, FRIDAY, zone)).toEqual({
      opens: MONDAY_NINE,
    });
    expect(queuedWindow({ behind: ["a:prod"] }, OFFICE_HOURS, TUESDAY, zone)).toBeUndefined();
    expect(queuedWindow({ behind: ["a:prod"] }, undefined, FRIDAY, zone)).toBeUndefined();
  });

  test("a record that is deploying says nothing of the window", () => {
    expect(queuedWindow({}, OFFICE_HOURS, FRIDAY, zone)).toBeUndefined();
  });
});
