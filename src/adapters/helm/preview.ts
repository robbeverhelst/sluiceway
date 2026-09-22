import { join } from "node:path";
import type { PreviewFailureReason } from "../../core/failure-reason.ts";
import { type Stack, stackId } from "../../core/stack.ts";
import type { PreviewOptions, PreviewResult } from "../adapter.ts";
import { runTool, stripAnsi } from "../tool-run.ts";
import { diffCommand, renderCommand } from "./commands.ts";
import { helmEnvironment, optionsOf } from "./environment.ts";
import { foldEntries } from "./fold.ts";
import { RenderedManifests } from "./rendered.ts";
import { parseEntries } from "./schema.ts";

// A preview is `helm diff upgrade` of the release against the chart and its
// values, in the stack's directory, with the stack's time limit (record
// 0058). When `apply` asks it to keep its plan, it also renders what a deploy
// would install, which the deploy is held to.
export async function preview(stack: Stack, options: PreviewOptions): Promise<PreviewResult> {
  const helm = optionsOf(stack);
  const run = (argv: string[]) =>
    runTool(options.run, {
      argv,
      cwd: join(options.root, stack.path),
      env: helmEnvironment(options.env),
      timeoutMinutes: options.timeoutMinutes,
    });
  const failed = (
    reason: PreviewFailureReason,
    toolLog: string,
    detail: string[] = [],
  ): PreviewResult => ({ ok: false, reason, detail, toolLog });

  // The reason comes from the exit code alone, never from the tool's words
  // (record 0022 as amended). A release that is not installed is no failure:
  // the diff shows every object as added.
  const diffed = await run(diffCommand(helm));
  // Never stdout: it is the diff, with the old and new value of every
  // changed field (record 0021).
  const words = stripAnsi(diffed.stderr);
  if (!diffed.ok) return failed(diffed.reason, words);

  const parsed = parseEntries(diffed.stdout);
  if (!parsed.ok) return failed({ kind: "unreadable-output" }, words, parsed.problems);
  const folded = foldEntries(parsed.entries, helm.namespace, options.showValues ?? []);
  if (!folded.ok) return failed({ kind: folded.reason }, words, folded.detail);
  const diff = { stackId: stackId(stack), changes: folded.changes };
  if (!options.savePlan) return { ok: true, diff, toolLog: words };

  const rendered = await run(renderCommand(helm));
  // Never stdout: it is every manifest, values and all.
  const log = words + stripAnsi(rendered.stderr);
  if (!rendered.ok) return failed(rendered.reason, log);
  return {
    ok: true,
    diff,
    plan: new RenderedManifests(stackId(stack), rendered.stdout),
    toolLog: log,
  };
}
