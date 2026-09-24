// The cost estimate of an OpenTofu or Terraform preview (record 0105): the
// Infracost CLI's `diff` over the plan's JSON, which `tofu show -json` gave
// the preview anyway, so no tool runs against the cloud again. The CLI is
// the open source 0.10 line, whose `diff` reads a plan's JSON and asks its
// pricing API for prices: what leaves the runner is resource types, regions
// and quantities, never a value or a credential. Its output holds resource
// names and tag values, so only the totals are read from it and it never
// reaches the job log; its stderr does (record 0022).
import { writeFile } from "node:fs/promises";
import { z } from "zod";
import type { CostFailure, CostResult } from "../../core/cost.ts";
import { toolEnvironment } from "../environment.ts";
import type { ProcessRunner } from "../process.ts";
import { stripAnsi } from "../tool-run.ts";
import type { PlanFile } from "./plan-file.ts";

export const INFRACOST = "infracost";

// The plan's JSON, next to the plan file, so the CLI reads nothing of the
// checkout: no code, no git metadata.
export const PLAN_JSON = "plan.json";

// `diff` gives the change between the plan's prior state and its planned
// state, which is what a row shows: the change to the bill, never the bill.
export function costArgs(): string[] {
  return [INFRACOST, "diff", "--path", PLAN_JSON, "--format", "json", "--no-color"];
}

// The job's environment as every tool gets it (record 0013), with the two
// settings that keep the CLI to the pricing API: no check for a newer
// version, and no upload of the run to Infracost Cloud.
export function infracostEnvironment(
  env: Record<string, string | undefined>,
): Record<string, string> {
  return {
    ...toolEnvironment(env),
    INFRACOST_SKIP_UPDATE_CHECK: "true",
    INFRACOST_ENABLE_CLOUD: "false",
  };
}

// What is read of the CLI's JSON, and nothing more. A project of type
// "error", or with errors, is one the CLI could not price: it then exits
// with 0 and every total is 0, which must never read as a change that costs
// nothing.
const output = z.object({
  currency: z.string(),
  diffTotalMonthlyCost: z.string(),
  projects: z.array(
    z.object({
      metadata: z.object({
        type: z.string(),
        errors: z.array(z.object({ message: z.string() })).optional(),
      }),
    }),
  ),
});

export function readCostOutput(stdout: string): CostResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return unreadable();
  }
  const read = output.safeParse(parsed);
  const monthly = read.success ? Number(read.data.diffTotalMonthlyCost) : Number.NaN;
  if (!read.success || !Number.isFinite(monthly)) return unreadable();
  const reported = read.data.projects.reduce(
    (sum, project) => sum + (project.metadata.errors?.length ?? 0),
    0,
  );
  const failed = read.data.projects.some((project) => project.metadata.type === "error");
  if (reported > 0 || failed || read.data.projects.length === 0) {
    const errors = Math.max(reported, 1);
    return {
      ok: false,
      reason: { kind: "reported-error" },
      detail: [
        `The Infracost CLI's output reports ${errors === 1 ? "1 error" : `${errors} errors`} for the plan. Its words are in the log below.`,
      ],
    };
  }
  return { ok: true, estimate: { monthly, currency: read.data.currency } };
}

function unreadable(): CostResult {
  return {
    ok: false,
    reason: { kind: "unreadable-output" },
    detail: [
      "Expected the JSON of infracost diff --format json with currency, diffTotalMonthlyCost and projects, and the output does not fit.",
    ],
  };
}

export interface EstimateOptions {
  env: Record<string, string | undefined>;
  run: ProcessRunner;
  timeoutMinutes: number;
}

// Writes the plan's JSON next to the plan and runs the CLI on it, in the
// plan's directory, with the preview's time limit. The JSON goes with the
// plan's directory (record 0053). It always resolves: a CLI that is not
// there, that ran out of time, that exited with an error or whose output
// says it could not price the plan is a failed estimate, which is a missing
// line on the row and never a red scan.
export async function estimateCost(
  planJson: string,
  plan: PlanFile,
  options: EstimateOptions,
): Promise<CostResult & { toolLog: string }> {
  await writeFile(plan.jsonPath, planJson);
  const result = await options.run({
    argv: costArgs(),
    cwd: plan.dir,
    env: infracostEnvironment(options.env),
    timeoutMs: options.timeoutMinutes * 60_000,
  });
  if (result.status === "not-started") {
    return {
      ok: false,
      reason: { kind: "not-started" },
      detail: [
        "The Infracost CLI could not be started. Add a workflow step that installs it before the step that runs Sluiceway, or turn cost.enabled off.",
      ],
      toolLog: "",
    };
  }
  const toolLog = stripAnsi(result.stderr);
  if (result.status === "timed-out") {
    return {
      ok: false,
      reason: { kind: "timed-out", minutes: options.timeoutMinutes },
      detail: [],
      toolLog,
    };
  }
  if (result.exitCode !== 0) {
    const reason: CostFailure = { kind: "exited", exitCode: result.exitCode };
    return { ok: false, reason, detail: [], toolLog };
  }
  return { ...readCostOutput(result.stdout), toolLog };
}
