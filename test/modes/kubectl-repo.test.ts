import { describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Adapter, PreviewResult } from "../../src/adapters/adapter.ts";
import { kubectl } from "../../src/adapters/kubectl/index.ts";
import type { ProcessRunner, Run } from "../../src/adapters/process.ts";
import { tools } from "../../src/adapters/tools.ts";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { replay as kubectlReplay, ROOT } from "../adapters/kubectl/replay.ts";
import { WEB } from "../adapters/kubectl/stacks.ts";
import { replay as pulumiReplay } from "../adapters/pulumi/replay.ts";
import { handedOn, runApply, states } from "./apply-harness.ts";
import { dashboardBody, harness, repoRoot } from "./harness.ts";

// Record 0060: Kubernetes manifests stacks next to Pulumi stacks, on one
// dashboard, with the adapter the action uses and the tools' recorded output.
// And `apply` of a kubectl stack: the rendered set its fresh preview diffed
// goes out, and a change that moved after the tick sends nothing.

const PULUMI = "v3.263.0";
const KUBECTL = "v1.37.0";

const CONFIG = [
  "stacks:",
  "  - path: k8s/web",
  "    tool: kubectl",
  "    options:",
  "      namespace: sluiceway-example",
  "",
].join("\n");

function mixedRepo(config = CONFIG): string {
  const root = repoRoot(config);
  for (const [file, text] of Object.entries({
    "network/Pulumi.yaml": "name: network\nruntime: yaml\n",
    "network/Pulumi.dev.yaml": "",
  })) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  cpSync(join(ROOT, "web"), join(root, "k8s/web"), { recursive: true });
  return root;
}

// Every command to the recording of its tool. The example's web/ lives in
// k8s/ of this repo, so its recordings are replayed from there.
function router(root: string): { run: ProcessRunner; runs: Run[] } {
  const runs: Run[] = [];
  const pulumiVersion = pulumiReplay(PULUMI, "version", root);
  const pulumiPreview = pulumiReplay(PULUMI, "new-stack", root);
  const kubectlVersion = kubectlReplay(KUBECTL, "version", root);
  const kubectlDiff = kubectlReplay(KUBECTL, "new-stack", join(root, "k8s"));
  return {
    runs,
    run: async (asked) => {
      runs.push(asked);
      const [tool, command] = asked.argv;
      if (tool === "pulumi") {
        return (command === "version" ? pulumiVersion : pulumiPreview).run(asked);
      }
      return (command === "version" ? kubectlVersion : kubectlDiff).run(asked);
    },
  };
}

describe("a repo with Pulumi and Kubernetes manifests stacks", () => {
  test("one scan checks both tools and writes both rows", async () => {
    const root = mixedRepo();
    const { run, runs } = router(root);
    const { context, github } = harness(tools, { root, run });

    await scan(context);

    const rows = parseDashboard(dashboardBody(github)).rows;
    expect(rows.map((row) => [row.stackId, row.state])).toEqual([
      ["k8s/web", "pending"],
      ["network:dev", "pending"],
    ]);
    const commands = runs.map((one) => one.argv.slice(0, 2).join(" "));
    expect(commands.slice(0, 2)).toEqual(["pulumi version", "kubectl version"]);
    expect(commands.slice(2).sort()).toEqual(["kubectl diff", "pulumi preview"]);
    expect(dashboardBody(github)).toContain("**k8s/web** · 4 creates");
  });

  test("a repo with only Pulumi stacks never starts kubectl", async () => {
    const root = mixedRepo("");
    const { run, runs } = router(root);
    const { context } = harness(tools, { root, run });

    await scan(context);

    expect(runs.map((one) => one.argv[0])).toEqual(["pulumi", "pulumi"]);
  });
});

// The diff of web that a scenario's preview gives, as the scan wrote it.
async function previewed(scenario: string): Promise<PreviewResult> {
  return kubectl.preview(WEB, {
    root: ROOT,
    env: {},
    run: kubectlReplay(KUBECTL, scenario).run,
    timeoutMinutes: 10,
  });
}

// `apply` with the real adapter over a scenario's recordings, in the example
// project, whose stacks are web and cache.
function realAdapter(): Adapter {
  return { ...kubectl, checkVersion: async () => {} };
}

describe("apply of a Kubernetes manifests stack", () => {
  test("deploys the rendered set of its fresh preview when the hash still holds", async () => {
    const h = await handedOn({ web: await previewed("deploy") }, ["web"]);
    const { run, runs } = kubectlReplay(KUBECTL, "deploy");
    h.context = { ...h.context, root: ROOT, adapter: realAdapter(), run };

    await runApply(h);

    expect(runs.map((one) => one.argv[1])).toEqual(["diff", "apply"]);
    expect(runs[1]?.argv.at(-1)).toBe(runs[0]?.argv.at(-1));
    expect(states(h)).toEqual(["queued", "in_progress", "success"]);
  });

  test("a change that moved after the tick deploys nothing", async () => {
    // The row showed the update of one scenario, and the code moved on to
    // the mixed one: a new ConfigMap and more replicas.
    const h = await handedOn({ web: await previewed("update") }, ["web"]);
    const { run, runs } = kubectlReplay(KUBECTL, "mixed");
    h.context = { ...h.context, root: ROOT, adapter: realAdapter(), run };

    await expect(runApply(h)).rejects.toThrow("the change moved since the tick");

    expect(runs.map((one) => one.argv[1])).toEqual(["diff"]);
    expect(states(h)).toEqual(["queued", "in_progress", "error"]);
  });
});
