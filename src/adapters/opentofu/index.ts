import { ConfigError } from "../../core/config.ts";
import type { Adapter } from "../adapter.ts";
import { apply } from "./apply.ts";
import { discoverOpenTofu } from "./discover.ts";
import { prepare } from "./prepare.ts";
import { preview } from "./preview.ts";
import { toolDiff } from "./tool-diff.ts";
import { checkVersion } from "./version.ts";

export const opentofu: Adapter = {
  async discover(root, config) {
    const { stacks, optionProblems } = discoverOpenTofu(root, config);
    if (optionProblems.length > 0) throw new ConfigError(optionProblems);
    return stacks;
  },
  checkVersion,
  prepare,
  preview,
  toolDiff,
  apply,
};
