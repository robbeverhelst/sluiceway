import { join } from "node:path";
import type { Stack } from "../../core/stack.ts";
import type { Preparation } from "../adapter.ts";
import { stripAnsi } from "../pulumi/tool-log.ts";
import { dependencyCommand } from "./commands.ts";
import { helmEnvironment, optionsOf } from "./environment.ts";
import { failureOf } from "./preview.ts";

// A local chart with dependencies needs them in its charts/ directory before
// helm can render it (helm docs, "helm dependency build"). The build writes
// into the chart's directory, so two stacks of one chart must never build side
// by side: one build per chart, in path order, run by the modes one at a time
// and before any preview (record 0053, as for OpenTofu's init). A chart
// without dependencies, or a chart reference, needs none (record 0058).
export function prepare(stacks: Stack[]): Preparation[] {
  const byChart = Map.groupBy(
    stacks.filter((stack) => optionsOf(stack).dependencies),
    (stack) => optionsOf(stack).chartDir ?? "",
  );
  return [...byChart]
    .filter(([chartDir]) => chartDir !== "")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([chartDir, grouped]) => ({
      title: chartDir,
      stacks: grouped,
      run: async (context) => {
        const result = await context.run({
          argv: dependencyCommand(),
          cwd: join(context.root, chartDir),
          env: helmEnvironment(context.env),
          timeoutMs: context.timeoutMinutes * 60_000,
        });
        // What the build prints names charts and repositories, and no value.
        const toolLog =
          result.status === "not-started" ? "" : stripAnsi(result.stdout + result.stderr);
        const reason = failureOf(result, context.timeoutMinutes);
        return reason === undefined ? { ok: true, toolLog } : { ok: false, reason, toolLog };
      },
    }));
}
