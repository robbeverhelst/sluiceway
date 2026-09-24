import type { CircleStep, ConfigIssue } from "../core/config.ts";
import { WEEKDAYS } from "../core/deploy-window.ts";

// The words of a config file that cannot be used. The rules that find what is
// wrong are core/config.ts's, and they hand over facts. The wording is ours,
// not the schema library's, so an upgrade of the library cannot change what a
// person reads.

// The whole error: the file, then every problem in it, one per line.
export function configErrorText(file: string, problems: readonly string[]): string {
  return [`${file} is not valid:`, ...problems.map((problem) => `- ${problem}`)].join("\n");
}

// One problem, led by where in the file it is.
export function configProblemText(issue: ConfigIssue): string {
  return `${where(issue.path)}${problemWords(issue)}`;
}

function problemWords(issue: ConfigIssue): string {
  switch (issue.kind) {
    case "not-yaml":
      return `line ${issue.line}, column ${issue.column}: not valid YAML. ${issue.detail}`;
    case "two-config-files":
      return `found both ${issue.files.join(" and ")}. Keep one of them.`;
    case "not-a-file":
      return "it is not a file.";
    case "unknown-key":
      return `unknown key "${issue.key}". Known keys here: ${issue.known.join(", ")}.`;
    case "drift-schedule":
      return `"schedule" is not a key of sluiceway.yaml. A drift check runs in every scan that a schedule starts, so the cron goes in the workflow, under \`on: schedule\`.`;
    case "notify-unknown-key":
      return `unknown key "${issue.key}". Known keys here: ${issue.known.join(", ")}. A channel is an input of the step, from a secret, never a key of sluiceway.yaml.`;
    case "reserved-key":
      return `"${issue.key}" is not in this version of Sluiceway yet. Remove it.`;
    case "required-stack-path":
      return "is required. It is the directory of the stack, relative to the repo root.";
    case "required-ignore-reason":
      return `is required. Say why the stack is left out, or write the glob as text: ${show(issue.glob)}.`;
    case "required-ignore-glob":
      return "is required. It is matched against the stack id.";
    case "not-a-count":
      return issue.max === undefined
        ? `expected a whole number of ${issue.counts}, ${issue.min} or more, got ${show(issue.value)}.`
        : `expected a whole number of ${issue.counts} from ${issue.min} to ${issue.max}, got ${show(issue.value)}.`;
    case "not-an-ignore-entry":
      return `expected a glob as text, or a mapping with glob and reason, got ${show(issue.value)}.`;
    case "not-a-depends-on":
      return `expected a list of stack ids, or ${issue.auto}, got ${show(issue.value)}.`;
    case "not-a-phase":
      return `expected a phase name, or a mapping with from, got ${show(issue.value)}.`;
    case "stack-drift-not-a-mapping":
      return `expected a mapping, got ${show(issue.value)}. Write it as the top level has it: drift: { enabled: ${typeof issue.value === "boolean" ? issue.value : true} }.`;
    case "not-a-tick-rule":
      return `expected "write", "maintain", "admin" or a list of usernames, got ${show(issue.value)}.`;
    case "not-a-deploy-trigger":
      return `expected "on-tick" or "on-merge", got ${show(issue.value)}.`;
    case "not-an-event":
      return `${show(issue.value)} is not an event. The events are: ${issue.events.join(", ")}.`;
    case "not-a-phase-name":
      return `${show(issue.value)} is not a phase name. Use letters, digits, ".", "_" and "-".`;
    case "not-a-login":
      return `${show(issue.value)} is not a GitHub login. Write the login alone, without "@". An app is written with [bot], such as renovate[bot].`;
    case "not-a-time-zone":
      return `${show(issue.value)} is not a time zone. Write an IANA name, such as Europe/Brussels or America/New_York, or leave the key out for UTC.`;
    case "not-a-weekday":
      return `${show(issue.value)} is not a day of the week. Write one of: ${WEEKDAYS.join(", ")}.`;
    case "no-days":
      return "a window needs at least one day of the week.";
    case "not-a-clock-time":
      return `${show(issue.value)} is not a clock time. Write HH:MM on a 24 hour clock in quotes, such as "09:00" or "17:30". "24:00" is the end of the day.`;
    case "window-ends-first":
      return `the window ends at "${issue.to}", which is not after it starts at "${issue.from}". A window over midnight is two windows: one to "24:00" and one from "00:00" on the next day.`;
    case "a-team":
      return `${show(issue.value)} looks like a team. Teams are not supported yet. Use a level ("write", "maintain", "admin") or usernames.`;
    case "not-a-username":
      return `${show(issue.value)} is not a GitHub username. Write the login alone, without "@".`;
    case "no-tickers":
      return "the list is empty, so nobody could tick. Name at least one username or use a level.";
    case "empty-stack-path":
      return 'must not be empty. Use "." for the repo root.';
    case "empty":
      return "must not be empty.";
    case "wrong-type":
      return `expected ${EXPECTED[issue.expected] ?? issue.expected}, got ${show(issue.value)}.`;
    case "backslash-in-path":
      return `${show(issue.value)} must use forward slashes.`;
    case "absolute-path":
      return `${show(issue.value)} must be relative to the repo root.`;
    case "path-leaves-repo":
      return `${show(issue.value)} must stay inside the repo, so ".." is not allowed.`;
    case "option-without-tool":
      return `unknown option ${show(issue.option)}. A stack that discovery finds from its files takes no options. Only an entry with tool takes them.`;
    case "same-entry":
      return `says the same path and name as stacks[${issue.first}] (${show(issue.stackId)}). Put the settings in one entry.`;
    case "phase-named-twice":
      return `${show(issue.phase)} is already phases[${issue.first}]. Each phase is named once.`;
    case "unknown-phase":
      return issue.phases.length === 0
        ? `${show(issue.phase)} is not one of the phases, and sluiceway.yaml has no phases. List them in order at the top: phases: [first, second].`
        : `${show(issue.phase)} is not one of the phases. The phases are: ${issue.phases.join(", ")}.`;
    case "id-covers-no-stack":
      return `the entry covers no stack, so there is nothing to name ${issue.id}.`;
    case "id-covers-stacks":
      return `the entry covers ${issue.stackIds.length} stacks (${issue.stackIds.join(", ")}), and an id names one. Give the entry a name.`;
    case "id-given-twice":
      return `${issue.stackId} already has the id ${issue.id}.`;
    case "id-taken":
      return `${show(issue.id)} is the id of another stack already. Every stack id is unique.`;
    case "entry-only-ignored": {
      const ids = issue.stackIds.map(show).join(", ");
      const subject = issue.stackIds.length === 1 ? `the stack ${ids} is` : `the stacks ${ids} are`;
      return `${subject} left out by ignore, so these settings would do nothing. Remove the entry, or change ignore.`;
    }
    case "entry-no-stack":
      return `no stack was found in ${show(issue.stackPath)}. An entry adds settings to a stack that exists, it never creates one.`;
    case "entry-no-named-stack": {
      const found =
        issue.names.length === 0
          ? "The stack found there has no name."
          : `Found there: ${issue.names.join(", ")}.`;
      return `no stack named ${show(issue.name)} was found in ${show(issue.stackPath)}. ${found}`;
    }
    case "no-phase-key":
      return `${issue.stackId} has no text under ${issue.key} in its project file, under config or at the top level. Add it there, or name the phase here.`;
    case "phase-key-unknown": {
      const known = issue.phases.join(", ");
      return `the text under ${issue.key} in the project file of ${issue.stackId} is not one of the phases. The phases are: ${known === "" ? "none, sluiceway.yaml has no phases" : known}.`;
    }
    case "depends-on-ignored": {
      const why = issue.reason === undefined ? "" : ` (${show(issue.reason)})`;
      return `${show(issue.stackId)} is left out by ignore${why}, so it never has a change to wait for. Remove it here, or change ignore.`;
    }
    case "depends-on-unknown":
      return `${show(issue.stackId)} is not a stack that discovery found. Write the stack id as a row shows it, such as ${show(issue.example ?? "network:dev")}.`;
    case "depends-on-itself":
      return `${show(issue.stackId)} is the stack itself. A stack cannot depend on itself.`;
    case "depends-on-earlier-phase":
      return `${show(issue.stackId)} is in the ${issue.phase} phase, which comes after the ${issue.stackPhase} phase of ${issue.stack}. ${issue.stackId} already waits on every stack of the ${issue.stackPhase} phase, so take this out, or move one of them to another phase.`;
    case "depends-on-circle":
      return `dependsOn goes round in a circle: ${circleText(issue.circle)}. Nothing in a circle could ever deploy first, so take one of these out.`;
    case "worded":
      return issue.text;
  }
}

// "a depends on b, which waits on the late phase, which holds a".
function circleText(circle: readonly CircleStep[]): string {
  const [first, ...rest] = circle;
  const links = rest.map((to, index) => {
    const from = circle[index];
    if ("phase" in to) return `${index === 0 ? "" : "which "}waits on the ${to.phase} phase`;
    if (from !== undefined && "phase" in from) return `which holds ${to.stack}`;
    return `${index === 0 ? "depends on" : "which depends on"} ${to.stack}`;
  });
  return `${first === undefined ? "" : "phase" in first ? first.phase : first.stack} ${links.join(", ")}`;
}

const EXPECTED: Record<string, string> = {
  string: "text",
  boolean: "true or false",
  array: "a list",
  object: "a mapping",
};

// A value from the file, as a person would recognise it. Config holds no
// secrets, so quoting it back is fine.
function show(value: unknown): string {
  if (value === null || value === undefined) return "nothing";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "object") return "a mapping";
  return JSON.stringify(value);
}

// "stacks[0].path: ", or nothing for the top level.
function where(path: readonly PropertyKey[]): string {
  const text = path
    .map((segment) => (typeof segment === "number" ? `[${segment}]` : `.${String(segment)}`))
    .join("")
    .replace(/^\./, "");
  return text === "" ? "" : `${text}: `;
}
