import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pulumi } from "../../../src/adapters/pulumi/index.ts";
import { tools } from "../../../src/adapters/tools.ts";
import { ConfigError, parseConfig } from "../../../src/core/config.ts";
import { DiscoveryError } from "../../../src/core/discovery.ts";

// OpenTofu discovery (record 0053): no zero config. A root module is a stack
// when a `stacks` entry names it with `tool: opentofu`, and discovery checks
// from the files alone that the entry can work. It never starts the tool.

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "sluiceway-tofu-"));
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

const MODULE = { "infra/network/main.tf": 'resource "terraform_data" "x" {}\n' };

describe("an entry with tool: opentofu", () => {
  test("declares the root module at its path as a stack, with no name", async () => {
    expect(
      await discover(MODULE, "stacks:\n  - path: infra/network\n    tool: opentofu\n"),
    ).toEqual([{ path: "infra/network", options: { tool: "opentofu", varFiles: [] } }]);
  });

  test("with a name, a workspace and var files", async () => {
    const files = { ...MODULE, "infra/network/prod.tfvars": "", "infra/shared.tfvars": "" };
    const config = [
      "stacks:",
      "  - path: infra/network",
      "    name: prod",
      "    tool: opentofu",
      "    options:",
      "      workspace: prod",
      "      varFiles: [../shared.tfvars, prod.tfvars]",
      "",
    ].join("\n");
    expect(await discover(files, config)).toEqual([
      {
        path: "infra/network",
        name: "prod",
        options: {
          tool: "opentofu",
          workspace: "prod",
          varFiles: ["../shared.tfvars", "prod.tfvars"],
        },
      },
    ]);
  });

  test("two workspaces of one root module are two stacks", async () => {
    const config = [
      "stacks:",
      "  - path: infra/network",
      "    name: dev",
      "    tool: opentofu",
      "    options: { workspace: dev }",
      "  - path: infra/network",
      "    name: prod",
      "    tool: opentofu",
      "    options: { workspace: prod }",
      "",
    ].join("\n");
    expect((await discover(MODULE, config)).map((stack) => stack.name)).toEqual(["dev", "prod"]);
  });

  test("a directory of .tofu or .tf.json files is a root module too", async () => {
    const config = "stacks:\n  - path: a\n    tool: opentofu\n  - path: b\n    tool: opentofu\n";
    const found = await discover({ "a/main.tofu": "", "b/main.tf.json": "{}" }, config);
    expect(found.map((stack) => stack.path)).toEqual(["a", "b"]);
  });

  test("a directory with .tf files and no entry is no stack", async () => {
    expect(await discover(MODULE, "")).toEqual([]);
  });
});

describe("what discovery refuses", () => {
  test("a path with no OpenTofu files, or no directory at all", async () => {
    expect(
      await problems(
        { "docs/readme.md": "", "modules/x/variables.txt": "" },
        "stacks:\n  - path: docs\n    tool: opentofu\n  - path: nowhere\n    tool: opentofu\n",
      ),
    ).toEqual([
      'stacks[0]: "docs" holds no OpenTofu files (*.tf, *.tofu, *.tf.json, *.tofu.json). An entry with tool: opentofu names the directory of a root module.',
      'stacks[1]: "nowhere" is not a directory of the repo. An entry with tool: opentofu names the directory of a root module.',
    ]);
  });

  test("a var file that is not there, or that lies outside the repo", async () => {
    const config = [
      "stacks:",
      "  - path: infra/network",
      "    tool: opentofu",
      "    options:",
      "      varFiles: [prod.tfvars, ../../../etc/passwd, /etc/hosts]",
      "",
    ].join("\n");
    expect(await problems(MODULE, config)).toEqual([
      'stacks[0].options.varFiles[0]: "prod.tfvars" is not a file in "infra/network".',
      'stacks[0].options.varFiles[1]: "../../../etc/passwd" must stay inside the repo.',
      'stacks[0].options.varFiles[2]: "/etc/hosts" must be relative to the directory of the stack.',
    ]);
  });

  test("an unknown tool, an unknown option and an option of the wrong kind", async () => {
    const config = [
      "stacks:",
      "  - path: infra/network",
      "    tool: terraform",
      "  - path: infra/network",
      "    name: prod",
      "    tool: opentofu",
      "    options:",
      "      refresh: true",
      "      workspace: 3",
      "      varFiles: prod.tfvars",
      "",
    ].join("\n");
    expect(await problems(MODULE, config)).toEqual([
      'stacks[0].tool: unknown tool "terraform". Known tools: opentofu, helm.',
      'stacks[1].options: unknown option "refresh". Known options for opentofu: workspace, varFiles.',
      "stacks[1].options.workspace: expected text.",
      "stacks[1].options.varFiles: expected a list of file names.",
    ]);
  });

  test("dependsOn: auto, because only a Pulumi program has stack references (record 0059)", async () => {
    const config = "stacks:\n  - path: infra/network\n    tool: opentofu\n    dependsOn: auto\n";
    expect(await problems(MODULE, config)).toEqual([
      "stacks[0].dependsOn: auto reads the stack references of a Pulumi program, and an opentofu stack has none. Name the stack ids instead.",
    ]);
  });
});

describe("a repo with Pulumi and OpenTofu stacks", () => {
  const files = {
    ...MODULE,
    "apps/site/Pulumi.yaml": "name: site\nruntime: yaml\n",
    "apps/site/Pulumi.prod.yaml": "",
    "zeta/Pulumi.yaml": "name: zeta\nruntime: yaml\n",
    "zeta/Pulumi.dev.yaml": "",
  };

  test("finds both, in the order of path and name", async () => {
    const found = await discover(files, "stacks:\n  - path: infra/network\n    tool: opentofu\n");
    expect(found).toEqual([
      { path: "apps/site", name: "prod", options: {} },
      { path: "infra/network", options: { tool: "opentofu", varFiles: [] } },
      { path: "zeta", name: "dev", options: {} },
    ]);
  });

  test("a repo with only Pulumi stacks finds what the Pulumi adapter finds", async () => {
    const root = repo(files);
    const config = parseConfig(undefined);
    expect(await tools.discover(root, config)).toEqual(await pulumi.discover(root, config));
  });
});
