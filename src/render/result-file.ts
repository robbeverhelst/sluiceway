// The result file of a scan and of an apply (record 0041): what the summary
// holds, as JSON, for a workflow step that sends it somewhere or charts it.
// Sluiceway sends nothing itself. The file is rendered from the same summary
// data as the summary (records 0021 and 0037), which has no field for a value,
// and every failure reason in it comes from the fixed list (record 0022). The
// schemas below are strict, so a field that is not named here cannot ride
// along: the renderer checks its own output against them.

import { z } from "zod";
import type { Change, Diff } from "../core/diff.ts";
import type { AppliedPreview, ApplyOutcome } from "./apply-summary.ts";
import { orderChanges } from "./changes.ts";
import type { ParsedRow } from "./marker.ts";
import { byCodeUnit, sortedKeys } from "./row.ts";
import type { SummaryStack } from "./summary.ts";

// The shape of the file. A reader checks it before anything else, and a
// change that breaks a reader raises it.
export const RESULT_FILE_VERSION = 1;

const count = () => z.int().min(0);

const countsSchema = z.strictObject({
  create: count(),
  update: count(),
  replace: count(),
  delete: count(),
  // Changes that only touch the tool's record of an object (record 0007).
  trackingOnly: count(),
});

// One change as a row shows it: the type, the name, the op, the tracking
// change and the paths of the changed properties, whole (record 0045). No
// address and no value.
const changeSchema = z.strictObject({
  type: z.string(),
  name: z.string(),
  op: z.enum(["create", "update", "replace", "delete", "none"]),
  tracking: z.enum(["import", "forget", "move"]).optional(),
  changedKeys: z.array(z.string()),
  replaceKeys: z.array(z.string()),
});

const diffSchema = {
  state: z.enum(["pending", "in-sync"]),
  counts: countsSchema,
  // Deletes, then replaces, then the rest (record 0024).
  changes: z.array(changeSchema),
};

const failedSchema = {
  state: z.literal("preview-failed"),
  // A failure reason from the fixed list (record 0022).
  reason: z.string(),
};

const scanStackSchema = z.union([
  z.strictObject({ stack: z.string(), seconds: z.number(), ...diffSchema }),
  z.strictObject({
    stack: z.string(),
    seconds: z.number(),
    ...failedSchema,
    // The glob that takes a stack the backend does not have off the dashboard.
    ignore: z.string().optional(),
  }),
]);

export const scanResultSchema = z.strictObject({
  version: z.literal(RESULT_FILE_VERSION),
  mode: z.literal("scan"),
  // The workflow run of the scan.
  run: z.string(),
  // The commit the scan checked out.
  commit: z.string(),
  // How long the scan took.
  seconds: z.number(),
  // The dashboard after this scan: its counts line in numbers. Null when the
  // scan did not get as far as writing it.
  dashboard: z
    .strictObject({
      url: z.string(),
      // True when this scan wrote a body that differs from the one before.
      changed: z.boolean(),
      pending: count(),
      deploying: count(),
      previewFailed: count(),
      inSync: count(),
      failedDeploys: count(),
    })
    .nullable(),
  // Every stack this scan previewed, in stack id order, as the summary lists
  // them. A stack whose row was carried through is not here.
  stacks: z.array(scanStackSchema),
});

const previewSchema = z.union([z.strictObject(diffSchema), z.strictObject(failedSchema)]);

export const applyResultSchema = z.strictObject({
  version: z.literal(RESULT_FILE_VERSION),
  mode: z.literal("apply"),
  run: z.string(),
  commit: z.string(),
  // The deployment record this job was handed.
  deployment: count(),
  dashboard: z.strictObject({ url: z.string() }).nullable(),
  // `refused`: the change moved since the tick, or the record was not one
  // this job may deploy. `failed`: the deploy was tried, or meant to be, and
  // did not go out.
  outcome: z.enum(["deployed", "refused", "failed"]),
  // Null when the job never learned which stack the record is for.
  stack: z.string().nullable(),
  ticker: z.string().nullable(),
  // The deploy failure reason from the fixed list (record 0022), when there is one.
  reason: z.string().nullable(),
  // The fresh preview that was held against the tick. After a deploy it is
  // what went out.
  preview: previewSchema.nullable(),
  // The preview after a deploy that failed half way: what is pending now.
  after: previewSchema.nullable(),
});

export type ScanResult = z.infer<typeof scanResultSchema>;
export type ApplyResult = z.infer<typeof applyResultSchema>;
export type ApplyResultOutcome = ApplyResult["outcome"];

// The counts line of the dashboard in numbers, counted from the row markers
// the way the counts line is. A row of a state this version does not know is
// not counted.
export interface DashboardCounts {
  pending: number;
  deploying: number;
  previewFailed: number;
  inSync: number;
  failedDeploys: number;
}

export function dashboardCounts(rows: readonly ParsedRow[]): DashboardCounts {
  const known = rows.filter((row) => row.known);
  const of = (state: string) => known.filter((row) => row.state === state).length;
  return {
    pending: of("pending"),
    deploying: of("deploying"),
    previewFailed: of("preview-failed"),
    inSync: of("in-sync"),
    failedDeploys: known.filter((row) => row.failed).length,
  };
}

export interface ScanResultInput {
  // The web address of the run.
  run: string;
  commit: string;
  milliseconds: number;
  dashboard?: { url: string; changed: boolean; counts: DashboardCounts } | undefined;
  stacks: { stack: SummaryStack; milliseconds: number }[];
}

export interface ApplyResultInput {
  run: string;
  commit: string;
  deployment: number;
  dashboardUrl?: string | undefined;
  outcome: ApplyResultOutcome;
  stack?: string | undefined;
  ticker?: string | undefined;
  // The deploy failure reason, as display text. Also for a deploy that stopped
  // before there was anything to summarize.
  reason?: string | undefined;
  // What the summary of the apply shows, when the job wrote one.
  applied?: ApplyOutcome | undefined;
}

function seconds(milliseconds: number): number {
  return milliseconds / 1000;
}

function changeOf(change: Change): z.infer<typeof changeSchema> {
  return {
    type: change.type,
    name: change.name,
    op: change.op,
    ...(change.tracking === undefined ? {} : { tracking: change.tracking }),
    changedKeys: sortedKeys(change.changedKeys),
    replaceKeys: sortedKeys(change.replaceKeys),
  };
}

function diffOf(diff: Diff) {
  const { deletes, replaces, others } = orderChanges(diff);
  const of = (op: Change["op"]) => diff.changes.filter((change) => change.op === op).length;
  return {
    state: diff.changes.length === 0 ? ("in-sync" as const) : ("pending" as const),
    counts: {
      create: of("create"),
      update: of("update"),
      replace: of("replace"),
      delete: of("delete"),
      trackingOnly: diff.changes.filter((change) => change.op === "none" && change.tracking).length,
    },
    changes: [...deletes, ...replaces, ...others].map(changeOf),
  };
}

function stackIdOf(stack: SummaryStack): string {
  return stack.kind === "diff" ? stack.diff.stackId : stack.stackId;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function scanResultFile(input: ScanResultInput): string {
  const stacks = [...input.stacks]
    .sort((a, b) => byCodeUnit(stackIdOf(a.stack), stackIdOf(b.stack)))
    .map(({ stack, milliseconds }) =>
      stack.kind === "diff"
        ? { stack: stack.diff.stackId, seconds: seconds(milliseconds), ...diffOf(stack.diff) }
        : {
            stack: stack.stackId,
            seconds: seconds(milliseconds),
            state: "preview-failed" as const,
            reason: stack.reason,
            ...(stack.ignore === undefined ? {} : { ignore: stack.ignore }),
          },
    );
  const { dashboard } = input;
  return json(
    scanResultSchema.parse({
      version: RESULT_FILE_VERSION,
      mode: "scan",
      run: input.run,
      commit: input.commit,
      seconds: seconds(input.milliseconds),
      dashboard: dashboard
        ? { url: dashboard.url, changed: dashboard.changed, ...dashboard.counts }
        : null,
      stacks,
    }),
  );
}

function previewOf(preview: AppliedPreview | undefined) {
  if (preview === undefined) return null;
  return preview.kind === "diff"
    ? diffOf(preview.diff)
    : { state: "preview-failed" as const, reason: preview.reason };
}

export function applyResultFile(input: ApplyResultInput): string {
  const { applied } = input;
  return json(
    applyResultSchema.parse({
      version: RESULT_FILE_VERSION,
      mode: "apply",
      run: input.run,
      commit: input.commit,
      deployment: input.deployment,
      dashboard: input.dashboardUrl === undefined ? null : { url: input.dashboardUrl },
      outcome: input.outcome,
      stack: input.stack ?? null,
      ticker: input.ticker ?? null,
      reason: input.reason ?? null,
      preview:
        applied?.kind === "deployed"
          ? diffOf(applied.diff)
          : previewOf(applied?.kind === "not-deployed" ? applied.checked : undefined),
      after: previewOf(applied?.kind === "not-deployed" ? applied.after : undefined),
    }),
  );
}

// The JSON schema of both files, for a reader that wants to check one. The
// tests hold it as a snapshot, so a change to the shape cannot go unnoticed.
export function resultFileJsonSchema(): Record<string, unknown> {
  const { $schema, ...rest } = z.toJSONSchema(
    z.discriminatedUnion("mode", [scanResultSchema, applyResultSchema]),
    { target: "draft-7" },
  );
  return {
    $schema,
    title: "Sluiceway result file",
    description:
      "What the summary of a scan or an apply holds, written under RUNNER_TEMP. No property value and none of the tool's own words.",
    ...rest,
  };
}
