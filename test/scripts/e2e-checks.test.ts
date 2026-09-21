import { describe, expect, test } from "bun:test";
import {
  checkFullScan,
  checkNarrowedScan,
  type Expected,
  type Observed,
} from "../../scripts/e2e/checks.ts";

// The checks of the e2e run are code too, and a check that cannot fail proves
// nothing. Each test here hands them something wrong and wants it named.

const SHA = "0123456789abcdef0123456789abcdef01234567";
const NEXT_SHA = "89abcdef0123456789abcdef0123456789abcdef";

function row(stack: string, state: string, more = ""): string {
  return `- [ ] **${stack}** <!-- sluiceway:row stack="${stack}" state="${state}"${more} -->\n  <!-- /sluiceway:row -->`;
}

function body(rows: string[], root: Record<string, string> = {}): string {
  const facts = {
    "scan-sha": SHA,
    "scan-run": "1",
    "scan-at": "2026-09-21T06:00:00.000Z",
    "full-scan-at": "2026-09-21T06:00:00.000Z",
    "full-scan-run": "1",
    ...root,
  };
  const marker = Object.entries(facts)
    .map(([key, value]) => `${key}="${value}"`)
    .join(" ");
  return [
    `<!-- sluiceway:dashboard v="1" ${marker} -->`,
    `<img src="https://raw.githubusercontent.com/sluiceway/sluiceway/${SHA}/assets/mascot/pending-2-light.svg">`,
    ...rows,
    "- [ ] Rescan all stacks <!-- sluiceway:rescan -->",
  ].join("\n");
}

const ROWS = [
  row("app:prod", "pending", ' hash="6f5afda2b3712163"'),
  row("network:dev", "pending", ' hash="05bf4ba5424cef76"'),
  row("network:prod", "in-sync"),
  row("site:prod", "pending", ' hash="1111111111111111"'),
];

const EXPECTED: Expected = {
  rows: {
    "app:prod": "pending",
    "network:dev": "pending",
    "network:prod": "in-sync",
    "site:prod": "pending",
  },
  label: "sluiceway",
  title: "Sluiceway dashboard",
  sha: SHA,
  actionRef: SHA,
  secrets: ["CANARY-VALUE", "CANARY-SECRET"],
};

const FULL_LOG = [
  "Found 4 stacks.",
  "This is a full scan. A push gives a narrowed scan, and this one fell back to a full scan: the dashboard does not exist yet.",
  "Previewing 4 stacks with a pool of 4 and a time limit of 10 minutes for each preview.",
  "Previewed app:prod in 1.0 s: pending",
  "Previewed network:dev in 1.0 s: pending",
  "Previewed network:prod in 1.0 s: in sync",
  "Previewed site:prod in 1.0 s: pending",
  "Previewed 4 stacks in 1.2 s with a pool of 4. Added up, the previews took 4.0 s. The slowest was app:prod with 1.0 s.",
  "Created the dashboard: https://github.com/acme/infra/issues/1 (1,234 of 65,536 characters).",
  "The scan made 6 requests to the GitHub API. GitHub allows the workflow token at least 1,000 an hour in a repo.",
].join("\n");

function observed(over: Partial<Observed> = {}): Observed {
  return {
    exitCode: 0,
    log: FULL_LOG,
    summary: "## Sluiceway scan\n\n4 stacks previewed",
    issues: [
      {
        number: 1,
        state: "open",
        title: "Sluiceway dashboard",
        labels: ["sluiceway"],
        author: { login: "github-actions[bot]", type: "Bot" },
        body: body(ROWS),
      },
    ],
    pinned: [1],
    requests: ["listIssues", "listIssues", "createIssue", "pinIssue", "getIssue", "walkCommits"],
    ...over,
  };
}

function withBody(text: string): Observed {
  const seen = observed();
  return { ...seen, issues: seen.issues.map((issue) => ({ ...issue, body: text })) };
}

describe("the checks of a full scan", () => {
  test("a scan that did everything right has no problems", () => {
    expect(checkFullScan(observed(), EXPECTED)).toEqual([]);
  });

  test("a red job is a problem", () => {
    expect(checkFullScan(observed({ exitCode: 1 }), EXPECTED)).toEqual([
      "The scan ended with exit code 1, expected 0.",
    ]);
  });

  test("a second dashboard, a dashboard by a person and a dashboard that is not pinned are problems", () => {
    const seen = observed();
    const [first] = seen.issues;
    if (!first) throw new Error("unreachable");
    expect(checkFullScan({ ...seen, issues: [first, { ...first, number: 2 }] }, EXPECTED)).toEqual([
      "Expected one open issue, found 2.",
    ]);
    expect(
      checkFullScan(
        { ...seen, issues: [{ ...first, author: { login: "alice", type: "User" } }] },
        EXPECTED,
      ),
    ).toEqual(['The dashboard was written by alice (User), expected "github-actions[bot]" (Bot).']);
    expect(checkFullScan({ ...seen, pinned: [] }, EXPECTED)).toEqual([
      "The dashboard is not pinned.",
    ]);
  });

  test("a missing row, a row too many and a row in another state are problems", () => {
    const rows = [...ROWS.slice(1), row("playground:dev", "pending")];
    rows[1] = row("network:prod", "pending");
    expect(checkFullScan(withBody(body(rows)), EXPECTED)).toEqual([
      "The dashboard has no row for app:prod.",
      "The row of network:prod is in state pending, expected in-sync.",
      "The dashboard has a row for playground:dev, which nothing expects.",
    ]);
  });

  test("a stack with two rows is a problem", () => {
    expect(checkFullScan(withBody(body([...ROWS, ROWS[0] ?? ""])), EXPECTED)).toEqual([
      "The dashboard has 2 rows for app:prod.",
    ]);
  });

  test("a value that must never show is a problem wherever it shows", () => {
    expect(checkFullScan(withBody(`${body(ROWS)}\nCANARY-VALUE`), EXPECTED)).toEqual([
      "The dashboard holds CANARY-VALUE.",
    ]);
    expect(checkFullScan(observed({ summary: "CANARY-SECRET" }), EXPECTED)).toEqual([
      "The summary holds CANARY-SECRET.",
    ]);
    expect(
      checkFullScan(
        observed({ log: `${FULL_LOG}\n::warning title=Preview failed::CANARY-VALUE` }),
        EXPECTED,
      ),
    ).toEqual(["An annotation holds CANARY-VALUE."]);
  });

  test("an image from another ref than the action's own is a problem", () => {
    expect(checkFullScan(observed(), { ...EXPECTED, actionRef: NEXT_SHA })).toEqual([
      `An image comes from the ref ${SHA}, expected ${NEXT_SHA}.`,
    ]);
  });

  test("a root marker with another commit, an empty summary and a log without its lines are problems", () => {
    expect(checkFullScan(withBody(body(ROWS, { "scan-sha": NEXT_SHA })), EXPECTED)).toEqual([
      `The root marker has scan-sha="${NEXT_SHA}", expected "${SHA}".`,
    ]);
    expect(checkFullScan(observed({ summary: "" }), EXPECTED)).toEqual(["The summary is empty."]);
    expect(checkFullScan(observed({ log: "Found 4 stacks." }), EXPECTED)).toEqual([
      'The job log has no line that starts with "The scan made 6 requests to the GitHub API.".',
      'The job log has no line that starts with "This is a full scan".',
      'The job log has no line that starts with "Previewed 4 stacks in ".',
      'The job log has no line that starts with "Previewed app:prod in ".',
      'The job log has no line that starts with "Previewed network:dev in ".',
      'The job log has no line that starts with "Previewed network:prod in ".',
      'The job log has no line that starts with "Previewed site:prod in ".',
    ]);
  });

  test("a request count in the log that is not what GitHub saw is a problem", () => {
    expect(checkFullScan(observed({ requests: ["listIssues"] }), EXPECTED)).toEqual([
      'The job log has no line that starts with "The scan made 1 request to the GitHub API.".',
    ]);
  });
});

describe("the checks of a narrowed scan", () => {
  const before = body(ROWS);
  const after = body([row("app:prod", "in-sync"), ...ROWS.slice(1)], {
    "scan-sha": NEXT_SHA,
    "scan-run": "2",
    "scan-at": "2026-09-21T06:05:00.000Z",
  });
  const expected: Expected = {
    ...EXPECTED,
    sha: NEXT_SHA,
    rows: { ...EXPECTED.rows, "app:prod": "in-sync" },
  };
  const log = [
    "Found 4 stacks.",
    "This is a narrowed scan: it previews 1 of 4 stacks and keeps the rows of the other 3 as they are.",
    "app:prod is previewed: it claims shared/motd.txt.",
    "Previewed app:prod in 1.0 s: in sync",
    "Previewed 1 stack in 1.0 s with a pool of 4. Added up, the previews took 1.0 s. The slowest was app:prod with 1.0 s.",
    "The scan made 6 requests to the GitHub API. GitHub allows the workflow token at least 1,000 an hour in a repo.",
  ].join("\n");
  const narrowed = { previewed: ["app:prod"], before };

  test("a scan that swapped one row and kept the rest has no problems", () => {
    expect(checkNarrowedScan({ ...withBody(after), log }, expected, narrowed)).toEqual([]);
  });

  test("a carried row that changed by one character is a problem", () => {
    const changed = after.replace('hash="05bf4ba5424cef76"', 'hash="05bf4ba5424cef77"');
    expect(checkNarrowedScan({ ...withBody(changed), log }, expected, narrowed)).toEqual([
      "The row of network:dev was not carried through byte for byte.",
    ]);
  });

  test("a full scan time that moved is a problem", () => {
    const moved = after.replace(
      'full-scan-at="2026-09-21T06:00:00.000Z"',
      'full-scan-at="2026-09-21T06:05:00.000Z"',
    );
    expect(checkNarrowedScan({ ...withBody(moved), log }, expected, narrowed)).toEqual([
      'The root marker has full-scan-at="2026-09-21T06:05:00.000Z", expected "2026-09-21T06:00:00.000Z" carried through.',
    ]);
  });

  test("a preview of a stack the scan should have left alone is a problem", () => {
    const loud = `${log}\nPreviewed site:prod in 1.0 s: pending`;
    expect(checkNarrowedScan({ ...withBody(after), log: loud }, expected, narrowed)).toEqual([
      "The scan previewed site:prod, and it should have previewed only app:prod.",
    ]);
  });

  test("a scan that does not say it is narrowed is a problem", () => {
    const quiet = log.replace("This is a narrowed scan", "This is a full scan");
    expect(checkNarrowedScan({ ...withBody(after), log: quiet }, expected, narrowed)).toEqual([
      'The job log has no line that starts with "This is a narrowed scan: it previews 1 of 4 stacks".',
    ]);
  });
});
