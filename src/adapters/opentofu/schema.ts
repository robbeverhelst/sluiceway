import { z } from "zod";

// The plan JSON that `tofu show -json <plan file>` prints (OpenTofu docs,
// "JSON Output Format"), and `terraform show -json` in the same format
// (record 0068), holds every value of the configuration, the state and
// the plan in plain text, sensitive ones included (record 0021). This schema
// names the few fields the adapter needs. Zod drops every other key, so
// `variables`, `prior_state`, `configuration`, `planned_values`,
// `output_changes`, `resource_drift` and `generated_config` never leave here.
// `before`, `after`, `after_unknown` and the two sensitivity masks are read by
// the fold in memory, to find the paths that change and the values a repo
// listed, and nothing of them leaves the fold but those.

// The docs: a minor version only adds fields, a new major version must be
// refused.
const formatVersion = z.string().regex(/^1\.\d+$/);

const change = z.object({
  actions: z.array(z.string()),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  after_unknown: z.unknown().optional(),
  before_sensitive: z.unknown().optional(),
  after_sensitive: z.unknown().optional(),
  replace_paths: z.array(z.array(z.union([z.string(), z.number()]))).optional(),
  // Only whether it is there: its id is a value.
  importing: z
    .unknown()
    .optional()
    .transform((importing) => importing != null),
});

const resourceChange = z.object({
  address: z.string().min(1),
  previous_address: z.string().min(1).optional(),
  module_address: z.string().min(1).optional(),
  mode: z.string(),
  type: z.string().min(1),
  name: z.string().min(1),
  deposed: z.string().min(1).optional(),
  change,
});

// A plan that failed half way says so, and cannot be applied. Its changes are
// never shown as a diff. Terraform also says whether the plan holds every
// change (record 0068): with changes deferred to a later plan it shows only
// part of what a deploy would do. OpenTofu writes no such field.
const planDocument = z.object({
  format_version: formatVersion,
  errored: z.literal(false).optional(),
  complete: z.literal(true).optional(),
  resource_changes: z.array(resourceChange).default([]),
});

export type ResourceChange = z.infer<typeof resourceChange>;

export type ParsedPlan =
  | { ok: true; changes: ResourceChange[] }
  // Each problem names a place and what was expected there, never what was
  // found: the parser's own message can quote its input.
  | { ok: false; problems: string[] };

export function parsePlan(stdout: string): ParsedPlan {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    return { ok: false, problems: ["The tool's output: expected one JSON document."] };
  }
  const parsed = planDocument.safeParse(json);
  if (!parsed.success) return { ok: false, problems: parsed.error.issues.map(problem) };
  return { ok: true, changes: parsed.data.resource_changes };
}

const EXPECTED: Record<string, string> = {
  string: "text",
  array: "a list",
  object: "an object",
  boolean: "true or false",
};

function problem(issue: z.core.$ZodIssue): string {
  const at = place(issue.path);
  if (at === "format_version") {
    return `The tool's output, at format_version: expected a plan format version 1.x, which Sluiceway reads.`;
  }
  if (at === "errored") return "The tool's output, at errored: expected a plan that did not fail.";
  if (at === "complete") {
    return "The tool's output, at complete: expected a plan that holds every change, not one with changes left for later.";
  }
  const expected = issue.code === "invalid_type" ? EXPECTED[issue.expected] : undefined;
  return `The tool's output, at ${at}: expected ${expected ?? "something else"}.`;
}

// A path is made of this schema's field names and of indexes, so it holds
// nothing the tool wrote.
export function place(path: PropertyKey[]): string {
  if (path.length === 0) return "the top";
  return path
    .map((part, index) =>
      typeof part === "number" ? `[${part}]` : `${index === 0 ? "" : "."}${String(part)}`,
    )
    .join("");
}
