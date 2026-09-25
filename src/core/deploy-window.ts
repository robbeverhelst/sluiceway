// Deploy windows (record 0104): when a stack may go out, as `sluiceway.yaml`
// writes it, per repo and per stack, in the dashboard zone (record 0089), and
// deploy freezes (record 0115), when nothing goes out at all. A
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
  // When the stack may go out, or nothing when it may now.
  opens: Date | undefined;
  // The deploy freeze that holds it now (record 0115).
  freeze?: HeldFreeze | undefined;
  // It may go now and the stack has no window: nothing holds it any more,
  // so the row names no window.
  anyTime?: true | undefined;
}

export function queuedWindow(
  record: { behind?: readonly string[] | undefined; window?: boolean | undefined },
  windows: readonly DeployWindow[] | undefined,
  now: Date,
  timeZone: string,
  freezes: readonly DeployFreeze[] = [],
): QueuedWindow | undefined {
  const state = deployState(windows, freezes, now, timeZone);
  const closed = (held: Extract<DeployState, { open: false }>): QueuedWindow => ({
    opens: held.opens,
    ...(held.freeze === undefined ? {} : { freeze: held.freeze }),
  });
  if (record.window) {
    if (!state.open) return closed(state);
    return (windows ?? []).length === 0
      ? { opens: undefined, anyTime: true }
      : { opens: undefined };
  }
  if (record.behind && record.behind.length > 0 && !state.open) return closed(state);
  return undefined;
}

// Deploy freezes (record 0115): periods, from one date and clock time to
// another in the dashboard zone, when nothing goes out at all. A freeze is
// the repo's, not a stack's: no entry lifts it, and a destroy waits like
// anything else. A freeze and a window together let a stack go at the first
// moment both allow.
export interface DeployFreeze {
  // `YYYY-MM-DDTHH:MM` on the wall of the dashboard zone. `from` is inside
  // and `to` is outside, as for a window.
  from: string;
  to: string;
  reason?: string | undefined;
}

// What is wrong with one freeze whose two ends have the shape of a date and
// a time: a date the calendar does not have, or an end that is not after
// the start.
export type FreezeProblem =
  | { kind: "not-a-date-time"; value: string }
  | { kind: "freeze-ends-first"; from: string; to: string };

const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

// The wall of a date and time as written, or nothing for a text that is
// not one or names a day the calendar does not have.
function wallOf(text: string): { day: CalendarDay; minutes: number } | undefined {
  const match = DATE_TIME.exec(text);
  if (!match) return undefined;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const real = new Date(Date.UTC(year, month - 1, day));
  if (real.getUTCMonth() !== month - 1 || real.getUTCDate() !== day) return undefined;
  return { day: { year, month, day }, minutes: hour * 60 + minute };
}

export function freezeProblem(freeze: DeployFreeze): FreezeProblem | undefined {
  for (const value of [freeze.from, freeze.to]) {
    if (DATE_TIME.test(value) && wallOf(value) === undefined) {
      return { kind: "not-a-date-time", value };
    }
  }
  // The shape is fixed, so the text sorts as the time does.
  return freeze.to > freeze.from
    ? undefined
    : { kind: "freeze-ends-first", from: freeze.from, to: freeze.to };
}

// When a freeze starts and ends, as instants.
function spanOf(
  freeze: DeployFreeze,
  timeZone: string,
): { starts: number; ends: number } | undefined {
  const from = wallOf(freeze.from);
  const to = wallOf(freeze.to);
  if (from === undefined || to === undefined) return undefined;
  return {
    starts: instantOf(from.day, from.minutes, timeZone),
    ends: instantOf(to.day, to.minutes, timeZone),
  };
}

// The freeze that holds a stack back now: when the freezes stop holding
// without a break, and the reason of the one that ends last.
export interface HeldFreeze {
  reason?: string | undefined;
  ends: Date;
}

function heldAt(
  freezes: readonly DeployFreeze[],
  at: number,
  timeZone: string,
): HeldFreeze | undefined {
  const spans = freezes.flatMap((freeze) => {
    const span = spanOf(freeze, timeZone);
    return span === undefined ? [] : [{ freeze, ...span }];
  });
  let last: (typeof spans)[number] | undefined;
  let until = at;
  for (;;) {
    const holding = spans.filter(({ starts, ends }) => starts <= until && until < ends);
    if (holding.length === 0) break;
    for (const one of holding) if (last === undefined || one.ends > last.ends) last = one;
    until = last?.ends ?? until;
  }
  if (last === undefined) return undefined;
  return {
    ...(last.freeze.reason === undefined ? {} : { reason: last.freeze.reason }),
    ends: new Date(last.ends),
  };
}

// Whether a stack may go out now, by its windows and the repo's freezes, and
// when it may when it may not: the first moment no freeze holds and a
// window is open. `freeze` is there while one holds now.
export type DeployState =
  | { open: true }
  | { open: false; opens: Date | undefined; freeze?: HeldFreeze };

// How many times a window opening and a freeze ending are looked past
// before giving up; each turn moves on by at least one of them.
const TURNS = 64;

export function deployState(
  windows: readonly DeployWindow[] | undefined,
  freezes: readonly DeployFreeze[] | undefined,
  now: Date,
  timeZone: string,
): DeployState {
  const held = heldAt(freezes ?? [], now.getTime(), timeZone);
  const first = windowState(windows ?? [], now, timeZone);
  if (held === undefined && first.open) return { open: true };
  let at = held?.ends ?? (first.open ? now : first.opens);
  for (let turn = 0; at !== undefined && turn < TURNS; turn++) {
    const frozen = heldAt(freezes ?? [], at.getTime(), timeZone);
    if (frozen !== undefined) {
      at = frozen.ends;
      continue;
    }
    const window = windowState(windows ?? [], at, timeZone);
    if (window.open) break;
    at = window.opens;
  }
  return { open: false, opens: at, ...(held === undefined ? {} : { freeze: held }) };
}

// A freeze the dashboard names under the scan line: one that holds, or that
// starts within a week.
export interface ShownFreeze {
  reason?: string | undefined;
  starts: Date;
  ends: Date;
  holds: boolean;
}

const WEEK = 7 * 24 * 60 * 60_000;

export function shownFreezes(
  freezes: readonly DeployFreeze[],
  now: Date,
  timeZone: string,
): ShownFreeze[] {
  const time = now.getTime();
  return freezes
    .flatMap((freeze): ShownFreeze[] => {
      const span = spanOf(freeze, timeZone);
      if (span === undefined || span.starts - WEEK > time || span.ends <= time) return [];
      return [
        {
          ...(freeze.reason === undefined ? {} : { reason: freeze.reason }),
          starts: new Date(span.starts),
          ends: new Date(span.ends),
          holds: span.starts <= time,
        },
      ];
    })
    .sort((a, b) => a.starts.getTime() - b.starts.getTime());
}

// The freezes that ended before `now`, which hold nothing any more: the
// check warns about each.
export function endedFreezes(
  freezes: readonly DeployFreeze[],
  now: Date,
  timeZone: string,
): { freeze: DeployFreeze; ended: Date }[] {
  return freezes.flatMap((freeze) => {
    const span = spanOf(freeze, timeZone);
    return span !== undefined && span.ends <= now.getTime()
      ? [{ freeze, ended: new Date(span.ends) }]
      : [];
  });
}
