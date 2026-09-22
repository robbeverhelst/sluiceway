import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { tools } from "../../../src/adapters/tools.ts";
import { ConfigError, parseConfig } from "../../../src/core/config.ts";
import { DiscoveryError } from "../../../src/core/discovery.ts";

// Kubernetes manifests discovery (record 0060): no zero config. A directory of
// manifests or a kustomization is a stack when a `stacks` entry names it with
// `tool: kubectl`, and discovery checks from the files alone that the entry
// can work. It never starts the tool and never reaches a cluster.

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "sluiceway-kubectl-"));
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

const MANIFESTS = { "deploy/web/deployment.yaml": "kind: Deployment\n" };

describe("an entry with tool: kubectl", () => {
  test("declares the directory of manifests at its path as a stack, with no name", async () => {
    expect(await discover(MANIFESTS, "stacks:\n  - path: deploy/web\n    tool: kubectl\n")).toEqual(
      [{ path: "deploy/web", options: { tool: "kubectl" } }],
    );
  });

  test("with a name, a context and a namespace", async () => {
    const config = [
      "stacks:",
      "  - path: deploy/web",
      "    name: prod",
      "    tool: kubectl",
      "    options:",
      "      context: prod-cluster",
      "      namespace: web",
      "",
    ].join("\n");
    expect(await discover(MANIFESTS, config)).toEqual([
      {
        path: "deploy/web",
        name: "prod",
        options: { tool: "kubectl", context: "prod-cluster", namespace: "web" },
      },
    ]);
  });

  test("a kustomization is a stack, in every spelling kustomize reads", async () => {
    for (const file of ["kustomization.yaml", "kustomization.yml", "Kustomization"]) {
      expect(
        await discover(
          { [`overlays/prod/${file}`]: "resources: []\n" },
          "stacks:\n  - path: overlays/prod\n    tool: kubectl\n",
        ),
      ).toEqual([{ path: "overlays/prod", options: { tool: "kubectl" } }]);
    }
  });

  test("a directory with only JSON manifests is a stack", async () => {
    expect(
      await discover(
        { "deploy/web/service.json": "{}\n" },
        "stacks:\n  - path: deploy/web\n    tool: kubectl\n",
      ),
    ).toEqual([{ path: "deploy/web", options: { tool: "kubectl" } }]);
  });

  test("stacks of every tool come back in stack id order", async () => {
    const files = {
      ...MANIFESTS,
      "infra/main.tf": "",
      "apps/Pulumi.yaml": "name: apps\nruntime: yaml\n",
      "apps/Pulumi.dev.yaml": "",
    };
    const config = [
      "stacks:",
      "  - path: infra",
      "    tool: opentofu",
      "  - path: deploy/web",
      "    tool: kubectl",
      "",
    ].join("\n");
    const found = await discover(files, config);
    expect(found.map((stack) => stack.path)).toEqual(["apps", "deploy/web", "infra"]);
  });
});

describe("what discovery refuses", () => {
  test("a path that is not a directory", async () => {
    expect(await problems({}, "stacks:\n  - path: deploy/web\n    tool: kubectl\n")).toEqual([
      'stacks[0]: "deploy/web" is not a directory of the repo. An entry with tool: kubectl names a directory of manifests or a kustomization.',
    ]);
  });

  test("a directory with no manifest and no kustomization", async () => {
    expect(
      await problems(
        { "deploy/web/README.md": "" },
        "stacks:\n  - path: deploy/web\n    tool: kubectl\n",
      ),
    ).toEqual([
      'stacks[0]: "deploy/web" holds no manifests (*.yaml, *.yml, *.json) and no kustomization. An entry with tool: kubectl names a directory of manifests or a kustomization.',
    ]);
  });

  test("manifests only in a subdirectory do not count, as kubectl -f reads one level", async () => {
    expect(
      await problems(
        { "deploy/web/nested/deployment.yaml": "" },
        "stacks:\n  - path: deploy/web\n    tool: kubectl\n",
      ),
    ).toHaveLength(1);
  });

  test("an unknown option, and options of the wrong kind", async () => {
    const config = [
      "stacks:",
      "  - path: deploy/web",
      "    tool: kubectl",
      "    options:",
      "      workspace: prod",
      "      namespace: 3",
      "      context: ''",
      "",
    ].join("\n");
    expect(await problems(MANIFESTS, config)).toEqual([
      'stacks[0].options: unknown option "workspace". Known options for kubectl: context, namespace.',
      "stacks[0].options.context: must not be empty.",
      "stacks[0].options.namespace: expected text.",
    ]);
  });

  test("an unknown tool names kubectl among the known ones", async () => {
    expect(
      await problems(MANIFESTS, "stacks:\n  - path: deploy/web\n    tool: kustomize\n"),
    ).toEqual([
      'stacks[0].tool: unknown tool "kustomize". Known tools: opentofu, terraform, helm, kubectl.',
    ]);
  });
});

describe("examples/kubernetes-basic", () => {
  test("its sluiceway.yaml declares web and cache", async () => {
    const root = join(import.meta.dir, "../../../examples/kubernetes-basic");
    const config = parseConfig(readFileSync(join(root, "sluiceway.yaml"), "utf8"));
    expect(await tools.discover(root, config)).toEqual([
      { path: "cache", options: { tool: "kubectl" } },
      { path: "web", options: { tool: "kubectl", namespace: "sluiceway-example" } },
    ]);
  });
});

describe("a namespace", () => {
  test("is a DNS label, as for Helm, so it never reads as a flag", async () => {
    const config =
      "stacks:\n  - path: deploy/web\n    tool: kubectl\n    options:\n      namespace: --all\n";
    expect(await problems(MANIFESTS, config)).toEqual([
      'stacks[0].options.namespace: expected a namespace of lower case letters, digits and "-", that starts and ends with a letter or a digit, at most 63 characters.',
    ]);
  });
});
