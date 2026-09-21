import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { CANARY_SECRET, CANARY_VALUE } from "../../scripts/fixtures/example.ts";
import type { ProcessRunner } from "../../src/adapters/process.ts";
import { pulumi } from "../../src/adapters/pulumi/index.ts";
import { scan } from "../../src/modes/scan.ts";
import { FIXTURES, readRecording, VERSIONS } from "../adapters/pulumi/replay.ts";
import { dashboardBody, harness } from "./harness.ts";

// The scan of the example project with the real adapter and a replayed tool
// (build plan, section 6): discovery and config read the real files, and each
// stack's preview answers with what the real CLI printed in one recorded
// scenario. The recordings were all made in network/ or app/, and a stack id
// never comes from the tool's output, so any stack can replay any scenario.

const ROOT = resolve(import.meta.dir, "../../examples/pulumi-basic");

const SCENARIO_OF: Record<string, string> = {
  "app prod": "new-stack-yml-project",
  "network dev": "mixed",
  "network prod": "no-changes",
  "site prod": "program-error",
};

function replayedTool(version: string): ProcessRunner {
  const answer = (scenario: string) => {
    const [command] = readRecording(version, scenario).commands;
    if (command === undefined) throw new Error(`${scenario} holds no command.`);
    const file = (name: string) => readFileSync(join(FIXTURES, version, scenario, name), "utf8");
    return {
      status: "exited" as const,
      exitCode: command.exitCode,
      stdout: file(command.stdout),
      stderr: file(command.stderr),
    };
  };
  return async (run) => {
    if (run.argv.join(" ") === "pulumi version") return answer("version");
    const scenario = SCENARIO_OF[`${relative(ROOT, run.cwd)} ${run.argv.at(-1)}`];
    if (scenario === undefined) {
      throw new Error(`No scenario for "${run.argv.join(" ")}" in ${run.cwd}.`);
    }
    return answer(scenario);
  };
}

test("a full scan of the example project gives the same dashboard and summary from both CLI versions", async () => {
  const results = [];
  for (const version of VERSIONS) {
    const { context, github, log } = harness(pulumi, { root: ROOT, run: replayedTool(version) });
    await scan(context);
    results.push({ dashboard: dashboardBody(github), summaries: log.summaries });
  }
  expect(results).toHaveLength(2);
  expect(results[1]).toEqual(results[0]);
  expect(results[0]?.summaries).toHaveLength(1);
  expect(results[0]?.dashboard).toMatchSnapshot("dashboard");
  expect(results[0]?.summaries[0]).toMatchSnapshot("summary");
});

describe.each(VERSIONS)("a full scan of the example project, replayed from %s", (version) => {
  test("leaves the ignored playground stack out and keeps the job green for one broken stack", async () => {
    const { context, log } = harness(pulumi, { root: ROOT, run: replayedTool(version) });
    await scan(context);
    expect(log.groups.map((group) => group.title)).toEqual([
      "app:prod",
      "network:dev",
      "network:prod",
      "site:prod",
    ]);
    expect(log.warnings).toEqual([
      {
        title: "Preview failed",
        message: "The preview of site:prod failed: the tool exited with an error (exit code 1).",
      },
    ]);
  });

  // The canary test again, on the wired scan (record 0021). The groups of the
  // job log are left out: they hold the tool's own words, which may quote a
  // value and go nowhere else (record 0022).
  test("no value reaches the dashboard, the summary, an annotation or a plain log line", async () => {
    const { context, github, log } = harness(pulumi, { root: ROOT, run: replayedTool(version) });
    await scan(context);
    const written = [
      dashboardBody(github),
      ...log.summaries,
      ...log.lines,
      ...log.warnings.flatMap((warning) => [warning.title, warning.message]),
    ].join("\n");
    for (const forbidden of [CANARY_VALUE, CANARY_SECRET, "CANARY", "[secret]"]) {
      expect(written).not.toContain(forbidden);
    }
  });
});
