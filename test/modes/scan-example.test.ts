import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { CANARY_SECRET, CANARY_VALUE } from "../../scripts/fixtures/example.ts";
import type { ProcessRunner } from "../../src/adapters/process.ts";
import { pulumi } from "../../src/adapters/pulumi/index.ts";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { FIXTURES, readRecording, VERSIONS } from "../adapters/pulumi/replay.ts";
import { dashboardBody, harness, SHA } from "./harness.ts";

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

function replayedTool(version: string, scenarios = SCENARIO_OF): ProcessRunner {
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
    const scenario = scenarios[`${relative(ROOT, run.cwd)} ${run.argv.at(-1)}`];
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

// Onboarding log, hurdle 9, and record 0022 as amended: network:prod has a
// stack file and no stack in the backend. It answers with what the real CLI
// printed for such a stack.
describe("a stack of the example project that does not exist in the backend", () => {
  const MISSING = { ...SCENARIO_OF, "network prod": "missing-stack" };

  async function scanned(version: string) {
    const { context, github, log } = harness(pulumi, {
      root: ROOT,
      run: replayedTool(version, MISSING),
    });
    await scan(context);
    return { dashboard: dashboardBody(github), summaries: log.summaries, log };
  }

  test("gives the same row and summary from both CLI versions", async () => {
    const results = [];
    for (const version of VERSIONS) {
      const { dashboard, summaries } = await scanned(version);
      results.push({ dashboard, summaries });
    }
    expect(results[1]).toEqual(results[0]);
    const row = parseDashboard(results[0]?.dashboard ?? "").rows.find(
      (candidate) => candidate.stackId === "network:prod",
    );
    expect(row?.text).toMatchSnapshot("row");
    expect(results[0]?.summaries[0]).toMatchSnapshot("summary");
  });

  test.each(VERSIONS)(
    "says so on the row, in the summary and on the run, replayed from %s",
    async (version) => {
      const { dashboard, summaries, log } = await scanned(version);
      expect(dashboard).toContain(
        "- **network:prod** · preview failed: the stack does not exist in the backend · [run](",
      );
      expect(summaries[0]).toContain(
        "- **network:prod** · the stack does not exist in the backend · create it, or take it off the dashboard with <code>&quot;network:prod&quot;</code> under <code>ignore</code> in <code>sluiceway.yaml</code>\n",
      );
      expect(log.warnings).toContainEqual({
        title: "Preview failed",
        message: "The preview of network:prod failed: the stack does not exist in the backend.",
      });
      // The tool's words, which name the stack, stay in the job log (record 0022).
      const written = [dashboard, ...summaries, ...log.lines].join("\n");
      expect(written).not.toContain("no stack named");
      expect(log.groups.find((group) => group.title === "network:prod")?.lines).toContain(
        "error: no stack named 'ghost' found",
      );
      // Any other failure is still "the tool exited with an error".
      expect(dashboard).toContain(
        "- **site:prod** · preview failed: the tool exited with an error (exit code 1) · [run](",
      );
    },
  );
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

// The narrowed scan with real discovery and the real sluiceway.yaml: the paths
// discovery gives, the inputs of the config file and the paths GitHub names
// have to meet in one form (record 0010).
describe("a narrowed scan of the example project", () => {
  const [version = ""] = VERSIONS;
  const OLD = "1111111111111111111111111111111111111111";

  async function afterPush(...paths: string[]) {
    const first = harness(pulumi, { root: ROOT, run: replayedTool(version), sha: OLD });
    await scan(first.context);
    const before = dashboardBody(first.github);
    first.github.seedComparison(OLD, SHA, {
      status: "ahead",
      files: paths.map((path) => ({ path })),
    });
    const started: string[] = [];
    const tool = replayedTool(version);
    const next = harness(pulumi, {
      root: ROOT,
      github: first.github,
      event: "push",
      run: (run) => {
        if (run.argv.includes("preview")) started.push(relative(ROOT, run.cwd));
        return tool(run);
      },
    });
    await scan(next.context);
    return { started: started.sort(), before, after: dashboardBody(first.github), log: next.log };
  }

  const rows = (body: string) =>
    Object.fromEntries(parseDashboard(body).rows.map((row) => [row.stackId, row.text]));

  test("a file under shared/ is claimed by app through its inputs, and the broken site stack is tried again", async () => {
    const { started, before, after, log } = await afterPush("shared/motd.txt");
    expect(started).toEqual(["app", "site"]);
    expect(log.lines).toContain("app:prod is previewed: it claims shared/motd.txt.");
    expect(log.lines).toContain("site:prod is previewed: its row is a preview failure.");
    expect(rows(after)["network:dev"]).toBe(rows(before)["network:dev"] as string);
    expect(rows(after)["network:prod"]).toBe(rows(before)["network:prod"] as string);
  });

  test("the program of app lies in app/program, inside the stack's directory", async () => {
    expect((await afterPush("app/program/Main.yaml")).started).toEqual(["app", "site"]);
  });

  test("a file in network/ is claimed by both of its stacks", async () => {
    expect((await afterPush("network/Pulumi.yaml")).started).toEqual([
      "network",
      "network",
      "site",
    ]);
  });

  test("the ignored playground stack claims nothing, so a change there is a full scan", async () => {
    const { started, log } = await afterPush("playground/Pulumi.yaml");
    expect(started).toEqual(["app", "network", "network", "site"]);
    expect(log.lines).toContain(
      "This is a full scan. A push gives a narrowed scan, and this one fell back to a full scan: no stack claims playground/Pulumi.yaml.",
    );
  });
});
