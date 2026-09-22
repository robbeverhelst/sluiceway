import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { tools } from "../../../src/adapters/tools.ts";
import { ConfigError, parseConfig } from "../../../src/core/config.ts";
import { DiscoveryError } from "../../../src/core/discovery.ts";

// The Terraform family behind the OpenTofu adapter (record 0068): the
// terraform binary as `tool: terraform`, and Terragrunt and CDK for Terraform
// as the `wrapper` option of an opentofu or terraform entry. Discovery checks
// from the files alone that each entry can work, and never starts a tool.

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "sluiceway-tf-family-"));
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

const lines = (...all: string[]) => `${all.join("\n")}\n`;

describe("an entry with tool: terraform", () => {
  test("declares the root module at its path, with a workspace and var files", async () => {
    const files = { "infra/main.tf": "", "infra/prod.tfvars": "" };
    const config = lines(
      "stacks:",
      "  - path: infra",
      "    name: prod",
      "    tool: terraform",
      "    options: { workspace: prod, varFiles: [prod.tfvars] }",
    );
    expect(await discover(files, config)).toEqual([
      {
        path: "infra",
        name: "prod",
        options: { tool: "terraform", workspace: "prod", varFiles: ["prod.tfvars"] },
      },
    ]);
  });

  test("a directory of .tofu files alone is no Terraform root module", async () => {
    expect(
      await problems({ "dns/main.tofu": "" }, "stacks:\n  - path: dns\n    tool: terraform\n"),
    ).toEqual([
      'stacks[0]: "dns" holds no Terraform files (*.tf, *.tf.json). An entry with tool: terraform names the directory of a root module.',
    ]);
  });

  test("one directory is initialised by one tool, so its entries name the same one", async () => {
    const config = lines(
      "stacks:",
      "  - path: infra",
      "    name: a",
      "    tool: terraform",
      "  - path: infra",
      "    name: b",
      "    tool: opentofu",
    );
    expect(await problems({ "infra/main.tf": "" }, config)).toEqual([
      'stacks[1]: "infra" is declared with tool: terraform by stacks[0]. The stacks of one directory share its init, so they name the same tool and wrapper.',
    ]);
  });
});

describe("the terragrunt wrapper", () => {
  test("declares the Terragrunt unit at its path", async () => {
    const config = lines(
      "stacks:",
      "  - path: live/dev/app",
      "    tool: opentofu",
      "    options: { wrapper: terragrunt }",
    );
    expect(await discover({ "live/dev/app/terragrunt.hcl": "" }, config)).toEqual([
      {
        path: "live/dev/app",
        options: { tool: "opentofu", varFiles: [], wrapper: "terragrunt" },
      },
    ]);
  });

  test("a unit written as terragrunt.hcl.json, under terraform", async () => {
    const config = lines(
      "stacks:",
      "  - path: unit",
      "    tool: terraform",
      "    options: { wrapper: terragrunt }",
    );
    expect(await discover({ "unit/terragrunt.hcl.json": "{}" }, config)).toEqual([
      { path: "unit", options: { tool: "terraform", varFiles: [], wrapper: "terragrunt" } },
    ]);
  });

  test("a directory without terragrunt.hcl, and var files, which terragrunt.hcl passes", async () => {
    const config = lines(
      "stacks:",
      "  - path: modules/app",
      "    tool: opentofu",
      "    options: { wrapper: terragrunt }",
      "  - path: live/app",
      "    tool: opentofu",
      "    options: { wrapper: terragrunt, varFiles: [dev.tfvars] }",
    );
    const files = { "modules/app/main.tf": "", "live/app/terragrunt.hcl": "" };
    expect(await problems(files, config)).toEqual([
      "stacks[1].options.varFiles: a Terragrunt unit passes its var files in its own terragrunt.hcl (extra_arguments), so the entry takes none.",
    ]);
    expect(await problems(files, lines(...config.split("\n").slice(0, 5)))).toEqual([
      'stacks[0]: "modules/app" holds no terragrunt.hcl or terragrunt.hcl.json. An entry with wrapper: terragrunt names the directory of one Terragrunt unit.',
    ]);
  });
});

describe("the cdktf wrapper", () => {
  test("declares one synthesized stack of a CDK for Terraform app, which the name selects", async () => {
    const config = lines(
      "stacks:",
      "  - path: cdk",
      "    name: dev",
      "    tool: opentofu",
      "    options: { wrapper: cdktf }",
      "  - path: cdk",
      "    name: prod",
      "    tool: opentofu",
      "    options: { wrapper: cdktf, workspace: prod }",
    );
    expect(await discover({ "cdk/cdktf.json": "{}" }, config)).toEqual([
      { path: "cdk", name: "dev", options: { tool: "opentofu", varFiles: [], wrapper: "cdktf" } },
      {
        path: "cdk",
        name: "prod",
        options: { tool: "opentofu", varFiles: [], wrapper: "cdktf", workspace: "prod" },
      },
    ]);
  });

  test("an entry without a name, with a name that is no stack name, or with var files", async () => {
    const config = lines(
      "stacks:",
      "  - path: cdk",
      "    tool: terraform",
      "    options: { wrapper: cdktf }",
      "  - path: cdk",
      "    name: ../dev",
      "    tool: terraform",
      "    options: { wrapper: cdktf }",
      "  - path: cdk",
      "    name: dev",
      "    tool: terraform",
      "    options: { wrapper: cdktf, varFiles: [dev.tfvars] }",
    );
    expect(await problems({ "cdk/cdktf.json": "{}" }, config)).toEqual([
      "stacks[0].name: an entry with wrapper: cdktf names the CDK for Terraform stack it deploys, as the app calls it.",
      'stacks[1].name: "../dev" is not a CDK for Terraform stack name: letters, digits, "-" and "_" only.',
      "stacks[2].options.varFiles: a CDK for Terraform app sets its variables in code, so the entry takes none.",
    ]);
  });

  test("a directory without cdktf.json", async () => {
    const config = lines(
      "stacks:",
      "  - path: cdk",
      "    name: dev",
      "    tool: opentofu",
      "    options: { wrapper: cdktf }",
    );
    expect(await problems({ "cdk/main.ts": "" }, config)).toEqual([
      'stacks[0]: "cdk" holds no cdktf.json. An entry with wrapper: cdktf names the directory of a CDK for Terraform app.',
    ]);
  });

  test("an unknown wrapper", async () => {
    const config = lines(
      "stacks:",
      "  - path: infra",
      "    tool: opentofu",
      "    options: { wrapper: atlantis }",
    );
    expect(await problems({ "infra/main.tf": "" }, config)).toEqual([
      'stacks[0].options.wrapper: expected one of "terragrunt" or "cdktf".',
    ]);
  });
});
