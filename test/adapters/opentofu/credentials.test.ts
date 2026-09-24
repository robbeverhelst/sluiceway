import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { credentialNeeds } from "../../../src/adapters/opentofu/credentials.ts";
import { cloudWays } from "../../../src/core/credentials.ts";
import type { Stack } from "../../../src/core/stack.ts";

// Slice 5.34, record 0099: what an OpenTofu or Terraform stack's own files
// say the tool will want from the job environment. Read with the HCL reader
// of root module discovery: block labels, attribute names and the one plain
// string of a source or a hostname. No default, no var file value and no
// backend setting leaves this.

type Files = Record<string, string>;

function repo(files: Files): string {
  const root = mkdtempSync(join(tmpdir(), "sluiceway-tofu-credentials-"));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

const stack = (path: string, options: Record<string, unknown> = {}, name?: string): Stack => ({
  path,
  ...(name === undefined ? {} : { name }),
  options: { tool: "opentofu", varFiles: [], ...options },
});

const LOCK =
  'provider "registry.opentofu.org/hashicorp/aws" {\n  version = "5.0.0"\n}\nprovider "registry.opentofu.org/hashicorp/random" {\n}\n';

describe("the providers of a root module", () => {
  test("the lock file names them, one that needs nothing is left out, and a region is asked for", async () => {
    const root = repo({ "infra/main.tf": "", "infra/.terraform.lock.hcl": LOCK });
    expect(await credentialNeeds(root, stack("infra"))).toEqual([
      { what: "the aws provider", namedIn: "infra/.terraform.lock.hcl", ways: cloudWays("aws") },
      {
        what: "a region for the aws provider",
        namedIn: "infra/.terraform.lock.hcl",
        ways: [
          { names: ["AWS_REGION"] },
          { names: ["AWS_DEFAULT_REGION"] },
          { names: [], uses: "aws-actions/configure-aws-credentials" },
        ],
      },
    ]);
  });

  test("without a lock file, required_providers and provider blocks name them, each once", async () => {
    const root = repo({
      "infra/versions.tf":
        'terraform {\n  required_providers {\n    google = {\n      source = "hashicorp/google"\n    }\n    tls = { source = "hashicorp/tls" }\n  }\n}\n',
      "infra/main.tf":
        'provider "google" {\n  project = "CANARY-VALUE"\n}\nprovider "kubernetes" {\n}\nprovider "unheard-of" {\n}\n',
    });
    const needs = await credentialNeeds(root, stack("infra"));
    expect(needs).toEqual([
      { what: "the google provider", namedIn: "infra/versions.tf", ways: cloudWays("google") },
      { what: "the kubernetes provider", namedIn: "infra/main.tf", ways: cloudWays("kubernetes") },
      { what: "the unheard-of provider", namedIn: "infra/main.tf", ways: [] },
    ]);
    expect(JSON.stringify(needs)).not.toContain("CANARY");
  });

  test("a region in the aws provider block meets the region", async () => {
    const root = repo({
      "infra/main.tf": 'provider "aws" {\n  region = "eu-west-1"\n}\n',
    });
    const needs = await credentialNeeds(root, stack("infra"));
    expect(needs).toEqual([
      { what: "the aws provider", namedIn: "infra/main.tf", ways: cloudWays("aws") },
    ]);
    expect(JSON.stringify(needs)).not.toContain("eu-west-1");
  });
});

describe("the backend of a root module", () => {
  const withBackend = (block: string) =>
    repo({ "infra/main.tf": `terraform {\n${block}\n}\nprovider "random" {}\n` });

  test("a backend of a cloud names that cloud", async () => {
    expect(
      await credentialNeeds(
        withBackend('  backend "s3" {\n    bucket = "CANARY-BUCKET"\n  }'),
        stack("infra"),
      ),
    ).toEqual([{ what: "the s3 backend", namedIn: "infra/main.tf", ways: cloudWays("aws") }]);
    expect(await credentialNeeds(withBackend('  backend "gcs" {}'), stack("infra"))).toEqual([
      { what: "the gcs backend", namedIn: "infra/main.tf", ways: cloudWays("google") },
    ]);
    expect(await credentialNeeds(withBackend('  backend "azurerm" {}'), stack("infra"))).toEqual([
      { what: "the azurerm backend", namedIn: "infra/main.tf", ways: cloudWays("azure") },
    ]);
    expect(await credentialNeeds(withBackend('  backend "kubernetes" {}'), stack("infra"))).toEqual(
      [{ what: "the kubernetes backend", namedIn: "infra/main.tf", ways: cloudWays("kubernetes") }],
    );
  });

  test("a remote backend or a cloud block needs the token of its host", async () => {
    expect(await credentialNeeds(withBackend('  backend "remote" {}'), stack("infra"))).toEqual([
      {
        what: "the remote backend",
        namedIn: "infra/main.tf",
        ways: [{ names: ["TF_TOKEN_app_terraform_io"] }],
      },
    ]);
    expect(
      await credentialNeeds(
        withBackend('  cloud {\n    organization = "acme"\n  }'),
        stack("infra"),
      ),
    ).toEqual([
      {
        what: "the cloud block",
        namedIn: "infra/main.tf",
        ways: [{ names: ["TF_TOKEN_app_terraform_io"] }],
      },
    ]);
    expect(
      await credentialNeeds(
        withBackend('  cloud {\n    hostname = "tofu.example.com"\n  }'),
        stack("infra"),
      ),
    ).toEqual([
      {
        what: "the cloud block",
        namedIn: "infra/main.tf",
        ways: [{ names: ["TF_TOKEN_tofu_example_com"] }],
      },
    ]);
  });

  test("a local backend needs nothing, and one the table does not know is unknown", async () => {
    expect(await credentialNeeds(withBackend('  backend "local" {}'), stack("infra"))).toEqual([]);
    expect(await credentialNeeds(withBackend('  backend "pg" {}'), stack("infra"))).toEqual([
      { what: "the pg backend", namedIn: "infra/main.tf", ways: [{ names: ["PG_CONN_STR"] }] },
    ]);
    expect(await credentialNeeds(withBackend('  backend "http" {}'), stack("infra"))).toEqual([
      { what: "the http backend", namedIn: "infra/main.tf", ways: [] },
    ]);
  });
});

describe("the variables of a root module", () => {
  const root = () =>
    repo({
      "infra/main.tf": [
        'variable "env" {\n  type = string\n}',
        'variable "motd" {\n  type    = string\n  default = "CANARY-VALUE"\n}',
        'variable "secret" {\n  sensitive = true\n}',
        'variable "zone" {}',
      ].join("\n"),
      "infra/prod.tfvars": 'env = "CANARY-ENV"\n',
      "infra/terraform.tfvars": 'zone = "a"\n',
    });

  test("a variable with no default needs TF_VAR_<name>, unless a var file of the stack sets it", async () => {
    const needs = await credentialNeeds(root(), stack("infra", { varFiles: ["prod.tfvars"] }));
    expect(needs).toEqual([
      {
        what: "the variable secret",
        namedIn: "infra/main.tf",
        ways: [{ names: ["TF_VAR_secret"] }],
      },
    ]);
    expect(JSON.stringify(needs)).not.toContain("CANARY");
  });

  test("without the var file, the variable it sets is wanted too", async () => {
    expect(await credentialNeeds(root(), stack("infra"))).toEqual([
      { what: "the variable env", namedIn: "infra/main.tf", ways: [{ names: ["TF_VAR_env"] }] },
      {
        what: "the variable secret",
        namedIn: "infra/main.tf",
        ways: [{ names: ["TF_VAR_secret"] }],
      },
    ]);
  });
});

describe("a Terragrunt unit and a CDK for Terraform app", () => {
  test("a unit names its remote state, and the providers of a module of the repo", async () => {
    const root = repo({
      "live/prod/terragrunt.hcl":
        'terraform {\n  source = "../../modules/vpc"\n}\nremote_state {\n  backend = "s3"\n  config = {\n    bucket = "CANARY-BUCKET"\n  }\n}\n',
      "modules/vpc/main.tf": 'provider "aws" {\n  region = "eu-west-1"\n}\n',
    });
    const needs = await credentialNeeds(root, stack("live/prod", { wrapper: "terragrunt" }));
    expect(needs).toEqual([
      { what: "the s3 remote state", namedIn: "live/prod/terragrunt.hcl", ways: cloudWays("aws") },
      { what: "the aws provider", namedIn: "modules/vpc/main.tf", ways: cloudWays("aws") },
    ]);
    expect(JSON.stringify(needs)).not.toContain("CANARY");
  });

  test("a unit whose source is outside the repo names no provider", async () => {
    const root = repo({
      "live/prod/terragrunt.hcl":
        'terraform {\n  source = "git::https://user:CANARY-TOKEN@example.com/m.git//vpc"\n}\n',
    });
    const needs = await credentialNeeds(root, stack("live/prod", { wrapper: "terragrunt" }));
    expect(needs).toEqual([]);
    expect(JSON.stringify(needs)).not.toContain("CANARY");
  });

  test("an app names its providers in cdktf.json, and its backend is in code", async () => {
    const root = repo({
      "cdktf.json": JSON.stringify({
        terraformProviders: [
          "aws@~> 5.0",
          { name: "random", source: "hashicorp/random" },
          "hashicorp/google@~> 6.0",
        ],
      }),
    });
    expect(await credentialNeeds(root, stack(".", { wrapper: "cdktf" }, "dev"))).toEqual([
      { what: "the backend the app sets in code", namedIn: "cdktf.json", ways: [] },
      { what: "the aws provider", namedIn: "cdktf.json", ways: cloudWays("aws") },
      {
        what: "a region for the aws provider",
        namedIn: "cdktf.json",
        ways: [
          { names: ["AWS_REGION"] },
          { names: ["AWS_DEFAULT_REGION"] },
          { names: [], uses: "aws-actions/configure-aws-credentials" },
        ],
      },
      { what: "the google provider", namedIn: "cdktf.json", ways: cloudWays("google") },
    ]);
  });
});
