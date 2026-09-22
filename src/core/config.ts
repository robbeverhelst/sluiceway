import { LineCounter, parseDocument } from "yaml";
import { z } from "zod";
import { knownStacks } from "./discovery.ts";
import { globMatcher } from "./glob.ts";
import { showValuesEntryProblem } from "./show-values.ts";
import { type Stack, stackId } from "./stack.ts";

// The word that reads a stack's dependencies from its program (record 0059).
export const DEPENDS_ON_AUTO = "auto";

// Loose on purpose: old logins break today's rules, and managed accounts
// carry an underscore. What matters is that a slash or an "@" never passes.
const username = z.string().regex(/^[A-Za-z0-9_-]+$/);

// The tick rule (record 0018). A level, or a list of usernames. Logins are
// compared without regard to case, so they are kept in lower case, once each.
const tickers = z.union([
  z.enum(["write", "maintain", "admin"]),
  z
    .array(username)
    .min(1)
    .transform((names) => [...new Set(names.map((name) => name.toLowerCase()))]),
]);

// The author of a pull request, as GitHub writes it: a person's login, or an
// app's login with "[bot]" (record 0054). The two are different accounts, so
// "renovate" never stands for "renovate[bot]".
const author = z
  .string()
  .regex(/^[A-Za-z0-9_-]+(\[bot\])?$/)
  .transform((login) => login.toLowerCase());

const text = z.string().min(1);
const globs = z.array(text);

// An `ignore` entry: a glob, or a glob with the reason it is there. A stack
// left out with a reason is listed with it on the dashboard, so an exclusion
// never rots out of sight (record 0051).
const ignoreEntry = z.union([
  text,
  z.strictObject({
    glob: text.describe("Glob matched against the stack id."),
    reason: text.describe("Why these stacks are left out. Shown on the dashboard under In sync."),
  }),
]);

// A person typed this path. It leaves here in the form a stack id uses (record
// 0006): forward slashes, no leading "./", no trailing slash. The repo root
// itself is ".".
const stackPath = text
  .superRefine((path, context) => {
    const refuse = (message: string) => context.addIssue({ code: "custom", message });
    if (path.includes("\\")) refuse(`${show(path)} must use forward slashes.`);
    else if (path.startsWith("/")) refuse(`${show(path)} must be relative to the repo root.`);
    else if (path.split("/").includes(".."))
      refuse(`${show(path)} must stay inside the repo, so ".." is not allowed.`);
  })
  .transform((path) => {
    const segments = path.split("/").filter((segment) => segment !== "" && segment !== ".");
    return segments.length === 0 ? "." : segments.join("/");
  });

// An entry adds settings to stacks that discovery found. It never creates one,
// except an entry that names a tool, which declares its stack (record 0053).
const stackEntry = z
  .strictObject({
    path: stackPath.describe("Directory of the stack, relative to the repo root."),
    name: text
      .describe("Name of the stack. Without it the entry covers every stack in path.")
      .exactOptional(),
    // A tool whose stacks no file names, so the entry declares the stack
    // instead of adding settings to one (record 0053). Which tools exist and
    // what options each takes is for the adapters to say, so no tool word is
    // written here (record 0006). Discovery checks both.
    tool: text
      .describe(
        "The tool of a stack that discovery cannot find from files alone. The entry then declares the stack at path. See the configuration reference for the tools.",
      )
      .exactOptional(),
    environment: text
      .describe(
        "Label on the deployment record, and the GitHub Environment where one is used. Default: sluiceway.",
      )
      .exactOptional(),
    tickers: tickers
      .describe("Tick rule for this stack. Default: the top level tickers.")
      .exactOptional(),
    inputs: globs
      .describe("Extra globs this stack claims, relative to the repo root.")
      .exactOptional(),
    previewTimeout: z
      .int()
      .min(1)
      .describe(
        "Time limit for one preview of this stack, in whole minutes. Default: the preview-timeout input.",
      )
      .exactOptional(),
    // Stack ids, exact, checked against discovery (record 0056), or `auto`:
    // read from the program's stack references at each preview (record 0059).
    dependsOn: z
      .union([z.literal(DEPENDS_ON_AUTO), z.array(text)])
      .describe(
        "Stack ids of the stacks this stack depends on, or auto to read them from the program's stack references at each preview. A tick on this stack is refused while one of them has a change waiting, and when both are ticked they deploy in order.",
      )
      .exactOptional(),
    // The drift check of these stacks, like the top level (record 0059).
    drift: z
      .strictObject({
        enabled: z
          .boolean()
          .describe(
            "Check these stacks for drift, or not, whatever drift.enabled at the top level says. The scans that check are the same.",
          ),
      })
      .describe("The drift check of these stacks. Default: the top level drift.")
      .exactOptional(),
    // Named adapter options (records 0006, 0015). Only an entry with a tool
    // takes them, and its adapter checks their names and values (record 0053).
    options: z
      .record(z.string(), z.unknown())
      .describe("Named adapter options of the tool. Only an entry with tool takes them.")
      .exactOptional(),
  })
  .superRefine((entry, context) => {
    if (entry.tool !== undefined) return;
    for (const name of Object.keys(entry.options ?? {})) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: `unknown option ${show(name)}. A stack that discovery finds from its files takes no options. Only an entry with tool takes them.`,
      });
    }
  });

const stackEntries = z.array(stackEntry).superRefine((entries, context) => {
  const seen = new Map<string, number>();
  entries.forEach((entry, index) => {
    const id = stackId(entry);
    const first = seen.get(id);
    if (first === undefined) seen.set(id, index);
    else
      context.addIssue({
        code: "custom",
        path: [index],
        message: `says the same path and name as stacks[${first}] (${show(id)}). Put the settings in one entry.`,
      });
  });
});

// The shape of sluiceway.yaml (build-plan.md, section 3). Unknown keys are an
// error, because a typo in "tickers" would change who can deploy. The JSON
// schema in schema/ is generated from this.
export const configSchema = z.strictObject({
  dashboard: z
    .strictObject({
      title: text.describe("Title of the dashboard issue.").default("Sluiceway dashboard"),
      label: text.describe("Label the dashboard issue is found by.").default("sluiceway"),
      pin: z.boolean().describe("Pin the dashboard issue, best effort.").default(true),
      redact: z
        .boolean()
        .describe(
          "Keep resource types, resource names and property names out of the issue. The summary stays full. Not access control.",
        )
        .default(false),
      personality: z
        .boolean()
        .describe("Show the header image and use the voice. false removes both.")
        .default(true),
      // Slice 2.17: for a workflow with no `resolve` job, where a box would
      // do nothing (onboarding log, hurdle 16).
      readOnly: z
        .boolean()
        .describe(
          "Draw no boxes: pending rows have none, there is no rescan box, and a line under the Pending heading says so. For a workflow that only scans.",
        )
        .default(false),
      // Slice 2.19: the one list that lets a value reach the issue (record
      // 0052). Empty by default.
      showValues: z
        .array(
          text.superRefine((entry, context) => {
            const problem = showValuesEntryProblem(entry);
            if (problem !== undefined) context.addIssue({ code: "custom", message: problem });
          }),
        )
        .describe(
          'Property paths whose old and new value may appear on the dashboard, as "old → new". Exact paths, or "*" for part of one name. Never a value the tool marks secret, and none at all with redact on.',
        )
        .default([]),
    })
    .prefault({}),
  tickers: tickers
    .describe(
      "Default tick rule: write, maintain, admin, or a list of usernames. A list narrows and never widens: a person on it still needs write access.",
    )
    .default("write"),
  // One reviewed line that stops every deploy (record 0051).
  deploys: z
    .boolean()
    .describe(
      "false stops every deploy: resolve clears every ticked box with a note and starts nothing, and apply ends a deploy that was already started before the tool runs. Scans go on.",
    )
    .default(true),
  ignore: z
    .array(ignoreEntry)
    .describe(
      "Globs matched against the stack id. An ignored stack has no row. An entry with a reason is listed with it under In sync.",
    )
    .default([]),
  scan: z
    .strictObject({
      unrelated: globs
        .describe("Globs for files that claim nothing and force nothing, such as **/*.md.")
        .default([]),
      // The one setting that lets a value reach the job log (record 0048).
      logDiff: z
        .boolean()
        .describe(
          "Print the tool's own diff of every pending stack, values included, in that stack's group of the job log and nowhere else. Anyone who can read the repo can read its job logs. Costs one more tool run per pending stack.",
        )
        .default(false),
    })
    .prefault({}),
  // The drift check (record 0055). When it runs is the workflow's business:
  // every scan that a schedule starts checks drift, and so does a dispatch
  // that a person started.
  drift: z
    .strictObject({
      enabled: z
        .boolean()
        .describe(
          "Check every stack for drift in each scan that a schedule starts, or that a person starts with Run workflow: changes made to real infrastructure outside the code. A stack with drift gets a row with a box, and a tick deploys the code as it is, which puts it back. Costs one more tool run per stack in those scans.",
        )
        .default(false),
    })
    .prefault({}),
  stacks: stackEntries
    .describe("Settings for stacks that discovery found. An entry never creates a stack.")
    .default([]),
  // Slice 4.2 (record 0054): one tick merges a routine pull request and
  // deploys its stack. Off while the list is empty.
  mergeAndDeploy: z
    .strictObject({
      authors: z
        .array(author)
        .transform((logins) => [...new Set(logins)])
        .describe(
          "Logins whose open pull requests may be merged and deployed with one tick, such as renovate[bot]. Empty turns it off.",
        )
        .default([]),
    })
    .prefault({}),
});

export type Config = z.output<typeof configSchema>;

// A sluiceway.yaml that cannot be used. It holds every problem found, not only
// the first, so a person fixes the file in one go.
export class ConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(
      ["sluiceway.yaml is not valid:", ...problems.map((problem) => `- ${problem}`)].join("\n"),
    );
    this.name = "ConfigError";
    this.problems = problems;
  }
}

// Takes the text of sluiceway.yaml, or undefined when the repo has no such
// file. The file is optional, so no text and an empty file both give defaults.
export function parseConfig(text: string | undefined): Config {
  const raw = text === undefined ? null : readYaml(text);
  const result = configSchema.safeParse(raw ?? {});
  if (!result.success) {
    const problems = result.error.issues.flatMap((issue) => describe(issue, raw));
    throw new ConfigError(inFileOrder(problems, raw).map((problem) => problem.text));
  }
  return result.data;
}

function readYaml(text: string): unknown {
  const lineCounter = new LineCounter();
  const document = parseDocument(text, { lineCounter, prettyErrors: false });
  if (document.errors.length > 0) {
    throw new ConfigError(
      document.errors.map((error) => {
        const { line, col } = lineCounter.linePos(error.pos[0]);
        return `line ${line}, column ${col}: not valid YAML. ${error.message}`;
      }),
    );
  }
  return document.toJS();
}

type Issue = z.core.$ZodIssue;

interface Problem {
  // Where in the file the problem is, down to the key it is about.
  path: PropertyKey[];
  text: string;
}

// The wording is ours, not the schema library's, so an upgrade of the library
// cannot change what a person reads.
function describe(issue: Issue, raw: unknown): Problem[] {
  const at = where(issue.path);
  const value = valueAt(raw, issue.path);
  const problem = (text: string): Problem[] => [{ path: issue.path, text: `${at}${text}` }];
  const key = issue.path.at(-1);
  if (issue.code === "unrecognized_keys") {
    const known = knownKeys(issue.path);
    const unknown = (name: string): string => {
      if (issue.path.length === 1 && issue.path[0] === "drift" && name === "schedule")
        return `"schedule" is not a key of sluiceway.yaml. A drift check runs in every scan that a schedule starts, so the cron goes in the workflow, under \`on: schedule\`.`;
      if (issue.path.length > 0 && RESERVED_KEYS.includes(name))
        return `"${name}" is not in this version of Sluiceway yet. Remove it.`;
      return `unknown key "${name}". Known keys here: ${known.join(", ")}.`;
    };
    return issue.keys.map((name) => ({
      path: [...issue.path, name],
      text: `${at}${unknown(name)}`,
    }));
  }
  if (value === undefined && key === "path") {
    return problem("is required. It is the directory of the stack, relative to the repo root.");
  }
  if (issue.path[0] === "ignore" && issue.path.length === 3) {
    const glob = valueAt(raw, [...issue.path.slice(0, -1), "glob"]);
    if (value === undefined && key === "reason") {
      return problem(
        `is required. Say why the stack is left out, or write the glob as text: ${show(glob)}.`,
      );
    }
    if (value === undefined && key === "glob") {
      return problem("is required. It is matched against the stack id.");
    }
  }
  if (key === "previewTimeout" && issue.code !== "custom") {
    return problem(`expected a whole number of minutes, 1 or more, got ${show(value)}.`);
  }
  // An `ignore` entry is text or a mapping, and each kind has its own words.
  if (issue.code === "invalid_union" && issue.path[0] === "ignore") {
    const branch = typeof value === "string" ? 0 : isMapping(value) ? 1 : undefined;
    if (branch === undefined) {
      return problem(
        `expected a glob as text, or a mapping with glob and reason, got ${show(value)}.`,
      );
    }
    return (issue.errors[branch] ?? []).flatMap((inner) =>
      describe({ ...inner, path: [...issue.path, ...inner.path] }, raw),
    );
  }
  if (issue.code === "invalid_union" && key === "dependsOn") {
    if (!Array.isArray(value)) {
      return problem(`expected a list of stack ids, or ${DEPENDS_ON_AUTO}, got ${show(value)}.`);
    }
    return (issue.errors[1] ?? []).flatMap((inner) =>
      describe({ ...inner, path: [...issue.path, ...inner.path] }, raw),
    );
  }
  if (issue.code === "invalid_type" && key === "drift" && issue.path[0] === "stacks") {
    return problem(
      `expected a mapping, got ${show(value)}. Write it as the top level has it: drift: { enabled: ${typeof value === "boolean" ? value : true} }.`,
    );
  }
  // The other union in the schema is the tick rule.
  if (issue.code === "invalid_union") {
    if (!Array.isArray(value)) {
      return problem(
        `expected "write", "maintain", "admin" or a list of usernames, got ${show(value)}.`,
      );
    }
    return (issue.errors[1] ?? []).flatMap((inner) =>
      describe({ ...inner, path: [...issue.path, ...inner.path] }, raw),
    );
  }
  if (issue.code === "invalid_format" && issue.path[0] === "mergeAndDeploy") {
    return problem(
      `${show(value)} is not a GitHub login. Write the login alone, without "@". An app is written with [bot], such as renovate[bot].`,
    );
  }
  // The other pattern in the schema is the username.
  if (issue.code === "invalid_format") {
    return problem(
      String(value).includes("/")
        ? `${show(value)} looks like a team. Teams are not supported yet. Use a level ("write", "maintain", "admin") or usernames.`
        : `${show(value)} is not a GitHub username. Write the login alone, without "@".`,
    );
  }
  if (issue.code === "too_small") {
    return problem(
      issue.origin === "array"
        ? "the list is empty, so nobody could tick. Name at least one username or use a level."
        : key === "path"
          ? 'must not be empty. Use "." for the repo root.'
          : "must not be empty.",
    );
  }
  if (issue.code === "invalid_type") {
    return problem(`expected ${EXPECTED[issue.expected] ?? issue.expected}, got ${show(value)}.`);
  }
  // What is left are the checks written in this file, in their own words.
  return problem(issue.message);
}

const EXPECTED: Record<string, string> = {
  string: "text",
  boolean: "true or false",
  array: "a list",
  object: "a mapping",
};

function isMapping(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function valueAt(raw: unknown, path: PropertyKey[]): unknown {
  let value = raw;
  for (const segment of path) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<PropertyKey, unknown>)[segment];
  }
  return value;
}

// A value from the file, as a person would recognise it. Config holds no
// secrets, so quoting it back is fine.
function show(value: unknown): string {
  if (value === null || value === undefined) return "nothing";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "object") return "a mapping";
  return JSON.stringify(value);
}

// Problems are listed top to bottom as the file has them, whatever order the
// schema library found them in.
function inFileOrder(problems: Problem[], raw: unknown): Problem[] {
  const position = (path: PropertyKey[]): number[] => {
    let value = raw;
    return path.map((segment) => {
      const keys = typeof value === "object" && value !== null ? Object.keys(value) : [];
      const index = keys.indexOf(String(segment));
      value = index === -1 ? undefined : (value as Record<string, unknown>)[String(segment)];
      // A key that is missing from the file sorts after the ones that are there.
      return index === -1 ? keys.length : index;
    });
  };
  const compare = (a: number[], b: number[]): number => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const difference = (a[i] ?? 0) - (b[i] ?? 0);
      if (difference !== 0) return difference;
    }
    return a.length - b.length;
  };
  return problems
    .map((problem) => ({ problem, at: position(problem.path) }))
    .sort((a, b) => compare(a.at, b.at))
    .map(({ problem }) => problem);
}

// Keys of features that are planned and not in v1. They fail with their own
// message and are never ignored (build-plan.md, section 3). None is reserved
// now: `drift` on a stack arrived with record 0059.
const RESERVED_KEYS: string[] = [];

// "stacks[0].path: ", or nothing for the top level.
function where(path: PropertyKey[]): string {
  const text = path
    .map((segment) => (typeof segment === "number" ? `[${segment}]` : `.${String(segment)}`))
    .join("")
    .replace(/^\./, "");
  return text === "" ? "" : `${text}: `;
}

// The keys the schema allows at a path, in the order the schema lists them.
function knownKeys(path: PropertyKey[]): string[] {
  let schema: z.core.$ZodType = configSchema;
  for (const segment of path) {
    schema = unwrap(schema);
    if (schema instanceof z.ZodObject) schema = schema.shape[String(segment)];
    else if (schema instanceof z.ZodArray) schema = schema.element;
  }
  schema = unwrap(schema);
  return schema instanceof z.ZodObject ? Object.keys(schema.shape) : [];
}

// Through defaults, and into the mapping of a union that has one.
function unwrap(schema: z.core.$ZodType): z.core.$ZodType {
  let inner = schema;
  while (
    inner instanceof z.ZodDefault ||
    inner instanceof z.ZodPrefault ||
    inner instanceof z.ZodExactOptional
  ) {
    inner = inner.def.innerType;
  }
  if (inner instanceof z.ZodUnion) {
    return inner.options.find((option) => option instanceof z.ZodObject) ?? inner;
  }
  return inner;
}

export type TickRule = z.output<typeof tickers>;

export type IgnoreEntry = z.output<typeof ignoreEntry>;

export function ignoreGlob(entry: IgnoreEntry): string {
  return typeof entry === "string" ? entry : entry.glob;
}

// A stack that an `ignore` entry with a reason leaves out (record 0051).
export interface IgnoredStack {
  stackId: string;
  reason: string;
}

// The stacks an entry with a reason leaves out, by stack id, each with the
// reason of the first entry in the file that matches it. A stack whose first
// match is a glob as text has no reason to show and is not listed.
export function ignoredStacks(config: Config, found: Stack[]): IgnoredStack[] {
  return found
    .map(stackId)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap((id) => {
      const entry = config.ignore.find((one) => globMatcher([ignoreGlob(one)])(id));
      return entry === undefined || typeof entry === "string"
        ? []
        : [{ stackId: id, reason: entry.reason }];
    });
}

// A discovered stack with the settings that config gives it.
export interface ConfiguredStack {
  stack: Stack;
  environment: string;
  tickers: TickRule;
  inputs: string[];
  // Whole minutes. Absent means the time limit of the action's input.
  previewTimeout?: number;
  // The stack ids this stack depends on, in stack id order (record 0056).
  // Absent when it depends on none.
  dependsOn?: string[];
  // `dependsOn: auto` (record 0059): the stacks its program's stack
  // references name are read at each preview, and ride on its row.
  dependsOnAuto?: true;
  // `drift.enabled` of its stack entries (record 0059). Absent when no entry
  // sets it, and the top level decides.
  drift?: boolean;
}

const DEFAULT_ENVIRONMENT = "sluiceway";

// Takes the stacks an adapter found, drops the ignored ones, and lays the
// stacks entries over the rest. An entry with a name sets one stack, an entry
// without covers every stack in its path, and the entry with a name wins key by
// key. Inputs only ever add up (record 0010). What comes back is every stack
// that exists for Sluiceway, so no caller can forget ignore.
export function applyConfig(config: Config, found: Stack[]): ConfiguredStack[] {
  const stacks = knownStacks(found, config.ignore.map(ignoreGlob));
  const problems = config.stacks.flatMap((entry, index) => {
    const inPath = stacks.filter((stack) => stack.path === entry.path);
    if (inPath.some((stack) => covers(entry, stack))) return [];
    const ignored = found.filter((stack) => covers(entry, stack));
    return [`stacks[${index}]: ${describeMiss(entry, inPath, ignored)}`];
  });
  if (problems.length > 0) throw new ConfigError(problems);
  const dependencyProblems = checkDependsOn(config, found, stacks);
  if (dependencyProblems.length > 0) throw new ConfigError(dependencyProblems);

  return stacks.map((stack) => {
    const entries = config.stacks
      .filter((entry) => covers(entry, stack))
      .sort((a, b) => Number(a.name !== undefined) - Number(b.name !== undefined));
    const previewTimeout = entries.findLast((entry) => entry.previewTimeout)?.previewTimeout;
    const drift = entries.findLast((entry) => entry.drift)?.drift?.enabled;
    return {
      stack,
      environment:
        entries.findLast((entry) => entry.environment)?.environment ?? DEFAULT_ENVIRONMENT,
      tickers: entries.findLast((entry) => entry.tickers)?.tickers ?? config.tickers,
      inputs: [...new Set(entries.flatMap((entry) => entry.inputs ?? []))],
      ...(previewTimeout === undefined ? {} : { previewTimeout }),
      ...dependsOnOf(entries),
      ...(entries.some((entry) => entry.dependsOn === DEPENDS_ON_AUTO)
        ? { dependsOnAuto: true as const }
        : {}),
      ...(drift === undefined ? {} : { drift }),
    };
  });
}

// Like inputs, dependencies only ever add up.
function dependsOnOf(entries: StackEntry[]): { dependsOn?: string[] } {
  const ids = [...new Set(entries.flatMap((entry) => listed(entry.dependsOn)))].sort(byCodeUnit);
  return ids.length === 0 ? {} : { dependsOn: ids };
}

// The stack ids an entry names. `auto` names none in the file.
function listed(dependsOn: StackEntry["dependsOn"]): string[] {
  return Array.isArray(dependsOn) ? dependsOn : [];
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// A dependency that could never hold anything back is an error, never a gate
// that stays silent (record 0056): a stack that discovery did not find, one
// that ignore leaves out, the stack itself, and a circle.
function checkDependsOn(config: Config, found: Stack[], stacks: Stack[]): string[] {
  const known = new Set(stacks.map(stackId));
  const all = new Set(found.map(stackId));
  const problems = config.stacks.flatMap((entry, index) =>
    listed(entry.dependsOn).flatMap((id, at) => {
      const where = `stacks[${index}].dependsOn[${at}]: ${show(id)}`;
      if (all.has(id) && !known.has(id)) {
        // The reason the ignore entry gives, when it gives one (record 0059).
        const reason = ignoredStacks(config, found).find((one) => one.stackId === id)?.reason;
        const why = reason === undefined ? "" : ` (${show(reason)})`;
        return [
          `${where} is left out by ignore${why}, so it never has a change to wait for. Remove it here, or change ignore.`,
        ];
      }
      if (!known.has(id))
        return [
          `${where} is not a stack that discovery found. Write the stack id as a row shows it, such as ${show(stacks[0] ? stackId(stacks[0]) : "network:dev")}.`,
        ];
      const self = stacks.find((stack) => stackId(stack) === id);
      if (self && covers(entry, self))
        return [`${where} is the stack itself. A stack cannot depend on itself.`];
      return [];
    }),
  );
  if (problems.length > 0) return problems;

  const edges = new Map<string, string[]>();
  for (const stack of stacks) {
    const entries = config.stacks.filter((entry) => covers(entry, stack));
    edges.set(stackId(stack), dependsOnOf(entries).dependsOn ?? []);
  }
  return dependencyCircles(edges).map((circle) => {
    const [first = "", ...rest] = circle;
    const links = rest.map(
      (id, index) => `${index === 0 ? "depends on" : "which depends on"} ${id}`,
    );
    return `dependsOn goes round in a circle: ${first} ${links.join(", ")}. Nothing in a circle could ever deploy first, so take one of these out.`;
  });
}

// Every circle once, each starting at its smallest stack id, in stack id order.
function dependencyCircles(edges: ReadonlyMap<string, readonly string[]>): string[][] {
  const circles = new Map<string, string[]>();
  const walk = (path: string[]) => {
    const last = path[path.length - 1] ?? "";
    for (const next of edges.get(last) ?? []) {
      const at = path.indexOf(next);
      if (at === -1) {
        walk([...path, next]);
        continue;
      }
      const circle = path.slice(at);
      const start = circle.indexOf([...circle].sort(byCodeUnit)[0] ?? "");
      const turned = [...circle.slice(start), ...circle.slice(0, start)];
      const key = [...turned].sort(byCodeUnit).join("\n");
      if (!circles.has(key)) circles.set(key, [...turned, turned[0] ?? ""]);
    }
  };
  for (const id of [...edges.keys()].sort(byCodeUnit)) walk([id]);
  return [...circles.values()].sort((a, b) => byCodeUnit(a[0] ?? "", b[0] ?? ""));
}

type StackEntry = Config["stacks"][number];

function covers(entry: StackEntry, stack: Stack): boolean {
  return entry.path === stack.path && (entry.name === undefined || entry.name === stack.name);
}

function describeMiss(entry: StackEntry, inPath: Stack[], ignored: Stack[]): string {
  if (ignored.length > 0) {
    const ids = ignored.map((stack) => show(stackId(stack))).join(", ");
    const subject = ignored.length === 1 ? `the stack ${ids} is` : `the stacks ${ids} are`;
    return `${subject} left out by ignore, so these settings would do nothing. Remove the entry, or change ignore.`;
  }
  if (entry.name === undefined || inPath.length === 0) {
    return `no stack was found in ${show(entry.path)}. An entry adds settings to a stack that exists, it never creates one.`;
  }
  const names = inPath.flatMap((stack) => (stack.name === undefined ? [] : [stack.name]));
  const found =
    names.length === 0 ? "The stack found there has no name." : `Found there: ${names.join(", ")}.`;
  return `no stack named ${show(entry.name)} was found in ${show(entry.path)}. ${found}`;
}
