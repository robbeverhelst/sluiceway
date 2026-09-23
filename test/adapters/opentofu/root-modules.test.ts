import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { tools } from "../../../src/adapters/tools.ts";
import { applyConfig, ConfigError, parseConfig } from "../../../src/core/config.ts";

// Slice 5.29 (record 0092): OpenTofu and Terraform root modules are found
// from the repo's own files, the way Pulumi stacks are. Each test is a small
// repo, and discovery runs as the action runs it.

type Files = Record<string, string>;

function repo(files: Files): string {
  const root = mkdtempSync(join(tmpdir(), "sluiceway-root-modules-"));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

function discover(files: Files, config = "") {
  return tools.discover(repo(files), parseConfig(config));
}

const lines = (...all: string[]) => `${all.join("\n")}\n`;

// What `init` writes next to a root module: the providers it installed, from
// the registry of the tool that ran it.
const lock = (registry: string) =>
  lines(
    "# This file is maintained automatically by init.",
    `provider "${registry}/hashicorp/random" {`,
    '  version = "3.7.2"',
    '  hashes = ["h1:abc="]',
    "}",
  );
const TOFU_LOCK = lock("registry.opentofu.org");
const TERRAFORM_LOCK = lock("registry.terraform.io");

const BACKEND = lines("terraform {", '  backend "s3" {', '    key = "network"', "  }", "}");

describe("a flat root module", () => {
  test("a directory with a backend block and an OpenTofu lock file is an OpenTofu stack", async () => {
    const files = {
      "main.tf": lines(BACKEND, 'resource "random_pet" "name" {}'),
      ".terraform.lock.hcl": TOFU_LOCK,
    };
    expect(await discover(files)).toEqual([
      { path: ".", options: { tool: "opentofu", varFiles: [] } },
    ]);
  });
});

// A shared module can look exactly like a root module: an empty backend block
// for Terragrunt or a caller to fill, and a lock file from a validate run.
const MODULE_LOOKING_LIKE_A_ROOT = lines(
  'terraform {\n  backend "s3" {}\n}',
  'resource "random_pet" "name" {}',
);

describe("a root module with a modules/ directory beside it", () => {
  const files = {
    "main.tf": lines(BACKEND, 'module "vpc" {', '  source = "./modules/vpc"', "}"),
    ".terraform.lock.hcl": TOFU_LOCK,
    "modules/vpc/main.tf": MODULE_LOOKING_LIKE_A_ROOT,
    "modules/vpc/.terraform.lock.hcl": TOFU_LOCK,
    "modules/dns/main.tf": MODULE_LOOKING_LIKE_A_ROOT,
    "modules/dns/.terraform.lock.hcl": TOFU_LOCK,
  };

  test("finds the root and neither module, the used one or the unused one", async () => {
    expect((await discover(files)).map((stack) => stack.path)).toEqual(["."]);
  });

  test("a modules/ directory beside a directory is no evidence that it is a root", async () => {
    const withoutBackend = {
      ...files,
      "main.tf": 'module "vpc" {\n  source = "./modules/vpc"\n}\n',
    };
    expect(await discover(withoutBackend)).toEqual([]);
  });
});

describe("two root modules where one uses the other as a local source", () => {
  test("only the one that is used by no other directory is found", async () => {
    const files = {
      "prod/main.tf": lines(BACKEND, 'module "network" {', '  source = "../network"', "}"),
      "prod/.terraform.lock.hcl": TOFU_LOCK,
      "network/main.tf": lines(BACKEND, 'resource "random_pet" "name" {}'),
      "network/.terraform.lock.hcl": TOFU_LOCK,
    };
    expect((await discover(files)).map((stack) => stack.path)).toEqual(["prod"]);
  });

  test("a source in a .tf.json file counts the same", async () => {
    const files = {
      "prod/main.tf.json": JSON.stringify({
        terraform: { backend: { s3: { key: "prod" } } },
        module: { network: { source: "../network" } },
      }),
      "prod/.terraform.lock.hcl": TOFU_LOCK,
      "network/main.tf": lines(BACKEND),
      "network/.terraform.lock.hcl": TOFU_LOCK,
    };
    expect((await discover(files)).map((stack) => stack.path)).toEqual(["prod"]);
  });

  test("a source in a comment names nothing", async () => {
    const files = {
      "prod/main.tf": lines(
        BACKEND,
        '# source = "../network"',
        '/* module "x" { source = "../network" } */',
      ),
      "prod/.terraform.lock.hcl": TOFU_LOCK,
      "network/main.tf": lines(BACKEND),
      "network/.terraform.lock.hcl": TOFU_LOCK,
    };
    expect((await discover(files)).map((stack) => stack.path)).toEqual(["network", "prod"]);
  });
});

describe("a repo where every .tf file is a module", () => {
  test("finds nothing, even where a module looks like a root", async () => {
    // The layout of a published module: the module at the root, its
    // submodules under modules/, and examples that call it by a local path.
    // The module and a submodule carry an empty backend block and a lock
    // file, so only what names them as a source, or modules/, leaves them
    // out. The examples keep their state locally, as examples do.
    const files = {
      "main.tf": MODULE_LOOKING_LIKE_A_ROOT,
      ".terraform.lock.hcl": TOFU_LOCK,
      "versions.tf": lines("terraform {", '  required_version = ">= 1.6"', "}"),
      "modules/zone/main.tf": MODULE_LOOKING_LIKE_A_ROOT,
      "modules/zone/.terraform.lock.hcl": TOFU_LOCK,
      "modules/record/main.tf": MODULE_LOOKING_LIKE_A_ROOT,
      "modules/record/.terraform.lock.hcl": TOFU_LOCK,
      "examples/complete/main.tf": lines('module "this" {', '  source = "../../"', "}"),
      "examples/complete/.terraform.lock.hcl": TOFU_LOCK,
      "examples/zone/main.tf": lines('module "zone" {', '  source = "../../modules/zone"', "}"),
    };
    expect(await discover(files)).toEqual([]);
  });
});

describe("which tool runs a found root module", () => {
  test("a lock file of Terraform providers makes a Terraform stack", async () => {
    const files = { "infra/main.tf": BACKEND, "infra/.terraform.lock.hcl": TERRAFORM_LOCK };
    expect(await discover(files)).toEqual([
      { path: "infra", options: { tool: "terraform", varFiles: [] } },
    ]);
  });

  test(".tofu files make an OpenTofu stack without a lock file", async () => {
    const files = { "dns/main.tofu": BACKEND };
    expect(await discover(files)).toEqual([
      { path: "dns", options: { tool: "opentofu", varFiles: [] } },
    ]);
  });

  test("no lock file and no .tofu files is no stack: the files do not say which tool", async () => {
    expect(await discover({ "infra/main.tf": BACKEND })).toEqual([]);
  });

  test("a lock file of both registries is no stack", async () => {
    const files = {
      "infra/main.tf": BACKEND,
      "infra/.terraform.lock.hcl": TOFU_LOCK + TERRAFORM_LOCK,
    };
    expect(await discover(files)).toEqual([]);
  });

  test(".tofu files next to a lock file of Terraform providers is no stack", async () => {
    const files = { "infra/main.tofu": BACKEND, "infra/.terraform.lock.hcl": TERRAFORM_LOCK };
    expect(await discover(files)).toEqual([]);
  });

  test("a cloud block is evidence as a backend block is", async () => {
    const files = {
      "infra/main.tf": lines(
        "terraform {",
        "  cloud {",
        "    workspaces {",
        '      name = "infra"',
        "    }",
        "  }",
        "}",
      ),
      "infra/.terraform.lock.hcl": TERRAFORM_LOCK,
    };
    expect((await discover(files)).map((stack) => stack.path)).toEqual(["infra"]);
  });

  test("a backend block in a comment is no evidence", async () => {
    const files = {
      "infra/main.tf": lines("# terraform {", '#   backend "s3" {}', "# }"),
      "infra/.terraform.lock.hcl": TOFU_LOCK,
    };
    expect(await discover(files)).toEqual([]);
  });
});

describe("a root module built for several workspaces or var files", () => {
  const root = (extra: Files) => ({
    "infra/.terraform.lock.hcl": TOFU_LOCK,
    "infra/main.tf": BACKEND,
    ...extra,
  });

  test("code that reads terraform.workspace is left to a stacks entry per workspace", async () => {
    const files = root({ "infra/names.tf": 'locals {\n  env = "${terraform.workspace}-app"\n}\n' });
    expect(await discover(files)).toEqual([]);
  });

  test("a cloud block that picks its workspaces by tags is left out", async () => {
    const files = root({
      "infra/main.tf": lines(
        "terraform {",
        "  cloud {",
        "    workspaces {",
        '      tags = ["app"]',
        "    }",
        "  }",
        "}",
      ),
    });
    expect(await discover(files)).toEqual([]);
  });

  test("a var file the tool does not load by itself is left out", async () => {
    expect(await discover(root({ "infra/prod.tfvars": "" }))).toEqual([]);
  });

  test("var files in a subdirectory of var files only are left out, the env/ layout", async () => {
    expect(
      await discover(root({ "infra/env/dev.tfvars": "", "infra/env/prod.tfvars": "" })),
    ).toEqual([]);
  });

  test("a backend file beside the module is left out", async () => {
    expect(await discover(root({ "infra/prod.s3.tfbackend": "" }))).toEqual([]);
  });

  test("terraform.tfvars and *.auto.tfvars are loaded by themselves and choose nothing", async () => {
    const files = root({ "infra/terraform.tfvars": "", "infra/common.auto.tfvars.json": "{}" });
    expect((await discover(files)).map((stack) => stack.path)).toEqual(["infra"]);
  });
});

describe("what discovery never reads", () => {
  test("a repo with Terragrunt files finds nothing: its units are declared", async () => {
    const files = {
      "modules/app/main.tf": MODULE_LOOKING_LIKE_A_ROOT,
      "app/main.tf": BACKEND,
      "app/.terraform.lock.hcl": TOFU_LOCK,
      "live/prod/terragrunt.hcl": 'terraform {\n  source = "${get_repo_root()}/app"\n}\n',
    };
    expect(await discover(files)).toEqual([]);
  });

  test("tool caches and synthesized output are skipped", async () => {
    const root = { BACKEND, lock: TOFU_LOCK };
    const files = {
      "app/.terraform/modules/net/main.tf": root.BACKEND,
      "app/.terraform/modules/net/.terraform.lock.hcl": root.lock,
      "app/.terragrunt-cache/x/main.tf": root.BACKEND,
      "app/.terragrunt-cache/x/.terraform.lock.hcl": root.lock,
      "app/cdktf.out/stacks/web/cdk.tf.json": JSON.stringify({
        terraform: { backend: { local: {} } },
      }),
      "app/cdktf.out/stacks/web/.terraform.lock.hcl": root.lock,
      "node_modules/pkg/main.tf": root.BACKEND,
      "node_modules/pkg/.terraform.lock.hcl": root.lock,
    };
    expect(await discover(files)).toEqual([]);
  });
});

describe("sluiceway.yaml overrules discovery", () => {
  const files = {
    "infra/main.tf": BACKEND,
    "infra/.terraform.lock.hcl": TOFU_LOCK,
    "legacy/main.tf": BACKEND,
    "legacy/.terraform.lock.hcl": TOFU_LOCK,
  };

  test("a declared stack that discovery would also find is the declared one, as before", async () => {
    const config = lines(
      "stacks:",
      "  - path: infra",
      "    name: prod",
      "    tool: terraform",
      "    options: { workspace: prod }",
    );
    expect(await discover(files, config)).toEqual([
      {
        path: "infra",
        name: "prod",
        options: { tool: "terraform", workspace: "prod", varFiles: [] },
      },
      { path: "legacy", options: { tool: "opentofu", varFiles: [] } },
    ]);
  });

  test("a found stack is the stack a stacks entry with only its path and tool declares", async () => {
    const declared = await discover(files, "stacks:\n  - path: infra\n    tool: opentofu\n");
    const found = await discover(files);
    expect(found.find((stack) => stack.path === "infra")).toEqual(
      declared.find((stack) => stack.path === "infra"),
    );
  });

  test("an entry without a tool adds settings to a found stack", async () => {
    const root = repo(files);
    const config = parseConfig("stacks:\n  - path: infra\n    tickers: admin\n");
    const found = await tools.discover(root, config);
    expect(found.map((stack) => stack.path)).toEqual(["infra", "legacy"]);
    expect(applyConfig(config, found).map((one) => one.tickers)).toEqual(["admin", "write"]);
  });

  test("ignore leaves a found stack out, by its stack id", async () => {
    const root = repo(files);
    const config = parseConfig("ignore:\n  - legacy\n");
    const found = await tools.discover(root, config);
    expect(applyConfig(config, found).map((one) => one.stack.path)).toEqual(["infra"]);
  });

  test("an entry with a tool adds a directory that discovery left out", async () => {
    const missed = { "net/main.tf": 'resource "random_pet" "name" {}\n' };
    expect(await discover(missed, "stacks:\n  - path: net\n    tool: opentofu\n")).toEqual([
      { path: "net", options: { tool: "opentofu", varFiles: [] } },
    ]);
  });

  test("discovery.rootModules: false turns it off for the repo", async () => {
    expect(await discover(files, "discovery:\n  rootModules: false\n")).toEqual([]);
  });

  test("with it off, declared stacks are declared as before", async () => {
    const config =
      "discovery:\n  rootModules: false\nstacks:\n  - path: infra\n    tool: opentofu\n";
    expect((await discover(files, config)).map((stack) => stack.path)).toEqual(["infra"]);
  });

  test("an unknown discovery switch fails the config", async () => {
    const error = await discover(files, "discovery:\n  rootModule: false\n").catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).problems).toEqual([
      "discovery.rootModule: unknown key. Known keys: rootModules.",
    ]);
  });
});

describe("reading the files", () => {
  test("a heredoc or a template holds text, never a block", async () => {
    const files = {
      "infra/main.tf": lines(
        'resource "local_file" "readme" {',
        "  content = <<-EOT",
        "    terraform {",
        '      backend "s3" {}',
        "    }",
        "  EOT",
        '  filename = "${lookup({ a = "}" }, "a")}-$${literal}"',
        "}",
      ),
      "infra/.terraform.lock.hcl": TOFU_LOCK,
    };
    expect(await discover(files)).toEqual([]);
  });

  test("blocks after a heredoc and a template are still read", async () => {
    const files = {
      "prod/main.tf": lines(
        'locals {\n  text = <<EOT\nmodule "x" { source = "../nowhere" }\nEOT\n}',
        'locals {\n  name = "${join("-", ["a", "}"])}"\n}',
        BACKEND,
        'module "network" {\n  source = "../network"\n}',
      ),
      "prod/.terraform.lock.hcl": TOFU_LOCK,
      "network/main.tf": BACKEND,
      "network/.terraform.lock.hcl": TOFU_LOCK,
      "nowhere/main.tf": BACKEND,
      "nowhere/.terraform.lock.hcl": TOFU_LOCK,
    };
    expect((await discover(files)).map((stack) => stack.path)).toEqual(["nowhere", "prod"]);
  });
});
