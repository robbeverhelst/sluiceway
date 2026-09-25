import { describe, expect, test } from "bun:test";
import type { Adapter } from "../../src/adapters/adapter.ts";
import type { PreviewEvent } from "../../src/core/pull-request-preview.ts";
import { check } from "../../src/modes/check.ts";
import {
  type PullRequestPreviewContext,
  previewPullRequest,
} from "../../src/modes/pull-request-preview.ts";
import { renderPullRequestPage } from "../../src/render/pull-request-preview.ts";
import { FakeGitHub } from "../fake-github/fake-github.ts";
import {
  change,
  failing,
  inSync,
  JOB_ID,
  JOB_URL,
  pending,
  REPO_URL,
  RUN_ID,
  rememberingLog,
  repoRoot,
  SUMMARY_URL,
  steppingClock,
  type TableAdapter,
  tableAdapter,
} from "./harness.ts";

// Record 0101: with pull-request-preview: true the check previews the stacks
// the pull request claims, as they would be after the merge, and writes a
// check run per stack on the head commit. It never deploys, never opens a
// deployment record and leaves no row.

const HEAD = "89abcdef89abcdef89abcdef89abcdef89abcdef";
const BASE = "0123456789abcdef0123456789abcdef01234567";
const DASHBOARD_SEARCH = `${REPO_URL}/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22sluiceway%22`;
const LINKS = { dashboard: DASHBOARD_SEARCH, summary: SUMMARY_URL, log: JOB_URL };
const PULL_REQUEST = { number: 12, head: HEAD, base: BASE, baseRef: "main", fromFork: false };

const TABLE = () => ({
  "network:dev": pending("network:dev", change("logs")),
  "network:prod": pending("network:prod", change("records"), change("old", "delete")),
  "site:prod": inSync("site:prod"),
  "zone:dev": failing("error: no credentials for VALUE-OF-zone\n"),
});

const CONFIG = ["stacks:", "  - path: site", '    inputs: ["shared/**"]', ""].join("\n");

interface Harness {
  context: PullRequestPreviewContext;
  github: FakeGitHub;
  log: ReturnType<typeof rememberingLog>;
  adapter: TableAdapter;
  root: string;
}

function harness(
  adapter: TableAdapter,
  files: string[],
  overrides: Partial<PullRequestPreviewContext> & { event?: PreviewEvent; config?: string } = {},
): Harness {
  const github = new FakeGitHub();
  const log = rememberingLog();
  const { config, ...rest } = overrides;
  const root = repoRoot(config ?? CONFIG);
  github.seedComparison(BASE, HEAD, { status: "diverged", files: files.map((path) => ({ path })) });
  const context: PullRequestPreviewContext = {
    root,
    env: { PATH: "/usr/bin" },
    mask: () => {},
    adapter,
    run: async () => {
      throw new Error("No test of the pull request preview starts a process.");
    },
    github,
    log,
    now: steppingClock(),
    pool: { size: 4, from: "input" },
    previewTimeoutMinutes: 10,
    repoUrl: REPO_URL,
    runId: RUN_ID,
    runAttempt: "1",
    jobId: JOB_ID,
    event: { name: "pull_request", pullRequest: PULL_REQUEST },
    ...rest,
  };
  return { context, github, log, adapter, root };
}

// The check with the preview handed in, as the check job hands it in.
async function checkWith({ context, root, log }: Harness): Promise<void> {
  await check({
    root,
    adapter: context.adapter as Adapter,
    log,
    pullRequestPreview: (repo) => previewPullRequest(context, repo),
  });
}

describe("the pull request preview of the check", () => {
  test("writes one page per stack the pull request claims, on its head commit, and none for the others", async () => {
    const h = harness(tableAdapter(TABLE()), ["network/Pulumi.yaml", "shared/values.json"]);
    await checkWith(h);

    expect(h.adapter.previewed).toEqual(["network:dev", "network:prod", "site:prod"]);
    const runs = h.github.checkRuns(HEAD);
    expect(runs.map(({ name, status, conclusion }) => ({ name, status, conclusion }))).toEqual([
      { name: "sluiceway / network:dev", status: "completed", conclusion: "neutral" },
      { name: "sluiceway / network:prod", status: "completed", conclusion: "neutral" },
      { name: "sluiceway / site:prod", status: "completed", conclusion: "neutral" },
    ]);
    const prod = runs.find(({ name }) => name === "sluiceway / network:prod");
    const { unlisted: _unlisted, ...output } = renderPullRequestPage(
      "network:prod",
      pending("network:prod", change("records"), change("old", "delete")),
      { number: 12, baseRef: "main" },
      LINKS,
    );
    expect(prod?.output).toEqual(output);
  });

  test("never deploys, never opens a deployment record and writes no issue and no comment", async () => {
    const h = harness(tableAdapter(TABLE()), ["network/Pulumi.yaml"]);
    await checkWith(h);

    expect(h.adapter.applied).toEqual([]);
    expect(h.github.deploymentsOf("sluiceway")).toEqual([]);
    expect(h.github.requests).toEqual([
      "compareCommits",
      "listCheckRuns",
      "createCheckRun",
      "createCheckRun",
    ]);
    expect(await h.github.listIssues({ label: "sluiceway", state: "open" })).toEqual([]);
  });

  test("the summary lists every previewed stack with its page, and the job log says the same", async () => {
    const h = harness(tableAdapter(TABLE()), ["network/Pulumi.yaml", "package-lock.json"]);
    await checkWith(h);

    const [dev, prod] = h.github.checkRuns(HEAD);
    const summary = h.log.summaries.at(-1) ?? "";
    expect(summary).toContain("### The pull request preview");
    expect(summary).toContain(
      "What the merge of #12 into main would change, previewed at its head commit 89abcde.",
    );
    expect(summary).toContain(`| network:dev | 1 update | [preview](${dev?.htmlUrl}) |`);
    expect(summary).toContain(
      `| network:prod | 1 update, **1 delete** | [preview](${prod?.htmlUrl}) |`,
    );
    expect(summary).toContain(
      "Files no stack claims, for which the scan after the merge previews every stack: <code>package-lock.json</code>.",
    );
    // The closing says the preview ran the tool for these stacks only.
    expect(summary).toContain(
      "the pull request preview above ran the tool for the stacks the pull request claims, and for no other stack",
    );
    expect(h.log.lines).toContain(
      "Previewed 2 stacks after the merge of #12 into main, at its head commit 89abcde. Nothing deploys from a pull request preview.",
    );
    expect(h.log.lines).toContain(
      "Wrote the preview pages of 2 stacks on 89abcde: 2 created, 0 updated.",
    );
    expect(h.log.lines).toContainEqual(
      expect.stringMatching(
        /^Previewed network:prod after the merge of #12 in \d+\.\d s: pending$/,
      ),
    );
  });

  test("a failed preview gets a page that says why in Sluiceway's words, the tool's words go to the job log, and the job stays green", async () => {
    const h = harness(tableAdapter(TABLE()), ["zone/Pulumi.yaml"]);
    await checkWith(h);

    const [zone] = h.github.checkRuns(HEAD);
    expect(zone?.output.title).toBe(
      "zone:dev: preview failed, the tool exited with an error (exit code 255)",
    );
    expect(h.log.groups).toContainEqual({
      title: "zone:dev after the merge of #12",
      lines: ["The tool's own words:", "error: no credentials for VALUE-OF-zone"],
    });
    const everything = [
      ...h.github
        .checkRuns(HEAD)
        .map(({ output }) => `${output.title}${output.summary}${output.text}`),
      ...h.log.lines,
      ...h.log.summaries,
    ].join("\n");
    expect(everything).not.toContain("VALUE-OF");
  });

  test("a pull request from a fork is refused before any request or any preview", async () => {
    const h = harness(tableAdapter(TABLE()), ["network/Pulumi.yaml"], {
      event: { name: "pull_request", pullRequest: { ...PULL_REQUEST, fromFork: true } },
    });
    await checkWith(h);

    expect(h.adapter.previewed).toEqual([]);
    expect(h.adapter.versionChecks).toBe(0);
    expect(h.github.requests).toEqual([]);
    expect(h.log.lines).toContain(
      "#12 comes from a fork, so Sluiceway refuses to preview it: a preview runs the pull request's code with the credentials of this job, and that never relies on GitHub withholding them. Nothing was previewed.",
    );
    expect(h.log.summaries.at(-1)).toContain("#12 comes from a fork");
  });

  test("pull_request_target is refused the same way, whatever the payload says", async () => {
    const h = harness(tableAdapter(TABLE()), ["network/Pulumi.yaml"], {
      event: { name: "pull_request_target", pullRequest: PULL_REQUEST },
    });
    await checkWith(h);
    expect(h.adapter.previewed).toEqual([]);
    expect(h.github.requests).toEqual([]);
    expect(h.log.lines).toContain(
      "This run was started by pull_request_target, which Sluiceway never previews on: it runs with the secrets of the base branch against code that is not merged. Run the preview on the pull_request event. Nothing was previewed.",
    );
  });

  test("a run that no pull request started has nothing to preview", async () => {
    const h = harness(tableAdapter(TABLE()), ["network/Pulumi.yaml"], {
      event: { name: "merge_group" },
    });
    await checkWith(h);
    expect(h.github.requests).toEqual([]);
    expect(h.log.lines).toContain(
      "This run was started by a merge_group event, which names no pull request, so there is nothing to preview. pull-request-preview: true acts on the pull_request event only.",
    );
  });

  test("a pull request that claims no stack costs one request and no preview", async () => {
    const h = harness(tableAdapter(TABLE()), ["docs/setup.md", "package.json"]);
    await checkWith(h);
    expect(h.adapter.previewed).toEqual([]);
    expect(h.adapter.versionChecks).toBe(0);
    expect(h.github.requests).toEqual(["compareCommits"]);
    expect(h.log.lines).toContain(
      "#12 changes no file that a stack claims, so there is nothing to preview.",
    );
    expect(h.log.lines).toContain(
      "Files no stack claims, for which the scan after the merge previews every stack: package.json.",
    );
  });

  test("without checks: write the previews still run, no page is written, and the log says which permission gives them", async () => {
    const h = harness(tableAdapter(TABLE()), ["network/Pulumi.yaml"]);
    h.github.withoutChecksWrite();
    await checkWith(h);

    expect(h.adapter.previewed).toEqual(["network:dev", "network:prod"]);
    expect(h.github.checkRuns(HEAD)).toEqual([]);
    expect(h.log.lines).toContain(
      "No preview page could be written: GitHub answered \"Resource not accessible by integration\". checks: write in the workflow's permissions gives each stack its page in the pull request's checks.",
    );
    expect(h.log.summaries.at(-1)).toContain("| network:dev | 1 update | none |");
  });

  test("a second run on the same head commit updates the pages in place", async () => {
    const h = harness(tableAdapter(TABLE()), ["network/Pulumi.yaml"]);
    await checkWith(h);
    const first = h.github.checkRuns(HEAD).map(({ id }) => id);
    h.github.requests.length = 0;

    await checkWith(h);
    expect(h.github.checkRuns(HEAD).map(({ id }) => id)).toEqual(first);
    expect(h.github.requests.filter((one) => one.includes("CheckRun"))).toEqual([
      "listCheckRuns",
      "updateCheckRun",
      "updateCheckRun",
    ]);
    expect(h.log.lines).toContain(
      "Wrote the preview pages of 2 stacks on 89abcde: 0 created, 2 updated.",
    );
  });

  test("the values a repo lists are asked for, as a scan asks for them, and a redacted dashboard asks for none", async () => {
    const asked: string[][] = [];
    const table = {
      ...TABLE(),
      "network:dev": async (options: { showValues?: readonly string[] | undefined }) => {
        asked.push([...(options.showValues ?? [])]);
        return pending("network:dev", change("logs"));
      },
    };
    const listed = harness(tableAdapter(table), ["network/Pulumi.yaml"], {
      config: "dashboard:\n  showValues: [version]\n",
    });
    await checkWith(listed);
    const redacted = harness(tableAdapter(table), ["network/Pulumi.yaml"], {
      config: "dashboard:\n  redact: true\n  showValues: [version]\n",
    });
    await checkWith(redacted);
    expect(asked).toEqual([["version"], []]);
  });

  test("a pull request of 300 files or more previews nothing and says why", async () => {
    const many = Array.from({ length: 300 }, (_, index) => `network/file-${index}.yaml`);
    const h = harness(tableAdapter(TABLE()), many);
    await checkWith(h);
    expect(h.adapter.previewed).toEqual([]);
    expect(h.log.lines).toContain(
      "#12 changes 300 files or more, more than GitHub's comparison lists, so Sluiceway cannot tell which stacks it claims and previewed nothing. The scan after the merge previews every stack.",
    );
  });
});
