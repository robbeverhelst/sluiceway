import { ConfigError } from "../../core/config.ts";
import type { Adapter } from "../adapter.ts";
import { apply } from "./apply.ts";
import { discoverKubectl } from "./discover.ts";
import { detectDrift } from "./drift.ts";
import { preview } from "./preview.ts";
import { toolDiff } from "./tool-diff.ts";
import { checkVersion } from "./version.ts";

// The Kubernetes manifests adapter (records 0060 and 0070). It has no
// preparation. Its drift check runs only for a stack with pruning or
// forceConflicts.
export const kubectl: Adapter = {
  async discover(root, config) {
    const { stacks, optionProblems } = discoverKubectl(root, config);
    if (optionProblems.length > 0) throw new ConfigError(optionProblems);
    return stacks;
  },
  checkVersion,
  preview,
  toolDiff,
  detectDrift,
  apply,
};
