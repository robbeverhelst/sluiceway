import type { Stack } from "../core/stack.ts";
import type { Adapter } from "./adapter.ts";
import { discoverAll } from "./discover-all.ts";
import { helm } from "./helm/index.ts";
import { isHelmOptions } from "./helm/options.ts";
import { opentofu } from "./opentofu/index.ts";
import { isOpenTofuOptions } from "./opentofu/options.ts";
import { pulumi } from "./pulumi/index.ts";

export { TOOLS } from "./discover-all.ts";

// The adapter the modes use: every tool Sluiceway knows, behind the one
// interface (record 0053). Pulumi stacks are found from their files, as
// before. OpenTofu stacks come from `stacks` entries with `tool: opentofu`,
// and Helm releases from entries with `tool: helm` (record 0058).
// Each stack goes to the adapter of its tool, which the options bag says, and
// a stack without a tool in it is a Pulumi stack, so everything Pulumi does is
// what it did with Pulumi alone.

function adapterOf(stack: Stack): Adapter {
  if (isOpenTofuOptions(stack.options)) return opentofu;
  if (isHelmOptions(stack.options)) return helm;
  return pulumi;
}

export const tools: Adapter = {
  discover: discoverAll,

  // The tools of these stacks, each once, Pulumi first.
  async checkVersion(context, stacks) {
    const tofu = stacks.filter((stack) => isOpenTofuOptions(stack.options));
    const charts = stacks.filter((stack) => isHelmOptions(stack.options));
    if (tofu.length + charts.length < stacks.length) await pulumi.checkVersion(context, []);
    if (tofu.length > 0) await opentofu.checkVersion(context, tofu);
    if (charts.length > 0) await helm.checkVersion(context, charts);
  },

  prepare(stacks) {
    return [
      ...(opentofu.prepare?.(stacks.filter((stack) => isOpenTofuOptions(stack.options))) ?? []),
      ...(helm.prepare?.(stacks.filter((stack) => isHelmOptions(stack.options))) ?? []),
    ];
  },

  preview: (stack, options) => adapterOf(stack).preview(stack, options),
  toolDiff: (stack, options) => adapterOf(stack).toolDiff(stack, options),
  // Only Pulumi can check drift (record 0055). A stack of another tool is
  // never checked.
  detectDrift: async (stack, options) => adapterOf(stack).detectDrift?.(stack, options),
  apply: (stack, context, plan, options) => adapterOf(stack).apply(stack, context, plan, options),
};
