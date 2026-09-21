import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CANARY_SECRET, CANARY_VALUE } from "../../scripts/fixtures/example.ts";
import type { Adapter } from "../../src/adapters/adapter.ts";
import type { ProcessRunner } from "../../src/adapters/process.ts";
import { pulumi } from "../../src/adapters/pulumi/index.ts";
import type { MatrixEntry } from "../../src/core/resolve.ts";
import { apply } from "../../src/modes/apply.ts";
import { resolve } from "../../src/modes/resolve.ts";
import { scan } from "../../src/modes/scan.ts";
import { FIXTURES, replay, VERSIONS } from "../adapters/pulumi/replay.ts";
import { ACTION_REF, harness, REPO_URL, repoRoot, SHA, stack } from "./harness.ts";
import { rememberingOutputs } from "./outputs-harness.ts";
import {
  ALICE,
  RESOLVE_RUN,
  type ResolveHarness,
  tick,
  WORKFLOW,
  WRITE,
} from "./resolve-harness.ts";

// The whole way with the real Pulumi adapter and what the real CLI printed in
// the deploy scenarios (record 0001): a scan previews network:dev, alice ticks
// it, `resolve` hands it on, and `apply` previews it again and deploys it. The
// hash of the recorded preview is the one the row showed, so only a recording
// that holds the same diff can deploy.

const ID = "network:dev";

// The version check is not in these recordings. Its own tests replay it.
function adapterFor(): Adapter {
  return { ...pulumi, discover: async () => [stack(ID)], checkVersion: async () => {} };
}

// Hands each command to the first recording that holds it.
function inTurn(...runs: ProcessRunner[]): ProcessRunner {
  return async (asked) => {
    for (const run of runs) {
      try {
        return await run(asked);
      } catch {}
    }
    throw new Error(`No recording holds "${asked.argv.join(" ")}".`);
  };
}

async function deployed(
  version: string,
  scenario: string,
  applyRun?: (root: string) => ProcessRunner,
) {
  const root = repoRoot();
  const adapter = adapterFor();
  // Both result files are searched with everything else that is shown.
  const outputs = rememberingOutputs();
  const { context, github, log } = harness(adapter, {
    root,
    run: replay(version, scenario, root).run,
    outputs,
  });
  await scan(context);
  github.seedPermission(ALICE.login, WRITE);
  github.seedRun(RESOLVE_RUN, { completed: false });
  tick({ github, number: 1 } as ResolveHarness, ALICE, [ID]);
  let matrix: MatrixEntry[] = [];
  await resolve({
    root,
    adapter,
    github,
    log,
    repoUrl: REPO_URL,
    runId: RESOLVE_RUN,
    sha: SHA,
    actionRef: ACTION_REF,
    event: github.deliverEvent(),
    workflow: WORKFLOW,
    setOutput: (_name, value) => {
      matrix = JSON.parse(value);
    },
  });
  const deployment = matrix[0]?.deployment ?? 0;
  log.summaries.length = 0;
  const runs = replay(version, scenario, root);
  const outcome = apply({
    root,
    env: { PATH: "/usr/bin", INPUT_GITHUB_TOKEN: "ghs_not_for_the_tool" },
    adapter,
    run: applyRun ? applyRun(root) : runs.run,
    github,
    log,
    previewTimeoutMinutes: 10,
    repoUrl: REPO_URL,
    runId: RESOLVE_RUN,
    runAttempt: "1",
    sha: SHA,
    actionRef: ACTION_REF,
    deploymentId: deployment,
    outputs,
  });
  return { outcome, github, log, deployment, runs, root, outputs };
}

for (const version of VERSIONS) {
  describe(`apply with the real adapter, replaying pulumi ${version}`, () => {
    test("the recorded deploy goes out, and the record ends as success", async () => {
      const { outcome, github, deployment, runs, root } = await deployed(version, "deploy");
      await outcome;

      expect(runs.runs.map(({ argv }) => argv[1])).toEqual(["preview", "up"]);
      expect(runs.runs.every(({ cwd }) => cwd === join(root, "network"))).toBe(true);
      expect(runs.runs.every(({ env }) => !("INPUT_GITHUB_TOKEN" in env))).toBe(true);
      expect(github.deploymentStatuses(deployment).map(({ state }) => state)).toEqual([
        "queued",
        "in_progress",
        "success",
      ]);
    });

    // Record 0021: the summary of an apply never lists stack outputs, and no
    // value is anywhere but in the tool's own words in the job log.
    test("outputs and values are never in the summary, the body or the record", async () => {
      const { outcome, github, log, deployment, outputs } = await deployed(version, "deploy");
      await outcome;

      const shown = [
        ...log.summaries,
        JSON.stringify(outputs.resultFile("scan")),
        JSON.stringify(outputs.resultFile("apply")),
        JSON.stringify(outputs.values),
        github.issue(1).body,
        JSON.stringify(github.deploymentStatuses(deployment)),
        JSON.stringify(github.deployment(deployment)),
        ...log.lines,
      ].join("\n");
      expect(log.summaries.at(-1)).toContain(`**${ID}** · deployed`);
      expect(outputs.resultFile("apply")).toMatchObject({ outcome: "deployed", stack: ID });
      expect(shown).not.toContain("networkName");
      expect(shown).not.toContain(CANARY_VALUE);
      expect(shown).not.toContain(CANARY_SECRET);
      // Nothing of what the tool printed for the deploy leaves the job log.
      const up = readFileSync(join(FIXTURES, version, "deploy", "up.stdout"), "utf8");
      for (const line of up.split("\n").filter((one) => one.trim().length > 12)) {
        expect(shown).not.toContain(line.trim());
      }
    });

    test("the recorded failed deploy ends as failure, and the job is red", async () => {
      // The preview after the failed deploy is not in the recording. It gives
      // the same diff again, from a second copy of it.
      const { outcome, github, deployment, log } = await deployed(
        version,
        "deploy-failed",
        (root) =>
          inTurn(
            replay(version, "deploy-failed", root).run,
            replay(version, "deploy-failed", root).run,
          ),
      );
      await expect(outcome).rejects.toThrow(
        `${ID} was not deployed: the tool exited with an error (exit code 1).`,
      );
      expect(github.deploymentStatuses(deployment).map(({ state }) => state)).toEqual([
        "queued",
        "in_progress",
        "failure",
      ]);
      const words = log.groups.find(({ title }) => title === `${ID}: the deploy`)?.lines ?? [];
      expect(words).toContain("    error: update failed");
      expect(log.summaries.join("\n")).not.toContain("update failed");
      expect(github.issue(1).body).not.toContain("update failed");
    });
  });
}
