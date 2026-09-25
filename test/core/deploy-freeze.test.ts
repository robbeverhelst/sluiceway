import { describe, expect, test } from "bun:test";
import {
  type DeployFreeze,
  type DeployWindow,
  deployState,
  endedFreezes,
  freezeProblem,
  queuedWindow,
  shownFreezes,
} from "../../src/core/deploy-window.ts";

// Deploy freezes (record 0115): periods of dates and clock times in the
// dashboard zone (record 0089) when no deploy goes out at all. Worked out by
// hand from the zone's own clock, never from the code. Brussels is UTC+1 in
// winter and UTC+2 in summer.

const at = (iso: string) => new Date(iso);
const BRUSSELS = "Europe/Brussels";

const YEAR_END: DeployFreeze = {
  from: "2026-12-20T00:00",
  to: "2027-01-05T00:00",
  reason: "Year-end freeze",
};

// Monday to Thursday, 09:00 to 17:00.
const OFFICE_HOURS: DeployWindow[] = [
  { days: ["monday", "tuesday", "wednesday", "thursday"], from: "09:00", to: "17:00" },
];

describe("deployState with a freeze and no window", () => {
  const state = (now: string) => deployState([], [YEAR_END], at(now), BRUSSELS);

  test("inside the freeze nothing goes, until it ends at midnight on the wall", () => {
    // 2027-01-05 00:00 in Brussels is 2027-01-04 23:00 UTC.
    expect(state("2026-12-24T12:00:00Z")).toEqual({
      open: false,
      opens: at("2027-01-04T23:00:00Z"),
      freeze: { reason: "Year-end freeze", ends: at("2027-01-04T23:00:00Z") },
    });
  });

  test("the start is inside and the end is outside", () => {
    expect(state("2026-12-19T22:59:00Z")).toEqual({ open: true });
    expect(state("2026-12-19T23:00:00Z").open).toBe(false);
    expect(state("2027-01-04T22:59:00Z").open).toBe(false);
    expect(state("2027-01-04T23:00:00Z")).toEqual({ open: true });
  });

  test("no freeze and no window is any time", () => {
    expect(deployState([], [], at("2026-12-24T12:00:00Z"), BRUSSELS)).toEqual({ open: true });
    expect(deployState(undefined, undefined, at("2026-12-24T12:00:00Z"), BRUSSELS)).toEqual({
      open: true,
    });
  });

  test("a freeze with no reason says none", () => {
    const quiet = { from: YEAR_END.from, to: YEAR_END.to };
    expect(deployState([], [quiet], at("2026-12-24T12:00:00Z"), BRUSSELS)).toEqual({
      open: false,
      opens: at("2027-01-04T23:00:00Z"),
      freeze: { ends: at("2027-01-04T23:00:00Z") },
    });
  });

  test("in UTC the wall clock is the instant", () => {
    expect(deployState([], [YEAR_END], at("2026-12-24T12:00:00Z"), "UTC")).toMatchObject({
      open: false,
      opens: at("2027-01-05T00:00:00Z"),
    });
  });

  test("the offset is the zone's at each end, across a change of daylight saving", () => {
    // Brussels moves to summer time at 02:00 on 2026-03-29: 01:00 is CET
    // (00:00 UTC) and 04:00 is CEST (02:00 UTC).
    const night = { from: "2026-03-29T01:00", to: "2026-03-29T04:00" };
    expect(deployState([], [night], at("2026-03-28T23:59:00Z"), BRUSSELS)).toEqual({ open: true });
    expect(deployState([], [night], at("2026-03-29T00:00:00Z"), BRUSSELS)).toMatchObject({
      open: false,
      opens: at("2026-03-29T02:00:00Z"),
    });
    expect(deployState([], [night], at("2026-03-29T02:00:00Z"), BRUSSELS)).toEqual({ open: true });
  });

  test("freezes that overlap hold until the last of them ends, named by the one that ends last", () => {
    const first = { from: "2026-12-20T00:00", to: "2026-12-28T00:00", reason: "Sale" };
    const second = { from: "2026-12-27T00:00", to: "2027-01-05T00:00", reason: "Year end" };
    expect(deployState([], [first, second], at("2026-12-27T12:00:00Z"), BRUSSELS)).toEqual({
      open: false,
      opens: at("2027-01-04T23:00:00Z"),
      freeze: { reason: "Year end", ends: at("2027-01-04T23:00:00Z") },
    });
    // Before the second starts, the first holds, and the second takes over
    // right as it ends: the chain still ends on 5 January.
    expect(deployState([], [first, second], at("2026-12-24T12:00:00Z"), BRUSSELS)).toEqual({
      open: false,
      opens: at("2027-01-04T23:00:00Z"),
      freeze: { reason: "Year end", ends: at("2027-01-04T23:00:00Z") },
    });
  });
});

describe("deployState with a freeze and a deploy window: the first moment both allow", () => {
  test("a freeze that ends at midnight before a Tuesday goes out when the window opens at nine", () => {
    // 2027-01-05 is a Tuesday. The window opens at 09:00 CET, 08:00 UTC.
    expect(deployState(OFFICE_HOURS, [YEAR_END], at("2026-12-24T12:00:00Z"), BRUSSELS)).toEqual({
      open: false,
      opens: at("2027-01-05T08:00:00Z"),
      freeze: { reason: "Year-end freeze", ends: at("2027-01-04T23:00:00Z") },
    });
  });

  test("a freeze that ends inside a window opens right as it ends", () => {
    const morning = { from: "2027-01-05T00:00", to: "2027-01-05T11:30" };
    expect(deployState(OFFICE_HOURS, [morning], at("2027-01-05T09:00:00Z"), BRUSSELS)).toEqual({
      open: false,
      opens: at("2027-01-05T10:30:00Z"),
      freeze: { ends: at("2027-01-05T10:30:00Z") },
    });
  });

  test("a window that is closed and whose next opening falls in a freeze opens after the freeze", () => {
    // Friday 2026-12-18 at 17:00 in Brussels: no freeze holds yet, and the
    // next window, Monday 21 December, is inside the freeze.
    expect(deployState(OFFICE_HOURS, [YEAR_END], at("2026-12-18T16:00:00Z"), BRUSSELS)).toEqual({
      open: false,
      opens: at("2027-01-05T08:00:00Z"),
    });
  });

  test("an open window is closed by a freeze, and a freeze that has ended changes nothing", () => {
    // Tuesday 2026-12-22 at 10:00 is inside the window and inside the freeze.
    expect(deployState(OFFICE_HOURS, [YEAR_END], at("2026-12-22T09:00:00Z"), BRUSSELS).open).toBe(
      false,
    );
    // Tuesday 2027-01-12 at 10:00.
    expect(deployState(OFFICE_HOURS, [YEAR_END], at("2027-01-12T09:00:00Z"), BRUSSELS)).toEqual({
      open: true,
    });
  });
});

describe("freezeProblem", () => {
  test("a date and a time of the zone, YYYY-MM-DDTHH:MM, that exist on the calendar", () => {
    expect(freezeProblem(YEAR_END)).toBeUndefined();
    expect(freezeProblem({ from: "2027-02-30T00:00", to: "2027-03-01T00:00" })).toEqual({
      kind: "not-a-date-time",
      value: "2027-02-30T00:00",
    });
  });

  test("the end comes after the start", () => {
    expect(freezeProblem({ from: "2027-01-05T00:00", to: "2026-12-20T00:00" })).toEqual({
      kind: "freeze-ends-first",
      from: "2027-01-05T00:00",
      to: "2026-12-20T00:00",
    });
    expect(freezeProblem({ from: "2027-01-05T00:00", to: "2027-01-05T00:00" })?.kind).toBe(
      "freeze-ends-first",
    );
  });
});

describe("shownFreezes: the freezes the dashboard names, while one holds and for the week before", () => {
  test("a freeze that holds, and one that starts within a week, in the order they start", () => {
    const later = { from: "2026-12-30T00:00", to: "2026-12-31T00:00" };
    expect(shownFreezes([later, YEAR_END], at("2026-12-24T12:00:00Z"), BRUSSELS)).toEqual([
      {
        reason: "Year-end freeze",
        starts: at("2026-12-19T23:00:00Z"),
        ends: at("2027-01-04T23:00:00Z"),
        holds: true,
      },
      { starts: at("2026-12-29T23:00:00Z"), ends: at("2026-12-30T23:00:00Z"), holds: false },
    ]);
  });

  test("a week before the start it shows, a minute more before it does not, and once it ended it goes", () => {
    const shown = (now: string) => shownFreezes([YEAR_END], at(now), BRUSSELS).length;
    expect(shown("2026-12-12T23:00:00Z")).toBe(1);
    expect(shown("2026-12-12T22:59:00Z")).toBe(0);
    expect(shown("2027-01-04T23:00:00Z")).toBe(0);
  });
});

describe("endedFreezes: what the check warns about", () => {
  test("a freeze whose end has passed, and not one that holds or is to come", () => {
    const past = { from: "2026-01-01T00:00", to: "2026-01-02T00:00", reason: "New year" };
    expect(endedFreezes([past, YEAR_END], at("2026-12-24T12:00:00Z"), BRUSSELS)).toEqual([
      { freeze: past, ended: at("2026-01-01T23:00:00Z") },
    ]);
  });
});

describe("the freeze words of a queued record", () => {
  const CHRISTMAS = at("2026-12-24T12:00:00Z");
  const JANUARY = at("2027-01-12T09:00:00Z");

  test("a record that waits says when the freeze ends and names it", () => {
    expect(queuedWindow({ window: true }, undefined, CHRISTMAS, BRUSSELS, [YEAR_END])).toEqual({
      opens: at("2027-01-04T23:00:00Z"),
      freeze: { reason: "Year-end freeze", ends: at("2027-01-04T23:00:00Z") },
    });
  });

  test("with a window after the freeze, it says both", () => {
    expect(queuedWindow({ window: true }, OFFICE_HOURS, CHRISTMAS, BRUSSELS, [YEAR_END])).toEqual({
      opens: at("2027-01-05T08:00:00Z"),
      freeze: { reason: "Year-end freeze", ends: at("2027-01-04T23:00:00Z") },
    });
  });

  test("a record behind a stack says the freeze while it holds", () => {
    expect(
      queuedWindow({ behind: ["a:prod"] }, undefined, CHRISTMAS, BRUSSELS, [YEAR_END]),
    ).toMatchObject({ freeze: { reason: "Year-end freeze" } });
    expect(
      queuedWindow({ behind: ["a:prod"] }, undefined, JANUARY, BRUSSELS, [YEAR_END]),
    ).toBeUndefined();
  });

  test("once nothing holds a stack without windows, the words say so and not a window", () => {
    expect(queuedWindow({ window: true }, undefined, JANUARY, BRUSSELS, [YEAR_END])).toEqual({
      opens: undefined,
      anyTime: true,
    });
  });
});
