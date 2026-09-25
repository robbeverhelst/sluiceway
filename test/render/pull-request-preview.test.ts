import { describe, expect, test } from "bun:test";
import type { Change } from "../../src/core/diff.ts";
import type { PreviewResult } from "../../src/core/tool-result.ts";
import { renderPreviewPage } from "../../src/render/preview-page.ts";
import {
  type PullRequestPreviewLinks,
  pullRequestPreviewPart,
  renderPullRequestPage,
} from "../../src/render/pull-request-preview.ts";

// Record 0101: the page of a stack after the merge of a pull request shows
// what the scan's preview page shows, says that nothing deploys from it, and
// never a value. The check's summary lists every stack the pull request
// claims with its page.

const REPO_URL = "https://github.com/example-org/infra";
const LINKS: PullRequestPreviewLinks = {
  dashboard: `${REPO_URL}/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22sluiceway%22`,
  summary: `${REPO_URL}/actions/runs/4242/attempts/1`,
  log: `${REPO_URL}/actions/runs/4242/job/106502264185`,
};
const PULL_REQUEST = {
  number: 12,
  baseRef: "main",
  head: "89abcdef89abcdef89abcdef89abcdef89abcdef",
};

function change(op: Change["op"], name: string, rest: Partial<Change> = {}): Change {
  const type = "aws:s3/bucket:Bucket";
  return { address: `${type}::${name}`, type, name, op, changedKeys: [], replaceKeys: [], ...rest };
}

const PENDING: PreviewResult = {
  ok: true,
  diff: {
    stackId: "storage/buckets:prod",
    changes: [
      change("update", "logs", { changedKeys: ["tags.owner"] }),
      change("replace", "uploads", { replaceKeys: ["bucket"] }),
    ],
  },
  toolLog: "",
};

describe("the page of a stack after the merge", () => {
  test("shows the counts, the destroy warning and the changes, and says nothing deploys from it", () => {
    const page = renderPullRequestPage("storage/buckets:prod", PENDING, PULL_REQUEST, LINKS);
    expect(page.title).toBe("storage/buckets:prod: 1 update, 1 replace");
    expect(page.summary).toBe(
      [
        "**storage/buckets:prod** · 1 update, **1 replace**",
        ":warning: **This deploy replaces 1.**",
        "Sluiceway's own preview of this stack as it would be after the merge of #12 into main: what a deploy would change, never what it changes to, with every property path whole.",
        `**Nothing deploys from this page.** A deploy goes out only after the merge, from a fresh preview of the default branch, and is refused when the change moved since. What is merged and waiting is on the [dashboard](${LINKS.dashboard}).`,
        `Every stack this run previewed is in the [summary](${LINKS.summary}) of the run, and the tool's own words are in the [job log](${LINKS.log}), in the group <code>storage/buckets:prod</code>.`,
      ].join("\n\n"),
    );
    // The same list the scan's preview page shows, destroys first (record 0050).
    expect(page.text).toBe(renderPreviewPage(PENDING.diff, LINKS).text);
    expect(page.text).toContain(
      "<kbd>REPLACE</kbd> <code>aws:s3/bucket:Bucket</code> <b>uploads</b>",
    );
  });

  test("a stack the merge would not change says so", () => {
    const page = renderPullRequestPage(
      "network:dev",
      { ok: true, diff: { stackId: "network:dev", changes: [] }, toolLog: "" },
      PULL_REQUEST,
      LINKS,
    );
    expect(page.title).toBe("network:dev: no changes");
    expect(page.summary).toContain(
      "A deploy of this stack after the merge of #12 into main would change nothing.",
    );
    expect(page.summary).toContain("**Nothing deploys from this page.**");
    expect(page.text).toBe("");
  });

  test("a failed preview says why in Sluiceway's words, never the tool's", () => {
    const page = renderPullRequestPage(
      "network:dev",
      {
        ok: false,
        reason: { kind: "tool-error", exitCode: 255 },
        detail: [],
        toolLog: "error: no credentials for VALUE-OF-network\n",
      },
      PULL_REQUEST,
      LINKS,
    );
    expect(page.title).toBe(
      "network:dev: preview failed, the tool exited with an error (exit code 255)",
    );
    expect(page.summary).toContain(
      `The preview of this stack after the merge of #12 into main did not produce a diff: the tool exited with an error (exit code 255). The tool's own words are in the [job log](${LINKS.log}), in the group <code>network:dev</code>.`,
    );
    expect(`${page.title}\n${page.summary}\n${page.text}`).not.toContain("VALUE-OF");
  });
});

describe("the check's part about the pull request preview", () => {
  const texts = (part: ReturnType<typeof pullRequestPreviewPart>) =>
    part.log.map((entry) => ("info" in entry ? entry.info : JSON.stringify(entry)));

  test("lists every stack the pull request claims with what the merge would change and its page", () => {
    const part = pullRequestPreviewPart({
      pullRequest: PULL_REQUEST,
      outcome: {
        kind: "previewed",
        stacks: [
          {
            stackId: "network:dev",
            outcome: "no changes",
            pageUrl: `${REPO_URL}/runs/1`,
          },
          {
            stackId: "storage/buckets:prod",
            outcome: "1 update, **1 replace**",
            pageUrl: `${REPO_URL}/runs/2`,
          },
        ],
        unclaimed: ["package-lock.json", "packages/@scope/a_b.json"],
        pages: { created: 2, updated: 0, failed: [], refused: undefined },
      },
    });
    expect(part.summary).toEqual([
      "### The pull request preview",
      "What the merge of #12 into main would change, previewed at its head commit 89abcde. Nothing deploys from it: a deploy goes out only after the merge, from a fresh preview, and is refused when the change moved since.",
      [
        "| Stack | After the merge | Page |",
        "|---|---|---|",
        `| network:dev | no changes | [preview](${REPO_URL}/runs/1) |`,
        `| storage/buckets:prod | 1 update, **1 replace** | [preview](${REPO_URL}/runs/2) |`,
      ].join("\n"),
      // In <code>, where a character reference and a span are read as they
      // are in any other HTML, and not in a code span, where they show as typed.
      "Files no stack claims, for which the scan after the merge previews every stack: <code>package-lock.json</code>, <code>packages/<span>@</span>scope/a&#95;b.json</code>.",
    ]);
    expect(texts(part)).toEqual([
      "Previewed 2 stacks after the merge of #12 into main, at its head commit 89abcde. Nothing deploys from a pull request preview.",
      "network:dev: no changes.",
      "storage/buckets:prod: 1 update, 1 replace.",
      "Wrote the preview pages of 2 stacks on 89abcde: 2 created, 0 updated.",
      "Files no stack claims, for which the scan after the merge previews every stack: package-lock.json, packages/@scope/a_b.json.",
    ]);
  });

  test("without checks: write the pages could not be written, and the summary says which permission gives them", () => {
    const part = pullRequestPreviewPart({
      pullRequest: PULL_REQUEST,
      outcome: {
        kind: "previewed",
        stacks: [{ stackId: "network:dev", outcome: "1 update" }],
        unclaimed: [],
        pages: {
          created: 0,
          updated: 0,
          failed: [],
          refused: { message: "Resource not accessible by integration", permission: true },
        },
      },
    });
    expect(part.summary[2]).toContain("| network:dev | 1 update | none |");
    expect(part.summary[3]).toBe(
      "No preview page could be written: GitHub answered \"Resource not accessible by integration\". `checks: write` in the workflow's permissions gives each stack its page in the pull request's checks. The summary of the run holds the same.",
    );
    expect(texts(part)).toContain(
      "No preview page could be written: GitHub answered \"Resource not accessible by integration\". checks: write in the workflow's permissions gives each stack its page in the pull request's checks.",
    );
  });

  test("a pull request from a fork is refused in one sentence, and previews nothing", () => {
    const part = pullRequestPreviewPart({
      pullRequest: PULL_REQUEST,
      outcome: { kind: "refused", refusal: { kind: "fork" } },
    });
    const sentence =
      "#12 comes from a fork, so Sluiceway refuses to preview it: a preview runs the pull request's code with the credentials of this job, and that never relies on GitHub withholding them. Nothing was previewed.";
    expect(part.summary).toEqual(["### The pull request preview", sentence]);
    expect(texts(part)).toEqual([sentence]);
  });

  test("pull_request_target is never previewed on", () => {
    const part = pullRequestPreviewPart({
      outcome: { kind: "refused", refusal: { kind: "pull-request-target" } },
    });
    expect(part.summary[1]).toBe(
      "This run was started by pull_request_target, which Sluiceway never previews on: it runs with the secrets of the base branch against code that is not merged. Run the preview on the pull_request event. Nothing was previewed.",
    );
  });

  test("an event that names no pull request has nothing to preview", () => {
    const part = pullRequestPreviewPart({
      outcome: { kind: "refused", refusal: { kind: "not-a-pull-request", event: "push" } },
    });
    expect(part.summary[1]).toBe(
      "This run was started by a push event, which names no pull request, so there is nothing to preview. pull-request-preview: true acts on the pull_request event only.",
    );
  });

  test("a pull request that claims no stack, and one of too many files, say so", () => {
    expect(
      pullRequestPreviewPart({
        pullRequest: PULL_REQUEST,
        outcome: { kind: "nothing-claimed", unclaimed: ["docs/a.md", "package.json"] },
      }).summary.slice(1),
    ).toEqual([
      "#12 changes no file that a stack claims, so there is nothing to preview.",
      "Files no stack claims, for which the scan after the merge previews every stack: `docs/a.md`, `package.json`.",
    ]);
    expect(
      pullRequestPreviewPart({ pullRequest: PULL_REQUEST, outcome: { kind: "too-many-files" } })
        .summary[1],
    ).toBe(
      "#12 changes 300 files or more, more than GitHub's comparison lists, so Sluiceway cannot tell which stacks it claims and previewed nothing. The scan after the merge previews every stack.",
    );
  });
});
