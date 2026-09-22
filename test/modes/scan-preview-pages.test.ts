// Record 0050: a scan writes a preview page, a check run on the scanned
// commit, for every pending stack, and the row's `preview` link lands on it.
// Without `checks: write` the link falls back to where record 0044 sends it,
// and the job log says which permission to add.

import { describe, expect, test } from "bun:test";
import { scan } from "../../src/modes/scan.ts";
import { renderPreviewPage } from "../../src/render/preview-page.ts";
import { FakeGitHubError } from "../fake-github/fake-github.ts";
import {
  change,
  dashboardBody,
  failing,
  harness,
  inSync,
  JOB_URL,
  pending,
  REPO_URL,
  SHA,
  SUMMARY_URL,
  tableAdapter,
} from "./harness.ts";

const DASHBOARD_SEARCH = `${REPO_URL}/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22sluiceway%22`;

const TABLE = () => ({
  "network:dev": pending("network:dev", change("logs")),
  "network:prod": failing(),
  "site:prod": inSync("site:prod"),
  "zone:dev": pending("zone:dev", change("records"), change("old", "delete")),
});

describe("the preview pages of a scan", () => {
  test("one page per pending stack on the scanned commit, and none for a stack in sync or a failed preview", async () => {
    const { context, github } = harness(tableAdapter(TABLE()));
    await scan(context);

    const runs = github.checkRuns(SHA);
    expect(runs.map(({ name, status, conclusion }) => ({ name, status, conclusion }))).toEqual([
      { name: "sluiceway / network:dev", status: "completed", conclusion: "neutral" },
      { name: "sluiceway / zone:dev", status: "completed", conclusion: "neutral" },
    ]);
  });

  test("a pending row's preview link is its page, and the other links stay where they were", async () => {
    const { context, github } = harness(tableAdapter(TABLE()));
    await scan(context);

    const [network, zone] = github.checkRuns(SHA);
    const body = dashboardBody(github);
    expect(body).toContain(`- [ ] **network:dev** · 1 update · [preview](${network?.htmlUrl})`);
    expect(body).toContain(`[preview](${zone?.htmlUrl})`);
    expect(body).toContain(`· [run](${JOB_URL})`);
    expect(network?.htmlUrl).toBe(`${REPO_URL}/runs/${network?.id}`);
  });

  test("the page shows Sluiceway's own diff of the stack, with links to the dashboard, the summary and the job log", async () => {
    const { context, github } = harness(tableAdapter(TABLE()));
    await scan(context);

    const zone = github.checkRuns(SHA).find(({ name }) => name === "sluiceway / zone:dev");
    const { unlisted: _unlisted, ...output } = renderPreviewPage(
      { stackId: "zone:dev", changes: [change("records"), change("old", "delete")] },
      { dashboard: DASHBOARD_SEARCH, summary: SUMMARY_URL, log: JOB_URL },
    );
    expect(zone?.output).toEqual(output);
  });

  test("the job log says what was written", async () => {
    const { context, log } = harness(tableAdapter(TABLE()));
    await scan(context);
    expect(log.lines).toContain(
      "Wrote the preview pages of 2 pending stacks on 0123456: 2 created, 0 updated.",
    );
  });

  test("a scan of the same commit updates the pages in place: no duplicate, one list and one write per pending stack", async () => {
    const { context, github, log } = harness(tableAdapter(TABLE()));
    await scan(context);
    const first = github.checkRuns(SHA);
    github.requests.length = 0;

    await scan(context);

    expect(github.checkRuns(SHA).map(({ id }) => id)).toEqual(first.map(({ id }) => id));
    const checks = github.requests.filter((one) => one.includes("CheckRun"));
    expect(checks).toEqual(["listCheckRuns", "updateCheckRun", "updateCheckRun"]);
    expect(log.lines).toContain(
      "Wrote the preview pages of 2 pending stacks on 0123456: 0 created, 2 updated.",
    );
  });

  test("a scan with nothing pending makes no check run request", async () => {
    const { context, github } = harness(tableAdapter({ "site:prod": inSync("site:prod") }));
    await scan(context);
    expect(github.requests.filter((one) => one.includes("CheckRun"))).toEqual([]);
  });

  test("with scan.logDiff on, the link still lands on the page, and the page says where the tool's diff is", async () => {
    const { context, github } = harness(tableAdapter(TABLE()), {
      config: "scan:\n  logDiff: true\n",
    });
    await scan(context);

    const [network] = github.checkRuns(SHA);
    expect(dashboardBody(github)).toContain(`· 1 update · [preview](${network?.htmlUrl})`);
    expect(network?.output.summary).toContain(
      `The tool's own diff of this stack, values included, is in the [job log](${JOB_URL}), in the group <code>network:dev</code>. It is not on this page.`,
    );
    // The tool's own diff never goes on the page (records 0048 and 0050).
    expect(JSON.stringify(github.checkRuns(SHA))).not.toContain("VALUE-OF-");
  });

  test("a narrowed scan writes pages only for the stacks it previewed", async () => {
    const { context, github } = harness(tableAdapter(TABLE()));
    await scan(context);
    const before = github.checkRuns(SHA).length;
    const next = "fedcba9876543210fedcba9876543210fedcba98";
    github.seedComparison(SHA, next, { status: "ahead", files: [{ path: "zone/index.ts" }] });

    await scan({ ...context, event: "push", sha: next });

    expect(github.checkRuns(SHA)).toHaveLength(before);
    expect(github.checkRuns(next).map(({ name }) => name)).toEqual(["sluiceway / zone:dev"]);
    // The carried row keeps the link it had.
    expect(dashboardBody(github)).toContain(`[preview](${github.checkRuns(SHA)[0]?.htmlUrl})`);
  });
});

describe("without checks: write", () => {
  test("the link falls back to the summary, the job log says which permission to add, and the scan stays green", async () => {
    const { context, github, log } = harness(tableAdapter(TABLE()));
    github.withoutChecksWrite();

    await scan(context);

    expect(dashboardBody(github)).toContain(`· 1 update · [preview](${SUMMARY_URL})`);
    expect(log.lines).toContain(
      "No preview page was written: GitHub answered \"Resource not accessible by integration\". With `checks: write` in the permissions of the scan job, a pending row's preview link lands on a page of its own that shows the stack's diff (record 0050). Until then it lands on the summary of the scan.",
    );
    // One try, then no more.
    expect(github.requests.filter((one) => one.includes("CheckRun"))).toEqual([
      "listCheckRuns",
      "createCheckRun",
    ]);
    expect(log.warnings).toEqual([expect.objectContaining({ title: "Preview failed" })]);
  });

  test("with scan.logDiff on the link falls back to the job log, as record 0048 has it", async () => {
    const { context, github, log } = harness(tableAdapter(TABLE()), {
      config: "scan:\n  logDiff: true\n",
    });
    github.withoutChecksWrite();
    await scan(context);
    expect(dashboardBody(github)).toContain(`· 1 update · [preview](${JOB_URL})`);
    const said = log.lines.find((line) => line.startsWith("No preview page was written"));
    expect(said).toEndWith("Until then it lands on the job log.");
  });
});

describe("a refusal that is not about the permission", () => {
  test("stops the pages for the scan and says what GitHub answered", async () => {
    const { context, github, log } = harness(tableAdapter(TABLE()));
    github.createCheckRun = async () => {
      throw new FakeGitHubError(403, "You have exceeded a secondary rate limit.");
    };
    await scan(context);
    expect(dashboardBody(github)).toContain(`· 1 update · [preview](${SUMMARY_URL})`);
    expect(log.lines).toContain(
      'GitHub answered "You have exceeded a secondary rate limit." while the preview pages were written. No more pages are written in this scan, and the preview links of 2 pending stacks land on the summary of the scan.',
    );
  });
});

describe("a page that fails on its own", () => {
  test("costs only its row the link, and the job log names it", async () => {
    const { context, github, log } = harness(tableAdapter(TABLE()));
    const create = github.createCheckRun.bind(github);
    github.createCheckRun = async (run) => {
      if (run.name === "sluiceway / zone:dev") throw new Error("Server Error");
      return create(run);
    };

    await scan(context);

    const body = dashboardBody(github);
    expect(body).toContain(`· 1 update · [preview](${github.checkRuns(SHA)[0]?.htmlUrl})`);
    expect(body).toContain(`**1 delete** · [preview](${SUMMARY_URL})`);
    expect(log.lines).toContain(
      "The preview page of zone:dev could not be written: Server Error. Its preview link lands on the summary of the scan.",
    );
    expect(log.lines).toContain(
      "Wrote the preview pages of 1 pending stack on 0123456: 1 created, 0 updated.",
    );
  });
});
