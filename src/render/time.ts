// Every time on the dashboard is absolute, so the same input always gives the
// same bytes (record 0029). It is in UTC unless the repo names its own zone,
// `dashboard.timeZone` (record 0089): the instant is kept and only the
// rendering changes, so a marker keeps its UTC ISO time whatever the zone.
// `timeZone` is an IANA name that the config has checked. Absent, or `UTC`,
// gives the bytes Sluiceway wrote before the key existed.

interface Wall {
  year: number;
  // `MM-DD` and `HH:MM`.
  day: string;
  minute: string;
  // Minutes east of UTC at that instant.
  offset: number;
}

const formats = new Map<string, Intl.DateTimeFormat>();

function format(timeZone: string): Intl.DateTimeFormat {
  let found = formats.get(timeZone);
  if (found === undefined) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formats.set(timeZone, found);
  }
  return found;
}

function isUtc(timeZone: string | undefined): timeZone is undefined | "UTC" {
  return timeZone === undefined || timeZone === "UTC";
}

// The wall clock of the zone at `at`. UTC never asks the runtime's zone data.
function wall(at: Date, timeZone: string | undefined): Wall {
  if (isUtc(timeZone)) {
    const iso = at.toISOString();
    return {
      year: at.getUTCFullYear(),
      day: iso.slice(5, 10),
      minute: iso.slice(11, 16),
      offset: 0,
    };
  }
  const parts: Record<string, number> = {};
  for (const part of format(timeZone).formatToParts(at)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const { year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0 } = parts;
  const shown = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset = Math.round((shown - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
  const two = (value: number) => String(value).padStart(2, "0");
  return {
    year,
    day: `${two(month)}-${two(day)}`,
    minute: `${two(hour)}:${two(minute)}`,
    offset,
  };
}

// The years Sluiceway writes all have four digits.
function fullDay(time: Wall): string {
  return `${String(time.year).padStart(4, "0")}-${time.day}`;
}

// `UTC`, `UTC+2`, `UTC-3:30`: the offset from UTC at that instant, so a
// January and a July time of one zone each say their own.
function offsetName(offset: number): string {
  if (offset === 0) return "UTC";
  const sign = offset > 0 ? "+" : "-";
  const hours = Math.floor(Math.abs(offset) / 60);
  const minutes = Math.abs(offset) % 60;
  return `UTC${sign}${hours}${minutes === 0 ? "" : `:${String(minutes).padStart(2, "0")}`}`;
}

// A time that stands alone says its offset, as it always said `UTC`:
// `2026-09-21 08:52 UTC`, or `2026-09-21 10:52 UTC+2` in Europe/Brussels.
export function minuteAt(at: Date, timeZone?: string): string {
  const time = wall(at, timeZone);
  return `${fullDay(time)} ${time.minute} ${offsetName(time.offset)}`;
}

// The year of `at` in the zone, for the trail's times.
export function yearIn(at: Date, timeZone?: string): number {
  return wall(at, timeZone).year;
}

// A time on the trail (slice 5.10): the year only when it is not the year
// given, the scan's, which the scan line shows in full, and no zone, which
// the line under the heading says once: `09-21 08:52`, or `2025-12-31 23:59`.
export function trailMinute(at: Date, year: number | undefined, timeZone?: string): string {
  const time = wall(at, timeZone);
  return `${time.year === year ? time.day : fullDay(time)} ${time.minute}`;
}

// The one line under the Recently deployed heading: the zone the trail's
// times are in, by the name the repo gave it.
export function zoneLine(timeZone: string | undefined): string {
  return `Times are in ${timeZone ?? "UTC"}.`;
}
