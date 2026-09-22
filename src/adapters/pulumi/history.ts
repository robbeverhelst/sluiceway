import { join } from "node:path";
import { z } from "zod";
import type { PreviewFailureReason } from "../../core/failure-reason.ts";
import type { Stack } from "../../core/stack.ts";
import type { DeployHistoryResult, HistoryOptions, ToolDeploy } from "../adapter.ts";
import { pulumiEnvironment } from "./environment.ts";
import { STACK_NOT_FOUND_EXIT_CODE } from "./preview.ts";
import { stripAnsi } from "./tool-log.ts";

// The tool's history of a stack (record 0073). It needs the backend and no
// passphrase, takes no stack lock and adds no entry. `--json` and not
// `--output json`, which v3.229.0 does not know. Never `--show-secrets`.
function historyCommand(name: string, limit: number): string[] {
  return [
    "pulumi",
    "stack",
    "history",
    "--json",
    "--page-size",
    String(limit),
    "--non-interactive",
    "--color",
    "never",
    "--stack",
    name,
  ];
}

// The only keys of an entry that are read. Zod drops the rest: `config` holds
// every plain config value, `message` is anybody's words, and `environment`
// names the people behind the commit and whatever a newer CLI adds (record
// 0021). Of the environment only four keys are kept.
const entry = z.object({
  kind: z.string(),
  result: z.string(),
  endTime: z.string(),
  resourceChanges: z.record(z.string(), z.number()).nullish(),
  environment: z
    .object({
      "git.head": z.string().optional(),
      "git.dirty": z.string().optional(),
      "ci.system": z.string().optional(),
      "ci.build.id": z.string().optional(),
    })
    .nullish(),
});

const KINDS: Record<string, ToolDeploy["kind"]> = { update: "deploy", destroy: "destroy" };
const COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const RUN_ID = /^[1-9]\d*$/;

export async function deployHistory(
  stack: Stack,
  options: HistoryOptions,
): Promise<DeployHistoryResult> {
  if (stack.name === undefined) throw new Error("A Pulumi stack always has a name.");
  const result = await options.run({
    argv: historyCommand(stack.name, options.limit),
    cwd: join(options.root, stack.path),
    env: pulumiEnvironment(options.env),
    timeoutMs: options.timeoutMinutes * 60_000,
  });

  const failed = (reason: PreviewFailureReason, toolLog: string, detail: string[] = []) =>
    ({ ok: false, reason, detail, toolLog }) as const;
  if (result.status === "not-started") return failed({ kind: "tool-error", exitCode: null }, "");
  // Stdout holds config values, so only stderr is ever the tool's words here
  // (record 0022).
  const words = stripAnsi(result.stderr);
  if (result.status === "timed-out") {
    return failed({ kind: "timed-out", minutes: options.timeoutMinutes }, words);
  }
  if (result.exitCode !== 0) {
    return failed(
      result.exitCode === STACK_NOT_FOUND_EXIT_CODE
        ? { kind: "stack-not-found" }
        : { kind: "tool-error", exitCode: result.exitCode },
      words,
    );
  }
  const read = readHistory(result.stdout);
  if (typeof read === "string") return failed({ kind: "unreadable-output" }, words, [read]);
  return { ok: true, deploys: read, toolLog: words };
}

// A problem names an entry and what was expected there, never what was found
// (record 0021).
function readHistory(stdout: string): ToolDeploy[] | string {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    return "The tool's output: expected one JSON document.";
  }
  if (!Array.isArray(json)) return "The tool's output: expected a list of updates.";
  const deploys: ToolDeploy[] = [];
  for (const [index, raw] of json.entries()) {
    const parsed = entry.safeParse(raw);
    const at = `The tool's output, at update ${index + 1}`;
    if (!parsed.success) return `${at}: expected a kind, a result and an end time.`;
    const { kind, result, endTime, resourceChanges, environment } = parsed.data;
    const endedAt = new Date(endTime);
    if (Number.isNaN(endedAt.getTime())) return `${at}: expected an end time.`;
    // A deploy that went out and changed something. A failed one, a refresh,
    // a preview and a deploy that changed nothing are no deploy fact.
    const deployKind = Object.hasOwn(KINDS, kind) ? KINDS[kind] : undefined;
    const changed = Object.entries(resourceChanges ?? {}).some(
      ([op, count]) => op !== "same" && count > 0,
    );
    if (deployKind === undefined || result !== "succeeded" || !changed) continue;
    const sha = environment?.["git.head"] ?? "";
    const runId = environment?.["ci.build.id"] ?? "";
    deploys.push({
      kind: deployKind,
      endedAt,
      ...(COMMIT.test(sha)
        ? { commit: { sha, dirty: environment?.["git.dirty"] === "true" } }
        : {}),
      // Only a run id of GitHub Actions is one Sluiceway can match.
      ...(environment?.["ci.system"] === "GitHub Actions" && RUN_ID.test(runId) ? { runId } : {}),
    });
  }
  // Newest first, as the tool lists them. Whole seconds can tie, and then the
  // tool's order stands.
  return deploys.sort((a, b) => b.endedAt.getTime() - a.endedAt.getTime());
}
