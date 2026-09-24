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
// The credentials part is its own test (slice 5.34).
const NO_CREDENTIALS = { stacks: [], jobs: [] };
// A job with nothing around its step.
const PROVIDES = { names: [], steps: [] };

const texts = (entries: CheckLogEntry[]) =>
  entries.map((entry) =>
    "info" in entry ? entry.info : "warning" in entry ? entry.warning : entry.group,
  );

describe("the parts of the check", () => {
  test("the summary is every part in order, each paragraph apart", () => {
    const parts = [
      ...checkParts({
        report: EMPTY,
        workflows: NO_WORKFLOWS,
        credentials: NO_CREDENTIALS,
        unrelated: [],
        hasConfigFile: true,
      }),
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
      credentials: NO_CREDENTIALS,
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
    const part = checkParts({
      report: EMPTY,
      workflows,
      credentials: NO_CREDENTIALS,
      unrelated: [],
      hasConfigFile: true,
    }).at(-2);
    const warning = part?.log.find((entry) => "warning" in entry);
    expect(warning).toMatchObject({ title: "A workflow is missing something" });
    const text = warning !== undefined && "warning" in warning ? warning.warning : "";
    expect(part?.summary).toContain(`- ${text}`);
  });

  // Record 0107: a stack the backend lacks whose entry asks the scan to
  // create it is a line, not a warning, and stays out of the ignore block.
  test("a stack the scan will create is a line, not a warning, and not in the ignore block", () => {
    const part = backendPart(
      [
        { stackId: "app:prod", found: false, createInBackend: true },
        { stackId: "app:qa", found: false },
      ],
      [],
      "",
    );
    const warnings = part.log.flatMap((entry) => ("warning" in entry ? [entry.warning] : []));
    expect(warnings).toEqual([expect.stringContaining("app:qa has files in the repo")]);
    const block = part.log.find(
      (entry) =>
        "group" in entry && entry.group === "Ready to paste into sluiceway.yaml, over ignore",
    );
    expect(block !== undefined && "lines" in block ? block.lines : []).toEqual([
      "ignore:",
      '  - "app:qa"',
    ]);
    expect(part.summary.join("\n")).toContain("| app:prod | No, the first scan creates it |");
  });

  test("with only stacks the scan will create missing, there is no block and no word that every stack is in", () => {
    const part = backendPart(
      [
        { stackId: "app:prod", found: false, createInBackend: true },
        { stackId: "app:qa", found: true },
      ],
      [],
      "",
    );
    expect(texts(part.log)).toEqual(["Stacks in the backend"]);
    expect(part.summary.join("\n")).not.toContain("Every stack the backend was asked about");
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
    provides: PROVIDES,
  });
  const partOf = (jobs: ReturnType<typeof job>[]) =>
    checkParts({
      report: EMPTY,
      workflows: {
        workflows: [{ path: PATH, jobs: jobs.map((one) => ({ ...one, runs: [...one.runs] })) }],
        warnings: [],
        notes: [],
      },
      credentials: NO_CREDENTIALS,
      unrelated: [],
      hasConfigFile: true,
    }).at(-2);

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

// Record 0095: the check says which stacks deploy on merge, in the log line
// of each stack and in a column of the summary's table that is there only
// when one does, so a setup without it keeps its table.
describe("a stack set to on-merge in the check", () => {
  const configured = (id: string, deploy?: "on-merge") => ({
    stack: { path: id, options: {} },
    environment: "sluiceway",
    tickers: "write" as const,
    inputs: [],
    ...(deploy ? { deploy } : {}),
  });
  const parts = (report: CheckReport) =>
    checkParts({
      report,
      workflows: NO_WORKFLOWS,
      credentials: NO_CREDENTIALS,
      unrelated: [],
      hasConfigFile: true,
    });

  test("its line and the table say it deploys on merge", () => {
    const all = parts({ ...EMPTY, stacks: [configured("app", "on-merge"), configured("db")] });
    const lines = all
      .flatMap((part) => part.log)
      .flatMap((entry) => ("group" in entry ? entry.lines : []));
    expect(lines).toContain(
      "app: environment sluiceway, tickers write, no inputs, deploys on merge",
    );
    expect(lines).toContain("db: environment sluiceway, tickers write, no inputs");
    const summary = renderCheckSummary(all);
    expect(summary).toContain("| Stack | Environment | Tickers | Inputs | Deploys |");
    expect(summary).toContain("| app | sluiceway | write | none | on merge |");
    expect(summary).toContain("| db | sluiceway | write | none | on a tick |");
  });

  test("without one, the table has no such column", () => {
    const summary = renderCheckSummary(parts({ ...EMPTY, stacks: [configured("db")] }));
    expect(summary).toContain("| Stack | Environment | Tickers | Inputs |\n");
  });
});
