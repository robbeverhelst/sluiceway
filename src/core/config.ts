import { LineCounter, parseDocument } from "yaml";
import { z } from "zod";
import { configErrorText, configProblemText } from "../render/config-problems.ts";
import { LOOKBACK, NAMED_ON_A_ROW } from "./attribution.ts";
import { knownStacks } from "./discovery.ts";
import { globMatcher } from "./glob.ts";
import { DEFAULT_NOTIFY_EVENTS, NOTIFY_EVENTS } from "./notify.ts";
import { PHASE_NAME, phaseDependencies, throughPhase } from "./phases.ts";
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

// A phase (record 0067). A plain word, so it reads the same wherever it is
// named.
const phaseName = text.regex(PHASE_NAME);

// What an `id` a person gives a stack may hold (slice 5.9).
const STACK_ID = /^[A-Za-z0-9][A-Za-z0-9._/:@+-]*$/;

// A person typed this path. It leaves here in the form a stack id uses (record
// 0006): forward slashes, no leading "./", no trailing slash. The repo root
// itself is ".".
const stackPath = text
  .superRefine((path, context) => {
    if (path.includes("\\")) refuse(context, { kind: "backslash-in-path", value: path });
    else if (path.startsWith("/")) refuse(context, { kind: "absolute-path", value: path });
    else if (path.split("/").includes(".."))
      refuse(context, { kind: "path-leaves-repo", value: path });
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
    // The id of the one stack this entry covers, in place of the derived one
    // (slice 5.9). Plain, so it is safe on a row and in a deployment task.
    id: text
      .regex(STACK_ID, "must be letters, digits and . _ / : @ + -, starting with a letter or digit")
      .describe(
        "The id of the one stack this entry covers, in place of the one derived from its path and name. A stack that moved keeps its row and its deploys under it. Unique among every stack id.",
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
    // The phase of these stacks (record 0067), or the key of the tool's own
    // file that names it.
    phase: z
      .union([
        phaseName,
        z.strictObject({
          from: text.describe(
            "A key of the project file whose text is the phase, under config or at the top level.",
          ),
        }),
      ])
      .describe(
        "The phase of these stacks, one of phases, or from: a key of the project file that names it. A stack in a phase depends on every stack in every earlier phase.",
      )
      .exactOptional(),
    // When these stacks deploy (record 0095). A tick unless the repo says
    // on-merge, for these stacks and no other.
    deploy: z
      .enum(["on-tick", "on-merge"])
      .describe(
        "When these stacks deploy. on-tick: when a person ticks the row, the default. on-merge: by themselves after the scan of a merge that found them pending, through the same fresh preview and hash check as a tick, attributed to whoever merged. A change that deletes or replaces something, drift, and a stack it depends on that waits for a tick still wait for a tick.",
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
      refuse(context, { kind: "option-without-tool", option: name }, ["options"]);
    }
  });

const stackEntries = z.array(stackEntry).superRefine((entries, context) => {
  const seen = new Map<string, number>();
  entries.forEach((entry, index) => {
    // The derived id of what the entry points at, not the id it may give.
    const id = stackId({
      path: entry.path,
      ...(entry.name === undefined ? {} : { name: entry.name }),
    });
    const first = seen.get(id);
    if (first === undefined) seen.set(id, index);
    else refuse(context, { kind: "same-entry", first, stackId: id }, [index]);
  });
});

// The shape of sluiceway.yaml (build-plan.md, section 3). Unknown keys are an
// error, because a typo in "tickers" would change who can deploy. The JSON
// schema in schema/ is generated from this.
// An IANA name the runtime knows (record 0089): `Europe/Brussels`, `UTC`.
// An offset such as `+02:00` is no name, even where the runtime takes one: it
// has no daylight saving, so it would be wrong half the year.
export function isTimeZone(name: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(name)) return false;
  if (/^(UTC|GMT)[+-]/i.test(name)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

// The longest Recently deployed list `dashboard.recentlyDeployed` allows
// (record 0062).
export const RECENTLY_DEPLOYED_MAX = 50;

// The longest lookback and the most names `attribution` allows (record 0072).
// Ten pages of the walk, and a line that still fits the size budget.
export const LOOKBACK_MAX = 1000;
export const NAMES_MAX = 20;

export const configSchema = z
  .strictObject({
    dashboard: z
      .strictObject({
        title: text
          .describe("Title of the dashboard issue. Every scan puts it back when it differs.")
          .default("Sluiceway dashboard"),
        label: text.describe("Label the dashboard issue is found by.").default("sluiceway"),
        pin: z
          .boolean()
          .describe(
            "Pin the dashboard issue on every scan when it is not pinned, best effort. false keeps it unpinned.",
          )
          .default(true),
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
              if (problem !== undefined) refuse(context, { kind: "worded", text: problem });
            }),
          )
          .describe(
            'Property paths whose old and new value may appear on the dashboard, as "old → new". Exact paths, or "*" for part of one name. Never a value the tool marks secret, and none at all with redact on.',
          )
          .default([]),
        // Slice 4.11 (record 0062). At most 50, so the list stays a small part
        // of the size budget and inside the page of records a writer reads.
        recentlyDeployed: z
          .int()
          .min(0)
          .max(RECENTLY_DEPLOYED_MAX)
          .describe(
            "How many deploys the Recently deployed list shows, newest first, failed ones included. 0 leaves the list out.",
          )
          .default(10),
        // Slice 5.25 (record 0089). Checked against the zones the runtime
        // knows, so a runtime without the zone refuses it here and never
        // falls back to UTC in silence.
        timeZone: z
          .string()
          .superRefine((value, context) => {
            if (!isTimeZone(value)) refuse(context, { kind: "not-a-time-zone", value });
          })
          .describe(
            "The IANA time zone every time on the dashboard is shown in, such as Europe/Brussels. A time that stands alone says its offset from UTC, and the line under Recently deployed names the zone. The markers keep UTC.",
          )
          .default("UTC"),
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
    // Slice 5.5 (record 0072): how far attribution looks back, and how many
    // pull requests and direct pushes a row names before the rest is a count.
    attribution: z
      .strictObject({
        lookback: z
          .int()
          .min(1)
          .max(LOOKBACK_MAX)
          .describe(
            "How many of the newest commits a job walks to say which pull requests made a row pending. A stack whose last deploy lies further back gets a line that says earlier changes exist. Each 100 commits cost one more GraphQL request.",
          )
          .default(LOOKBACK),
        names: z
          .int()
          .min(0)
          .max(NAMES_MAX)
          .describe(
            "How many pull requests and direct pushes a row and a line of Recently deployed name, newest first. The rest is a count. 0 names none and always counts.",
          )
          .default(NAMED_ON_A_ROW),
      })
      .prefault({}),
    // Slice 4.16 (record 0067): deploys in phases, in the order listed.
    phases: z
      .array(phaseName)
      .describe(
        "Names of the phases stacks deploy in, in order. A stack in a phase depends on every stack in every earlier phase.",
      )
      .default([]),
    stacks: stackEntries
      .describe(
        "Settings for stacks that discovery found. An entry never creates a stack, except an entry with tool, which declares one.",
      )
      .default([]),
    // Record 0092: switches for what discovery finds from files without a
    // `stacks` entry. Which switches exist is for the adapters to say, as with
    // a tool and its options, so no tool word is written here (record 0006).
    discovery: z
      .record(z.string(), z.boolean())
      .describe(
        "Switches for what discovery finds on its own. See the configuration reference for the keys.",
      )
      .default({}),
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
        // Slice 5.4 (record 0071): one extra preview per listed update.
        preview: z
          .boolean()
          .describe(
            "Preview the branch of each update waiting to merge, and show what it would change on its row. One extra preview per update on every scan that lists it.",
          )
          .default(false),
      })
      .prefault({}),
    // Slice 5.13 (record 0078): the events the built-in notifications send
    // on. The channels are inputs of the step, from the repo's secrets, so a
    // secret never sits in this file.
    notify: z
      .strictObject({
        events: z
          .array(z.enum(NOTIFY_EVENTS))
          .transform((events) => [...new Set(events)])
          .describe(
            "The events a notification is sent on, to each channel the step's inputs name: pending (stacks newly pending after a scan), drift (stacks newly drifted), deployed, failed and refused (a tick that deployed nothing).",
          )
          .default([...DEFAULT_NOTIFY_EVENTS]),
      })
      .prefault({}),
  })
  .superRefine((config, context) => {
    config.phases.forEach((phase, index) => {
      const first = config.phases.indexOf(phase);
      if (first !== index)
        refuse(context, { kind: "phase-named-twice", phase, first }, ["phases", index]);
    });
    config.stacks.forEach((entry, index) => {
      if (typeof entry.phase !== "string" || config.phases.includes(entry.phase)) return;
      refuse(context, { kind: "unknown-phase", phase: entry.phase, phases: config.phases }, [
        "stacks",
        index,
        "phase",
      ]);
    });
  });

export type Config = z.output<typeof configSchema>;

// What is wrong with a config file, as facts and never as words. The words a
// person reads are render/config-problems.ts's, so a rule and its wording
// change apart. `path` is where in the file, down to the key it is about. The
// file as a whole is [].
export type ConfigIssue = WhatIsWrong & { path: PropertyKey[] };

export type WhatIsWrong =
  // The file itself.
  | { kind: "not-yaml"; line: number; column: number; detail: string }
  | { kind: "two-config-files"; files: readonly string[] }
  | { kind: "not-a-file" }
  // Its shape, as the schema checks it. Where a key was not found, `path`
  // is the mapping it is in.
  | { kind: "unknown-key"; key: string; known: string[] }
  | { kind: "drift-schedule" }
  | { kind: "notify-unknown-key"; key: string; known: string[] }
  | { kind: "reserved-key"; key: string }
  | { kind: "required-stack-path" }
  | { kind: "required-ignore-reason"; glob: unknown }
  | { kind: "required-ignore-glob" }
  | { kind: "not-a-count"; counts: string; min: number; max?: number; value: unknown }
  | { kind: "not-an-ignore-entry"; value: unknown }
  | { kind: "not-a-depends-on"; value: unknown; auto: string }
  | { kind: "not-a-phase"; value: unknown }
  | { kind: "stack-drift-not-a-mapping"; value: unknown }
  | { kind: "not-a-tick-rule"; value: unknown }
  | { kind: "not-an-event"; value: unknown; events: readonly string[] }
  | { kind: "not-a-deploy-trigger"; value: unknown }
  | { kind: "not-a-phase-name"; value: unknown }
  | { kind: "not-a-login"; value: unknown }
  | { kind: "not-a-time-zone"; value: unknown }
  | { kind: "a-team"; value: unknown }
  | { kind: "not-a-username"; value: unknown }
  | { kind: "no-tickers" }
  | { kind: "empty-stack-path" }
  | { kind: "empty" }
  | { kind: "wrong-type"; expected: string; value: unknown }
  | { kind: "backslash-in-path"; value: string }
  | { kind: "absolute-path"; value: string }
  | { kind: "path-leaves-repo"; value: string }
  | { kind: "option-without-tool"; option: string }
  | { kind: "same-entry"; first: number; stackId: string }
  | { kind: "phase-named-twice"; phase: string; first: number }
  | { kind: "unknown-phase"; phase: string; phases: readonly string[] }
  // Against the stacks discovery found.
  | { kind: "id-covers-no-stack"; id: string }
  | { kind: "id-covers-stacks"; stackIds: string[] }
  | { kind: "id-given-twice"; stackId: string; id: string }
  | { kind: "id-taken"; id: string }
  | { kind: "entry-only-ignored"; stackIds: string[] }
  | { kind: "entry-no-stack"; stackPath: string }
  | { kind: "entry-no-named-stack"; name: string; stackPath: string; names: string[] }
  | { kind: "no-phase-key"; stackId: string; key: string }
  | { kind: "phase-key-unknown"; stackId: string; key: string; phases: readonly string[] }
  | { kind: "depends-on-ignored"; stackId: string; reason?: string }
  | { kind: "depends-on-unknown"; stackId: string; example?: string }
  | { kind: "depends-on-itself"; stackId: string }
  | {
      kind: "depends-on-earlier-phase";
      stackId: string;
      phase: string;
      stack: string;
      stackPhase: string;
    }
  | { kind: "depends-on-circle"; circle: CircleStep[] }
  // Words another module chose: an adapter's, show-values', or the schema
  // library's for an issue no rule here foresees.
  | { kind: "worded"; text: string };

// One stop on a dependsOn circle. A phase is a stop of its own, so a circle
// through one names the phase and not every stack in it (record 0067).
export type CircleStep = { stack: string } | { phase: string };

// A config file that cannot be used. It holds every problem found, not only
// the first, so a person fixes the file in one go. `problems` are the issues
// in words, in the same order.
export class ConfigError extends Error {
  readonly issues: ConfigIssue[];
  readonly problems: string[];

  // A string is a problem already in words, such as an adapter's. `file` is
  // the name of the config file, sluiceway.yaml unless the repo uses the
  // second spelling (slice 5.9).
  constructor(issues: readonly (ConfigIssue | string)[], file = "sluiceway.yaml") {
    const all = issues.map(
      (issue): ConfigIssue =>
        typeof issue === "string" ? { kind: "worded", text: issue, path: [] } : issue,
    );
    const problems = all.map(configProblemText);
    super(configErrorText(file, problems));
    this.name = "ConfigError";
    this.issues = all;
    this.problems = problems;
  }
}

// Takes the text of sluiceway.yaml, or undefined when the repo has no such
// file. The file is optional, so no text and an empty file both give defaults.
export function parseConfig(text: string | undefined): Config {
  const raw = text === undefined ? null : readYaml(text);
  const result = configSchema.safeParse(raw ?? {});
  if (!result.success) {
    const found = result.error.issues.flatMap((issue) => classify(issue, raw));
    throw new ConfigError(inFileOrder(found, raw).map((one) => one.issue));
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
        return { kind: "not-yaml", line, column: col, detail: error.message, path: [] };
      }),
    );
  }
  return document.toJS();
}

// A check written in this file refuses with the facts, and classify hands
// them on as they are.
function refuse(context: z.RefinementCtx, wrong: WhatIsWrong, path?: PropertyKey[]): void {
  context.addIssue({
    code: "custom",
    ...(path === undefined ? {} : { path }),
    params: { wrong },
  });
}

type Issue = z.core.$ZodIssue;

interface Found {
  issue: ConfigIssue;
  // Where it sorts in the file: an unknown key sorts as the key itself.
  at: PropertyKey[];
}

// What a schema library issue means for sluiceway.yaml. The library's own
// words never reach a person, except for an issue no rule here foresees.
function classify(issue: Issue, raw: unknown): Found[] {
  const path = issue.path;
  const value = valueAt(raw, path);
  const one = (wrong: WhatIsWrong): Found[] => [{ issue: { ...wrong, path }, at: path }];
  const inner = (branch: number): Found[] =>
    issue.code === "invalid_union"
      ? (issue.errors[branch] ?? []).flatMap((error) =>
          classify({ ...error, path: [...path, ...error.path] }, raw),
        )
      : [];
  const key = path.at(-1);
  if (issue.code === "unrecognized_keys") {
    const known = knownKeys(path);
    const unknown = (name: string): WhatIsWrong => {
      if (path.length === 1 && path[0] === "drift" && name === "schedule")
        return { kind: "drift-schedule" };
      if (path.length === 1 && path[0] === "notify")
        return { kind: "notify-unknown-key", key: name, known };
      if (path.length > 0 && RESERVED_KEYS.includes(name))
        return { kind: "reserved-key", key: name };
      return { kind: "unknown-key", key: name, known };
    };
    return issue.keys.map((name) => ({
      issue: { ...unknown(name), path },
      at: [...path, name],
    }));
  }
  if (value === undefined && key === "path") return one({ kind: "required-stack-path" });
  if (path[0] === "ignore" && path.length === 3) {
    const glob = valueAt(raw, [...path.slice(0, -1), "glob"]);
    if (value === undefined && key === "reason")
      return one({ kind: "required-ignore-reason", glob });
    if (value === undefined && key === "glob") return one({ kind: "required-ignore-glob" });
  }
  if (key === "recentlyDeployed" && path[0] === "dashboard") {
    return one({ kind: "not-a-count", counts: "lines", min: 0, max: RECENTLY_DEPLOYED_MAX, value });
  }
  if (key === "lookback" && path[0] === "attribution") {
    return one({ kind: "not-a-count", counts: "commits", min: 1, max: LOOKBACK_MAX, value });
  }
  if (key === "names" && path[0] === "attribution") {
    return one({ kind: "not-a-count", counts: "names", min: 0, max: NAMES_MAX, value });
  }
  if (key === "previewTimeout" && issue.code !== "custom") {
    return one({ kind: "not-a-count", counts: "minutes", min: 1, value });
  }
  // An `ignore` entry is text or a mapping, and each kind has its own issues.
  if (issue.code === "invalid_union" && path[0] === "ignore") {
    const branch = typeof value === "string" ? 0 : isMapping(value) ? 1 : undefined;
    return branch === undefined ? one({ kind: "not-an-ignore-entry", value }) : inner(branch);
  }
  if (issue.code === "invalid_union" && key === "dependsOn") {
    return Array.isArray(value)
      ? inner(1)
      : one({ kind: "not-a-depends-on", value, auto: DEPENDS_ON_AUTO });
  }
  if (issue.code === "invalid_union" && key === "phase") {
    return isMapping(value) ? inner(1) : one({ kind: "not-a-phase", value });
  }
  if (issue.code === "invalid_type" && key === "drift" && path[0] === "stacks") {
    return one({ kind: "stack-drift-not-a-mapping", value });
  }
  // The other union in the schema is the tick rule.
  if (issue.code === "invalid_union") {
    return Array.isArray(value) ? inner(1) : one({ kind: "not-a-tick-rule", value });
  }
  if (key === "deploy" && path[0] === "stacks") {
    return one({ kind: "not-a-deploy-trigger", value });
  }
  if (issue.code === "invalid_value" && path[0] === "notify") {
    return one({ kind: "not-an-event", value, events: NOTIFY_EVENTS });
  }
  if (issue.code === "invalid_format" && (path[0] === "phases" || key === "phase")) {
    return one({ kind: "not-a-phase-name", value });
  }
  if (issue.code === "invalid_format" && path[0] === "mergeAndDeploy") {
    return one({ kind: "not-a-login", value });
  }
  // The other pattern in the schema is the username.
  if (issue.code === "invalid_format") {
    return one(
      String(value).includes("/") ? { kind: "a-team", value } : { kind: "not-a-username", value },
    );
  }
  if (issue.code === "too_small") {
    return one(
      issue.origin === "array"
        ? { kind: "no-tickers" }
        : key === "path"
          ? { kind: "empty-stack-path" }
          : { kind: "empty" },
    );
  }
  if (issue.code === "invalid_type") {
    return one({ kind: "wrong-type", expected: issue.expected, value });
  }
  // What is left are the checks written in this file, with their facts.
  const wrong = issue.code === "custom" ? issue.params?.wrong : undefined;
  return one(wrong === undefined ? { kind: "worded", text: issue.message } : wrong);
}

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

// Issues are listed top to bottom as the file has them, whatever order the
// schema library found them in.
function inFileOrder(found: Found[], raw: unknown): Found[] {
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
  return found
    .map((one) => ({ one, position: position(one.at) }))
    .sort((a, b) => compare(a.position, b.position))
    .map(({ one }) => one);
}

// Keys of features that are planned and not in v1. They fail with their own
// message and are never ignored (build-plan.md, section 3). None is reserved
// now: `drift` on a stack arrived with record 0059.
const RESERVED_KEYS: string[] = [];

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
    inner = inner.unwrap();
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

// The stacks discovery found, with the id a `stacks` entry gives one of them
// (slice 5.9). An entry gives an id to exactly one stack, and every stack id
// stays unique, derived or given. Runs right after discovery, so ignore,
// dependsOn, the rows and the deployment records all see the id it gives.
export function withIds(config: Config, found: Stack[]): Stack[] {
  const given = new Map<Stack, string>();
  const issues: ConfigIssue[] = [];
  config.stacks.forEach((entry, index) => {
    if (entry.id === undefined) return;
    const path = ["stacks", index, "id"];
    const covered = found.filter((stack) => covers(entry, stack));
    const [only] = covered;
    if (only === undefined) {
      issues.push({ kind: "id-covers-no-stack", id: entry.id, path });
    } else if (covered.length > 1) {
      issues.push({ kind: "id-covers-stacks", stackIds: covered.map(stackId), path });
    } else if (given.has(only)) {
      issues.push({
        kind: "id-given-twice",
        stackId: stackId(only),
        id: given.get(only) ?? "",
        path,
      });
    } else {
      given.set(only, entry.id);
    }
  });
  const taken = new Set(found.filter((stack) => !given.has(stack)).map(stackId));
  config.stacks.forEach((entry, index) => {
    if (entry.id === undefined || ![...given.values()].includes(entry.id)) return;
    if (taken.has(entry.id)) {
      issues.push({ kind: "id-taken", id: entry.id, path: ["stacks", index, "id"] });
    }
    taken.add(entry.id);
  });
  if (issues.length > 0) throw new ConfigError(once(issues));
  return found.map((stack) => {
    const id = given.get(stack);
    return id === undefined ? stack : { ...stack, id };
  });
}

// Each issue once, in the order first found.
function once(issues: ConfigIssue[]): ConfigIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = JSON.stringify(issue);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
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
  // Its phase (record 0067). Absent when it is in none. `dependsOn` then
  // holds every stack of every earlier phase as well.
  phase?: string;
  // The key of the tool's own file the phase was read from, when it was.
  phaseFrom?: string;
  // `drift.enabled` of its stack entries (record 0059). Absent when no entry
  // sets it, and the top level decides.
  drift?: boolean;
  // `deploy: on-merge` of its stack entries (record 0095). Absent for a stack
  // that deploys on a tick, the default, so nothing changes for a repo that
  // does not use it.
  deploy?: "on-merge";
}

const DEFAULT_ENVIRONMENT = "sluiceway";

// Takes the stacks an adapter found, drops the ignored ones, and lays the
// stacks entries over the rest. An entry with a name sets one stack, an entry
// without covers every stack in its path, and the entry with a name wins key by
// key. Inputs only ever add up (record 0010). What comes back is every stack
// that exists for Sluiceway, so no caller can forget ignore.
export function applyConfig(config: Config, found: Stack[]): ConfiguredStack[] {
  const stacks = knownStacks(found, config.ignore.map(ignoreGlob));
  const misses = config.stacks.flatMap((entry, index): ConfigIssue[] => {
    const inPath = stacks.filter((stack) => stack.path === entry.path);
    if (inPath.some((stack) => covers(entry, stack))) return [];
    const ignored = found.filter((stack) => covers(entry, stack));
    return [{ ...miss(entry, inPath, ignored), path: ["stacks", index] }];
  });
  if (misses.length > 0) throw new ConfigError(misses);
  const phases = phasesOf(config, stacks);
  if (phases.issues.length > 0) throw new ConfigError(phases.issues);
  const dependencyIssues = checkDependsOn(config, found, stacks, phases.phaseOf);
  if (dependencyIssues.length > 0) throw new ConfigError(dependencyIssues);
  const derived = phaseDependencies(config.phases, phases.phaseOf);

  return stacks.map((stack) => {
    const entries = entriesOf(config, stack);
    const id = stackId(stack);
    const previewTimeout = entries.findLast((entry) => entry.previewTimeout)?.previewTimeout;
    const drift = entries.findLast((entry) => entry.drift)?.drift?.enabled;
    const deploy = entries.findLast((entry) => entry.deploy)?.deploy;
    const phase = phases.phaseOf.get(id);
    const from = phases.from.get(id);
    return {
      stack,
      environment:
        entries.findLast((entry) => entry.environment)?.environment ?? DEFAULT_ENVIRONMENT,
      tickers: entries.findLast((entry) => entry.tickers)?.tickers ?? config.tickers,
      inputs: [...new Set(entries.flatMap((entry) => entry.inputs ?? []))],
      ...(previewTimeout === undefined ? {} : { previewTimeout }),
      ...dependsOnOf(entries, derived.get(id)),
      ...(phase === undefined ? {} : { phase }),
      ...(from === undefined ? {} : { phaseFrom: from }),
      ...(entries.some((entry) => entry.dependsOn === DEPENDS_ON_AUTO)
        ? { dependsOnAuto: true as const }
        : {}),
      ...(drift === undefined ? {} : { drift }),
      ...(deploy === "on-merge" ? { deploy } : {}),
    };
  });
}

// The entries that cover a stack, the ones without a name first, so the
// last one that sets a key wins.
function entriesOf(config: Config, stack: Stack): StackEntry[] {
  return config.stacks
    .filter((entry) => covers(entry, stack))
    .sort((a, b) => Number(a.name !== undefined) - Number(b.name !== undefined));
}

// Like inputs, dependencies only ever add up, and a phase adds every stack of
// every earlier phase (record 0067).
function dependsOnOf(
  entries: StackEntry[],
  fromPhases: readonly string[] = [],
): { dependsOn?: string[] } {
  const ids = [
    ...new Set([...entries.flatMap((entry) => listed(entry.dependsOn)), ...fromPhases]),
  ].sort(byCodeUnit);
  return ids.length === 0 ? {} : { dependsOn: ids };
}

// The phase of every stack in one (record 0067): the entry with a name wins
// over one without, as for environment. With `from`, the phase is the text
// discovery read under that key of the stack's own file. Its value is not
// quoted back when it names no phase: it is a value of the tool's file.
function phasesOf(
  config: Config,
  stacks: Stack[],
): { phaseOf: Map<string, string>; from: Map<string, string>; issues: ConfigIssue[] } {
  const phaseOf = new Map<string, string>();
  const from = new Map<string, string>();
  const issues: ConfigIssue[] = [];
  for (const stack of stacks) {
    const entry = entriesOf(config, stack).findLast((one) => one.phase !== undefined);
    if (entry?.phase === undefined) continue;
    const id = stackId(stack);
    if (typeof entry.phase === "string") {
      phaseOf.set(id, entry.phase);
      continue;
    }
    const path = ["stacks", config.stacks.indexOf(entry), "phase"];
    const key = entry.phase.from;
    const read = stack.phaseKeys?.[key];
    if (read === undefined) {
      issues.push({ kind: "no-phase-key", stackId: id, key, path });
    } else if (!config.phases.includes(read)) {
      issues.push({ kind: "phase-key-unknown", stackId: id, key, phases: config.phases, path });
    } else {
      phaseOf.set(id, read);
      from.set(id, key);
    }
  }
  return { phaseOf, from, issues: once(issues) };
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
function checkDependsOn(
  config: Config,
  found: Stack[],
  stacks: Stack[],
  phaseOf: ReadonlyMap<string, string>,
): ConfigIssue[] {
  const known = new Set(stacks.map(stackId));
  const all = new Set(found.map(stackId));
  const issues = config.stacks.flatMap((entry, index) =>
    listed(entry.dependsOn).flatMap((id, at): ConfigIssue[] => {
      const path = ["stacks", index, "dependsOn", at];
      if (all.has(id) && !known.has(id)) {
        // The reason the ignore entry gives, when it gives one (record 0059).
        const reason = ignoredStacks(config, found).find((one) => one.stackId === id)?.reason;
        return [
          {
            kind: "depends-on-ignored",
            stackId: id,
            ...(reason === undefined ? {} : { reason }),
            path,
          },
        ];
      }
      if (!known.has(id)) {
        const example = stacks[0] ? stackId(stacks[0]) : undefined;
        return [
          {
            kind: "depends-on-unknown",
            stackId: id,
            ...(example === undefined ? {} : { example }),
            path,
          },
        ];
      }
      const self = stacks.find((stack) => stackId(stack) === id);
      if (self && covers(entry, self)) return [{ kind: "depends-on-itself", stackId: id, path }];
      // A stack of a later phase already waits on this one (record 0067).
      const earlier = stacks
        .filter((stack) => covers(entry, stack))
        .map(stackId)
        .sort(byCodeUnit)
        .find((one) => throughPhase(config.phases, phaseOf, id, one));
      if (earlier !== undefined)
        return [
          {
            kind: "depends-on-earlier-phase",
            stackId: id,
            phase: phaseOf.get(id) ?? "",
            stack: earlier,
            stackPhase: phaseOf.get(earlier) ?? "",
            path,
          },
        ];
      return [];
    }),
  );
  if (issues.length > 0) return issues;

  // A phase is a node of its own, so a circle through one names the phase
  // and not every stack in it (record 0067).
  const edges = new Map<string, string[]>();
  for (const stack of stacks) {
    const id = stackId(stack);
    const at = config.phases.indexOf(phaseOf.get(id) ?? "");
    const earlierPhases = at === -1 ? [] : config.phases.slice(0, at).map(phaseNode);
    edges.set(id, [...(dependsOnOf(entriesOf(config, stack)).dependsOn ?? []), ...earlierPhases]);
  }
  for (const phase of config.phases) {
    edges.set(
      phaseNode(phase),
      [...phaseOf].flatMap(([id, one]) => (one === phase ? [id] : [])),
    );
  }
  return dependencyCircles(edges).map((circle) => ({
    kind: "depends-on-circle",
    circle: circle.map((node) =>
      isPhaseNode(node) ? { phase: phaseOfNode(node) } : { stack: node },
    ),
    path: [],
  }));
}

// A phase in the graph of the circle check. The prefix sorts after every
// stack id, so a circle is never told from a phase.
const PHASE_NODE = "\uffff";
const phaseNode = (phase: string) => `${PHASE_NODE}${phase}`;
const isPhaseNode = (node: string) => node.startsWith(PHASE_NODE);
const phaseOfNode = (node: string) => node.slice(PHASE_NODE.length);

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

// Why an entry covers no stack that exists for Sluiceway.
function miss(entry: StackEntry, inPath: Stack[], ignored: Stack[]): WhatIsWrong {
  if (ignored.length > 0) return { kind: "entry-only-ignored", stackIds: ignored.map(stackId) };
  if (entry.name === undefined || inPath.length === 0) {
    return { kind: "entry-no-stack", stackPath: entry.path };
  }
  return {
    kind: "entry-no-named-stack",
    name: entry.name,
    stackPath: entry.path,
    names: inPath.flatMap((stack) => (stack.name === undefined ? [] : [stack.name])),
  };
}
