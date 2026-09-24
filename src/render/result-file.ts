// The result file of a scan and of an apply (record 0041): what the summary
// holds, as JSON, for a workflow step that sends it somewhere or charts it.
// Sluiceway sends nothing itself. The file is rendered from the same summary
// data as the summary (records 0021 and 0037), which holds a value only at a
// path that `dashboard.showValues` lists (record 0052), and every failure reason in it comes from the fixed list (record 0022). The
// schemas below are strict, so a field that is not named here cannot ride
// along: the renderer checks its own output against them.

import { z } from "zod";
import type { Change, Diff } from "../core/diff.ts";
import type { AppliedPreview, ApplyOutcome } from "./apply-summary.ts";
import { orderChanges } from "./changes.ts";
import { dashboardFacts } from "./dashboard-facts.ts";
import type { ParsedRow } from "./marker.ts";
import { byCodeUnit, sortedDrift, sortedKeys } from "./row.ts";
import type { SummaryMerge, SummaryStack } from "./summary.ts";

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
// change and the paths of the changed properties, whole (record 0046). No
// address, and a value only as a row shows it: at a path that
// `dashboard.showValues` lists, shortened (record 0052).
const changeSchema = z.strictObject({
  type: z.string(),
  name: z.string(),
  op: z.enum(["create", "update", "replace", "delete", "none"]),
  tracking: z.enum(["import", "forget", "move"]).optional(),
  changedKeys: z.array(z.string()),
  replaceKeys: z.array(z.string()),
  // Absent when no path of the change is listed. A side is absent when the
  // property is not there on that side.
  values: z
    .array(
      z.strictObject({
        path: z.string(),
        old: z.string().optional(),
        new: z.string().optional(),
      }),
    )
    .optional()
    .describe(
      "The old and new value at a path the repo lists in dashboard.showValues: a scalar of one line, and never one the tool marks secret. The only field of the file that may hold a property value.",
    ),
});

const diffSchema = {
  // `drift`: nothing to deploy from the code, and drift found (record 0055).
  state: z.enum(["pending", "in-sync", "drift"]),
  counts: countsSchema,
  // Deletes, then replaces, then the rest (record 0024).
  changes: z.array(changeSchema),
  // What changed outside the code, when the scan checked and found some
  // (record 0055). `update` is a property that changed, `delete` an object
  // that is gone. Sorted by address.
  drift: z.array(changeSchema).optional(),
};

const failedSchema = {
  state: z.literal("preview-failed"),
  // A failure reason from the fixed list (record 0022).
  reason: z.string(),
};

// A merged pull request or a direct push the stack claims since its last
// successful deploy (record 0026), as the summary lists it: the title of a
// pull request, the first line of a push's message, the plain login of the
// author when GitHub has one (record 0061).
const attributionSchema = z.array(
  z.union([
    z.strictObject({
      kind: z.literal("pull-request"),
      number: count(),
      title: z.string(),
      url: z.string(),
      author: z.string().optional(),
    }),
    z.strictObject({
      kind: z.literal("push"),
      commit: z.string(),
      message: z.string(),
      url: z.string(),
      author: z.string().optional(),
    }),
  ]),
);

const scanStackSchema = z.union([
  z.strictObject({
    stack: z.string(),
    seconds: z.number(),
    ...diffSchema,
    // Newest first. Absent when the lookup failed or the stack is not one a
    // row names merges for: attribution never blocks (record 0026).
    attribution: attributionSchema.optional(),
  }),
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
  // `refused`: the change moved since the tick, the record was not one this
  // job may deploy, or deploys are turned off. `failed`: the deploy was
  // tried, or meant to be, and did not go out. `in-sync`: the fresh preview
  // had nothing to deploy. `rehearsed`: `dry-run` stopped after the hash
  // check (record 0051).
  outcome: z.enum(["deployed", "in-sync", "rehearsed", "refused", "failed"]),
  // Null when the job never learned which stack the record is for.
  stack: z.string().nullable(),
  ticker: z.string().nullable(),
  // The deploy failure reason from the fixed list (record 0022), when there is one.
  reason: z.string().nullable(),
  // How long the job took, and how long the tool's deploy inside it took.
  // `deploySeconds` is null when the tool was never asked to deploy (record
  // 0061).
  seconds: z.number(),
  deploySeconds: z.number().nullable(),
  // The fresh preview that was held against the tick. After a deploy it is
  // what went out, after a rehearsal what would have.
  preview: previewSchema.nullable(),
  // The preview after a deploy that failed half way: what is pending now.
  after: previewSchema.nullable(),
});

export type ScanResult = z.infer<typeof scanResultSchema>;
export type ApplyResult = z.infer<typeof applyResultSchema>;
export type ApplyResultOutcome = ApplyResult["outcome"];

// Five numbers of the counts line of the dashboard, the ones the counts line
// always shows, and the failed deploys. A row of a state this version does
// not know is not counted.
export interface DashboardCounts {
  pending: number;
  deploying: number;
  previewFailed: number;
  inSync: number;
  failedDeploys: number;
}

export function dashboardCounts(rows: readonly ParsedRow[]): DashboardCounts {
  const { pending, deploying, previewFailed, inSync, failedDeploys } = dashboardFacts(rows).counts;
  return { pending, deploying, previewFailed, inSync, failedDeploys };
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
  // From the start of the job to this file.
  milliseconds: number;
  // The tool's deploy, when it was asked to deploy.
  deployMilliseconds?: number | undefined;
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
    ...(change.values === undefined || change.values.length === 0
      ? {}
      : { values: change.values.map((value) => ({ ...value })) }),
  };
}

function diffOf(diff: Diff) {
  const { deletes, replaces, others } = orderChanges(diff);
  const drift = sortedDrift(diff);
  const of = (op: Change["op"]) => diff.changes.filter((change) => change.op === op).length;
  return {
    state:
      diff.changes.length > 0
        ? ("pending" as const)
        : drift.length > 0
          ? ("drift" as const)
          : ("in-sync" as const),
    counts: {
      create: of("create"),
      update: of("update"),
      replace: of("replace"),
      delete: of("delete"),
      trackingOnly: diff.changes.filter((change) => change.op === "none" && change.tracking).length,
    },
    changes: [...deletes, ...replaces, ...others].map(changeOf),
    ...(drift.length === 0 ? {} : { drift: drift.map(changeOf) }),
  };
}

function attributionOf(merges: SummaryMerge[]): z.infer<typeof attributionSchema> {
  return merges.map((merge) => {
    const author = merge.author === undefined ? {} : { author: merge.author };
    return merge.kind === "pull-request"
      ? { kind: merge.kind, number: merge.number, title: merge.title, url: merge.url, ...author }
      : {
          kind: merge.kind,
          commit: merge.sha,
          message: merge.message.split(/\r?\n/, 1)[0] ?? "",
          url: merge.url,
          ...author,
        };
  });
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
        ? {
            stack: stack.diff.stackId,
            seconds: seconds(milliseconds),
            ...diffOf(stack.diff),
            ...(stack.merges === undefined ? {} : { attribution: attributionOf(stack.merges) }),
          }
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
      seconds: seconds(input.milliseconds),
      deploySeconds:
        input.deployMilliseconds === undefined ? null : seconds(input.deployMilliseconds),
      preview:
        applied?.kind === "deployed" || applied?.kind === "rehearsed"
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
      "What the summary of a scan or an apply holds, written under RUNNER_TEMP. It holds no secret and none of the tool's own words, and no property value except the old and new value at a path the repo lists in dashboard.showValues.",
    ...rest,
  };
}
