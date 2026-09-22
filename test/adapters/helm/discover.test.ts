import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { tools } from "../../../src/adapters/tools.ts";
import { ConfigError, parseConfig } from "../../../src/core/config.ts";
import { DiscoveryError } from "../../../src/core/discovery.ts";
import { WEB, WORKER } from "./stacks.ts";

// Helm discovery (record 0058): no zero config. A release in a namespace is a
// stack when a `stacks` entry names it with `tool: helm`, and discovery checks
// from the files alone that the entry can work. It never starts the tool and
// never reaches a cluster.

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "sluiceway-helm-"));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

function discover(files: Record<string, string>, config: string) {
  return tools.discover(repo(files), parseConfig(config));
}

async function problems(files: Record<string, string>, config: string): Promise<string[]> {
  try {
    await discover(files, config);
  } catch (error) {
    if (error instanceof ConfigError || error instanceof DiscoveryError) return error.problems;
    throw error;
  }
  throw new Error("Expected discovery to fail.");
}

const CHART = { "charts/web/Chart.yaml": "apiVersion: v2\nname: web\nversion: 0.1.0\n" };
const FILES = { ...CHART, "apps/web/values.yaml": "greeting: hi\n" };

function entry(options: string[], path = "apps/web"): string {
  return [
    "stacks:",
    `  - path: ${path}`,
    "    tool: helm",
    "    options:",
    ...options.map((line) => `      ${line}`),
    "",
  ].join("\n");
}

const WEB_OPTIONS = [
  "release: web",
  "namespace: shop",
  "chart: ../../charts/web",
  "valuesFiles: [values.yaml]",
];

describe("an entry with tool: helm", () => {
  test("declares a release of a local chart, with its values files", async () => {
    expect(await discover(FILES, entry(WEB_OPTIONS))).toEqual([
      {
        path: "apps/web",
        options: {
          tool: "helm",
          release: "web",
          namespace: "shop",
          chart: "../../charts/web",
          valuesFiles: ["values.yaml"],
          chartDir: "charts/web",
          dependencies: false,
        },
      },
    ]);
  });

  test("a chart with dependencies needs them built first", async () => {
    const files = {
      ...FILES,
      "charts/web/Chart.yaml":
        "apiVersion: v2\nname: web\nversion: 0.1.0\ndependencies:\n  - name: db\n    version: 1.0.0\n    repository: file://../db\n",
    };
    const [stack] = await discover(files, entry(WEB_OPTIONS));
    expect(stack?.options.dependencies).toBe(true);
  });

  test("a chart reference with its exact version", async () => {
    const config = entry([
      "release: ingress",
      "namespace: ingress",
      "chart: oci://registry.example/charts/ingress-nginx",
      "version: 4.11.3",
    ]);
    expect(await discover({ "apps/web/.keep": "" }, config)).toEqual([
      {
        path: "apps/web",
        options: {
          tool: "helm",
          release: "ingress",
          namespace: "ingress",
          chart: "oci://registry.example/charts/ingress-nginx",
          version: "4.11.3",
          valuesFiles: [],
          dependencies: false,
        },
      },
    ]);
  });

  test("two releases of one directory are two stacks, told apart by name", async () => {
    const config = [
      "stacks:",
      "  - path: apps/web",
      "    name: blue",
      "    tool: helm",
      "    options: { release: web-blue, namespace: shop, chart: ../../charts/web }",
      "  - path: apps/web",
      "    name: green",
      "    tool: helm",
      "    options: { release: web-green, namespace: shop, chart: ../../charts/web }",
      "",
    ].join("\n");
    const stacks = await discover(FILES, config);
    expect(stacks.map((stack) => `${stack.path}:${stack.name}`)).toEqual([
      "apps/web:blue",
      "apps/web:green",
    ]);
  });

  test("the example's stacks are the ones the adapter tests use", async () => {
    const root = resolve(import.meta.dir, "../../../examples/helm-basic");
    const { readFileSync } = await import("node:fs");
    const config = parseConfig(readFileSync(join(root, "sluiceway.yaml"), "utf8"));
    expect(await tools.discover(root, config)).toEqual([WEB, WORKER]);
  });
});

describe("options that cannot work are config problems", () => {
  test("the three that are required", async () => {
    expect(await problems(FILES, entry(["valuesFiles: []"]))).toEqual([
      "stacks[0].options.release: required for tool: helm.",
      "stacks[0].options.namespace: required for tool: helm.",
      "stacks[0].options.chart: required for tool: helm.",
    ]);
  });

  test("an unknown option names the known ones", async () => {
    expect(await problems(FILES, entry([...WEB_OPTIONS, "atomic: false"]))).toEqual([
      'stacks[0].options: unknown option "atomic". Known options for helm: release, namespace, chart, version, valuesFiles.',
    ]);
  });

  test("names that helm and Kubernetes refuse, or that read as a flag", async () => {
    expect(
      await problems(
        FILES,
        entry([
          "release: --dry-run",
          "namespace: Shop_1",
          "chart: -f",
          "valuesFiles: [values.yaml]",
        ]),
      ),
    ).toEqual([
      'stacks[0].options.release: expected a release name of lower case letters, digits, "-" and ".", that starts and ends with a letter or a digit, at most 53 characters.',
      'stacks[0].options.namespace: expected a namespace of lower case letters, digits and "-", that starts and ends with a letter or a digit, at most 63 characters.',
      'stacks[0].options.chart: expected a local chart as a path that starts with "./" or "../", or a chart reference such as repo/name or oci://registry/name.',
    ]);
  });

  test("a chart reference without an exact version", async () => {
    expect(
      await problems(FILES, entry(["release: web", "namespace: shop", "chart: bitnami/nginx"])),
    ).toEqual([
      "stacks[0].options.version: required for a chart reference, so that the deploy installs the chart the preview saw.",
    ]);
    expect(
      await problems(
        FILES,
        entry(["release: web", "namespace: shop", "chart: bitnami/nginx", 'version: "^18.0.0"']),
      ),
    ).toEqual(["stacks[0].options.version: expected an exact chart version, such as 1.2.3."]);
  });

  test("a local chart with a version", async () => {
    expect(await problems(FILES, entry([...WEB_OPTIONS, "version: 1.0.0"]))).toEqual([
      "stacks[0].options.version: only a chart reference takes a version. A local chart is used as the repo holds it.",
    ]);
  });

  test("an entry without a tool takes no options, as before", async () => {
    expect(
      await problems(FILES, "stacks:\n  - path: apps/web\n    options: { release: web }\n"),
    ).toEqual([
      'stacks[0].options: unknown option "release". A stack that discovery finds from its files takes no options. Only an entry with tool takes them.',
    ]);
  });
});

describe("files that are not there are discovery problems", () => {
  test("a directory of the stack that does not exist", async () => {
    expect(await problems(CHART, entry(WEB_OPTIONS, "apps/gone"))).toEqual([
      'stacks[0]: "apps/gone" is not a directory of the repo. An entry with tool: helm names the directory its chart and values files are relative to.',
    ]);
  });

  test("a local chart that is not a chart", async () => {
    expect(
      await problems(
        { "apps/web/values.yaml": "" },
        entry(["release: web", "namespace: shop", "chart: ../../charts/web"]),
      ),
    ).toEqual([
      'stacks[0].options.chart: "../../charts/web" is not a chart in "apps/web": it holds no Chart.yaml.',
    ]);
  });

  test("a local chart outside the repo", async () => {
    expect(
      await problems(FILES, entry(["release: web", "namespace: shop", "chart: ../../../web"])),
    ).toEqual(['stacks[0].options.chart: "../../../web" must stay inside the repo.']);
  });

  test("a Chart.yaml that is not YAML", async () => {
    expect(
      await problems(
        { ...FILES, "charts/web/Chart.yaml": "dependencies: [\n" },
        entry(WEB_OPTIONS),
      ),
    ).toEqual([
      'stacks[0].options.chart: the Chart.yaml of "../../charts/web" could not be read as YAML.',
    ]);
  });

  test("values files that are not there, absolute or outside the repo", async () => {
    expect(
      await problems(
        FILES,
        entry([
          "release: web",
          "namespace: shop",
          "chart: ../../charts/web",
          "valuesFiles: [prod.yaml, /etc/values.yaml, ../../../values.yaml]",
        ]),
      ),
    ).toEqual([
      'stacks[0].options.valuesFiles[0]: "prod.yaml" is not a file in "apps/web".',
      'stacks[0].options.valuesFiles[1]: "/etc/values.yaml" must be relative to the directory of the stack.',
      'stacks[0].options.valuesFiles[2]: "../../../values.yaml" must stay inside the repo.',
    ]);
  });
});

test("a repo with Pulumi, OpenTofu and Helm stacks discovers all three, in path order", async () => {
  const files = {
    ...FILES,
    "network/Pulumi.yaml": "name: network\nruntime: yaml\n",
    "network/Pulumi.dev.yaml": "",
    "infra/dns/main.tf": "",
  };
  const config = [
    "stacks:",
    "  - path: infra/dns",
    "    tool: opentofu",
    "  - path: apps/web",
    "    tool: helm",
    "    options: { release: web, namespace: shop, chart: ../../charts/web }",
    "",
  ].join("\n");
  const stacks = await discover(files, config);
  expect(
    stacks.map((stack) => [stack.path, stack.name ?? "", stack.options.tool ?? "pulumi"]),
  ).toEqual([
    ["apps/web", "", "helm"],
    ["infra/dns", "", "opentofu"],
    ["network", "dev", "pulumi"],
  ]);
});
