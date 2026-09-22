import { ConfigError } from "../../core/config.ts";
import type { Adapter } from "../adapter.ts";
import { apply } from "./apply.ts";
import { discoverHelm } from "./discover.ts";
import { detectDrift } from "./drift.ts";
import { prepare } from "./prepare.ts";
import { preview } from "./preview.ts";
import { toolDiff } from "./tool-diff.ts";
import { checkVersion } from "./version.ts";

// A Helm release in a namespace is a stack (record 0058), and its drift check
// is the diff plugin's three-way merge against the live objects (record 0069).
export const helm: Adapter = {
  async discover(root, config) {
    const { stacks, optionProblems } = discoverHelm(root, config);
    if (optionProblems.length > 0) throw new ConfigError(optionProblems);
    return stacks;
  },
  checkVersion,
  prepare,
  preview,
  toolDiff,
  detectDrift,
  apply,
};
