import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProcessRunner, Run } from "../../src/adapters/process.ts";
import { tools } from "../../src/adapters/tools.ts";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { replay, VERSIONS } from "../adapters/helm/replay.ts";
import { dashboardBody, harness, repoRoot } from "./harness.ts";

// Record 0069: a Helm stack gets the drift check of record 0055. A scan that
// a schedule starts, with drift on, runs the diff plugin's three-way merge
// after the preview, and what changed outside the code lands on the release's
// own row, with the adapter the action uses and helm's recorded output.

const CONFIG = [
  "drift:",
  "  enabled: true",
  "stacks:",
  "  - path: web",
  "    tool: helm",
  "    options:",
  "      release: web",
  "      namespace: sluiceway-web",
  "      chart: ../charts/web",
  "      valuesFiles: [values.yaml]",
  "",
].join("\n");

function helmRepo(): string {
  const root = repoRoot(CONFIG);
  const files: Record<string, string> = {
    "charts/web/Chart.yaml": "apiVersion: v2\nname: web\nversion: 0.1.0\n",
    "web/values.yaml": "",
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

function router(version: string, scenario: string, root: string) {
  const runs: Run[] = [];
  const versions = replay(version, "version", root);
  const recorded = replay(version, scenario, root);
  const run: ProcessRunner = async (asked) => {
    runs.push(asked);
    const [, command, sub] = asked.argv;
    return (command === "version" || sub === "version" ? versions : recorded).run(asked);
  };
  return { run, runs };
}

async function scanned(version: string, scenario: string, event = "schedule") {
  const root = helmRepo();
  const { run, runs } = router(version, scenario, root);
  const { context, github } = harness(tools, { root, run, event });
  await scan(context);
  const body = dashboardBody(github);
  return { body, runs, row: parseDashboard(body).rows[0] };
}

for (const version of VERSIONS) {
  describe(`the drift row of a Helm stack, replaying helm ${version}`, () => {
    test("a release changed behind helm's back has a drifted row with a box that names what changed", async () => {
      const { body, row, runs } = await scanned(version, "drift");
      expect(row).toMatchObject({ stackId: "web", state: "drift", drift: true });
      expect(runs.filter((one) => one.argv.includes("--three-way-merge"))).toHaveLength(1);
      expect(body).toContain("## Drifted");
      expect(body).toContain("🟠&nbsp;1 drifted");
      expect(body).toContain("- [ ] **web** · 2 changed, 1 gone outside the code");
      expect(body).toContain("<b>web-settings</b> · <code>data.greeting</code>");
      expect(body).toContain("<kbd>gone</kbd> <code>Secret</code> <b>web-token</b>");
      expect(body).toContain("<b>web</b> · <code>spec.ports&#91;0&#93;.targetPort</code>");
      expect(body).not.toContain("CANARY");
    });

    test("new values in the code and a field changed by hand: a pending row with the drift under it", async () => {
      const { row } = await scanned(version, "drift-and-change");
      expect(row).toMatchObject({ stackId: "web", state: "pending", drift: true });
    });

    test("a release nobody touched stays in sync", async () => {
      const { row } = await scanned(version, "drift-hooks");
      expect(row).toMatchObject({ stackId: "web", state: "in-sync", drift: false });
    });
  });
}

test("a scan that a push starts, with no drifted row, runs no three-way diff", async () => {
  const [version = ""] = VERSIONS;
  const { runs } = await scanned(version, "drift", "push");
  expect(runs.some((one) => one.argv.includes("--three-way-merge"))).toBe(false);
});
