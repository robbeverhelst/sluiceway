import { describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { tools } from "../../src/adapters/tools.ts";
import { check } from "../../src/modes/check.ts";
import { escapeText } from "../../src/render/escape.ts";
import { rememberingLog } from "./harness.ts";

// Slice 5.34, record 0099: the check says which credentials each stack
// needs, as names with alternatives, and which of them nothing in the
// workflow appears to provide. Names only, and never a failure: a guess is
// said as "nothing in this workflow provides", a program can read any
// variable, and a step the check cannot see into is named as such.

const ROOT = resolve(import.meta.dir, "../..");

type Files = Record<string, string | undefined>;

function repo(files: Files): string {
  const root = mkdtempSync(join(tmpdir(), "sluiceway-check-credentials-"));
  for (const [file, text] of Object.entries(files)) {
    if (text === undefined) continue;
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

async function run(root: string) {
  const log = rememberingLog();
  await check({ root, adapter: tools, log });
  return {
    log,
    summary: log.summaries.at(-1) ?? "",
    group: (title: string) => log.groups.find((group) => group.title === title)?.lines,
  };
}

const NEEDS = "Credentials each stack needs";
const WORKFLOW = ".github/workflows/deploy-dashboard.yml";

const STACKS: Files = {
  "network/Pulumi.yaml":
    "name: network\nruntime: yaml\nresources:\n  bucket:\n    type: aws:s3:Bucket\n",
  "network/Pulumi.prod.yaml":
    "encryptionsalt: v1:CANARY-SALT\nconfig:\n  aws:region: eu-west-1\n  network:zone: CANARY-VALUE\n",
  "dns/main.tf": 'terraform {\n  backend "local" {}\n}\nprovider "random" {}\n',
  "dns/.terraform.lock.hcl": 'provider "registry.opentofu.org/hashicorp/random" {}\n',
};

const ONE_STEP = (before: string, env: string) => `name: deploy-dashboard
on:
  push:
    branches: [main]
  schedule:
    - cron: "0 6 * * *"
  workflow_dispatch:
  issues:
    types: [edited]
permissions:
  contents: read
  issues: write
  deployments: write
  actions: write
  pull-requests: read
  checks: write
jobs:
  sluiceway:
    runs-on: ubuntu-latest
    concurrency:
      group: sluiceway-\${{ github.event.issue.number }}
      queue: max
    steps:
      - uses: actions/checkout@v7
${before}      - uses: sluiceway/sluiceway@v0
${env}`;

describe("what each stack needs", () => {
  test("one line per need, names only, and a stack that needs nothing says so", async () => {
    const { group, log, summary } = await run(repo(STACKS));
    expect(group(NEEDS)).toEqual([
      "dns needs nothing that its files name.",
      "network:prod needs the Pulumi backend: PULUMI_ACCESS_TOKEN or PULUMI_BACKEND_URL. Named in network/Pulumi.yaml.",
      "network:prod needs the passphrase of its secrets: PULUMI_CONFIG_PASSPHRASE or PULUMI_CONFIG_PASSPHRASE_FILE. Named in network/Pulumi.prod.yaml.",
      "network:prod needs the aws provider: AWS_ACCESS_KEY_ID with AWS_SECRET_ACCESS_KEY, AWS_PROFILE, or a step that uses aws-actions/configure-aws-credentials. Named in network/Pulumi.yaml.",
    ]);
    expect(summary).toContain("### Credentials");
    // A summary escapes what it shows, as every summary does.
    const cells = [
      "network:prod",
      "the aws provider",
      "AWS_ACCESS_KEY_ID with AWS_SECRET_ACCESS_KEY, AWS_PROFILE, or a step that uses aws-actions/configure-aws-credentials",
      "network/Pulumi.yaml",
    ];
    expect(summary).toContain(`| ${cells.map(escapeText).join(" | ")} |`);
    expect(summary).toContain("| dns | nothing that its files name |  |  |");
    const everything = JSON.stringify([log.lines, log.groups, log.warnings, summary]);
    expect(everything).not.toContain("CANARY");
    expect(everything).not.toContain("eu-west-1");
    // Without a workflow, nothing is said about what one provides.
    expect(everything).not.toContain("provides");
  });

  test("a provider the check has no table for is said, never guessed", async () => {
    const { group } = await run(
      repo({
        "site/Pulumi.yaml": "name: site\nruntime: nodejs\n",
        "site/Pulumi.prod.yaml": "",
        "site/package.json": JSON.stringify({ dependencies: { "@pulumi/docker": "4" } }),
      }),
    );
    expect(group(NEEDS)).toContain(
      "site:prod needs the docker provider, which the check has no table for. Named in site/package.json.",
    );
  });
});

describe("what the workflow provides", () => {
  test("a job that names a way to everything says so, and the log says which", async () => {
    const { group, log, summary } = await run(
      repo({
        ...STACKS,
        [WORKFLOW]: ONE_STEP(
          "      - uses: aws-actions/configure-aws-credentials@v6\n        with:\n          role-to-assume: ${{ vars.ROLE }}\n",
          "        env:\n          PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}\n          PULUMI_CONFIG_PASSPHRASE: ${{ secrets.PASSPHRASE }}\n",
        ),
      }),
    );
    const line = `${WORKFLOW}, job sluiceway names a way to every credential the stacks' files ask for.`;
    expect(log.lines).toContain(line);
    expect(summary).toContain(`- ${escapeText(line)}`);
    expect(group(`What ${WORKFLOW}, job sluiceway provides`)).toEqual([
      "network:prod, the Pulumi backend: PULUMI_ACCESS_TOKEN, env: on the step.",
      "network:prod, the passphrase of its secrets: PULUMI_CONFIG_PASSPHRASE, env: on the step.",
      "network:prod, the aws provider: a step that uses aws-actions/configure-aws-credentials.",
    ]);
    expect(log.warnings.map((warning) => warning.title)).not.toContain("Credentials");
  });

  test("a need nothing names is said as such, and never as a failure", async () => {
    const { log, summary } = await run(repo({ ...STACKS, [WORKFLOW]: ONE_STEP("", "") }));
    const lines = [
      `Nothing in ${WORKFLOW}, job sluiceway provides PULUMI_ACCESS_TOKEN or PULUMI_BACKEND_URL, which network:prod needs for the Pulumi backend.`,
      `Nothing in ${WORKFLOW}, job sluiceway provides PULUMI_CONFIG_PASSPHRASE or PULUMI_CONFIG_PASSPHRASE_FILE, which network:prod needs for the passphrase of its secrets.`,
      `Nothing in ${WORKFLOW}, job sluiceway provides AWS_ACCESS_KEY_ID with AWS_SECRET_ACCESS_KEY, AWS_PROFILE or a step that uses aws-actions/configure-aws-credentials, which network:prod needs for the aws provider.`,
    ];
    for (const line of lines) {
      expect(log.lines).toContain(line);
      expect(summary).toContain(`- ${escapeText(line)}`);
    }
    expect(log.warnings).toEqual([]);
    expect(log.lines).toContain("The setup is valid.");
  });

  test("a step the check cannot see into is named as a maybe", async () => {
    const { log } = await run(
      repo({
        ...STACKS,
        [WORKFLOW]: ONE_STEP(
          "      - name: Load the environment\n        env:\n          OP_SERVICE_ACCOUNT_TOKEN: ${{ secrets.OP }}\n        run: op run --env-file=ci/deploy.env -- bash .github/scripts/export-env.sh ci/deploy.env\n",
          "",
        ),
      }),
    );
    expect(log.lines).toContain(
      `Nothing in ${WORKFLOW}, job sluiceway provides PULUMI_ACCESS_TOKEN or PULUMI_BACKEND_URL, which network:prod needs for the Pulumi backend. The step Load the environment may load it, and the check cannot see into it.`,
    );
  });

  test("an env file of the repo that a step loads provides the names it lists", async () => {
    const { group, log } = await run(
      repo({
        ...STACKS,
        "ci/deploy.env":
          "PULUMI_BACKEND_URL=op://infra/pulumi/url\nPULUMI_CONFIG_PASSPHRASE=op://infra/pulumi/passphrase\nAWS_PROFILE=op://infra/aws/profile\n",
        [WORKFLOW]: ONE_STEP(
          "      - name: Load the environment\n        run: op run --env-file=ci/deploy.env -- bash .github/scripts/export-env.sh ci/deploy.env\n",
          "",
        ),
      }),
    );
    expect(log.lines).toContain(
      `${WORKFLOW}, job sluiceway names a way to every credential the stacks' files ask for.`,
    );
    expect(group(`What ${WORKFLOW}, job sluiceway provides`)).toEqual([
      "network:prod, the Pulumi backend: PULUMI_BACKEND_URL, listed in ci/deploy.env.",
      "network:prod, the passphrase of its secrets: PULUMI_CONFIG_PASSPHRASE, listed in ci/deploy.env.",
      "network:prod, the aws provider: AWS_PROFILE, listed in ci/deploy.env.",
    ]);
    expect(JSON.stringify(log)).not.toContain("op://");
  });

  test("two stacks with the same unmet need share one line, and a check-only job gets none", async () => {
    const { log } = await run(
      repo({
        ...STACKS,
        "network/Pulumi.dev.yaml": "",
        ".github/workflows/deploy-dashboard-check.yml":
          "on: pull_request\npermissions:\n  contents: read\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n      - uses: sluiceway/sluiceway@v0\n",
        [WORKFLOW]: ONE_STEP("", ""),
      }),
    );
    expect(log.lines).toContain(
      `Nothing in ${WORKFLOW}, job sluiceway provides PULUMI_ACCESS_TOKEN or PULUMI_BACKEND_URL, which network:dev and network:prod need for the Pulumi backend.`,
    );
    expect(log.lines.filter((line) => line.includes("deploy-dashboard-check.yml"))).toEqual([]);
  });
});

describe("the example projects", () => {
  test.each([
    "pulumi-basic",
    "opentofu-basic",
    "helm-basic",
    "kubernetes-basic",
    "terragrunt-basic",
    "cdktf-basic",
  ])("%s lists what its stacks need, and no value", async (name) => {
    const root = mkdtempSync(join(tmpdir(), "sluiceway-check-credentials-"));
    cpSync(join(ROOT, "examples", name), root, { recursive: true });
    const { group, log, summary } = await run(root);
    expect(group(NEEDS)?.length).toBeGreaterThan(0);
    const everything = JSON.stringify([log.lines, log.groups, summary]);
    expect(everything).not.toContain("CANARY");
  });

  test("helm-basic and kubernetes-basic need the cluster", async () => {
    const root = mkdtempSync(join(tmpdir(), "sluiceway-check-credentials-"));
    cpSync(join(ROOT, "examples", "helm-basic"), root, { recursive: true });
    expect((await run(root)).group(NEEDS)).toEqual([
      "web needs the cluster: KUBECONFIG, a step that runs update-kubeconfig, a step that runs get-credentials, a step that uses azure/aks-set-context, or a step that uses google-github-actions/get-gke-credentials. Named in sluiceway.yaml.",
      "worker needs the cluster: KUBECONFIG, a step that runs update-kubeconfig, a step that runs get-credentials, a step that uses azure/aks-set-context, or a step that uses google-github-actions/get-gke-credentials. Named in sluiceway.yaml.",
    ]);
  });
});
