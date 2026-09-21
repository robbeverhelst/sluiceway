// What the e2e run holds a scan to. Every check reads only what a person could
// read after a real run: the issue on GitHub, the summary and the job log. A
// check gives back its problems in plain words, and an empty list means good.

export interface ObservedIssue {
  number: number;
  state: string;
  title: string;
  labels: string[];
  author: { login: string; type: string };
  body: string;
}

export interface Observed {
  exitCode: number;
  // Everything the step printed.
  log: string;
  // The summary file of the step.
  summary: string;
  issues: ObservedIssue[];
  // Numbers of the pinned issues.
  pinned: number[];
}

export interface Expected {
  // The state of the row of every stack, by stack id. No other row may exist.
  rows: Record<string, string>;
  label: string;
  title: string;
  // The commit the scan ran on.
  sha: string;
  // The ref the images are served from (build plan, section 3).
  actionRef: string;
  // Strings that may never leave the job log's groups (record 0021).
  secrets: string[];
}

export interface Narrowed {
  // The only stacks this scan may preview.
  previewed: string[];
  // The body as the scan found it.
  before: string;
}

const BOT = { login: "github-actions[bot]", type: "Bot" };

// The blocks of the rows by stack id, read the plain way: from the line with
// the opening marker to the line with the closing one.
function rowBlocks(body: string): Map<string, { state: string; block: string }[]> {
  const rows = new Map<string, { state: string; block: string }[]>();
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const open = /<!-- sluiceway:row stack="([^"]*)" state="([^"]*)"/.exec(lines[i] ?? "");
    if (!open) continue;
    const start = i;
    while (i < lines.length && !lines[i]?.includes("<!-- /sluiceway:row -->")) i++;
    const [, stack = "", state = ""] = open;
    rows.set(stack, [
      ...(rows.get(stack) ?? []),
      { state, block: lines.slice(start, i + 1).join("\n") },
    ]);
  }
  return rows;
}

function rootFact(body: string, key: string): string | undefined {
  const root = /<!-- sluiceway:dashboard ([^>]*)-->/.exec(body)?.[1] ?? "";
  return new RegExp(`(?:^| )${key}="([^"]*)"`).exec(root)?.[1];
}

function needLine(log: string, start: string): string[] {
  return log.split("\n").some((line) => line.startsWith(start))
    ? []
    : [`The job log has no line that starts with "${start}".`];
}

function previewedTotal(count: number): string {
  return `Previewed ${count} ${count === 1 ? "stack" : "stacks"} in `;
}

function checkScan(observed: Observed, expected: Expected): string[] {
  const problems: string[] = [];
  if (observed.exitCode !== 0) {
    problems.push(`The scan ended with exit code ${observed.exitCode}, expected 0.`);
  }

  const open = observed.issues.filter((issue) => issue.state === "open");
  const [dashboard] = open;
  if (open.length !== 1 || !dashboard) {
    return [...problems, `Expected one open issue, found ${open.length}.`];
  }
  if (dashboard.title !== expected.title) {
    problems.push(`The dashboard is titled "${dashboard.title}", expected "${expected.title}".`);
  }
  if (!dashboard.labels.includes(expected.label)) {
    problems.push(`The dashboard does not have the label "${expected.label}".`);
  }
  if (dashboard.author.login !== BOT.login || dashboard.author.type !== BOT.type) {
    problems.push(
      `The dashboard was written by ${dashboard.author.login} (${dashboard.author.type}), expected "${BOT.login}" (${BOT.type}).`,
    );
  }
  if (!observed.pinned.includes(dashboard.number)) problems.push("The dashboard is not pinned.");

  const scanSha = rootFact(dashboard.body, "scan-sha");
  if (scanSha !== expected.sha) {
    problems.push(`The root marker has scan-sha="${scanSha}", expected "${expected.sha}".`);
  }

  const rows = rowBlocks(dashboard.body);
  for (const [stack, state] of Object.entries(expected.rows)) {
    const found = rows.get(stack) ?? [];
    if (found.length === 0) problems.push(`The dashboard has no row for ${stack}.`);
    else if (found.length > 1) {
      problems.push(`The dashboard has ${found.length} rows for ${stack}.`);
    } else if (found[0]?.state !== state) {
      problems.push(`The row of ${stack} is in state ${found[0]?.state}, expected ${state}.`);
    }
  }
  for (const stack of rows.keys()) {
    if (!(stack in expected.rows)) {
      problems.push(`The dashboard has a row for ${stack}, which nothing expects.`);
    }
  }

  const imageRefs = dashboard.body.matchAll(
    /https:\/\/raw\.githubusercontent\.com\/[^/\s"]+\/[^/\s"]+\/([^/\s"]+)\/assets\//g,
  );
  for (const ref of new Set([...imageRefs].map((match) => match[1]))) {
    if (ref !== expected.actionRef) {
      problems.push(`An image comes from the ref ${ref}, expected ${expected.actionRef}.`);
    }
  }

  if (observed.summary.trim() === "") problems.push("The summary is empty.");

  // Annotations show on the run's page, outside the job log (record 0022).
  const annotations = observed.log
    .split("\n")
    .filter((line) => /^::(warning|error|notice)/.test(line))
    .join("\n");
  for (const secret of expected.secrets) {
    if (dashboard.body.includes(secret)) problems.push(`The dashboard holds ${secret}.`);
    if (observed.summary.includes(secret)) problems.push(`The summary holds ${secret}.`);
    if (annotations.includes(secret)) problems.push(`An annotation holds ${secret}.`);
  }
  return problems;
}

export function checkFullScan(observed: Observed, expected: Expected): string[] {
  const stacks = Object.keys(expected.rows);
  return [
    ...checkScan(observed, expected),
    ...needLine(observed.log, "This is a full scan"),
    // The timings the owner reads the pool size and the time limit from.
    ...needLine(observed.log, previewedTotal(stacks.length)),
    ...stacks.flatMap((stack) => needLine(observed.log, `Previewed ${stack} in `)),
  ];
}

export function checkNarrowedScan(
  observed: Observed,
  expected: Expected,
  narrowed: Narrowed,
): string[] {
  const problems = checkScan(observed, expected);
  const stacks = Object.keys(expected.rows);
  const count = narrowed.previewed.length;
  problems.push(
    ...needLine(
      observed.log,
      `This is a narrowed scan: it previews ${count} of ${stacks.length} stacks`,
    ),
    ...needLine(observed.log, previewedTotal(count)),
    ...narrowed.previewed.flatMap((stack) => needLine(observed.log, `Previewed ${stack} in `)),
  );
  for (const stack of stacks) {
    if (narrowed.previewed.includes(stack)) continue;
    if (observed.log.split("\n").some((line) => line.startsWith(`Previewed ${stack} in `))) {
      problems.push(
        `The scan previewed ${stack}, and it should have previewed only ${narrowed.previewed.join(", ")}.`,
      );
    }
  }

  const after = observed.issues.find((issue) => issue.state === "open")?.body ?? "";
  const rowsBefore = rowBlocks(narrowed.before);
  const rowsAfter = rowBlocks(after);
  for (const stack of stacks) {
    if (narrowed.previewed.includes(stack)) continue;
    if (rowsBefore.get(stack)?.[0]?.block !== rowsAfter.get(stack)?.[0]?.block) {
      problems.push(`The row of ${stack} was not carried through byte for byte.`);
    }
  }
  for (const key of ["full-scan-at", "full-scan-run"]) {
    const was = rootFact(narrowed.before, key);
    const is = rootFact(after, key);
    if (was !== is) {
      problems.push(`The root marker has ${key}="${is}", expected "${was}" carried through.`);
    }
  }
  return problems;
}
