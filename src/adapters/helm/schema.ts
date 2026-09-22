import { z } from "zod";
import { place } from "../opentofu/schema.ts";

// What `helm diff upgrade --output=structured` prints (the plugin's README,
// "Structured JSON output", and diff/structured.go at v3.15.13): one entry per
// object that changes, with the path of every changed field and its old and
// new value. For a Secret the plugin puts a stand-in in place of each value,
// which still says how long it is. This schema names the few fields the
// adapter needs and Zod drops every other key. `oldValue` and `newValue` are
// read by the fold in memory, for the values a repo listed, and nothing of
// them leaves the fold but those.

const change = z.object({
  // Where the field sits, with dots between names and [n] for a list index.
  path: z.string().optional(),
  // The last name or index of the path, as it is: it may hold a dot.
  field: z.string(),
  oldValue: z.unknown().optional(),
  newValue: z.unknown().optional(),
});

const entry = z.object({
  apiVersion: z.string().min(1),
  kind: z.string().min(1),
  // Empty for an object the plugin could not place in a namespace.
  namespace: z.string().optional(),
  name: z.string().min(1),
  changeType: z.string(),
  changes: z.array(change).optional(),
  changesSuppressed: z.boolean().optional(),
});

export type Entry = z.infer<typeof entry>;
export type FieldChange = z.infer<typeof change>;

export type ParsedEntries =
  | { ok: true; entries: Entry[] }
  // Each problem names a place and what was expected there, never what was
  // found: the parser's own message can quote its input.
  | { ok: false; problems: string[] };

export function parseEntries(stdout: string): ParsedEntries {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    return { ok: false, problems: ["The tool's output: expected one JSON document."] };
  }
  const parsed = z.array(entry).safeParse(json);
  if (!parsed.success) return { ok: false, problems: parsed.error.issues.map(problem) };
  return { ok: true, entries: parsed.data };
}

const EXPECTED: Record<string, string> = {
  string: "text",
  array: "a list",
  object: "an object",
  boolean: "true or false",
};

function problem(issue: z.core.$ZodIssue): string {
  const at = place(issue.path);
  const expected =
    issue.code === "invalid_type"
      ? EXPECTED[issue.expected]
      : issue.code === "too_small"
        ? "text"
        : undefined;
  return `The tool's output, at ${at}: expected ${expected ?? "something else"}.`;
}
