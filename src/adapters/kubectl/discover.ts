import { join } from "node:path";
import type { Config } from "../../core/config.ts";
import { DiscoveryError } from "../../core/discovery.ts";
import type { Stack } from "../../core/stack.ts";
import { KUBECTL, type KubectlStackOptions, parseKubectlOptions } from "./options.ts";
import { filesIn, isKustomization, isManifestFile } from "./render.ts";

// A directory of YAML says nothing about which cluster it belongs to, and a
// manifest looks the same whether a person applies it or a controller reads
// it, so a stack cannot be found from the files alone (record 0060). A
// `stacks` entry with `tool: kubectl` names it, and discovery checks from the
// files alone that the entry can work. It never starts the tool and never
// reaches a cluster (record 0014).

const NAMES = "An entry with tool: kubectl names a directory of manifests or a kustomization.";

// The option problems are config problems and are thrown by the caller, so
// they come back here instead. What is wrong with the files is a
// DiscoveryError.
export function discoverKubectl(
  root: string,
  config: Config,
): { stacks: Stack[]; optionProblems: string[] } {
  const stacks: Stack[] = [];
  const optionProblems: string[] = [];
  const problems: string[] = [];

  config.stacks.forEach((entry, index) => {
    if (entry.tool !== KUBECTL) return;
    const parsed = parseKubectlOptions(entry.options, index);
    if (!parsed.ok) {
      optionProblems.push(...parsed.problems);
      return;
    }
    const shown = JSON.stringify(entry.path);
    const files = filesIn(join(root, entry.path));
    if (files === undefined) {
      problems.push(`stacks[${index}]: ${shown} is not a directory of the repo. ${NAMES}`);
      return;
    }
    if (!files.some((file) => isKustomization(file) || isManifestFile(file))) {
      problems.push(
        `stacks[${index}]: ${shown} holds no manifests (*.yaml, *.yml, *.json) and no kustomization. ${NAMES}`,
      );
      return;
    }
    const options: KubectlStackOptions = { tool: KUBECTL, ...parsed.options };
    stacks.push({
      path: entry.path,
      ...(entry.name === undefined ? {} : { name: entry.name }),
      options: { ...options },
    });
  });

  if (optionProblems.length === 0 && problems.length > 0) throw new DiscoveryError(problems);
  return { stacks, optionProblems };
}
