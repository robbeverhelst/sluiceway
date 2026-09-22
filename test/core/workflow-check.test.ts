import { describe, expect, test } from "bun:test";
import { MODES } from "../../src/core/auto-mode.ts";
import { parseConfig } from "../../src/core/config.ts";
import { checkWorkflows, tokenNeeds, type WorkflowFile } from "../../src/core/workflow-check.ts";
import { EXAMPLE_WORKFLOWS, fences, read } from "../docs/docs.ts";

// Slice 4.10, record 0061: the check reads the workflow files and says what a
// Sluiceway workflow is missing, before its first run.

const DEFAULTS = parseConfig("");
const READ_ONLY = parseConfig("dashboard:\n  readOnly: true\n");

function file(text: string, path = ".github/workflows/deploy-dashboard.yml"): WorkflowFile {
  return { path, text };
}

// The complete workflows of the setup, in order: the check and the whole
// workflow of docs/workflow.md, then the read-only trial. They were the
// README's until the README rewrite.
const complete = (path: string) =>
  fences(read(path))
    .filter(
      ({ language, text }) => language === "yaml" && /^jobs:/m.test(text) && /^on:/m.test(text),
    )
    .map(({ text }) => text);
const README = [...complete("docs/workflow.md"), ...complete("docs/read-only-trial.md")];

// The split workflow, to break one piece at a time. The one-step workflow
// has tests of its own (workflow-check-auto.test.ts).
const WHOLE =
  complete("docs/split-workflow.md").find((text) => text.includes("mode: resolve")) ?? "";

describe("the workflows the docs ship", () => {
  test("the docs have a check, the whole workflow and the read-only trial", () => {
    expect(README.length).toBe(3);
  });

  test.each(EXAMPLE_WORKFLOWS)("%s has nothing missing", (path) => {
    const report = checkWorkflows([file(read(path))], DEFAULTS);
    expect(report.warnings).toEqual([]);
    expect(report.notes).toEqual([]);
  });

  test("the docs' check and whole workflow have nothing missing", () => {
    for (const whole of [README[1] ?? "", WHOLE]) {
      const report = checkWorkflows(
        [file(README[0] ?? "", ".github/workflows/check.yml"), file(whole)],
        DEFAULTS,
      );
      expect(report.warnings).toEqual([]);
      expect(report.notes).toEqual([]);
    }
    const report = checkWorkflows([file(WHOLE)], DEFAULTS);
    expect(report.warnings).toEqual([]);
    expect(report.notes).toEqual([]);
  });

  test("the read-only trial has nothing missing with dashboard.readOnly", () => {
    const report = checkWorkflows([file(README[2] ?? "")], READ_ONLY);
    expect(report.warnings).toEqual([]);
  });

  test("lists every job that runs Sluiceway, with its mode and its ref", () => {
    const report = checkWorkflows([file(WHOLE)], DEFAULTS);
    expect(report.workflows).toEqual([
      {
        path: ".github/workflows/deploy-dashboard.yml",
        jobs: [
          { job: "scan", mode: "scan", runs: ["scan"], ref: "v0", refKind: "moving" },
          { job: "resolve", mode: "resolve", runs: ["resolve"], ref: "v0", refKind: "moving" },
          { job: "apply", mode: "apply", runs: ["apply"], ref: "v0", refKind: "moving" },
          { job: "settle", mode: "settle", runs: ["settle"], ref: "v0", refKind: "moving" },
        ],
      },
    ]);
  });

  test("a workflow that does not run Sluiceway is not listed", () => {
    const ci =
      "on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: make\n";
    expect(checkWorkflows([file(ci, ".github/workflows/ci.yml")], DEFAULTS)).toEqual({
      workflows: [],
      warnings: [],
      notes: [],
    });
  });
});

// The whole workflow with one piece broken.
function broken(edit: (text: string) => string, config = DEFAULTS) {
  const changed = edit(WHOLE);
  expect(changed).not.toBe(WHOLE);
  return checkWorkflows([file(changed)], config);
}

const PATH = ".github/workflows/deploy-dashboard.yml";

describe("a broken workflow", () => {
  test("without workflow_dispatch", () => {
    expect(broken((text) => text.replace("  workflow_dispatch:\n", "")).warnings).toEqual([
      { kind: "missing-trigger", path: PATH, trigger: "workflow_dispatch" },
    ]);
  });

  test("without the schedule", () => {
    expect(broken((text) => text.replace(/ {2}schedule:\n.*\n/, "")).warnings).toEqual([
      { kind: "missing-trigger", path: PATH, trigger: "schedule" },
    ]);
  });

  test("without push", () => {
    expect(broken((text) => text.replace("  push:\n    branches: [main]\n", "")).warnings).toEqual([
      { kind: "missing-trigger", path: PATH, trigger: "push" },
    ]);
  });

  test("listening to issues, but not to an edit", () => {
    expect(broken((text) => text.replace("types: [edited]", "types: [opened]")).warnings).toEqual([
      { kind: "missing-trigger", path: PATH, trigger: "issues" },
    ]);
  });

  test("not listening to issues at all", () => {
    expect(broken((text) => text.replace("  issues:\n    types: [edited]\n", "")).warnings).toEqual(
      [{ kind: "missing-trigger", path: PATH, trigger: "issues" }],
    );
  });

  test("on pull requests or in a merge queue", () => {
    expect(
      broken((text) => text.replace("on:\n", "on:\n  pull_request:\n  merge_group:\n")).warnings,
    ).toEqual([
      { kind: "forbidden-trigger", path: PATH, trigger: "pull_request" },
      { kind: "forbidden-trigger", path: PATH, trigger: "merge_group" },
    ]);
  });

  test("with actions: read, which the rescan box and settle cannot dispatch with", () => {
    expect(broken((text) => text.replace("actions: write", "actions: read")).warnings).toEqual([
      {
        kind: "missing-permissions",
        path: PATH,
        job: "resolve",
        mode: "resolve",
        missing: ["actions: write"],
      },
      {
        kind: "missing-permissions",
        path: PATH,
        job: "settle",
        mode: "settle",
        missing: ["actions: write"],
      },
    ]);
  });

  test("with issues: read", () => {
    const { warnings } = broken((text) => text.replace("issues: write", "issues: read"));
    expect(warnings.map((warning) => "job" in warning && warning.job)).toEqual([
      "scan",
      "resolve",
      "apply",
    ]);
  });

  test("with no permissions block anywhere", () => {
    const { warnings } = broken((text) => text.replace(/^permissions:\n( {2}.*\n)+/m, ""));
    expect(warnings.map((warning) => warning.kind)).toEqual(Array(4).fill("no-permissions"));
    expect(warnings[3]).toEqual({
      kind: "no-permissions",
      path: PATH,
      job: "settle",
      mode: "settle",
      needs: ["contents: read", "issues: read", "deployments: write", "actions: write"],
    });
  });

  test("a job's own block replaces the workflow's", () => {
    const { warnings } = broken((text) =>
      text.replace("  settle:\n", "  settle:\n    permissions:\n      id-token: write\n"),
    );
    expect(warnings).toEqual([
      {
        kind: "missing-permissions",
        path: PATH,
        job: "settle",
        mode: "settle",
        missing: ["contents: read", "issues: read", "deployments: write", "actions: write"],
      },
    ]);
  });

  test("write-all is enough, read-all is not", () => {
    const all = (level: string) => (text: string) =>
      text.replace(/^permissions:\n( {2}.*\n)+/m, `permissions: ${level}\n`);
    expect(broken(all("write-all")).warnings).toEqual([]);
    expect(broken(all("read-all")).warnings.length).toBe(4);
  });

  test("merge and deploy needs contents: write on resolve", () => {
    const merging = parseConfig('mergeAndDeploy:\n  authors: ["renovate[bot]"]\n');
    expect(checkWorkflows([file(WHOLE)], merging).warnings).toEqual([
      // Slice 5.7: and a second apply job (record 0074).
      { kind: "no-merged-apply", path: PATH },
      {
        kind: "missing-permissions",
        path: PATH,
        job: "resolve",
        mode: "resolve",
        missing: ["contents: write"],
      },
    ]);
  });

  test("without checks: write, a note and no warning", () => {
    const report = broken((text) => text.replace("  checks: write\n", ""));
    expect(report.warnings).toEqual([]);
    expect(report.notes).toEqual([{ kind: "no-preview-pages", path: PATH, job: "scan" }]);
  });

  test("with a job left out of the file", () => {
    const { warnings } = broken((text) => text.slice(0, text.indexOf("  settle:\n")));
    expect(warnings).toEqual([{ kind: "missing-job", path: PATH, mode: "settle" }]);
  });

  test("a scan with no resolve and boxes on", () => {
    expect(checkWorkflows([file(README[2] ?? "")], DEFAULTS).warnings).toEqual([
      { kind: "boxes-do-nothing", path: PATH },
    ]);
  });

  test("a step with a mode that does not exist", () => {
    const { warnings } = broken((text) => text.replace("mode: settle", "mode: settel"));
    expect(warnings).toEqual([
      { kind: "unknown-mode", path: PATH, job: "settle", mode: "settel" },
      { kind: "missing-job", path: PATH, mode: "settle" },
    ]);
  });

  test("a file that is not YAML and names Sluiceway", () => {
    const report = checkWorkflows([file("on: [push\njobs: sluiceway/sluiceway@v0\n")], DEFAULTS);
    expect(report.warnings).toEqual([{ kind: "unreadable", path: PATH }]);
  });

  test("a reusable workflow is left to its caller", () => {
    const report = broken((text) =>
      text
        .replace(/^on:\n( {2}.*\n|\s+- .*\n| {4}.*\n)+/m, "on:\n  workflow_call:\n")
        .replace(/^permissions:\n( {2}.*\n)+/m, ""),
    );
    expect(report.warnings).toEqual([]);
    expect(report.notes).toEqual([{ kind: "called", path: PATH }]);
  });
});

describe("the ref of the action", () => {
  const at = (ref: string) => (text: string) =>
    text.replaceAll("sluiceway/sluiceway@v0", `sluiceway/sluiceway@${ref}`);

  test.each([
    ["v0", "moving"],
    ["v1", "moving"],
    ["v0.8.0", "release"],
    ["f417adda434806ed641f551aa126402c923516a3", "commit"],
    ["main", "other"],
    ["v0.8", "other"],
    ["f417add", "other"],
  ])("%s is %s", (ref, kind) => {
    const report = checkWorkflows([file(at(ref)(WHOLE))], DEFAULTS);
    expect(report.workflows[0]?.jobs.map((job): string => job.refKind)).toEqual(
      Array(4).fill(kind),
    );
  });

  test("a branch is a warning on every job", () => {
    expect(broken(at("main")).warnings).toEqual(
      ["scan", "resolve", "apply", "settle"].map((job) => ({
        kind: "unreleased-ref",
        path: PATH,
        job,
        ref: "main",
      })),
    );
  });

  test("a pinned commit with its version as a comment is fine", () => {
    expect(broken(at("f417adda434806ed641f551aa126402c923516a3 # v0.1.1")).warnings).toEqual([]);
  });

  test("two versions in one file", () => {
    const report = broken((text) =>
      text.replace(
        "sluiceway/sluiceway@v0\n        with:\n          mode: apply",
        "sluiceway/sluiceway@v0.8.0\n        with:\n          mode: apply",
      ),
    );
    expect(report.warnings).toEqual([{ kind: "mixed-refs", path: PATH, refs: ["v0", "v0.8.0"] }]);
  });
});

// Slice 5.7, record 0074: the concurrency groups, the status check in the
// `if:` of apply and settle, and the second apply job of merge and deploy.
describe("the rest of the workflow", () => {
  test("a scan or resolve job with no concurrency group", () => {
    const { warnings } = broken((text) =>
      text
        .replace("    concurrency: sluiceway-scan\n", "")
        .replace("    concurrency: sluiceway-resolve\n", ""),
    );
    expect(warnings).toEqual([
      { kind: "no-concurrency", path: PATH, job: "scan", mode: "scan" },
      { kind: "no-concurrency", path: PATH, job: "resolve", mode: "resolve" },
    ]);
  });

  test("a group of another name is fine, and so is the long form", () => {
    const { warnings } = broken((text) =>
      text.replace(
        "    concurrency: sluiceway-scan\n",
        "    concurrency:\n      group: deploys-scan\n",
      ),
    );
    expect(warnings).toEqual([]);
  });

  test("an apply job with no concurrency group", () => {
    const { warnings } = broken((text) =>
      text.replace(
        "    concurrency:\n      group: sluiceway-apply-${{ matrix.stack }}\n      queue: max\n",
        "",
      ),
    );
    expect(warnings).toEqual([{ kind: "no-concurrency", path: PATH, job: "apply", mode: "apply" }]);
  });

  test("an apply group that is not one per stack", () => {
    const { warnings } = broken((text) =>
      text.replace("group: sluiceway-apply-${{ matrix.stack }}", "group: sluiceway-apply"),
    );
    expect(warnings).toEqual([{ kind: "apply-group-shared", path: PATH, job: "apply" }]);
  });

  test("an apply group without queue: max", () => {
    const { warnings } = broken((text) => text.replace("      queue: max\n", ""));
    expect(warnings).toEqual([{ kind: "apply-no-queue", path: PATH, job: "apply" }]);
  });

  test("an apply group that cancels a running deploy", () => {
    const { warnings } = broken((text) =>
      text.replace("      queue: max\n", "      queue: max\n      cancel-in-progress: true\n"),
    );
    expect(warnings).toEqual([{ kind: "apply-cancels", path: PATH, job: "apply" }]);
  });

  test("an apply job without !cancelled()", () => {
    const { warnings } = broken((text) => text.replace("${{ !cancelled() && ", "${{ "));
    expect(warnings).toEqual([
      { kind: "no-status-check", path: PATH, job: "apply", mode: "apply" },
    ]);
  });

  test("an apply job with always() is fine", () => {
    expect(broken((text) => text.replace("!cancelled()", "always()")).warnings).toEqual([]);
  });

  test("an apply job with no if: at all", () => {
    const { warnings } = broken((text) => text.replace(/ {4}if: \$\{\{ !cancelled\(\).*\n/, ""));
    expect(warnings).toEqual([
      { kind: "no-status-check", path: PATH, job: "apply", mode: "apply" },
    ]);
  });

  test("a settle job without always(), even with !cancelled()", () => {
    for (const status of ["", "!cancelled() && "]) {
      const { warnings } = broken((text) => text.replace("if: always() && ", `if: ${status}`));
      expect(warnings).toEqual([
        { kind: "no-status-check", path: PATH, job: "settle", mode: "settle" },
      ]);
    }
  });

  test("a settle job that does not wait for apply", () => {
    const { warnings } = broken((text) =>
      text.replace("needs: [resolve, apply]", "needs: resolve"),
    );
    expect(warnings).toEqual([
      { kind: "settle-skips-apply", path: PATH, job: "settle", apply: "apply" },
    ]);
  });
});

// The whole workflow with the changes docs/workflow.md asks for merge and
// deploy: contents: write on resolve, the scan's matrix as an output, a second
// apply job that takes it, and settle waiting for both.
const MERGED = WHOLE.replace(
  "    concurrency: sluiceway-scan\n",
  "    concurrency: sluiceway-scan\n    outputs:\n      matrix: ${{ steps.scan.outputs.matrix }}\n",
)
  .replace(
    "      - uses: sluiceway/sluiceway@v0\n        with:\n          mode: scan\n",
    "      - id: scan\n        uses: sluiceway/sluiceway@v0\n        with:\n          mode: scan\n",
  )
  .replace(
    "    runs-on: ubuntu-latest\n    concurrency: sluiceway-resolve\n",
    "    runs-on: ubuntu-latest\n    permissions:\n      contents: write\n      issues: write\n      deployments: write\n      actions: write\n      pull-requests: read\n    concurrency: sluiceway-resolve\n",
  )
  .replace(
    "  settle:\n    needs: [resolve, apply]\n",
    `  apply-merged:
    needs: scan
    if: \${{ !cancelled() && needs.scan.outputs.matrix != '' && needs.scan.outputs.matrix != '[]' }}
    strategy:
      fail-fast: false
      matrix:
        include: \${{ fromJson(needs.scan.outputs.matrix) }}
    runs-on: ubuntu-latest
    concurrency:
      group: sluiceway-apply-\${{ matrix.stack }}
      queue: max
    steps:
      - uses: actions/checkout@v7
      - uses: sluiceway/sluiceway@v0
        with:
          mode: apply
          deployment-id: \${{ matrix.deployment }}

  settle:
    needs: [scan, resolve, apply, apply-merged]
`,
  );

const MERGE_AND_DEPLOY = parseConfig('mergeAndDeploy:\n  authors: ["renovate[bot]"]\n');

function merged(edit: (text: string) => string = (text) => text) {
  return checkWorkflows([file(edit(MERGED))], MERGE_AND_DEPLOY);
}

describe("the second apply job of merge and deploy", () => {
  test("the workflow docs/workflow.md describes has nothing missing", () => {
    expect(MERGED).toContain("apply-merged:");
    expect(merged().warnings).toEqual([]);
  });

  test("without it, the deploy after a merge never starts", () => {
    // The first warning is the merge's contents: write on resolve.
    const { warnings } = checkWorkflows([file(WHOLE)], MERGE_AND_DEPLOY);
    expect(warnings.map((warning) => warning.kind)).toEqual([
      "no-merged-apply",
      "missing-permissions",
    ]);
  });

  test("merge and deploy off needs no second apply job", () => {
    expect(checkWorkflows([file(WHOLE)], DEFAULTS).warnings).toEqual([]);
  });

  test("a second apply job that reads a scan with no matrix output", () => {
    const { warnings } = merged((text) =>
      text.replace("    outputs:\n      matrix: ${{ steps.scan.outputs.matrix }}\n", ""),
    );
    expect(warnings).toEqual([
      { kind: "scan-no-matrix-output", path: PATH, job: "apply-merged", scan: "scan" },
    ]);
  });

  test("settle that does not wait for the second apply job", () => {
    const { warnings } = merged((text) =>
      text.replace("needs: [scan, resolve, apply, apply-merged]", "needs: [resolve, apply]"),
    );
    expect(warnings).toEqual([
      { kind: "settle-skips-apply", path: PATH, job: "settle", apply: "apply-merged" },
    ]);
  });

  test("the second apply job is held to the same rules as the first", () => {
    const { warnings } = merged((text) =>
      text.replace(
        "${{ !cancelled() && needs.scan.outputs.matrix",
        "${{ needs.scan.outputs.matrix",
      ),
    );
    expect(warnings).toEqual([
      { kind: "no-status-check", path: PATH, job: "apply-merged", mode: "apply" },
    ]);
  });
});

// The permissions each mode needs are written by hand from the calls it makes
// on the GitHub port. A mode that starts a new call changes this table, and
// this test says so.
describe("the permissions of each mode", () => {
  const MERGES = parseConfig("mergeAndDeploy:\n  authors:\n    - renovate[bot]\n");

  test("are pinned", () => {
    expect(Object.fromEntries(MODES.map((mode) => [mode, tokenNeeds(mode, DEFAULTS)]))).toEqual({
      auto: {},
      scan: {
        contents: "read",
        issues: "write",
        deployments: "write",
        actions: "read",
        "pull-requests": "read",
      },
      resolve: {
        contents: "read",
        issues: "write",
        deployments: "write",
        actions: "write",
        "pull-requests": "read",
      },
      apply: { contents: "read", issues: "write", deployments: "write", "pull-requests": "read" },
      settle: { contents: "read", issues: "read", deployments: "write", actions: "write" },
      check: { contents: "read" },
      init: { contents: "read" },
    });
  });

  test("resolve merges with contents: write when merge and deploy is on", () => {
    expect(tokenNeeds("resolve", MERGES).contents).toBe("write");
  });
});
