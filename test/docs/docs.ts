import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Helpers for the tests that hold the docs to the code (slice 2.10). A reader
// copies what the docs show, so the docs are tested like code.

export const ROOT = resolve(import.meta.dir, "../..");

export function read(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

// The pages a user reads. The records, the plan, the brief and the logs are
// history and are not held to this.
export const USER_DOCS = [
  "README.md",
  "docs/workflow.md",
  "docs/read-only-trial.md",
  "docs/using-the-dashboard.md",
  "docs/reference.md",
  "docs/configuration.md",
  "docs/credentials.md",
  "docs/security.md",
  "docs/example-workflows.md",
  "docs/init.md",
];

// The complete workflows that sit next to the docs as files, ready to copy.
export const EXAMPLE_WORKFLOWS = readdirSync(resolve(ROOT, "examples/workflows"))
  .filter((name) => name.endsWith(".yml"))
  .map((name) => `examples/workflows/${name}`);

// A section of a Markdown file: its heading line and everything up to the
// next heading of the same level or higher. Nothing when the heading is not
// there. A `#` inside a code fence is not a heading.
export function section(markdown: string, heading: string): string {
  const level = heading.match(/^#+/)?.[0].length ?? 0;
  const lines = markdown.split("\n");
  const start = lines.indexOf(heading);
  if (start === -1) return "";
  let fenced = false;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (line.startsWith("```")) fenced = !fenced;
    const depth = line.match(/^(#+) /)?.[1]?.length;
    if (!fenced && depth !== undefined && depth <= level) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

export interface Fence {
  language: string;
  text: string;
}

// Every fenced code block of a Markdown file, in order.
export function fences(markdown: string): Fence[] {
  return [...markdown.matchAll(/^```([\w-]*)\n([\s\S]*?)^```$/gm)].map((match) => ({
    language: match[1] ?? "",
    text: match[2] ?? "",
  }));
}

// The rows of the first table under a heading, each as its cells, without the
// header row and the line under it. Nothing when the heading has no table
// before the next heading.
export function tableUnder(markdown: string, heading: string): string[][] {
  const lines = markdown.split("\n");
  const start = lines.indexOf(heading);
  if (start === -1) return [];
  const rows: string[][] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("#")) break;
    if (line.startsWith("|")) rows.push(cells(line));
    else if (rows.length > 0) break;
  }
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

// The words written in backticks in a cell, in order.
export function codeIn(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "");
}

export interface Step {
  id?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
}

export interface Job {
  if?: string;
  environment?: unknown;
  permissions?: Record<string, string>;
  concurrency?: string | { group: string; queue?: string; "cancel-in-progress"?: unknown };
  steps: Step[];
}

export interface Workflow {
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
}

export interface Found {
  // Where the workflow is written down, for the failure message.
  where: string;
  workflow: Workflow;
}

// Every complete workflow the user docs show, and every example file. A YAML
// block that is only a part of a workflow (no `jobs:`) is left out.
export function workflows(): Found[] {
  const inDocs = USER_DOCS.flatMap((path) =>
    fences(read(path))
      .filter((fence) => fence.language === "yaml")
      .map((fence, index) => ({ where: `${path}, YAML block ${index + 1}`, text: fence.text })),
  );
  const files = EXAMPLE_WORKFLOWS.map((path) => ({ where: path, text: read(path) }));
  return [...inDocs, ...files].flatMap(({ where, text }) => {
    const parsed = Bun.YAML.parse(text) as Partial<Workflow> | null;
    return parsed && typeof parsed === "object" && "jobs" in parsed
      ? [{ where, workflow: parsed as Workflow }]
      : [];
  });
}

export function isSluiceway(step: Step): boolean {
  return step.uses?.startsWith("sluiceway/sluiceway@") ?? false;
}

// The mode of a job's Sluiceway step, or nothing when the job has none.
export function modeOf(job: Job): string | undefined {
  const step = job.steps.find(isSluiceway);
  if (step === undefined) return undefined;
  // No mode is auto, action.yml's default (record 0077).
  const mode = String(step.with?.mode ?? "").trim();
  return mode === "" ? "auto" : mode;
}
