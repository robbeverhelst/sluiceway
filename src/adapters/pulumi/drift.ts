import { join } from "node:path";
import { z } from "zod";
import type { Change, Op } from "../../core/diff.ts";
import type { PreviewFailureReason } from "../../core/failure-reason.ts";
import type { Stack } from "../../core/stack.ts";
import type { DriftResult, PreviewOptions } from "../adapter.ts";
import { runTool, stripAnsi } from "../tool-run.ts";
import { pulumiEnvironment } from "./environment.ts";
import { PULUMI_EXIT_CODES } from "./exit-codes.ts";
import { typeAndName } from "./fold.ts";

// The drift check (record 0055): a refresh that only previews. It compares the
// stack's state with what is real and changes neither (Pulumi research). From
// v3.229.0 it takes no stack lock on a file backend, so it never blocks a
// deploy and a deploy never blocks it (record 0001).
function driftCommand(name: string): string[] {
  return [
    "pulumi",
    "refresh",
    "--preview-only",
    "--json",
    "--non-interactive",
    "--color",
    "never",
    "--stack",
    name,
  ];
}

// The tool's one JSON document lists a property that drifted as a plain
// "refresh" step with no paths, and only its change summary counts it: seen on
// v3.229.0 and v3.263.0 (record 0055). Its engine events name the resource
// and the op, so the check asks for those, one JSON document per line. This
// variable changes only how the tool prints (record 0013).
const STREAM_EVENTS = { PULUMI_ENABLE_STREAMING_JSON_PREVIEW: "true" };

// What the check found for one resource, from the event that closes it. Zod
// drops every other key: the event also holds the old and new state, which
// are property values (record 0021).
const outputsEvent = z.object({
  resOutputsEvent: z.object({
    metadata: z.object({
      op: z.string(),
      urn: z.string(),
      diffs: z.array(z.string()).nullish(),
      detailedDiff: z
        .record(z.string(), z.unknown())
        .nullish()
        .transform((paths) => (paths == null ? undefined : Object.keys(paths))),
    }),
  }),
});

const summaryEvent = z.object({
  summaryEvent: z.object({ resourceChanges: z.record(z.string(), z.number()).nullish() }),
});

const diagnosticEvent = z.object({ diagnosticEvent: z.object({ message: z.string() }) });

// From the tool's ops to drift, settled from the recordings of both CLI
// versions. "same" is a resource as it was. "refresh" is named by record 0007
// as a step that changes nothing. Anything else fails the check.
const DRIFT_OPS: Record<string, Op | "drop"> = {
  same: "drop",
  refresh: "drop",
  update: "update",
  delete: "delete",
};

export async function detectDrift(stack: Stack, options: PreviewOptions): Promise<DriftResult> {
  if (stack.name === undefined) throw new Error("A Pulumi stack always has a name.");
  const result = await runTool(options.run, {
    argv: driftCommand(stack.name),
    // The same directory, environment and time limit as the preview (record
    // 0012).
    cwd: join(options.root, stack.path),
    env: { ...pulumiEnvironment(options.env), ...STREAM_EVENTS },
    timeoutMinutes: options.timeoutMinutes,
    // As on the preview, the reason comes from the exit code alone.
    exitCodes: PULUMI_EXIT_CODES,
  });

  const failed = (reason: PreviewFailureReason, toolLog: string, detail: string[] = []) =>
    ({ ok: false, reason, detail, toolLog }) as const;
  if (!result.ok && result.reason.kind === "timed-out") {
    return failed(result.reason, stripAnsi(result.stderr));
  }
  // The events hold values, so nothing of stdout but the diagnostics is ever
  // the tool's words here (record 0022).
  const read = readEvents(result.stdout);
  const words = stripAnsi(
    [result.stderr, ...(typeof read === "string" ? [] : read.diagnostics)].join(""),
  );
  if (!result.ok) return failed(result.reason, words);
  if (typeof read === "string") return failed({ kind: "unreadable-output" }, words, [read]);
  if (read.unknown.length > 0) return failed({ kind: "unknown-step" }, words, read.unknown);
  if (read.summary === undefined) {
    return failed({ kind: "unreadable-output" }, words, [
      "The tool's output: expected a summary event at the end.",
    ]);
  }
  // Every change the summary counts has an event of its own, or the stream
  // is not the one this check was written for.
  const counted = Object.entries(read.summary)
    .filter(([op]) => op !== "same")
    .reduce((sum, [, count]) => sum + count, 0);
  if (counted > read.drift.length) {
    return failed({ kind: "unreadable-output" }, words, [
      `The tool's output: expected an event for every change the summary counts, and ${counted - read.drift.length} is missing.`,
    ]);
  }
  read.drift.sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
  return { ok: true, drift: read.drift, toolLog: words };
}

interface Events {
  drift: Change[];
  unknown: string[];
  diagnostics: string[];
  summary: Record<string, number> | undefined;
}

// Reads the stream line by line. A problem names a line or an event and what
// was expected there, never what was found (record 0021).
function readEvents(stdout: string): Events | string {
  const events: Events = { drift: [], unknown: [], diagnostics: [], summary: undefined };
  const seen = new Set<string>();
  let count = 0;
  const lines = stdout.split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      return `The tool's output, at line ${index + 1}: expected one JSON document per line.`;
    }
    const diagnostic = diagnosticEvent.safeParse(json);
    if (diagnostic.success) events.diagnostics.push(diagnostic.data.diagnosticEvent.message);
    const summary = summaryEvent.safeParse(json);
    if (summary.success) events.summary = summary.data.summaryEvent.resourceChanges ?? {};
    const outputs = outputsEvent.safeParse(json);
    if (!outputs.success) continue;
    count++;
    const { op, urn, diffs, detailedDiff } = outputs.data.resOutputsEvent.metadata;
    const at = `The tool's output, at event ${count}`;
    const known = Object.hasOwn(DRIFT_OPS, op) ? DRIFT_OPS[op] : undefined;
    if (known === undefined) {
      events.unknown.push(`${at}: expected a drift op that Sluiceway knows.`);
      continue;
    }
    if (known === "drop") continue;
    const resource = typeAndName(urn);
    if (resource === undefined || seen.has(urn)) {
      return `${at}: expected the URN of a resource that no earlier event has.`;
    }
    seen.add(urn);
    const paths = detailedDiff !== undefined && detailedDiff.length > 0 ? detailedDiff : diffs;
    events.drift.push({
      address: urn,
      ...resource,
      op: known,
      // Paths only on a changed property. A resource that is gone lists none.
      changedKeys: known === "update" ? [...new Set(paths ?? [])].sort() : [],
      replaceKeys: [],
    });
  }
  return events;
}
