import { ConfigError } from "../../core/config.ts";
import type { Adapter } from "../adapter.ts";
import { apply } from "./apply.ts";
import { discoverHelm } from "./discover.ts";
import { prepare } from "./prepare.ts";
import { preview } from "./preview.ts";
import { toolDiff } from "./tool-diff.ts";
import { checkVersion } from "./version.ts";

// A Helm release in a namespace is a stack (record 0058). There is no drift
// check for Helm stacks.
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
  apply,
};
