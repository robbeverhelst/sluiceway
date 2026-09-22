// The preparations of record 0053, such as OpenTofu's init of a directory,
// run for scan and apply alike: one at a time, all of them before any preview,
// because inits run side by side corrupted stacks in the first user's earlier
// dashboard. A failed preparation is a preview failure of every stack that
// needs it, and those stacks are not previewed.
import type { Adapter, PreviewResult, ToolContext } from "../adapters/adapter.ts";
import type { ConfiguredStack } from "../core/config.ts";
import { previewFailureText } from "../core/failure-reason.ts";
import { stackId } from "../core/stack.ts";
import type { JobLog } from "../github/job-log.ts";

export interface PrepareContext extends ToolContext {
  log: Pick<JobLog, "group">;
  adapter: Pick<Adapter, "prepare">;
}

// Gives the preview failure of every stack whose preparation failed, by stack
// id. A preparation gets the longest time limit of the stacks that need it.
export async function prepareStacks(
  context: PrepareContext,
  stacks: ConfiguredStack[],
  defaultTimeoutMinutes: number,
): Promise<Map<string, PreviewResult>> {
  const failed = new Map<string, PreviewResult>();
  if (stacks.length === 0 || context.adapter.prepare === undefined) return failed;
  const timeouts = new Map(
    stacks.map((one) => [stackId(one.stack), one.previewTimeout ?? defaultTimeoutMinutes]),
  );
  const tool = { root: context.root, env: context.env, run: context.run };

  for (const preparation of context.adapter.prepare(stacks.map(({ stack }) => stack))) {
    const ids = preparation.stacks.map(stackId);
    const timeoutMinutes = Math.max(...ids.map((id) => timeouts.get(id) ?? defaultTimeoutMinutes));
    const result = await preparation.run({ ...tool, timeoutMinutes });
    const words = lines(result.toolLog);
    const told = words.length > 0 ? ["The tool's own words:", ...words] : [];
    if (result.ok) {
      context.log.group(`Prepared ${preparation.title}`, [
        `Stacks that need it: ${ids.join(", ")}.`,
        ...told,
      ]);
      continue;
    }
    context.log.group(`Preparing ${preparation.title} failed`, [
      previewFailureText(result.reason),
      `Stacks that need it: ${ids.join(", ")}.`,
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
  return failed;
}

function lines(text: string): string[] {
  const all = text.split(/\r?\n/);
  if (all.at(-1) === "") all.pop();
  return all;
}
