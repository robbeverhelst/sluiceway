import type { Config } from "../core/config.ts";
import { ConfigError, DEPENDS_ON_AUTO } from "../core/config.ts";
import type { Stack } from "../core/stack.ts";
import { discoverOpenTofu } from "./opentofu/discover.ts";
import { OPENTOFU } from "./opentofu/options.ts";
import { discover as discoverPulumi } from "./pulumi/discover.ts";

// Discovery of every tool, on its own so that the check job reaches files and
// nothing that starts a tool (record 0042). Pulumi stacks are found from their
// files, as before. OpenTofu stacks come from `stacks` entries with
// `tool: opentofu` (record 0053). A repo with only Pulumi stacks gets exactly
// what the Pulumi adapter finds.

// The tools a `stacks` entry may name.
export const TOOLS = [OPENTOFU] as const;

export async function discoverAll(root: string, config: Config): Promise<Stack[]> {
  const toolProblems = config.stacks.flatMap((entry, index) => {
    if (entry.tool === undefined) return [];
    if (!(TOOLS as readonly string[]).includes(entry.tool)) {
      return [
        `stacks[${index}].tool: unknown tool ${JSON.stringify(entry.tool)}. Known tools: ${TOOLS.join(", ")}.`,
      ];
    }
    // Stack references are Pulumi's (record 0059). A stack of another tool
    // with auto would wait on nothing and say nothing.
    return entry.dependsOn === DEPENDS_ON_AUTO
      ? [
          `stacks[${index}].dependsOn: ${DEPENDS_ON_AUTO} reads the stack references of a Pulumi program, and an ${entry.tool} stack has none. Name the stack ids instead.`,
        ]
      : [];
  });
  const { stacks: declared, optionProblems } = discoverOpenTofu(root, config);
  const problems = [...toolProblems, ...optionProblems];
  if (problems.length > 0) throw new ConfigError(problems.sort(byEntry));
  const discovered = await discoverPulumi(root);
  if (declared.length === 0) return discovered;
  return [...discovered, ...declared].sort(
    (a, b) => compare(a.path, b.path) || compare(a.name ?? "", b.name ?? ""),
  );
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
