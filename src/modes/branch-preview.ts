// The preview of an update's branch (record 0071). With
// `mergeAndDeploy.preview` the scan previews each listed update as it would
// be after the merge: a copy of the checkout with the files the pull request
// changes as they are at its head commit, read through the GitHub API. The
// copy is thrown away after. What the preview found goes on the update's row
// as counts, and nothing of it deploys: the tick still approves the head
// commit, and the diff that deploys is previewed again after the merge
// (record 0054).

import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { PreviewResult } from "../adapters/adapter.ts";
import type { ConfiguredStack } from "../core/config.ts";
import { MAX_UPDATES, type WaitingUpdate } from "../core/merge-and-deploy.ts";
import { stackId } from "../core/stack.ts";
import type { stackEnvFiles } from "../github/env-file.ts";
import { logGroupTitle } from "../render/log-text.ts";
import type { BranchPreview } from "../render/merge-row.ts";
import { previewOutcome } from "../render/preview-result.ts";
import { prepareStacks } from "./prepare.ts";
import type { ScanContext } from "./scan.ts";

// The previews of the oldest thirty updates, the ones every dashboard lists,
// by pull request number. A newer one gets no preview: a scan with a hundred
// updates would run a hundred previews.
export async function previewBranches(
  context: ScanContext,
  stacks: readonly ConfiguredStack[],
  updates: readonly WaitingUpdate[],
  // The env file of each stack (record 0103).
  envFiles: ReturnType<typeof stackEnvFiles>,
): Promise<Map<number, BranchPreview[]>> {
  const { log } = context;
  const previews = new Map<number, BranchPreview[]>();
  for (const { pullRequest, stackIds } of updates.slice(0, MAX_UPDATES)) {
    if (pullRequest.fromFork) {
      log.info(
        `#${pullRequest.number} is not previewed: its branch lives in a fork, and its code would run with the credentials of this job.`,
      );
      continue;
    }
    const configured = stackIds.flatMap(
      (id) => stacks.find(({ stack }) => stackId(stack) === id) ?? [],
    );
    previews.set(
      pullRequest.number,
      await previewOne(
        context,
        pullRequest.number,
        pullRequest.head,
        pullRequest.files,
        configured,
        envFiles,
      ),
    );
  }
  return previews;
}

async function previewOne(
  context: ScanContext,
  number: number,
  head: string,
  files: readonly string[],
  stacks: ConfiguredStack[],
  envFiles: ReturnType<typeof stackEnvFiles>,
): Promise<BranchPreview[]> {
  const { log, now } = context;
  const failedAll = (why: string): BranchPreview[] => {
    log.info(`#${number} could not be previewed: ${why}`);
    return stacks.map(({ stack }) => ({ stackId: stackId(stack) }));
  };
  const copy = await mkdtemp(join(context.env.RUNNER_TEMP || tmpdir(), "sluiceway-branch-"));
  try {
    // Every file of the checkout but git's own. A symbolic link stays a link.
    await cp(context.root, copy, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (source) => basename(source) !== ".git",
    });
    const [owner = "", repo = ""] = new URL(context.repoUrl).pathname.split("/").filter(Boolean);
    const inside = await realpath(copy);
    for (const path of files) {
      const target = resolve(copy, path);
      let text: string | undefined;
      try {
        text = await context.github.readRepositoryFile({ owner, repo, path, ref: head });
      } catch (error) {
        return failedAll(
          `${path} could not be read at its head commit: ${error instanceof Error ? error.message : error}.`,
        );
      }
      await mkdir(dirname(target), { recursive: true });
      // A path that leads out of the copy, through a link, is never written.
      const parent = await realpath(dirname(target));
      if (parent !== inside && !parent.startsWith(`${inside}${sep}`)) {
        return failedAll(`${path} leads out of the copy of the checkout.`);
      }
      // Not there at the head commit: the pull request deletes it.
      if (text === undefined) await rm(target, { force: true, recursive: true });
      else await writeFile(target, text);
    }

    const tool = { root: copy, env: context.env, run: context.run };
    // The env file of each stack, read from the checkout and not from the
    // copy (record 0103): a pull request never changes what a stack's tool
    // gets before it is merged.
    const envs = envFiles(stacks.map(({ stack, envFile }) => ({ id: stackId(stack), envFile })));
    const failed = await prepareStacks(
      { ...tool, log, adapter: context.adapter },
      stacks,
      context.previewTimeoutMinutes,
      envs,
    );
    const previews: BranchPreview[] = [];
    for (const configured of stacks) {
      const id = stackId(configured.stack);
      const started = now().getTime();
      const own = envs.get(id);
      const result: PreviewResult =
        failed.get(id) ??
        (await context.adapter.preview(configured.stack, {
          ...tool,
          env: own?.ok ? own.env : tool.env,
          timeoutMinutes: configured.previewTimeout ?? context.previewTimeoutMinutes,
          // Counts only on the row, so no value is ever asked for.
          showValues: [],
        }));
      const seconds = ((now().getTime() - started) / 1000).toFixed(1);
      log.info(
        `Previewed ${logGroupTitle(id)} after the merge of #${number} in ${seconds} s: ${previewOutcome(result)}`,
      );
      if (!result.ok && result.toolLog !== "") {
        log.group(`${logGroupTitle(id)} after the merge of #${number}`, [
          "The tool's own words:",
          ...result.toolLog.replace(/\r?\n$/, "").split(/\r?\n/),
        ]);
      }
      previews.push({ stackId: id, ...(result.ok ? { changes: result.diff.changes } : {}) });
    }
    return previews;
  } catch (error) {
    return failedAll(`${error instanceof Error ? error.message : error}.`);
  } finally {
    await rm(copy, { recursive: true, force: true });
  }
}
