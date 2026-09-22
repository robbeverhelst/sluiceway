import type { Config } from "../core/config.ts";
import { ConfigError, DEPENDS_ON_AUTO } from "../core/config.ts";
import { DiscoveryError } from "../core/discovery.ts";
import type { Stack } from "../core/stack.ts";
import { discoverHelm } from "./helm/discover.ts";
import { HELM } from "./helm/options.ts";
import { discoverKubectl } from "./kubectl/discover.ts";
import { KUBECTL } from "./kubectl/options.ts";
import { discoverOpenTofu } from "./opentofu/discover.ts";
import { OPENTOFU, TERRAFORM } from "./opentofu/options.ts";
import { discover as discoverPulumi } from "./pulumi/discover.ts";

// Discovery of every tool, on its own so that the check job reaches files and
// nothing that starts a tool (record 0042). Pulumi stacks are found from their
// files, as before. OpenTofu stacks come from `stacks` entries with
// `tool: opentofu` (record 0053), Terraform stacks from `tool: terraform`
// (record 0068), Helm releases from entries with
// `tool: helm` (record 0058), and Kubernetes manifests from entries with
// `tool: kubectl` (record 0060). A repo with only Pulumi stacks gets exactly
// what the Pulumi adapter finds.

// The tools a `stacks` entry may name.
export const TOOLS = [OPENTOFU, TERRAFORM, HELM, KUBECTL] as const;

export async function discoverAll(root: string, config: Config): Promise<Stack[]> {
  const toolProblems = config.stacks.flatMap((entry, index) => {
    if (entry.tool === undefined) return [];
    if (!(TOOLS as readonly string[]).includes(entry.tool)) {
      return [
        `stacks[${index}].tool: unknown tool ${JSON.stringify(entry.tool)}. Known tools: ${TOOLS.join(", ")}.`,
      ];
    }
    // Stack references are Pulumi's (record 0059). A stack of another tool
    // with auto would wait on nothing and say nothing. The same goes for a
    // phase read from a project file (record 0067).
    return [
      ...(entry.dependsOn === DEPENDS_ON_AUTO
        ? [
            `stacks[${index}].dependsOn: ${DEPENDS_ON_AUTO} reads the stack references of a Pulumi program, and an ${entry.tool} stack has none. Name the stack ids instead.`,
          ]
        : []),
      ...(typeof entry.phase === "object"
        ? [
            `stacks[${index}].phase: from reads a key of a Pulumi project file, and an ${entry.tool} stack has none. Name the phase instead.`,
          ]
        : []),
    ];
  });
  // Every tool's option problems come before any tool's file problems, so a
  // config problem is always reported as one.
  const tofu = tryDiscover(() => discoverOpenTofu(root, config));
  const charts = tryDiscover(() => discoverHelm(root, config));
  const manifests = tryDiscover(() => discoverKubectl(root, config));
  const problems = [
    ...toolProblems,
    ...tofu.optionProblems,
    ...charts.optionProblems,
    ...manifests.optionProblems,
  ];
  if (problems.length > 0) throw new ConfigError(problems.sort(byEntry));
  const errors = [tofu.error, charts.error, manifests.error].filter((error) => error !== undefined);
  const other = errors.find((error) => !(error instanceof DiscoveryError));
  if (other !== undefined) throw other;
  if (errors.length > 0) {
    throw new DiscoveryError(
      errors.flatMap((error) => (error as DiscoveryError).problems).sort(byEntry),
    );
  }
  const declared = [...tofu.stacks, ...charts.stacks, ...manifests.stacks];
  const discovered = await discoverPulumi(root, config);
  if (declared.length === 0) return discovered;
  return [...discovered, ...declared].sort(
    (a, b) => compare(a.path, b.path) || compare(a.name ?? "", b.name ?? ""),
  );
}

// A tool's discovery throws what is wrong with the files only when its
// options are fine, so the error waits until every tool's options are known.
function tryDiscover(discover: () => { stacks: Stack[]; optionProblems: string[] }): {
  stacks: Stack[];
  optionProblems: string[];
  error?: unknown;
} {
  try {
    return discover();
  } catch (error) {
    return { stacks: [], optionProblems: [], error };
  }
}

// Problems of one entry together, in the order of the file.
function byEntry(a: string, b: string): number {
  const index = (text: string) => Number(/^stacks\[(\d+)\]/.exec(text)?.[1] ?? 0);
  return index(a) - index(b);
}

// By code unit, so the order is the same on every machine.
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
