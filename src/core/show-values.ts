// `dashboard.showValues` (record 0052): the property paths whose old and new
// value may appear. A path matches only an entry a person wrote. Sluiceway
// never guesses that a value is safe to show (record 0022), and a value the
// tool marks secret is never read, listed or not.

// The list a preview gets. `dashboard.redact` keeps names out of the issue, so
// it keeps values out of everywhere: with it on no value is even read.
export function shownValues(dashboard: {
  redact: boolean;
  showValues: readonly string[];
}): readonly string[] {
  return dashboard.redact ? [] : dashboard.showValues;
}

// A star stands for part of one name. It never crosses a dot or a bracket, so
// `values.*` cannot reach a key one level further down. Everything else in an
// entry is taken as it is, because a path is the tool's text and is never
// parsed (record 0046).
export function isListedPath(list: readonly string[], path: string): boolean {
  return list.some((entry) => entryPattern(entry).test(path));
}

const patterns = new Map<string, RegExp>();

function entryPattern(entry: string): RegExp {
  let pattern = patterns.get(entry);
  if (pattern === undefined) {
    const parts = entry.split("*").map((part) => part.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&"));
    pattern = new RegExp(`^${parts.join("[^.[\\]]*")}$`, "u");
    patterns.set(entry, pattern);
  }
  return pattern;
}

// Why an entry of the list cannot be used, or undefined when it can. An entry
// that could match any path under it would show values nobody chose.
export function showValuesEntryProblem(entry: string): string | undefined {
  const quoted = JSON.stringify(entry);
  // An empty entry has its own message from the config loader.
  if (entry === "") return undefined;
  if (entry.includes("**")) {
    return `${quoted} uses "**". An entry matches one path, and "*" stands for part of one name. Write each path whose value may appear.`;
  }
  if (!/[^*.[\]]/.test(entry)) {
    return `${quoted} names no property. Write each path whose value may appear.`;
  }
  return undefined;
}

// A value on a row, the summary or anywhere else is at most this long.
export const VALUE_LENGTH = 40;
const VALUE_HEAD = 19;

// A value past the limit keeps its start and its end, where a version or an
// image tag is. Counted in code points, so a cut never splits a character.
export function shortValue(value: string): string {
  const points = Array.from(value);
  if (points.length <= VALUE_LENGTH) return value;
  const tail = points.slice(points.length - (VALUE_LENGTH - VALUE_HEAD - 1));
  return `${points.slice(0, VALUE_HEAD).join("")}…${tail.join("")}`;
}
