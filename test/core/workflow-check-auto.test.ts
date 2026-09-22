import { describe, expect, test } from "bun:test";
import { parseConfig } from "../../src/core/config.ts";
import { checkWorkflows, type WorkflowFile } from "../../src/core/workflow-check.ts";

// Slice 5.12, record 0077: a Sluiceway step with no mode is auto mode, and the
// check reads what it runs from the triggers of its file. The one-step
// workflow needs no if:, no needs: and no second job, so nothing of that is a
// warning for it.

const DEFAULTS = parseConfig("");
const READ_ONLY = parseConfig("dashboard:\n  readOnly: true\n");
const MERGES = parseConfig("mergeAndDeploy:\n  authors:\n    - renovate[bot]\n");

const PERMISSIONS = `permissions:
  contents: read
  issues: write
  deployments: write
  actions: write
  pull-requests: read
  checks: write
`;

const TRIGGERS = `on:
  push:
    branches: [main]
  schedule:
    - cron: "0 6 * * *"
  workflow_dispatch:
  issues:
    types: [edited]
`;

const JOB = `jobs:
  sluiceway:
    runs-on: ubuntu-latest
    concurrency:
      group: sluiceway-\${{ github.event.issue.number }}
      queue: max
    steps:
      - uses: actions/checkout@v7
      - uses: sluiceway/sluiceway@v0
`;

const ONE_STEP = `name: deploy-dashboard\n${TRIGGERS}\n${PERMISSIONS}\n${JOB}`;

function file(text: string, path = ".github/workflows/deploy-dashboard.yml"): WorkflowFile {
  return { path, text };
}

function kinds(text: string, config = DEFAULTS): string[] {
  return checkWorkflows([file(text)], config).warnings.map((warning) => warning.kind);
}

describe("the one-step workflow", () => {
  test("has nothing missing", () => {
    const report = checkWorkflows([file(ONE_STEP)], DEFAULTS);
    expect(report.warnings).toEqual([]);
    expect(report.notes).toEqual([]);
  });

  test("lists its one job as auto, with the modes its triggers start", () => {
    expect(checkWorkflows([file(ONE_STEP)], DEFAULTS).workflows).toEqual([
      {
        path: ".github/workflows/deploy-dashboard.yml",
        jobs: [
          {
            job: "sluiceway",
            mode: "auto",
            runs: ["scan", "resolve", "apply", "settle"],
            ref: "v0",
            refKind: "moving",
          },
        ],
      },
    ]);
  });

  test("mode: auto written out is the same", () => {
    const written = ONE_STEP.replace(
      "      - uses: sluiceway/sluiceway@v0\n",
      "      - uses: sluiceway/sluiceway@v0\n        with:\n          mode: auto\n",
    );
    expect(kinds(written)).toEqual([]);
  });

  test.each([
    ["push", "    branches: [main]\n"],
    ["schedule", '    - cron: "0 6 * * *"\n'],
  ] as const)("without %s", (trigger, body) => {
    const without = ONE_STEP.replace(`  ${trigger}:\n${body}`, "");
    expect(checkWorkflows([file(without)], DEFAULTS).warnings).toEqual([
      { kind: "missing-trigger", path: ".github/workflows/deploy-dashboard.yml", trigger },
    ]);
  });

  // Without issue edits the job only scans, as the read-only trial does.
  test("without issue edits a tick starts nothing", () => {
    expect(kinds(ONE_STEP.replace("  issues:\n    types: [edited]\n", ""))).toEqual([
      "boxes-do-nothing",
    ]);
  });

  test("a read-only dashboard needs no issue edits, and no permission to deploy", () => {
    const trial = ONE_STEP.replace("  issues:\n    types: [edited]\n", "").replace(
      "  actions: write\n",
      "  actions: read\n",
    );
    expect(kinds(trial, READ_ONLY)).toEqual([]);
  });

  test("the permissions are those of every mode it runs, in one warning", () => {
    const report = checkWorkflows(
      [file(ONE_STEP.replace("  actions: write\n", "  actions: read\n"))],
      DEFAULTS,
    );
    expect(report.warnings).toEqual([
      {
        kind: "missing-permissions",
        path: ".github/workflows/deploy-dashboard.yml",
        job: "sluiceway",
        mode: "auto",
        missing: ["actions: write"],
      },
    ]);
  });

  test("merge and deploy needs contents: write on the whole job", () => {
    const report = checkWorkflows([file(ONE_STEP)], MERGES);
    expect(report.warnings.map((warning) => warning.kind)).toEqual(["missing-permissions"]);
    // And no second apply job: auto deploys what the scan after a merge hands on.
    const fixed = ONE_STEP.replace("  contents: read\n", "  contents: write\n");
    expect(kinds(fixed, MERGES)).toEqual([]);
  });

  test("with no concurrency group", () => {
    const none = ONE_STEP.replace(
      "    concurrency:\n      group: sluiceway-${{ github.event.issue.number }}\n      queue: max\n",
      "",
    );
    expect(checkWorkflows([file(none)], DEFAULTS).warnings).toEqual([
      {
        kind: "no-concurrency",
        path: ".github/workflows/deploy-dashboard.yml",
        job: "sluiceway",
        mode: "auto",
      },
    ]);
  });

  // The group's name is not checked: a fixed one works too, slower.
  test("a group of another name is fine, and one without queue: max is not", () => {
    expect(kinds(ONE_STEP.replace("sluiceway-${{ github.event.issue.number }}", "deploy"))).toEqual(
      [],
    );
    expect(kinds(ONE_STEP.replace("      queue: max\n", ""))).toEqual(["auto-no-queue"]);
    expect(
      kinds(
        ONE_STEP.replace(
          "      queue: max\n",
          "      queue: max\n      cancel-in-progress: true\n",
        ),
      ),
    ).toEqual(["auto-cancels"]);
  });

  // The job loads credentials before Sluiceway, and on a pull request it
  // would load them for code that is not on the default branch.
  test("on pull requests", () => {
    const report = checkWorkflows(
      [file(ONE_STEP.replace("on:\n", "on:\n  pull_request:\n"))],
      DEFAULTS,
    );
    expect(report.warnings).toEqual([
      {
        kind: "forbidden-trigger",
        path: ".github/workflows/deploy-dashboard.yml",
        trigger: "pull_request",
        auto: true,
      },
    ]);
  });

  test("without checks: write, a note", () => {
    const report = checkWorkflows([file(ONE_STEP.replace("  checks: write\n", ""))], DEFAULTS);
    expect(report.notes.map((note) => note.kind)).toEqual(["no-preview-pages"]);
  });
});

describe("the check workflow with no mode", () => {
  const CHECK = `name: deploy-dashboard-check
on:
  pull_request:
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: sluiceway/sluiceway@v0
`;

  test("runs the check and nothing else, with nothing missing", () => {
    const report = checkWorkflows([file(CHECK, ".github/workflows/check.yml")], DEFAULTS);
    expect(report.workflows[0]?.jobs[0]?.runs).toEqual(["check"]);
    expect(report.warnings).toEqual([]);
  });

  test("next to the one-step workflow, still nothing missing", () => {
    const report = checkWorkflows(
      [file(CHECK, ".github/workflows/check.yml"), file(ONE_STEP)],
      DEFAULTS,
    );
    expect(report.warnings).toEqual([]);
  });
});
