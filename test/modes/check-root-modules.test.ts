import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { tools } from "../../src/adapters/tools.ts";
import { check } from "../../src/modes/check.ts";
import { rememberingLog } from "./harness.ts";

// Record 0092: the check shows on a pull request what root module discovery
// found and what it left out and why, before any of it reaches a dashboard.

type Files = Record<string, string>;

function repo(files: Files): string {
  const root = mkdtempSync(join(tmpdir(), "sluiceway-check-roots-"));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

async function run(files: Files) {
  const log = rememberingLog();
  await check({ root: repo(files), adapter: tools, log });
  return { log, summary: log.summaries.at(-1) ?? "" };
}

const BACKEND = 'terraform {\n  backend "s3" {\n    key = "x"\n  }\n}\n';
const LOCK = 'provider "registry.opentofu.org/hashicorp/random" {\n  version = "3.7.2"\n}\n';

const FILES: Files = {
  "sluiceway.yaml": "stacks:\n  - path: legacy\n    tool: terraform\n",
  "envs/prod/main.tf": `${BACKEND}module "network" {\n  source = "../../modules/network"\n}\n`,
  "envs/prod/.terraform.lock.hcl": LOCK,
  "modules/network/main.tf": 'resource "random_pet" "name" {}\n',
  "bootstrap/main.tf": 'resource "random_pet" "name" {}\n',
  "legacy/main.tf": BACKEND,
};

describe("the check of a repo with OpenTofu and Terraform files", () => {
  test("the summary lists every directory with what discovery made of it", async () => {
    const { summary } = await run(FILES);
    expect(summary).toContain(
      [
        "### Root modules found from their files",
        "",
        "Discovery found 1 root module and left out 2 directories. A stacks entry with tool declares a directory it left out, and ignore or discovery.rootModules: false leaves out one it found.",
        "",
        "| Directory | Stack | Why |",
        "|---|---|---|",
        "| bootstrap | none | no backend or cloud block: only a root module chooses where its state lives, and state left on the runner is lost |",
        "| envs/prod | envs/prod | a backend &quot;s3&quot; block in main.tf, and a lock file of OpenTofu providers |",
        "| legacy | declared | declared by stacks&#91;0&#93;, which it keeps |",
        "| modules/network | none | envs/prod uses it as a module source |",
      ].join("\n"),
    );
  });

  test("the found stack is in the stacks table like any other", async () => {
    const { summary } = await run(FILES);
    expect(summary).toContain("| envs/prod | sluiceway | write | none |");
    expect(summary).toContain("| legacy | sluiceway | write | none |");
  });

  test("the job log holds the same, one line per directory", async () => {
    const { log } = await run(FILES);
    const group = log.groups.find((one) => one.title === "Root modules found from their files");
    expect(group?.lines).toEqual([
      "bootstrap: left out, no backend or cloud block: only a root module chooses where its state lives, and state left on the runner is lost",
      'envs/prod: found, a backend "s3" block in main.tf, and a lock file of OpenTofu providers',
      "legacy: declared by stacks[0], which it keeps",
      "modules/network: left out, envs/prod uses it as a module source",
    ]);
    expect(log.lines).toContain("Discovery found 1 root module and left out 2 directories.");
  });

  test("a repo with no OpenTofu or Terraform files has no such part", async () => {
    const { summary } = await run({
      "network/Pulumi.yaml": "name: n\nruntime: yaml\n",
      "network/Pulumi.dev.yaml": "",
    });
    expect(summary).not.toContain("Root modules");
  });
});
