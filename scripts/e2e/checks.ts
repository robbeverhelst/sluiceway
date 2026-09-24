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

// A check run on the scanned commit after the step (record 0050).
export interface ObservedPage {
  name: string;
  htmlUrl: string;
  // Its title, summary and text.
  output: string;
  // Created or changed by this step.
  written: boolean;
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
  // Every request the fake GitHub answered during the step, by port method.
  requests: string[];
  // Every check run on the scanned commit, older runs of one name included.
  pages: ObservedPage[];
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

// One preview page per pending or drifted stack this scan previewed, written by this
// scan, never a second one of the same name, none for any other stack, and
// the row's preview link lands on it (record 0050).
function checkPages(
  observed: Observed,
  expected: Expected,
  rows: Map<string, { state: string; block: string }[]>,
  previewed: string[],
): string[] {
  const problems: string[] = [];
  for (const [stack, state] of Object.entries(expected.rows)) {
    const name = `sluiceway / ${stack}`;
    const all = observed.pages.filter((page) => page.name === name);
    const written = all.filter((page) => page.written);
    if ((state !== "pending" && state !== "drift") || !previewed.includes(stack)) {
      if (written.length > 0) problems.push(`The scan wrote a preview page for ${stack}.`);
      continue;
    }
    if (all.length > 1) {
      problems.push(`The commit has ${all.length} preview pages for ${stack}, expected 1.`);
    }
    const [page] = written;
    if (!page) {
      problems.push(`The scan wrote no preview page for ${stack}.`);
      continue;
    }
    // A missing row is named above.
    const block = rows.get(stack)?.[0]?.block;
    if (block !== undefined && !block.includes(`[preview](${page.htmlUrl})`)) {
      problems.push(`The preview link of ${stack} does not land on its page ${page.htmlUrl}.`);
    }
  }
  return problems;
}

function checkScan(observed: Observed, expected: Expected, previewed: string[]): string[] {
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
  const refs = new Set([...imageRefs].map((match) => match[1]));
  if (refs.size === 0) {
    problems.push(
      `The dashboard shows no header image, expected one from the ref ${expected.actionRef}.`,
    );
  }
  for (const ref of refs) {
    if (ref !== expected.actionRef) {
      problems.push(`An image comes from the ref ${ref}, expected ${expected.actionRef}.`);
    }
  }

  if (observed.summary.trim() === "") problems.push("The summary is empty.");
  problems.push(...checkPages(observed, expected, rows, previewed));

  // The count the scan logs is taken on the wire, so it has to be the count
  // the fake GitHub saw (record 0017, build plan slice 3.1). On a dispatch the
  // one step of auto mode resolves before it scans (record 0077), and those
  // requests are the step's but not the scan's.
  const requests = observed.requests.length;
  if (observed.log.includes(RESOLVED_FIRST)) {
    const made = Number(
      /The scan made (\d+) requests? to the GitHub API\./.exec(observed.log)?.[1],
    );
    if (!(made > 0 && made <= requests)) {
      problems.push(
        `The scan says it made ${made} requests to the GitHub API, and the step made ${requests}.`,
      );
    }
  } else {
    problems.push(
      ...needLine(
        observed.log,
        `The scan made ${requests} ${requests === 1 ? "request" : "requests"} to the GitHub API.`,
      ),
    );
  }

  // Annotations show on the run's page, outside the job log (record 0022).
  const annotations = observed.log
    .split("\n")
    .filter((line) => /^::(warning|error|notice)/.test(line))
    .join("\n");
  for (const secret of expected.secrets) {
    if (dashboard.body.includes(secret)) problems.push(`The dashboard holds ${secret}.`);
    if (observed.summary.includes(secret)) problems.push(`The summary holds ${secret}.`);
    if (annotations.includes(secret)) problems.push(`An annotation holds ${secret}.`);
    for (const page of observed.pages) {
      if (page.output.includes(secret)) problems.push(`The page ${page.name} holds ${secret}.`);
    }
  }
  return problems;
}

// The stacks the trail lists as deployed outside the dashboard (record 0073),
// read from the markers of the dashboard's lines.
export function checkOutsideDeploys(observed: Observed, stacks: string[]): string[] {
  const body = observed.issues[0]?.body ?? "";
  const found = [...body.matchAll(/<!-- sluiceway:outside stack="([^"]*)"/g)].map(
    (match) => match[1] ?? "",
  );
  return JSON.stringify(found.sort()) === JSON.stringify([...stacks].sort())
    ? []
    : [
        `expected outside deploys of ${stacks.join(", ") || "no stack"} on the trail, found ${found.join(", ") || "none"}.`,
      ];
}

// The line of auto mode that says it resolves before it scans.
const RESOLVED_FIRST = "Sluiceway runs resolve, for the workflow_dispatch event of this run.";

export function checkFullScan(observed: Observed, expected: Expected): string[] {
  const stacks = Object.keys(expected.rows);
  return [
    ...checkScan(observed, expected, stacks),
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
  const problems = checkScan(observed, expected, narrowed.previewed);
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

// The env file of record 0100, on a scan whose step named one: the runner
// was told to mask the value that is long enough before the log said the
// file was loaded, the short one was never masked, and the log named both,
// with why the short one has no mask. The value itself is in `secrets`, so
// the other checks hold it out of the dashboard, the summary and the pages.
export function checkEnvFile(
  log: string,
  file: { path: string; masked: string; unmaskedName: string; unmaskedValue: string },
): string[] {
  const problems: string[] = [];
  const mask = log.indexOf(`::add-mask::${file.masked}`);
  const loaded = log.indexOf(`Loaded the env file ${file.path}`);
  if (mask < 0) problems.push(`The step never masked the value of the env file.`);
  if (loaded < 0) problems.push(`The step never said it loaded ${file.path}.`);
  if (mask >= 0 && loaded >= 0 && mask > loaded) {
    problems.push("The step said it loaded the env file before it masked the value.");
  }
  if (log.includes(`::add-mask::${file.unmaskedValue}`)) {
    problems.push(`The step masked ${file.unmaskedName}, which is too short to mask.`);
  }
  if (!log.includes(`Not masked: ${file.unmaskedName} (shorter than 8 characters).`)) {
    problems.push(`The step did not say that ${file.unmaskedName} got no mask.`);
  }
  return problems;
}
