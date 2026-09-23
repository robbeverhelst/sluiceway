import { describe, expect, test } from "bun:test";
import { minuteAt, trailMinute, yearIn, zoneLine } from "../../src/render/time.ts";

// Absolute UTC times, so the same input always gives the same bytes (0029).
test("a time is written in UTC to the minute, cut and not rounded", () => {
  expect(minuteAt(new Date("2026-09-21T08:52:59.999Z"))).toBe("2026-09-21 08:52 UTC");
  expect(minuteAt(new Date("2026-01-02T03:04:05+05:30"))).toBe("2026-01-01 21:34 UTC");
});

// Record 0089: `dashboard.timeZone`. The instant is kept, only the rendering
// changes, and a time that stands alone says its offset from UTC.
describe("a time in the repo's own zone", () => {
  test("UTC named outright is byte for byte the default", () => {
    const at = new Date("2026-09-21T08:52:59.999Z");
    expect(minuteAt(at, "UTC")).toBe(minuteAt(at));
    expect(trailMinute(at, 2026, "UTC")).toBe(trailMinute(at, 2026));
    expect(zoneLine("UTC")).toBe("Times are in UTC.");
    expect(zoneLine(undefined)).toBe("Times are in UTC.");
  });

  test("a zone that shifts gives a January and a July time their own offset", () => {
    expect(minuteAt(new Date("2026-01-15T08:52:00Z"), "Europe/Brussels")).toBe(
      "2026-01-15 09:52 UTC+1",
    );
    expect(minuteAt(new Date("2026-07-15T08:52:00Z"), "Europe/Brussels")).toBe(
      "2026-07-15 10:52 UTC+2",
    );
    expect(trailMinute(new Date("2026-01-15T08:52:00Z"), 2026, "Europe/Brussels")).toBe(
      "01-15 09:52",
    );
    expect(trailMinute(new Date("2026-07-15T08:52:00Z"), 2026, "Europe/Brussels")).toBe(
      "07-15 10:52",
    );
  });

  test("a zone with a half-hour offset, east and west of UTC", () => {
    expect(minuteAt(new Date("2026-09-21T08:52:00Z"), "Asia/Kolkata")).toBe(
      "2026-09-21 14:22 UTC+5:30",
    );
    expect(minuteAt(new Date("2026-01-15T08:52:00Z"), "America/St_Johns")).toBe(
      "2026-01-15 05:22 UTC-3:30",
    );
    expect(minuteAt(new Date("2026-07-15T08:52:00Z"), "America/St_Johns")).toBe(
      "2026-07-15 06:22 UTC-2:30",
    );
  });

  test("a zone at UTC for the moment says UTC", () => {
    expect(minuteAt(new Date("2026-01-15T08:52:00Z"), "Europe/London")).toBe(
      "2026-01-15 08:52 UTC",
    );
    expect(minuteAt(new Date("2026-07-15T08:52:00Z"), "Europe/London")).toBe(
      "2026-07-15 09:52 UTC+1",
    );
  });

  test("the day and the year are the zone's", () => {
    const at = new Date("2026-12-31T23:30:00Z");
    expect(yearIn(at)).toBe(2026);
    expect(yearIn(at, "Europe/Brussels")).toBe(2027);
    expect(trailMinute(at, 2027, "Europe/Brussels")).toBe("01-01 00:30");
    expect(trailMinute(at, 2026, "Europe/Brussels")).toBe("2027-01-01 00:30");
    expect(minuteAt(at, "America/New_York")).toBe("2026-12-31 18:30 UTC-5");
  });

  test("midnight is 00, never 24", () => {
    expect(minuteAt(new Date("2026-09-20T22:00:00Z"), "Europe/Brussels")).toBe(
      "2026-09-21 00:00 UTC+2",
    );
  });

  test("the line under the trail names the zone it used", () => {
    expect(zoneLine("Europe/Brussels")).toBe("Times are in Europe/Brussels.");
  });
});
