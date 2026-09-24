import { describe, expect, test } from "bun:test";
import { parseConfig } from "../../src/core/config.ts";
import { checkWorkflows, type WorkflowFile } from "../../src/core/workflow-check.ts";
import { workflowWarningText } from "../../src/render/check.ts";

// Record 0101: a check step with pull-request-preview: true writes a page per
// stack, which needs checks: write, and must never sit in a file that runs on
// pull_request_target.

const DEFAULTS = parseConfig("");

function file(text: string, path = ".github/workflows/deploy-dashboard-check.yml"): WorkflowFile {
  return { path, text };
}

const preview = (on: string, permissions: string) => `name: deploy-dashboard-check
on:
  ${on}:
permissions:
${permissions}
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: sluiceway/sluiceway@v0
        with:
          pull-request-preview: true
`;

describe("a check step that previews pull requests", () => {
  test("with contents: read and checks: write on pull_request has nothing missing", () => {
    const report = checkWorkflows(
      [file(preview("pull_request", "  contents: read\n  checks: write"))],
      DEFAULTS,
    );
    expect(report.warnings).toEqual([]);
    expect(report.workflows[0]?.jobs[0]?.previewsPullRequests).toBe(true);
  });

  test("without checks: write the pages cannot be written, and the check says so", () => {
    const report = checkWorkflows([file(preview("pull_request", "  contents: read"))], DEFAULTS);
    expect(report.warnings).toEqual([
      {
        kind: "missing-permissions",
        path: ".github/workflows/deploy-dashboard-check.yml",
        job: "check",
        mode: "auto",
        missing: ["checks: write"],
      },
    ]);
  });

  test("a file that runs it on pull_request_target is a warning of its own", () => {
    const report = checkWorkflows(
      [file(preview("pull_request_target", "  contents: read\n  checks: write"))],
      DEFAULTS,
    );
    expect(report.warnings).toEqual([
      {
        kind: "preview-on-target",
        path: ".github/workflows/deploy-dashboard-check.yml",
        job: "check",
      },
    ]);
    expect(workflowWarningText(report.warnings[0]!)).toBe(
      ".github/workflows/deploy-dashboard-check.yml, job check: pull-request-preview: true runs on pull_request_target, which Sluiceway never previews on: it runs with the secrets of the base branch against code that is not merged. Run it on pull_request, where a fork's pull request is refused.",
    );
  });

  test("a check step without the input needs nothing new", () => {
    const text = preview("pull_request", "  contents: read").replace(
      "        with:\n          pull-request-preview: true\n",
      "",
    );
    expect(checkWorkflows([file(text)], DEFAULTS).warnings).toEqual([]);
  });
});
