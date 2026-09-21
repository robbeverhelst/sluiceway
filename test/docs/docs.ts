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
  "docs/configuration.md",
  "docs/credentials.md",
  "docs/security.md",
  "docs/example-workflows.md",
];

// The complete workflows that sit next to the docs as files, ready to copy.
export const EXAMPLE_WORKFLOWS = readdirSync(resolve(ROOT, "examples/workflows"))
  .filter((name) => name.endsWith(".yml"))
  .map((name) => `examples/workflows/${name}`);

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
  return step === undefined ? undefined : String(step.with?.mode ?? "");
}
