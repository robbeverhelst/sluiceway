import { ConfigError } from "../../core/config.ts";
import type { Adapter } from "../adapter.ts";
import { discoverOpenTofu } from "./discover.ts";

const notYet = (): never => {
  throw new Error("Not built yet.");
};

export const opentofu: Adapter = {
  async discover(root, config) {
    const { stacks, optionProblems } = discoverOpenTofu(root, config);
    if (optionProblems.length > 0) throw new ConfigError(optionProblems);
    return stacks;
  },
  checkVersion: notYet,
  preview: notYet,
  toolDiff: notYet,
  apply: notYet,
};
