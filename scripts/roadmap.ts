// Writes the part of docs/roadmap.md that comes from docs/later.md: what comes
// after 1.0. The rest of the page is written by hand. A test fails when the
// page and later.md disagree. Run it with "bun run roadmap".
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const START =
  "<!-- Generated from docs/later.md by `bun run roadmap`. Do not edit by hand. -->";
export const END = "<!-- End of the generated part. -->";

// Rows of later.md that come before 1.0, by the start of their first cell.
// The page names them by hand, with the slice that builds them. A start that
// matches no row belongs to a row that shipped and left later.md.
export const BEFORE_1_0 = [
  "A Helm adapter",
  "Detecting dependencies from Pulumi stack references",
  "Docs site and Marketplace launch",
  "Launch material",
] as const;

// The rows of the table under a heading of later.md, each as its cells.
function table(later: string, heading: string): string[][] {
  const lines = later.split("\n");
  const start = lines.indexOf(heading);
  const rows: string[][] = [];
  for (const line of start === -1 ? [] : lines.slice(start + 1)) {
    if (line.startsWith("#")) break;
    if (line.startsWith("|")) rows.push(cells(line));
    else if (rows.length > 0) break;
  }
  if (rows.length < 3) throw new Error(`docs/later.md has no table under ${heading}.`);
  return rows.slice(2);
}

// The cells of one table line. A `|` inside backticks does not split.
function cells(line: string): string[] {
  const found: string[] = [];
  let cell = "";
  let code = false;
  for (const char of line.trim().slice(1, -1)) {
    if (char === "`") code = !code;
    if (char === "|" && !code) {
      found.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }
  return [...found, cell.trim()];
}

function after1_0(rows: string[][]): string[][] {
  return rows.filter(([what = ""]) => !BEFORE_1_0.some((start) => what.startsWith(start)));
}

export function generated(later: string): string {
  const deferred = after1_0(table(later, "## Deferred, door left open"));
  const rejected = table(later, "## Rejected on principle");
  const bigger = after1_0(table(later, "## Bigger efforts, each its own plan"));
  return [
    "### After 1.0, when someone needs it",
    "",
    "No date and no order. Each waits for a user who asks, and none of them needs a breaking change. [docs/later.md](later.md#deferred-door-left-open) says why each one waited and where that was decided.",
    "",
    ...deferred.map(([what]) => `- ${what}`),
    "",
    "### After 1.0, each its own plan",
    "",
    ...bigger.map(([what, note]) => `- ${what}. ${note}`),
    "",
    "### Not planned",
    "",
    `${rejected.length} ideas were rejected on principle. Bringing one back means reopening the decision that rejected it, not scheduling work: [docs/later.md](later.md#rejected-on-principle) lists them.`,
    "",
  ].join("\n");
}

// The page with its generated part replaced, and nothing else changed.
export function withGenerated(roadmap: string, later: string): string {
  const start = roadmap.indexOf(`${START}\n`);
  const end = roadmap.indexOf(END, start);
  if (start === -1 || end === -1) throw new Error("docs/roadmap.md has no generated part.");
  return `${roadmap.slice(0, start)}${START}\n${generated(later)}${roadmap.slice(end)}`;
}

if (import.meta.main) {
  const file = resolve(import.meta.dir, "../docs/roadmap.md");
  const later = readFileSync(resolve(import.meta.dir, "../docs/later.md"), "utf8");
  writeFileSync(file, withGenerated(readFileSync(file, "utf8"), later));
  console.log(`Wrote ${file}`);
}
