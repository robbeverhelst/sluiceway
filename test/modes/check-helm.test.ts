import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { tools } from "../../src/adapters/tools.ts";
import { ConfigError } from "../../src/core/config.ts";
import { DiscoveryError } from "../../src/core/discovery.ts";
import { check } from "../../src/modes/check.ts";
import { escapeText } from "../../src/render/escape.ts";
import { rememberingLog } from "./harness.ts";

// Record 0058: Helm releases are the stacks a `stacks` entry names with
// `tool: helm`, and the check lists them next to the others. It reads files
// and nothing else: no helm, no cluster (record 0042).

type Files = Record<string, string | undefined>;

function repo(files: Files): string {
  const root = mkdtempSync(join(tmpdir(), "sluiceway-check-helm-"));
  for (const [file, text] of Object.entries(files)) {
    if (text === undefined) continue;
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

async function run(files: Files) {
  const log = rememberingLog();
  const error = await check({ root: repo(files), adapter: tools, log }).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  return { log, error, summary: log.summaries.at(-1) ?? "" };
}

const FILES: Files = {
  "sluiceway.yaml": [
    "stacks:",
    "  - path: apps/web",
    "    tool: helm",
    "    inputs: [charts/web/**]",
    "    options:",
    "      release: web",
    "      namespace: shop",
    "      chart: ../../charts/web",
    "      valuesFiles: [values.yaml]",
    "",
  ].join("\n"),
  "apps/web/values.yaml": "",
  "apps/web/README.md": "",
  "charts/web/Chart.yaml": "apiVersion: v2\nname: web\nversion: 0.1.0\n",
  "charts/web/templates/configmap.yaml": "",
  "charts/api/Chart.yaml": "apiVersion: v2\nname: api\nversion: 0.1.0\n",
};

describe("a repo with Helm releases", () => {
  test("lists every configured release as a stack, and a chart no entry names as files", async () => {
    const { log, error } = await run(FILES);
    expect(error).toBeUndefined();
    expect(log.lines).toContain("Found 1 stack.");
    expect(log.groups.find((group) => group.title === "Stacks")?.lines).toEqual([
      "apps/web: environment sluiceway, tickers write, inputs charts/web/**",
    ]);
    expect(
      log.groups.find((group) => group.title === "Files that no stack claims")?.lines,
    ).toContain("charts/api/Chart.yaml");
  });

  test("a values file that is not there fails the check", async () => {
    const { error, summary } = await run({ ...FILES, "apps/web/values.yaml": undefined });
    expect(error).toBeInstanceOf(DiscoveryError);
    expect(summary).toContain(
      escapeText('stacks[0].options.valuesFiles[0]: "values.yaml" is not a file in "apps/web".'),
    );
  });

  test("a missing option fails the check as a config problem", async () => {
    const { error, summary } = await run({
      ...FILES,
      "sluiceway.yaml":
        "stacks:\n  - path: apps/web\n    tool: helm\n    options: { release: web, chart: ../../charts/web }\n",
    });
    expect(error).toBeInstanceOf(ConfigError);
    expect(summary).toContain(escapeText("stacks[0].options.namespace: required for tool: helm."));
  });
});
