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
// by side: one build per chart, run by the modes one at a time and before any
// preview (record 0053, as for OpenTofu's init). A chart without dependencies,
// or a chart reference, needs none (record 0058). A local chart that a chart
// depends on is built before it, down the whole tree, so the lowest level
// goes first and path order breaks a tie (record 0069).
export function prepare(stacks: Stack[]): Preparation[] {
  const byChart = new Map<string, { level: number; stacks: Stack[] }>();
  for (const stack of stacks) {
    for (const { chart, level } of optionsOf(stack).builds) {
      const found = byChart.get(chart) ?? { level, stacks: [] };
      found.stacks.push(stack);
      byChart.set(chart, found);
    }
  }
  return [...byChart]
    .sort(([a, one], [b, other]) => one.level - other.level || (a < b ? -1 : a > b ? 1 : 0))
    .map(([chartDir, { stacks: grouped }]) => ({
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
