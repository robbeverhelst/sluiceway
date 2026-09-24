// The preparations of record 0053, such as OpenTofu's init of a directory,
// run for scan and apply alike: one at a time, all of them before any preview,
// because inits run side by side corrupted stacks in the first user's earlier
// dashboard. A failed preparation is a preview failure of every stack that
// needs it, and those stacks are not previewed.
import type { Adapter, PreviewResult, ToolContext } from "../adapters/adapter.ts";
import type { ConfiguredStack } from "../core/config.ts";
import type { StackEnv } from "../core/env-file.ts";
import { previewFailureText } from "../core/failure-reason.ts";
import { stackId } from "../core/stack.ts";
import type { JobLog } from "../github/job-log.ts";

export interface PrepareContext extends ToolContext {
  log: Pick<JobLog, "group">;
  adapter: Pick<Adapter, "prepare">;
  // Set by the scan alone (record 0107): a stack whose entry sets
  // `createInBackend: true` is handed to its adapter to create in the backend
  // when the backend lacks it. `apply` never sets it, so a deploy never
  // creates a stack.
  createInBackend?: true;
}

// The preview failure of a stack whose env file could not be loaded (record
// 0103). The tool never ran for it, so there are no words of the tool's.
export function envFileFailure(detail: string[]): PreviewResult {
  return { ok: false, reason: { kind: "env-file-not-loaded" }, detail, toolLog: "" };
}

// Gives the preview failure of every stack whose preparation failed, by stack
// id. A preparation gets the longest time limit of the stacks that need it.
// With the environment of each stack (record 0103), a stack whose env file
// could not be loaded is a preview failure too and is prepared by nothing,
// and the stacks are prepared one env file at a time, so a preparation runs
// with the environment of the stacks it prepares.
export async function prepareStacks(
  context: PrepareContext,
  stacks: ConfiguredStack[],
  defaultTimeoutMinutes: number,
  envs?: ReadonlyMap<string, StackEnv>,
): Promise<Map<string, PreviewResult>> {
  const failed = new Map<string, PreviewResult>();
  if (envs === undefined) {
    await prepareWith(context, stacks, defaultTimeoutMinutes, context.env, failed);
    return failed;
  }
  const loaded: ConfiguredStack[] = [];
  for (const one of stacks) {
    const own = envs.get(stackId(one.stack));
    if (own?.ok === false) failed.set(stackId(one.stack), envFileFailure(own.detail));
    else loaded.push(one);
  }
  // In the order of the stacks, each file's group once.
  for (const group of Map.groupBy(loaded, (one) => one.envFile).values()) {
    const first = group[0];
    if (first === undefined) continue;
    const own = envs.get(stackId(first.stack));
    const env = own?.ok ? own.env : context.env;
    await prepareWith(context, group, defaultTimeoutMinutes, env, failed);
  }
  return failed;
}

async function prepareWith(
  context: PrepareContext,
  stacks: ConfiguredStack[],
  defaultTimeoutMinutes: number,
  env: Record<string, string | undefined>,
  failed: Map<string, PreviewResult>,
): Promise<void> {
  if (stacks.length === 0 || context.adapter.prepare === undefined) return;
  const timeouts = new Map(
    stacks.map((one) => [stackId(one.stack), one.previewTimeout ?? defaultTimeoutMinutes]),
  );
  const tool = { root: context.root, env, run: context.run };

  // The stacks to create in the backend, when this is a scan and an entry
  // asks (record 0107). Otherwise none, whatever the entries say.
  const createInBackend = context.createInBackend
    ? stacks.filter((one) => one.createInBackend).map(({ stack }) => stack)
    : [];

  for (const preparation of context.adapter.prepare(
    stacks.map(({ stack }) => stack),
    { createInBackend },
  )) {
    const ids = preparation.stacks.map(stackId);
    const timeoutMinutes = Math.max(...ids.map((id) => timeouts.get(id) ?? defaultTimeoutMinutes));
    const result = await preparation.run({ ...tool, timeoutMinutes });
    const words = lines(result.toolLog);
    const told = words.length > 0 ? ["The tool's own words:", ...words] : [];
    // Sluiceway's own words on what was done come before the tool's.
    const done = result.detail ?? [];
    if (result.ok) {
      context.log.group(`Prepared ${preparation.title}`, [
        `Stacks that need it: ${ids.join(", ")}.`,
        ...done,
        ...told,
      ]);
      continue;
    }
    context.log.group(`Preparing ${preparation.title} failed`, [
      previewFailureText(result.reason),
      `Stacks that need it: ${ids.join(", ")}.`,
      ...done,
      ...told,
    ]);
    for (const id of ids) {
      failed.set(id, {
        ok: false,
        reason: result.reason,
        detail: [
          `The tool could not prepare ${JSON.stringify(preparation.title)}. Its group in the job log holds the tool's own words.`,
        ],
        // Already in the group of the preparation, once.
        toolLog: "",
      });
    }
  }
}

function lines(text: string): string[] {
  const all = text.split(/\r?\n/);
  if (all.at(-1) === "") all.pop();
  return all;
}
