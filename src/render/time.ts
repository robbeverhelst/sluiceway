// Every time on the dashboard is absolute and in UTC, so the same input always
// gives the same bytes (record 0029): `2026-09-21 08:52 UTC`.
export function utcMinute(at: Date): string {
  const iso = at.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

// A time on the trail (slice 5.10): the year only when it is not the year
// given, the scan's, which the scan line shows in full, and no `UTC`, which
// the line under the heading says once: `09-21 08:52`, or `2025-12-31 23:59`.
export function trailMinute(at: Date, year: number | undefined): string {
  const iso = at.toISOString();
  const day = at.getUTCFullYear() === year ? iso.slice(5, 10) : iso.slice(0, 10);
  return `${day} ${iso.slice(11, 16)}`;
}
