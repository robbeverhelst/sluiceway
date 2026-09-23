// The one line of `resolve`'s job log that says where its time went (slice
// 5.23): each part of its own work, in the order the work runs, so a reader
// can tell the part Sluiceway owns from the part GitHub owns. It decides
// nothing and goes to the job log only.

// The parts of `resolve`'s work, in the order they run.
export const RESOLVE_PARTS = [
  "dashboard",
  "config",
  "discovery",
  "records",
  "ticks",
  "opening",
  "body",
] as const;

export type ResolvePart = (typeof RESOLVE_PARTS)[number];

const NAMES: Record<ResolvePart, string> = {
  dashboard: "reading the dashboard",
  config: "reading the config",
  discovery: "discovery",
  records: "reading deployment records",
  ticks: "judging ticks",
  opening: "opening records",
  body: "writing the body",
};

export interface ResolveTiming {
  // Milliseconds from the start of `resolve` to its end.
  total: number;
  // Milliseconds per part. A part that did not run is absent.
  parts: Partial<Record<ResolvePart, number>>;
  // Milliseconds from the start of the process to the start of `resolve`,
  // when the step knows it.
  startup?: number | undefined;
}

export function resolveTimingLine(timing: ResolveTiming): string {
  const measured = RESOLVE_PARTS.flatMap((part) => {
    const milliseconds = timing.parts[part];
    return milliseconds === undefined ? [] : [{ name: NAMES[part], milliseconds }];
  });
  const rest = timing.total - measured.reduce((sum, { milliseconds }) => sum + milliseconds, 0);
  const named = [
    ...measured,
    // Time between the parts: the log, the merges, a comment. Named only
    // next to parts, and only when it shows.
    ...(measured.length === 0 || seconds(rest) === "0.0" || rest < 0
      ? []
      : [{ name: "the rest", milliseconds: rest }]),
  ];
  const parts =
    named.length === 0
      ? ""
      : `: ${named.map(({ name, milliseconds }) => `${name} ${seconds(milliseconds)} s`).join(", ")}`;
  const startup =
    timing.startup === undefined
      ? ""
      : ` Starting the action took ${seconds(timing.startup)} s before that.`;
  return `Resolve took ${seconds(timing.total)} s${parts}.${startup}`;
}

// Tenths of a second, half up.
function seconds(milliseconds: number): string {
  return (Math.round(milliseconds / 100) / 10).toFixed(1);
}
