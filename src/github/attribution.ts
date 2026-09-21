// Reading what attribution needs (record 0026): the walk, once per job and
// shared by every stack, and the files of the direct pushes in range, one
// request each. Every mode that renders a row will use it. Attribution never
// blocks: a read that fails leaves the line out and the job carries on.

import {
  type Attribution,
  type AttributionInput,
  attributor,
  type CommitWalk,
  directPushesToRead,
  isCommitId,
} from "../core/attribution.ts";
import type { GitHubPort } from "./port.ts";

export interface AttributionSource {
  // The attribution of each stack that is asked for, by stack id. The value
  // asked with is the commit on the stack's last successful deployment record,
  // or nothing when the bounded reads found none. A stack is missing from the
  // answer when the read failed. Costs no request when no stack has a commit
  // to start from, and none the second time.
  attribute(from: ReadonlyMap<string, string | undefined>): Promise<Map<string, Attribution>>;
}

export function attributionSource(
  github: GitHubPort,
  input: Omit<AttributionInput, "walk" | "pushFiles">,
  // Called once, with GitHub's words, when a read fails.
  onFailure: (message: string) => void,
): AttributionSource {
  let walk: CommitWalk | undefined;
  let failed = false;
  const pushFiles = new Map<string, string[]>();

  return {
    async attribute(from) {
      const starts = [...from.values()].filter((sha) => sha !== undefined);
      try {
        if (failed) return new Map();
        if (!isCommitId(input.scanSha)) throw new Error("the scanned commit is no commit id");
        if (starts.length > 0) {
          walk ??= await github.walkCommits(input.scanSha);
          for (const sha of directPushesToRead(walk, starts)) {
            if (!pushFiles.has(sha)) pushFiles.set(sha, await github.listCommitFiles(sha));
          }
        }
      } catch (error) {
        // Not tried again in this job: the dashboard is written in a loop, and
        // a row that has the line on one try and not on the next helps nobody.
        failed = true;
        onFailure(error instanceof Error ? error.message : String(error));
        return new Map();
      }
      const of = attributor({
        ...input,
        walk: walk ?? { defaultBranch: "", commits: [] },
        pushFiles,
      });
      return new Map([...from].map(([stackId, sha]) => [stackId, of(stackId, sha)]));
    },
  };
}
