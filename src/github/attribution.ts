// Reading what attribution needs (record 0026): the walk, once per job and
// shared by every stack, and the files of the direct pushes in range, one
// request each. Every mode that renders a row will use it. Attribution never
// blocks: a read that fails leaves the line out and the job carries on.
// Record 0072 added the lookback and the number of names as settings, the
// files of a pull request that renamed a file, and what each deploy of the
// trail shipped.

import {
  type Attribution,
  type AttributionInput,
  attributor,
  type CommitWalk,
  directPushesToRead,
  isCommitId,
  LOOKBACK,
  pullRequestsToRead,
  type Range,
} from "../core/attribution.ts";
import type { TrailEntry } from "../core/deployment.ts";
import { newestTrail } from "../render/body.ts";
import type { AttributionLines } from "../render/row.ts";
import type { GitHubPort } from "./port.ts";

// The reads of one change a job makes at most, direct pushes and pull
// requests that renamed a file together, newest first (record 0072). It keeps
// a long lookback inside the API budget of record 0017: a change whose files
// were not read counts as a change outside every stack, which hides nothing.
export const READS_PER_JOB = 100;

export interface AttributionSource {
  // The attribution of each stack that is asked for, by stack id. The value
  // asked with is the commit on the stack's last successful deployment record,
  // or nothing when the bounded reads found none. A stack is missing from the
  // answer when the read failed. Costs no request when no stack has a commit
  // to start from, and none the second time.
  attribute(from: ReadonlyMap<string, string | undefined>): Promise<Map<string, Attribution>>;
  // What each deploy of the trail that is shown shipped (record 0072), by
  // entry. An entry is missing when there is nothing to say or the read
  // failed. Costs no request when no shown entry has a range.
  ship(trail: readonly TrailEntry[]): Promise<Map<TrailEntry, AttributionLines>>;
}

export interface SourceInput extends Omit<AttributionInput, "walk" | "pushFiles"> {
  // `attribution.lookback`.
  lookback?: number | undefined;
  // `dashboard.recentlyDeployed`: how many lines of the trail are shown.
  trailLength?: number | undefined;
}

export function attributionSource(
  github: GitHubPort,
  input: SourceInput,
  // Called once, with GitHub's words, when a read fails. The words come
  // without a full stop at the end, so the caller can end the sentence.
  onFailure: (message: string) => void,
): AttributionSource {
  let walk: CommitWalk | undefined;
  let failed = false;
  const pushFiles = new Map<string, string[]>();
  const pullRequestFiles = new Map<number, string[]>();
  let reads = 0;
  const { lookback, trailLength, ...rest } = input;

  // Walks once, and reads the changes in the ranges it has not read yet, as
  // long as the job has reads left. False when a read failed.
  const read = async (ranges: readonly (string | Range)[]): Promise<boolean> => {
    try {
      if (failed) return false;
      if (!isCommitId(input.scanSha)) throw new Error("the scanned commit is no commit id");
      if (ranges.length === 0) return true;
      walk ??= await github.walkCommits(input.scanSha, lookback ?? LOOKBACK);
      for (const sha of directPushesToRead(walk, ranges)) {
        if (pushFiles.has(sha) || reads >= READS_PER_JOB) continue;
        reads++;
        pushFiles.set(sha, await github.listCommitFiles(sha));
      }
      for (const number of pullRequestsToRead(walk, ranges)) {
        if (pullRequestFiles.has(number) || reads >= READS_PER_JOB) continue;
        reads++;
        pullRequestFiles.set(number, await github.listPullRequestFiles(number));
      }
      return true;
    } catch (error) {
      // Not tried again in this job: the dashboard is written in a loop, and
      // a row that has the line on one try and not on the next helps nobody.
      failed = true;
      const words = error instanceof Error ? error.message : String(error);
      onFailure(words.replace(/\.+$/, ""));
      return false;
    }
  };

  const of = () =>
    attributor({
      ...rest,
      walk: walk ?? { defaultBranch: "", commits: [] },
      pushFiles,
      pullRequestFiles,
    });

  return {
    async attribute(from) {
      const starts = [...from.values()].filter((sha) => sha !== undefined);
      if (!(await read(starts))) return new Map();
      const one = of();
      return new Map([...from].map(([stackId, sha]) => [stackId, one(stackId, sha)]));
    },

    async ship(trail) {
      const shown = newestTrail(trail, trailLength).filter(({ shipped }) => shipped);
      const ranges = shown.flatMap(({ shipped }) => (shipped ? [shipped] : []));
      if (ranges.length === 0 || !(await read(ranges))) return new Map();
      const one = of();
      const lines = new Map<TrailEntry, AttributionLines>();
      for (const entry of shown) {
        const said =
          entry.shipped && one.shipped(entry.stackId, entry.shipped.from, entry.shipped.to);
        if (said) lines.set(entry, said);
      }
      return lines;
    },
  };
}
