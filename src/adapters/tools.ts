import type { Stack } from "../core/stack.ts";
import type { Adapter } from "./adapter.ts";
import { discoverAll } from "./discover-all.ts";
import { readsFiles } from "./file-references.ts";
import { helm } from "./helm/index.ts";
import { isHelmOptions } from "./helm/options.ts";
import { kubectl } from "./kubectl/index.ts";
import { isKubectlOptions } from "./kubectl/options.ts";
import { opentofu } from "./opentofu/index.ts";
import { isOpenTofuOptions } from "./opentofu/options.ts";
import { pulumi } from "./pulumi/index.ts";

export { TOOLS } from "./discover-all.ts";

// The adapter the modes use: every tool Sluiceway knows, behind the one
// interface (record 0053). Pulumi stacks are found from their files, as
// before. OpenTofu stacks come from `stacks` entries with `tool: opentofu`,
// Helm releases from entries with `tool: helm` (record 0058), and Kubernetes
// manifests from entries with `tool: kubectl` (record 0060).
// Each stack goes to the adapter of its tool, which the options bag says, and
// a stack without a tool in it is a Pulumi stack, so everything Pulumi does is
// what it did with Pulumi alone.

function adapterOf(stack: Stack): Adapter {
  if (isOpenTofuOptions(stack.options)) return opentofu;
  if (isHelmOptions(stack.options)) return helm;
  if (isKubectlOptions(stack.options)) return kubectl;
  return pulumi;
}

export const tools: Adapter = {
  discover: discoverAll,
  readsFiles,

  // The tools of these stacks, each once, Pulumi first.
  async checkVersion(context, stacks) {
    const tofu = stacks.filter((stack) => isOpenTofuOptions(stack.options));
    const charts = stacks.filter((stack) => isHelmOptions(stack.options));
    const manifests = stacks.filter((stack) => isKubectlOptions(stack.options));
    if (tofu.length + charts.length + manifests.length < stacks.length) {
      await pulumi.checkVersion(context, []);
    }
    if (tofu.length > 0) await opentofu.checkVersion(context, tofu);
    if (charts.length > 0) await helm.checkVersion(context, charts);
    if (manifests.length > 0) await kubectl.checkVersion(context, manifests);
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

  // Each tool that can list its stacks is asked about its own (record 0074).
  // Only Pulumi can, so a stack of another tool gets no answer.
  async findInBackend(stacks, context) {
    const answers = [];
    const logs = [];
    for (const [adapter, own] of Map.groupBy(stacks, adapterOf)) {
      const result = await adapter.findInBackend?.(own, context);
      if (result === undefined) continue;
      answers.push(...result.answers);
      logs.push(result.toolLog);
    }
    return { answers, toolLog: logs.join("") };
  },
};
