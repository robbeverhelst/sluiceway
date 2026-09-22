import * as core from "@actions/core";
import { actionDirectory } from "./github/action-ref.ts";
import { parseMode, post, run } from "./mode.ts";
import { runSettle } from "./modes/settle-job.ts";

// dist/post.js, the post step of action.yml, sets this before it loads the
// bundle, so one bundle serves both (record 0077).
const isPost = (globalThis as { sluicewayPost?: unknown }).sluicewayPost === true;

try {
  const mode = parseMode(core.getInput("mode"));
  if (isPost) {
    await post(
      mode,
      (name) => core.getState(name),
      () => runSettle(),
    );
  } else {
    // Only the entry point's own address says where the action sits, in the
    // source and in the bundle alike (hotfix 0.1.1).
    await run(mode, actionDirectory(import.meta.url));
  }
} catch (error) {
  core.setFailed(error instanceof Error ? error.message : String(error));
}
