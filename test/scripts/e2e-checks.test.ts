import { describe, expect, test } from "bun:test";
import {
  checkEnvFile,
  checkFullScan,
  checkNarrowedScan,
  type Expected,
  type Observed,
  type ObservedPage,
} from "../../scripts/e2e/checks.ts";

// The checks of the e2e run are code too, and a check that cannot fail proves
// nothing. Each test here hands them something wrong and wants it named.

const SHA = "0123456789abcdef0123456789abcdef01234567";
const NEXT_SHA = "89abcdef0123456789abcdef0123456789abcdef";

// The address of a stack's preview page on the fake (record 0050).
function pageUrl(stack: string): string {
  return `https://github.com/acme/infra/runs/${stack.length}`;
}

function row(stack: string, state: string, more = ""): string {
  const link = state === "pending" ? ` · [preview](${pageUrl(stack)})` : "";
  return `- [ ] **${stack}**${link} <!-- sluiceway:row stack="${stack}" state="${state}"${more} -->\n  <!-- /sluiceway:row -->`;
}

function page(stack: string, written = true): ObservedPage {
  return { name: `sluiceway / ${stack}`, htmlUrl: pageUrl(stack), output: "the diff", written };
}

const PAGES = [page("app:prod"), page("network:dev"), page("site:prod")];

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
    pages: PAGES,
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

  // Without an image the check above has nothing to look at, and a scan that
  // could not tell its own version would pass it.
  test("a dashboard with no header image is a problem", () => {
    const noImage = body(ROWS).replace(/^<img .*\n/m, "");
    expect(checkFullScan(withBody(noImage), EXPECTED)).toEqual([
      `The dashboard shows no header image, expected one from the ref ${SHA}.`,
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

  test("a pending stack without its page, a second page and a page for a stack in sync are problems", () => {
    const pages = [page("network:dev"), page("network:dev", false), page("network:prod")];
    expect(checkFullScan(observed({ pages }), EXPECTED)).toEqual([
      "The scan wrote no preview page for app:prod.",
      "The commit has 2 preview pages for network:dev, expected 1.",
      "The scan wrote a preview page for network:prod.",
      "The scan wrote no preview page for site:prod.",
    ]);
  });

  test("a preview link that does not land on the stack's page is a problem", () => {
    const pages = PAGES.map((one) =>
      one.name === "sluiceway / site:prod" ? { ...one, htmlUrl: pageUrl("x") } : one,
    );
    expect(checkFullScan(observed({ pages }), EXPECTED)).toEqual([
      `The preview link of site:prod does not land on its page ${pageUrl("x")}.`,
    ]);
  });

  test("a value on a page is a problem", () => {
    const pages = [...PAGES.slice(1), { ...page("app:prod"), output: "CANARY-SECRET" }];
    expect(checkFullScan(observed({ pages }), EXPECTED)).toEqual([
      "The page sluiceway / app:prod holds CANARY-SECRET.",
    ]);
  });

  test("a request count in the log that is not what GitHub saw is a problem", () => {
    expect(checkFullScan(observed({ requests: ["listIssues"] }), EXPECTED)).toEqual([
      'The job log has no line that starts with "The scan made 1 request to the GitHub API.".',
    ]);
  });

  // Record 0077: on a dispatch the one step resolves first, and those
  // requests are not the scan's.
  test("after resolve in the same step, the scan's count is its share of the step's", () => {
    const first = `Sluiceway runs resolve, for the workflow_dispatch event of this run.\n${FULL_LOG}`;
    const more = [...observed().requests, "listNewestDeployments"];
    expect(checkFullScan(observed({ log: first, requests: more }), EXPECTED)).toEqual([]);
    expect(checkFullScan(observed({ log: first, requests: ["listIssues"] }), EXPECTED)).toEqual([
      "The scan says it made 6 requests to the GitHub API, and the step made 1.",
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
    expect(checkNarrowedScan({ ...withBody(after), log, pages: [] }, expected, narrowed)).toEqual(
      [],
    );
  });

  test("a page for a stack the scan did not preview is a problem, and a carried page is not", () => {
    const pages = [page("app:prod"), page("network:dev", false)];
    expect(checkNarrowedScan({ ...withBody(after), log, pages }, expected, narrowed)).toEqual([
      "The scan wrote a preview page for app:prod.",
    ]);
  });

  test("a carried row that changed by one character is a problem", () => {
    const changed = after.replace('hash="05bf4ba5424cef76"', 'hash="05bf4ba5424cef77"');
    expect(checkNarrowedScan({ ...withBody(changed), log, pages: [] }, expected, narrowed)).toEqual(
      ["The row of network:dev was not carried through byte for byte."],
    );
  });

  test("a full scan time that moved is a problem", () => {
    const moved = after.replace(
      'full-scan-at="2026-09-21T06:00:00.000Z"',
      'full-scan-at="2026-09-21T06:05:00.000Z"',
    );
    expect(checkNarrowedScan({ ...withBody(moved), log, pages: [] }, expected, narrowed)).toEqual([
      'The root marker has full-scan-at="2026-09-21T06:05:00.000Z", expected "2026-09-21T06:00:00.000Z" carried through.',
    ]);
  });

  test("a preview of a stack the scan should have left alone is a problem", () => {
    const loud = `${log}\nPreviewed site:prod in 1.0 s: pending`;
    expect(
      checkNarrowedScan({ ...withBody(after), log: loud, pages: [] }, expected, narrowed),
    ).toEqual(["The scan previewed site:prod, and it should have previewed only app:prod."]);
  });

  test("a scan that does not say it is narrowed is a problem", () => {
    const quiet = log.replace("This is a narrowed scan", "This is a full scan");
    expect(
      checkNarrowedScan({ ...withBody(after), log: quiet, pages: [] }, expected, narrowed),
    ).toEqual([
      'The job log has no line that starts with "This is a narrowed scan: it previews 1 of 4 stacks".',
    ]);
  });
});

// Slice 5.35 (record 0100): the first scan of the e2e run names an env file.
describe("the env file check", () => {
  const file = {
    path: "ci/deploy.env",
    masked: "CANARY-ENV-VALUE",
    unmaskedName: "E2E_SHORT",
    unmaskedValue: "e2e",
  };
  const good = [
    "::add-mask::CANARY-ENV-VALUE",
    "::group::Loaded the env file ci/deploy.env",
    "2 values for the tool: E2E_TOKEN, E2E_SHORT.",
    "Masked: E2E_TOKEN.",
    "Not masked: E2E_SHORT (shorter than 8 characters).",
    "::endgroup::",
  ];

  test("a step that masked first and said so has no problems", () => {
    expect(checkEnvFile(good.join("\n"), file)).toEqual([]);
  });

  test("a mask after the log, a short value masked, and no word about it are problems", () => {
    const wrong = [good[1], good[2], good[3], "::add-mask::e2e", good[5], good[0]];
    expect(checkEnvFile(wrong.join("\n"), file)).toEqual([
      "The step said it loaded the env file before it masked the value.",
      "The step masked E2E_SHORT, which is too short to mask.",
      "The step did not say that E2E_SHORT got no mask.",
    ]);
  });

  test("a step that never loaded the file is named", () => {
    expect(checkEnvFile("", file)).toEqual([
      "The step never masked the value of the env file.",
      "The step never said it loaded ci/deploy.env.",
      "The step did not say that E2E_SHORT got no mask.",
    ]);
  });
});
