// The scan's read of the tools' own histories (record 0073). Only a full scan
// reads them: one more backend call per stack, after every preview, through
// the same pool. What it found is matched with the deployment records at the
// late read, where the records are.

import type { Adapter, ToolDeploy } from "../adapters/adapter.ts";
import type { ProcessRunner } from "../adapters/process.ts";
import type { ConfiguredStack } from "../core/config.ts";
import { previewFailureText } from "../core/failure-reason.ts";
import { runPool } from "../core/pool.ts";
import { stackId } from "../core/stack.ts";
import type { JobLog } from "../github/job-log.ts";
import { logGroupTitle } from "../render/log-text.ts";

export interface HistoryContext {
  root: string;
  env: Record<string, string | undefined>;
  run: ProcessRunner;
  adapter: Adapter;
  log: JobLog;
  concurrency: number;
  previewTimeoutMinutes: number;
}

function lines(text: string): string[] {
  return text.split("\n").filter((line) => line.trim() !== "");
}

// The deploys of every stack whose history was read, by stack id. A stack
// whose tool keeps none, or whose history could not be read, is missing, and
// its lines on the trail stay as the live body has them.
export async function readHistories(
  context: HistoryContext,
  stacks: readonly ConfiguredStack[],
  // The newest entries to read per stack: as many as the trail lists.
  limit: number,
): Promise<Map<string, ToolDeploy[]>> {
  const read = new Map<string, ToolDeploy[]>();
  const { adapter, log } = context;
  if (limit === 0 || stacks.length === 0 || adapter.deployHistory === undefined) return read;
  const history = adapter.deployHistory.bind(adapter);
  const cannot: string[] = [];
  await runPool(stacks, context.concurrency, async (configured) => {
    const id = stackId(configured.stack);
    const result = await history(configured.stack, {
      root: context.root,
      env: context.env,
      run: context.run,
      timeoutMinutes: configured.previewTimeout ?? context.previewTimeoutMinutes,
      limit,
    });
    if (result === undefined) {
      cannot.push(id);
      return;
    }
    if (result.ok) {
      read.set(id, result.deploys);
      return;
    }
    // Never fails the scan: the trail only explains (record 0073). The tool's
    // own words go to the job log and nowhere else (record 0022).
    const words = lines(result.toolLog);
    log.group(`${logGroupTitle(id)}, its history`, [
      `history not read: ${previewFailureText(result.reason)}`,
      ...result.detail,
      ...(words.length > 0 ? ["The tool's own words:", ...words] : []),
    ]);
    log.warning(
      `The history of ${logGroupTitle(id)} could not be read: ${previewFailureText(result.reason)}. Its deploys made outside the dashboard stay as the dashboard listed them.`,
      "History not read",
    );
  });
  const deploys = [...read.values()].reduce((sum, one) => sum + one.length, 0);
  if (read.size > 0) {
    log.info(
      `Read the history of ${read.size} ${read.size === 1 ? "stack" : "stacks"}: ${deploys} ${deploys === 1 ? "deploy" : "deploys"} among the newest ${limit} entries of each.`,
    );
  }
  if (cannot.length > 0) {
    cannot.sort();
    log.info(
      `${cannot.length} ${cannot.length === 1 ? "stack was" : "stacks were"} not read for deploys made outside the dashboard: their tool keeps no history of its deploys (record 0073). ${cannot.map(logGroupTitle).join(", ")}.`,
    );
  }
  return read;
}
