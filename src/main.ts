import * as core from "@actions/core";
import { actionDirectory } from "./github/action-ref.ts";
import { parseMode, run } from "./mode.ts";

try {
  // Only the entry point's own address says where the action sits, in the
  // source and in the bundle alike (hotfix 0.1.1).
  await run(parseMode(core.getInput("mode")), actionDirectory(import.meta.url));
} catch (error) {
  core.setFailed(error instanceof Error ? error.message : String(error));
}
