import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProcessRunner, Run } from "../../src/adapters/process.ts";
import { tools } from "../../src/adapters/tools.ts";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { replay as tofuReplay } from "../adapters/opentofu/replay.ts";
import { replay as pulumiReplay } from "../adapters/pulumi/replay.ts";
import { dashboardBody, harness, repoRoot } from "./harness.ts";

// Record 0053: one repo, one dashboard, stacks of both tools. The scan runs
// with the adapter the action uses and the tools' recorded output, each
// command going to the recording of its own tool.

const PULUMI = "v3.263.0";
const TOFU = "v1.12.6";

function files(root: string, all: Record<string, string>): void {
  for (const [file, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
}

const CONFIG = [
  "stacks:",
  "  - path: tofu/network",
  "    name: dev",
  "    tool: opentofu",
  "    options:",
  "      workspace: dev",
  "      varFiles: [dev.tfvars]",
  "",
].join("\n");

function mixedRepo(config = CONFIG): string {
  const root = repoRoot(config);
  files(root, {
    "network/Pulumi.yaml": "name: network\nruntime: yaml\n",
    "network/Pulumi.dev.yaml": "",
    "tofu/network/main.tf": "",
    "tofu/network/dev.tfvars": "",
  });
  return root;
}

// Every command to the recording of its tool. The OpenTofu example lives in
// tofu/ of this repo, so its recordings are replayed from there.
function router(root: string): { run: ProcessRunner; runs: Run[] } {
  const runs: Run[] = [];
  const pulumiVersion = pulumiReplay(PULUMI, "version", root);
  const pulumiPreview = pulumiReplay(PULUMI, "new-stack", root);
  const tofuVersion = tofuReplay(TOFU, "version", root);
  const tofuPlan = tofuReplay(TOFU, "new-stack", join(root, "tofu"));
  return {
    runs,
    run: async (asked) => {
      runs.push(asked);
      const [tool, command] = asked.argv;
      if (tool === "pulumi") {
        return (command === "version" ? pulumiVersion : pulumiPreview).run(asked);
      }
      return (command === "version" ? tofuVersion : tofuPlan).run(asked);
    },
  };
}

describe("a repo with Pulumi and OpenTofu stacks", () => {
  test("one scan checks both tools, inits the OpenTofu directory first, and writes both rows", async () => {
    const root = mixedRepo();
    const { run, runs } = router(root);
    const { context, github, log } = harness(tools, { root, run });

    await scan(context);

    const rows = parseDashboard(dashboardBody(github)).rows;
    expect(rows.map((row) => [row.stackId, row.state])).toEqual([
      ["network:dev", "pending"],
      ["tofu/network:dev", "pending"],
    ]);
    const commands = runs.map((one) => one.argv.slice(0, 2).join(" "));
    expect(commands.slice(0, 3)).toEqual(["pulumi version", "tofu version", "tofu init"]);
    // After every preview the scan reads the Pulumi stack's history, and
    // never an OpenTofu one: OpenTofu keeps none (record 0073).
    expect(commands.slice(3, -1).sort()).toEqual(["pulumi preview", "tofu plan", "tofu show"]);
    expect(commands.at(-1)).toBe("pulumi stack");
    expect(log.groups.map((group) => group.title)).toContain("Prepared tofu/network");
    expect(dashboardBody(github)).toContain("**tofu/network:dev** · 4 creates");
  });

  test("a repo with only Pulumi stacks never starts tofu", async () => {
    const root = mixedRepo("");
    const { run, runs } = router(root);
    const { context } = harness(tools, { root, run });

    await scan(context);

    // The version, the preview and the history (record 0073).
    expect(runs.map((one) => one.argv[0])).toEqual(["pulumi", "pulumi", "pulumi"]);
  });
});
