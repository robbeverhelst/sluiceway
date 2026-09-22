import { describe, expect, test } from "bun:test";
import { parseConfig } from "../../src/core/config.ts";
import { checkWorkflows, type WorkflowFile } from "../../src/core/workflow-check.ts";
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

// The whole workflow, to break one piece at a time.
const WHOLE = README.find((text) => text.includes("mode: resolve")) ?? "";

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
    const report = checkWorkflows(
      [file(README[0] ?? "", ".github/workflows/check.yml"), file(WHOLE)],
      DEFAULTS,
    );
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
          { job: "scan", mode: "scan", ref: "v0", refKind: "moving" },
          { job: "resolve", mode: "resolve", ref: "v0", refKind: "moving" },
          { job: "apply", mode: "apply", ref: "v0", refKind: "moving" },
          { job: "settle", mode: "settle", ref: "v0", refKind: "moving" },
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

  test("a step with no mode, or one that does not exist", () => {
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
