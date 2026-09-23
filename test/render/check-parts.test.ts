import { describe, expect, test } from "bun:test";
import type { CheckReport } from "../../src/core/check.ts";
import type { WorkflowReport } from "../../src/core/workflow-check.ts";
import {
  backendPart,
  type CheckLogEntry,
  checkParts,
  closingPart,
  renderCheckSummary,
} from "../../src/render/check.ts";

// The check's facts render once (record 0042): each part holds a topic as the
// job log and as the summary show it, so the two views cannot drift apart.
// The words themselves are pinned by the tests of the check mode.

const EMPTY: CheckReport = {
  stacks: [],
  ignore: [],
  unclaimed: [],
  suggested: [],
  shared: [],
  phases: [],
  reads: [],
  inputs: [],
};

const NO_WORKFLOWS: WorkflowReport = { workflows: [], warnings: [], notes: [] };

const texts = (entries: CheckLogEntry[]) =>
  entries.map((entry) =>
    "info" in entry ? entry.info : "warning" in entry ? entry.warning : entry.group,
  );

describe("the parts of the check", () => {
  test("the summary is every part in order, each paragraph apart", () => {
    const parts = [
      ...checkParts({ report: EMPTY, workflows: NO_WORKFLOWS, unrelated: [], hasConfigFile: true }),
      closingPart(false),
    ];
    const summary = renderCheckSummary(parts);
    expect(summary).toBe(`${parts.flatMap((part) => part.summary).join("\n\n")}\n`);
    expect(summary.startsWith("## Sluiceway check\n\nThe setup is valid.\n\n### Stacks")).toBe(
      true,
    );
  });

  test("the verdict opens the summary and closes the job log", () => {
    const [header] = checkParts({
      report: EMPTY,
      workflows: NO_WORKFLOWS,
      unrelated: [],
      hasConfigFile: true,
    });
    expect(header?.log).toEqual([]);
    expect(texts(closingPart(false).log)[0]).toBe("The setup is valid.");
    expect(closingPart(true).summary).not.toContain("The setup is valid.");
  });

  test("a workflow warning is a warning in the log and a bullet in the summary", () => {
    const workflows: WorkflowReport = {
      workflows: [],
      warnings: [{ kind: "boxes-do-nothing", path: ".github/workflows/x.yml" }],
      notes: [],
    };
    const part = checkParts({ report: EMPTY, workflows, unrelated: [], hasConfigFile: true }).at(
      -1,
    );
    const warning = part?.log.find((entry) => "warning" in entry);
    expect(warning).toMatchObject({ title: "A workflow is missing something" });
    const text = warning !== undefined && "warning" in warning ? warning.warning : "";
    expect(part?.summary).toContain(`- ${text}`);
  });

  // The tool's own words stay in the job log (record 0022).
  test("the backend's tool log goes to the job log alone", () => {
    const part = backendPart([{ stackId: "app:prod", found: true }], [], "said this\n");
    expect(part.log[0]).toEqual({ group: "The tool's own words", lines: ["said this"] });
    expect(part.summary.join("\n")).not.toContain("said this");
  });
});

// Slice 5.28, record 0093: for every job that deploys, one line says who
// decides who may deploy, from what the file shows and nothing more.
describe("who may deploy", () => {
  const PATH = ".github/workflows/deploy-dashboard.yml";
  const job = (mode: "auto" | "scan" | "apply", environment?: string) => ({
    job: mode === "auto" ? "sluiceway" : mode,
    mode,
    runs: mode === "auto" ? (["scan", "resolve", "apply", "settle"] as const) : ([mode] as const),
    ref: "v0",
    refKind: "moving" as const,
    ...(environment === undefined ? {} : { environment }),
  });
  const partOf = (jobs: ReturnType<typeof job>[]) =>
    checkParts({
      report: EMPTY,
      workflows: {
        workflows: [{ path: PATH, jobs: jobs.map((one) => ({ ...one, runs: [...one.runs] })) }],
        warnings: [],
        notes: [],
      },
      unrelated: [],
      hasConfigFile: true,
    }).at(-1);

  test("a deploying job with no environment: the tick rule alone", () => {
    const part = partOf([job("auto")]);
    const text =
      "Who may deploy: .github/workflows/deploy-dashboard.yml, job sluiceway names no GitHub Environment, so the tick rule alone decides who may deploy.";
    expect(texts(part?.log ?? [])).toContain(text);
    expect(part?.summary).toContain(`- ${text}`);
  });

  test("a deploying job with an environment: its reviewers, if it has them", () => {
    const part = partOf([job("scan"), job("apply", "production")]);
    const text =
      "Who may deploy: .github/workflows/deploy-dashboard.yml, job apply deploys in the GitHub Environment production. The tick rule decides who may ask. If production has required reviewers, they decide who may deploy. Whether it has them is a setting of the repo, which the check cannot read.";
    expect(texts(part?.log ?? [])).toContain(text);
    expect(part?.summary).toContain(`- ${text}`);
    // The scan job deploys nothing, so it gets no line.
    expect(texts(part?.log ?? []).filter((line) => line.startsWith("Who may deploy"))).toEqual([
      text,
    ]);
  });

  test("no job deploys: no line", () => {
    const part = partOf([job("scan", "production")]);
    expect(texts(part?.log ?? []).some((line) => line.startsWith("Who may deploy"))).toBe(false);
    expect(part?.summary.join("\n")).not.toContain("Who may deploy");
  });
});
