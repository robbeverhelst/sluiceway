import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProcessRunner, Run } from "../../src/adapters/process.ts";
import { tools } from "../../src/adapters/tools.ts";
import { parseConfig } from "../../src/core/config.ts";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { answering, replay } from "../adapters/opentofu/replay.ts";
import { DNS } from "../adapters/opentofu/stacks.ts";
import { dashboardBody, harness, repoRoot } from "./harness.ts";

// Record 0092: a root module found from its files is planned and deployed
// the way a declared one is (record 0053). It is the same stack, so it runs
// the same code: init once per directory, a plan saved to a file and the
// deploy of exactly that file.

const TOFU = "v1.12.6";

const BACKEND = 'terraform {\n  backend "local" {\n    path = "dns.tfstate"\n  }\n}\n';

function files(root: string, all: Record<string, string>): void {
  for (const [file, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
}

// The dns root module of the OpenTofu example, with a backend block, found
// with no config at all.
function repo(): string {
  const root = repoRoot("");
  files(root, { "dns/main.tofu": BACKEND });
  return root;
}

function router(root: string): { run: ProcessRunner; runs: Run[] } {
  const runs: Run[] = [];
  const version = replay(TOFU, "version", root);
  const plan = replay(TOFU, "tofu-files", root);
  const init = answering({ status: "exited", exitCode: 0, stdout: "", stderr: "" });
  return {
    runs,
    run: async (asked) => {
      runs.push(asked);
      const command = asked.argv[1];
      if (command === "version") return version.run(asked);
      if (command === "init") return init.run(asked);
      return plan.run(asked);
    },
  };
}

describe("a root module that discovery found", () => {
  test("is the stack a declaration of its path and tool gives, the one the adapter tests deploy", async () => {
    const root = repo();
    expect(await tools.discover(root, parseConfig(""))).toEqual([DNS]);
    expect(
      await tools.discover(root, parseConfig("stacks:\n  - path: dns\n    tool: opentofu\n")),
    ).toEqual([DNS]);
  });

  test("a scan inits its directory, plans it to a file and writes its row", async () => {
    const root = repo();
    const { run, runs } = router(root);
    const { context, github } = harness(tools, { root, run });

    await scan(context);

    expect(runs.map((one) => one.argv.slice(0, 2).join(" "))).toEqual([
      "tofu version",
      "tofu init",
      "tofu plan",
      "tofu show",
    ]);
    expect(runs[2]?.argv).toContain(`-out=${runs[3]?.argv.at(-1)}`);
    expect(runs.every((one) => one.env.TF_WORKSPACE === undefined)).toBe(true);
    const rows = parseDashboard(dashboardBody(github)).rows;
    expect(rows.map((row) => [row.stackId, row.state])).toEqual([["dns", "pending"]]);
  });
});
