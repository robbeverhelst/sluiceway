import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProcessRunner, Run } from "../../src/adapters/process.ts";
import { tools } from "../../src/adapters/tools.ts";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { replay as helmReplay } from "../adapters/helm/replay.ts";
import { replay as tofuReplay } from "../adapters/opentofu/replay.ts";
import { replay as pulumiReplay } from "../adapters/pulumi/replay.ts";
import { dashboardBody, harness, repoRoot } from "./harness.ts";

// Record 0058: one repo, one dashboard, stacks of three tools. The scan runs
// with the adapter the action uses and the tools' recorded output, each
// command going to the recording of its own tool. The Helm example lives in
// helm/ of this repo, and its stack needs a dependency build first.

const PULUMI = "v3.263.0";
const TOFU = "v1.12.6";
const HELM = "v4.3.0";

const CONFIG = [
  "stacks:",
  "  - path: tofu/network",
  "    name: dev",
  "    tool: opentofu",
  "    options:",
  "      workspace: dev",
  "      varFiles: [dev.tfvars]",
  "  - path: helm/worker",
  "    tool: helm",
  "    options:",
  "      release: worker",
  "      namespace: sluiceway-worker",
  "      chart: ../charts/worker",
  "      valuesFiles: [values.yaml]",
  "",
].join("\n");

function threeToolRepo(config = CONFIG): string {
  const root = repoRoot(config);
  const files: Record<string, string> = {
    "network/Pulumi.yaml": "name: network\nruntime: yaml\n",
    "network/Pulumi.dev.yaml": "",
    "tofu/network/main.tf": "",
    "tofu/network/dev.tfvars": "",
    "helm/charts/worker/Chart.yaml":
      "apiVersion: v2\nname: worker\nversion: 0.1.0\ndependencies:\n  - name: web\n    version: 0.1.0\n    repository: file://../web\n",
    "helm/worker/values.yaml": "",
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

function router(root: string): { run: ProcessRunner; runs: Run[] } {
  const runs: Run[] = [];
  const pulumiVersion = pulumiReplay(PULUMI, "version", root);
  const pulumiPreview = pulumiReplay(PULUMI, "new-stack", root);
  const tofuVersion = tofuReplay(TOFU, "version", root);
  const tofuPlan = tofuReplay(TOFU, "new-stack", join(root, "tofu"));
  const helmVersion = helmReplay(HELM, "version", root);
  const helmDiff = helmReplay(HELM, "dependencies", join(root, "helm"));
  return {
    runs,
    run: async (asked) => {
      runs.push(asked);
      const [tool, command, sub] = asked.argv;
      if (tool === "pulumi") {
        return (command === "version" ? pulumiVersion : pulumiPreview).run(asked);
      }
      if (tool === "tofu") return (command === "version" ? tofuVersion : tofuPlan).run(asked);
      return (command === "version" || sub === "version" ? helmVersion : helmDiff).run(asked);
    },
  };
}

describe("a repo with Pulumi, OpenTofu and Helm stacks", () => {
  test("one scan checks every tool, prepares before any preview, and writes every row", async () => {
    const root = threeToolRepo();
    const { run, runs } = router(root);
    const { context, github, log } = harness(tools, { root, run });

    await scan(context);

    const rows = parseDashboard(dashboardBody(github)).rows;
    expect(rows.map((row) => [row.stackId, row.state])).toEqual([
      ["helm/worker", "pending"],
      ["network:dev", "pending"],
      ["tofu/network:dev", "pending"],
    ]);
    const commands = runs.map((one) => one.argv.slice(0, 3).join(" "));
    expect(commands.slice(0, 6)).toEqual([
      "pulumi version",
      "tofu version -json",
      "helm version --template={{.Version}}",
      "helm diff version",
      "tofu init -input=false",
      "helm dependency build",
    ]);
    // After every preview the scan reads the Pulumi stack's history, and no
    // other: OpenTofu and Helm keep none (record 0073).
    expect(commands.at(-1)).toBe("pulumi stack history");
    expect(commands.slice(6, -1).sort()).toEqual([
      "helm diff upgrade",
      "pulumi preview --json",
      "tofu plan -input=false",
      "tofu show -json",
    ]);
    expect(log.groups.map((group) => group.title)).toContain("Prepared helm/charts/worker");
    expect(dashboardBody(github)).toContain("**helm/worker** · 3 creates");
  });

  test("a repo without Helm stacks never starts helm", async () => {
    const root = threeToolRepo(CONFIG.split("  - path: helm/worker")[0]);
    const { run, runs } = router(root);
    const { context } = harness(tools, { root, run });

    await scan(context);

    expect(runs.some((one) => one.argv[0] === "helm")).toBe(false);
  });
});
