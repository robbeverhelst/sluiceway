// The pull request preview (record 0101): the part of the check that, with
// `pull-request-preview: true`, previews the stacks the pull request claims
// as they would be after the merge, and writes a preview page per stack on
// the pull request's head commit, where its checks are. The checkout of a
// `pull_request` run is the merge of the branch into the base, so the
// checkout is what the merge gives, and no copy is made. It never deploys,
// never opens a deployment record and touches no issue: the dashboard is
// about what is merged and waiting, and this is information for a reviewer.
// The rules are in core/pull-request-preview.ts and the words in
// render/pull-request-preview.ts.

import type { Adapter, PreviewResult } from "../adapters/adapter.ts";
import { ToolVersionError } from "../adapters/adapter.ts";
import type { ProcessRunner } from "../adapters/process.ts";
import type { Config, ConfiguredStack } from "../core/config.ts";
import { previewFailureText } from "../core/failure-reason.ts";
import { type PoolSize, runPool } from "../core/pool.ts";
import {
  type PreviewEvent,
  refusePullRequestPreview,
  stacksOfPullRequest,
} from "../core/pull-request-preview.ts";
import { shownValues } from "../core/show-values.ts";
import { stackId } from "../core/stack.ts";
import { type StackEnvFilesLoad, stackEnvFiles } from "../github/env-file.ts";
import type { JobLog } from "../github/job-log.ts";
import type { GitHubPort } from "../github/port.ts";
import { previewPages } from "../github/preview-pages.ts";
import type { CheckPart } from "../render/check.ts";
import { dashboardSearchUrl, type RunFacts, runLinks } from "../render/links.ts";
import { logGroupTitle } from "../render/log-text.ts";
import { previewOutcome } from "../render/preview-result.ts";
import {
  type PreviewedStack,
  pullRequestPreviewPart,
  renderPullRequestPage,
} from "../render/pull-request-preview.ts";
import { counts } from "../render/row.ts";
import { prepareStacks } from "./prepare.ts";

// Everything the preview needs, handed in as data and seams (build plan,
// section 5), the way a scan gets them.
export interface PullRequestPreviewContext extends RunFacts {
  // The directory of the checked-out repo: on a pull_request run, the merge
  // of the branch into the base.
  root: string;
  // The environment of the job, read once by the glue, which the adapter
  // hands to the tool (record 0013). The preview never looks inside.
  env: Record<string, string | undefined>;
  // The runner's `setSecret`, for the values of the env file a stack names
  // (record 0103).
  mask: StackEnvFilesLoad["mask"];
  adapter: Adapter;
  run: ProcessRunner;
  github: GitHubPort;
  log: JobLog;
  now: () => Date;
  pool: PoolSize;
  // The time limit of one preview, in whole minutes.
  previewTimeoutMinutes: number;
  // The event of the run, as the glue read it.
  event: PreviewEvent;
}

// What the check found in the repo, handed over so the preview reads the
// config file and runs discovery no second time.
export interface RepoForPreview {
  config: Config;
  stacks: ConfiguredStack[];
}

function lines(text: string): string[] {
  const all = text.split(/\r?\n/);
  if (all.at(-1) === "") all.pop();
  return all;
}

export async function previewPullRequest(
  context: PullRequestPreviewContext,
  repo: RepoForPreview,
): Promise<CheckPart> {
  const { log, now, adapter } = context;
  const refusal = refusePullRequestPreview(context.event);
  const pullRequest = context.event.pullRequest;
  if (refusal !== undefined || pullRequest === undefined) {
    return pullRequestPreviewPart({
      pullRequest,
      outcome: {
        kind: "refused",
        refusal: refusal ?? { kind: "not-a-pull-request", event: context.event.name },
      },
    });
  }
  const words = {
    number: pullRequest.number,
    baseRef: pullRequest.baseRef,
    head: pullRequest.head,
  };

  // The files of the pull request, from the comparison of its base and its
  // head, as a narrowed scan reads a push (record 0010).
  let comparison: Awaited<ReturnType<GitHubPort["compareCommits"]>>;
  try {
    comparison = await context.github.compareCommits(pullRequest.base, pullRequest.head);
  } catch (error) {
    throw new Error(
      `The files of #${pullRequest.number} could not be read: the comparison of its base and its head failed (${error instanceof Error ? error.message : error}). The preview needs contents: read.`,
    );
  }
  const claimed = stacksOfPullRequest(
    repo.stacks.map(({ stack, inputs }) => ({ id: stackId(stack), path: stack.path, inputs })),
    comparison,
    repo.config.scan.unrelated,
  );
  if (claimed.kind === "too-many-files") {
    return pullRequestPreviewPart({ pullRequest: words, outcome: { kind: "too-many-files" } });
  }
  const stacks = repo.stacks.filter(({ stack }) => claimed.stackIds.includes(stackId(stack)));
  if (stacks.length === 0) {
    return pullRequestPreviewPart({
      pullRequest: words,
      outcome: { kind: "nothing-claimed", unclaimed: claimed.unclaimed },
    });
  }

  const tool = { root: context.root, env: context.env, run: context.run };
  // The tools of the stacks to preview, as a scan checks them. A tool that is
  // missing or too old fails the job with Sluiceway's own message, and what
  // the tool printed stays in the job log (record 0022).
  try {
    await adapter.checkVersion(
      tool,
      stacks.map(({ stack }) => stack),
    );
  } catch (error) {
    if (error instanceof ToolVersionError && error.toolLog !== "") {
      log.group("The tool's own words", lines(error.toolLog));
    }
    throw error;
  }

  // The env file of each stack, on top of the step's environment (record
  // 0103), masked first.
  const envs = stackEnvFiles({ root: context.root, env: context.env, mask: context.mask, log })(
    stacks.map(({ stack, envFile }) => ({ id: stackId(stack), envFile })),
  );
  // Every preparation alone and before the pool (record 0053). A stack whose
  // preparation failed is a preview failure and is not previewed.
  const failed = await prepareStacks(
    { ...tool, log, adapter },
    stacks,
    context.previewTimeoutMinutes,
    envs,
  );
  const showValues = shownValues(repo.config.dashboard);
  const results = await runPool(stacks, context.pool.size, async (configured) => {
    const id = stackId(configured.stack);
    const started = now().getTime();
    const own = envs.get(id);
    const result: PreviewResult =
      failed.get(id) ??
      (await adapter.preview(configured.stack, {
        ...tool,
        env: own?.ok ? own.env : tool.env,
        timeoutMinutes: configured.previewTimeout ?? context.previewTimeoutMinutes,
        showValues,
      }));
    const seconds = ((now().getTime() - started) / 1000).toFixed(1);
    log.info(
      `Previewed ${logGroupTitle(id)} after the merge of #${pullRequest.number} in ${seconds} s: ${previewOutcome(result)}`,
    );
    if (!result.ok && result.toolLog !== "") {
      log.group(`${logGroupTitle(id)} after the merge of #${pullRequest.number}`, [
        "The tool's own words:",
        ...lines(result.toolLog),
      ]);
    }
    return { id, result };
  });

  // One page per stack the pull request claims, whatever the preview found,
  // so every one of them shows in the pull request's checks.
  const links = {
    ...runLinks(context),
    dashboard: dashboardSearchUrl(context.repoUrl, repo.config.dashboard.label),
  };
  const written = await previewPages(context.github, pullRequest.head).write(
    results.map(({ id, result }) => {
      const { unlisted: _unlisted, ...output } = renderPullRequestPage(id, result, words, links);
      return { stackId: id, output };
    }),
  );
  const previewed: PreviewedStack[] = results.map(({ id, result }) => ({
    stackId: id,
    outcome: !result.ok
      ? `preview failed, ${previewFailureText(result.reason)}`
      : result.diff.changes.length === 0
        ? "no changes"
        : counts(result.diff.changes),
    pageUrl: written.urls.get(id),
  }));
  return pullRequestPreviewPart({
    pullRequest: words,
    outcome: {
      kind: "previewed",
      stacks: previewed,
      unclaimed: claimed.unclaimed,
      pages: {
        created: written.created,
        updated: written.updated,
        failed: written.failed,
        refused: written.refused,
      },
    },
  });
}
