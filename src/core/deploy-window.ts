// Deploy windows (record 0104): when a stack may go out, as `sluiceway.yaml`
// writes it, per repo and per stack, in the dashboard zone (record 0089). A
// tick outside the window is not refused: its deployment record waits for
// the window, as a queued record waits for a dependency (record 0056), and a
// run that falls inside the window starts it. This file holds the rule alone:
// what a window is, whether an instant falls inside one, and when the next
// one opens. Pure: the clock and the zone come in as data.

export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

// One window: these days of the week, from one clock time to another, in
// the dashboard zone. `from` is inside and `to` is outside, so `09:00` to
// `17:00` ends as the clock turns 17:00. `24:00` is the end of the day.
export interface DeployWindow {
  days: readonly Weekday[];
  from: string;
  to: string;
}

// `HH:MM` on a 24 hour clock as minutes into the day, or nothing for a text
// that is not one. `24:00` is 1440, the end of the day.
export function minutesOf(text: string): number | undefined {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text);
  if (match) return Number(match[1]) * 60 + Number(match[2]);
  return text === "24:00" ? 1440 : undefined;
}

// What is wrong with one window after each of its parts is a clock time:
// an end that is not after its start. A window over midnight is two windows,
// one to `24:00` and one from `00:00` on the next day.
export type WindowProblem = { kind: "window-ends-first"; from: string; to: string };

export function windowProblem(window: DeployWindow): WindowProblem | undefined {
  const from = minutesOf(window.from);
  const to = minutesOf(window.to);
  if (from === undefined || to === undefined) return undefined;
  return to > from ? undefined : { kind: "window-ends-first", from: window.from, to: window.to };
}

// Whether the windows are open at `now`, and when the next one opens when
// they are not. `opens` is an instant, which a row shows in the dashboard
// zone. No window at all is always open. With windows and no opening within
// a week, which no valid window gives, `opens` is nothing.
export type WindowState = { open: true } | { open: false; opens: Date | undefined };

// How many days ahead the next opening is looked for: a week, and one day
// more for a zone whose day is ahead of UTC.
const DAYS_AHEAD = 8;

export function windowState(
  windows: readonly DeployWindow[],
  now: Date,
  timeZone: string,
): WindowState {
  if (windows.length === 0) return { open: true };
  const today = calendarDay(now, timeZone);
  let opens: number | undefined;
  for (let ahead = 0; ahead <= DAYS_AHEAD; ahead++) {
    const day = plusDays(today, ahead);
    const weekday = weekdayOf(day);
    for (const window of windows) {
      if (!window.days.includes(weekday)) continue;
      const from = minutesOf(window.from);
      const to = minutesOf(window.to);
      if (from === undefined || to === undefined) continue;
      const start = instantOf(day, from, timeZone);
      const end = instantOf(day, to, timeZone);
      if (start <= now.getTime() && now.getTime() < end) return { open: true };
      if (start > now.getTime() && (opens === undefined || start < opens)) opens = start;
    }
  }
  return { open: false, opens: opens === undefined ? undefined : new Date(opens) };
}

// A date of the zone's calendar, with no time.
interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

const formats = new Map<string, Intl.DateTimeFormat>();

// UTC never asks the runtime's zone data, as the renderer does not (record
// 0089).
function isUtc(timeZone: string): boolean {
  return timeZone === "UTC";
}

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

// The zone's wall clock at `at`, as the parts of the date and the time.
function wall(at: Date, timeZone: string): CalendarDay & { minutes: number } {
  if (isUtc(timeZone)) {
    return {
      year: at.getUTCFullYear(),
      month: at.getUTCMonth() + 1,
      day: at.getUTCDate(),
      minutes: at.getUTCHours() * 60 + at.getUTCMinutes(),
    };
  }
  const parts: Record<string, number> = {};
  for (const part of format(timeZone).formatToParts(at)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const { year = 0, month = 1, day = 1, hour = 0, minute = 0 } = parts;
  return { year, month, day, minutes: hour * 60 + minute };
}

// Minutes east of UTC at `at`, in the zone.
function offsetAt(at: Date, timeZone: string): number {
  if (isUtc(timeZone)) return 0;
  const clock = wall(at, timeZone);
  const shown = Date.UTC(clock.year, clock.month - 1, clock.day, 0, clock.minutes);
  const truncated = Math.floor(at.getTime() / 60_000) * 60_000;
  return Math.round((shown - truncated) / 60_000);
}

function calendarDay(at: Date, timeZone: string): CalendarDay {
  const { year, month, day } = wall(at, timeZone);
  return { year, month, day };
}

// The day `days` later on the calendar. `Date.UTC` carries a day past the
// end of its month over.
function plusDays(day: CalendarDay, days: number): CalendarDay {
  const shifted = new Date(Date.UTC(day.year, day.month - 1, day.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

// The weekday of a calendar day. The calendar is the same in every zone, so
// the weekday is read at noon UTC of that date, which no offset moves off it.
function weekdayOf(day: CalendarDay): Weekday {
  const noon = new Date(Date.UTC(day.year, day.month - 1, day.day, 12));
  // `getUTCDay` counts from Sunday.
  return WEEKDAYS[(noon.getUTCDay() + 6) % 7] ?? "monday";
}

// The instant at which the zone's clock shows `minutes` into `day`, as
// milliseconds since the epoch. The offset is read at a first guess and then
// at the instant it gives, so a day whose offset changes is placed by the
// offset in force at that clock time. A clock time that daylight saving skips
// is placed by the offset before the change.
function instantOf(day: CalendarDay, minutes: number, timeZone: string): number {
  const guess = Date.UTC(day.year, day.month - 1, day.day, 0, minutes);
  if (isUtc(timeZone)) return guess;
  const first = guess - offsetAt(new Date(guess), timeZone) * 60_000;
  const second = guess - offsetAt(new Date(first), timeZone) * 60_000;
  return second;
}

// What a queued row says about the window (record 0104), from the record and
// the windows the config gives the stack now. A record that waits for the
// window says when it opens, or that it is open and the next run inside it
// starts it. A record behind a stack could not start now either while the
// window is closed, so it says so too. A deploying record says nothing. The
// windows are the config's of this moment and not the record's, as the tick
// rule is (record 0018): a repo that moves its window moves the row.
export interface QueuedWindow {
  // When the window opens, or nothing when it is open now.
  opens: Date | undefined;
}

export function queuedWindow(
  record: { behind?: readonly string[] | undefined; window?: boolean | undefined },
  windows: readonly DeployWindow[] | undefined,
  now: Date,
  timeZone: string,
): QueuedWindow | undefined {
  const state = windowState(windows ?? [], now, timeZone);
  if (record.window) return { opens: state.open ? undefined : state.opens };
  if (record.behind && record.behind.length > 0 && !state.open) return { opens: state.opens };
  return undefined;
}
