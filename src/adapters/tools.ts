import type { Config } from "../core/config.ts";
import { ConfigError } from "../core/config.ts";
import type { Stack } from "../core/stack.ts";
import type { Adapter } from "./adapter.ts";
import { opentofu } from "./opentofu/index.ts";
import { isOpenTofuOptions, OPENTOFU } from "./opentofu/options.ts";
import { pulumi } from "./pulumi/index.ts";

// The adapter the modes use: every tool Sluiceway knows, behind the one
// interface (record 0053). Pulumi stacks are found from their files, as
// before. OpenTofu stacks come from `stacks` entries with `tool: opentofu`.
// Each stack goes to the adapter of its tool, which the options bag says, and
// a stack without a tool in it is a Pulumi stack, so everything Pulumi does is
// what it did with Pulumi alone.

// The tools a `stacks` entry may name.
export const TOOLS = [OPENTOFU] as const;

function adapterOf(stack: Stack): Adapter {
  return isOpenTofuOptions(stack.options) ? opentofu : pulumi;
}

export const tools: Adapter = {
  async discover(root: string, config: Config): Promise<Stack[]> {
    const toolProblems = config.stacks.flatMap((entry, index) =>
      entry.tool === undefined || (TOOLS as readonly string[]).includes(entry.tool)
        ? []
        : [
            `stacks[${index}].tool: unknown tool ${JSON.stringify(entry.tool)}. Known tools: ${TOOLS.join(", ")}.`,
          ],
    );
    const found = await opentofu.discover(root, config).catch((error: unknown) => {
      if (error instanceof ConfigError) return error;
      throw error;
    });
    const problems = [...toolProblems, ...(found instanceof ConfigError ? found.problems : [])];
    if (problems.length > 0) throw new ConfigError(problems.sort(byEntry));
    const declared = found as Stack[];
    const discovered = await pulumi.discover(root, config);
    if (declared.length === 0) return discovered;
    return [...discovered, ...declared].sort(
      (a, b) => compare(a.path, b.path) || compare(a.name ?? "", b.name ?? ""),
    );
  },

  // The tools of these stacks, each once, Pulumi first.
  async checkVersion(context, stacks) {
    const tofu = stacks.filter((stack) => isOpenTofuOptions(stack.options));
    if (tofu.length < stacks.length) await pulumi.checkVersion(context, []);
    if (tofu.length > 0) await opentofu.checkVersion(context, tofu);
  },

  prepare(stacks) {
    return opentofu.prepare?.(stacks.filter((stack) => isOpenTofuOptions(stack.options))) ?? [];
  },

  preview: (stack, options) => adapterOf(stack).preview(stack, options),
  toolDiff: (stack, options) => adapterOf(stack).toolDiff(stack, options),
  apply: (stack, context, plan) => adapterOf(stack).apply(stack, context, plan),
};

// Problems of one entry together, in the order of the file.
function byEntry(a: string, b: string): number {
  const index = (text: string) => Number(/^stacks\[(\d+)\]/.exec(text)?.[1] ?? 0);
  return index(a) - index(b);
}

// By code unit, so the order is the same on every machine.
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
