import { describe, expect, test } from "bun:test";
import { parseConfig } from "../../src/core/config.ts";
import { checkWorkflows, type WorkflowFile } from "../../src/core/workflow-check.ts";

// Slice 5.34, record 0099: the check reads what a job hands the Sluiceway
// step, as the file writes it: the names env: sets, and the other steps of
// the job. Never a value: the right-hand side of env: is not read.

const DEFAULTS = parseConfig("");

function provides(text: string) {
  const file: WorkflowFile = { path: ".github/workflows/deploy-dashboard.yml", text };
  return checkWorkflows([file], DEFAULTS).workflows[0]?.jobs[0]?.provides;
}

const WORKFLOW = `on:
  push:
    branches: [main]
env:
  TF_IN_AUTOMATION: "true"
jobs:
  sluiceway:
    runs-on: ubuntu-latest
    env:
      AWS_REGION: eu-west-1
    steps:
      - uses: actions/checkout@v7
      - name: Load the environment
        env:
          OP_SERVICE_ACCOUNT_TOKEN: \${{ secrets.OP_SERVICE_ACCOUNT_TOKEN }}
        run: op run --env-file=ci/deploy.env -- bash .github/scripts/export-env.sh ci/deploy.env
      - uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: \${{ vars.AWS_DEPLOY_ROLE }}
      - run: |
          echo one
          echo two
        env:
          NOT_FOR_SLUICEWAY: CANARY-VALUE
      - uses: sluiceway/sluiceway@v0
        env:
          PULUMI_ACCESS_TOKEN: \${{ secrets.PULUMI_ACCESS_TOKEN }}
      - name: Tell people
        run: ./notify.sh
        env:
          SLACK: \${{ secrets.SLACK }}
`;

describe("what a job hands the Sluiceway step", () => {
  const found = provides(WORKFLOW);

  test("the names env: sets on the workflow, the job and the step, each with where", () => {
    expect(found?.names).toEqual([
      { name: "TF_IN_AUTOMATION", where: "env: on the workflow" },
      { name: "AWS_REGION", where: "env: on the job" },
      { name: "PULUMI_ACCESS_TOKEN", where: "env: on the step" },
    ]);
  });

  test("env: on another step reaches nothing but that step", () => {
    expect(found?.names.map(({ name }) => name)).not.toContain("NOT_FOR_SLUICEWAY");
    expect(JSON.stringify(found)).not.toContain("CANARY");
  });

  test("the other steps, in order, with what they do and whether they run before", () => {
    expect(found?.steps).toEqual([
      { step: "actions/checkout", uses: "actions/checkout", before: true },
      {
        step: "Load the environment",
        run: "op run --env-file=ci/deploy.env -- bash .github/scripts/export-env.sh ci/deploy.env",
        secret: true,
        before: true,
      },
      {
        step: "aws-actions/configure-aws-credentials",
        uses: "aws-actions/configure-aws-credentials",
        before: true,
      },
      { step: "step 4", run: "echo one\necho two\n", before: true },
      { step: "Tell people", run: "./notify.sh", secret: true, before: false },
    ]);
  });

  test("a value of env: or with: is never kept", () => {
    expect(JSON.stringify(found)).not.toContain("secrets.");
    expect(JSON.stringify(found)).not.toContain("eu-west-1");
  });
});

describe("a job with nothing around the step", () => {
  test("provides no name and has no other step", () => {
    expect(
      provides("on: push\njobs:\n  sluiceway:\n    steps:\n      - uses: sluiceway/sluiceway@v0\n"),
    ).toEqual({ names: [], steps: [] });
  });

  test("a step handed a secret in with: is marked", () => {
    const found = provides(
      "on: push\njobs:\n  sluiceway:\n    steps:\n      - uses: hashicorp/vault-action@v3\n        with:\n          token: ${{ secrets.VAULT_TOKEN }}\n      - uses: sluiceway/sluiceway@v0\n",
    );
    expect(found?.steps).toEqual([
      {
        step: "hashicorp/vault-action",
        uses: "hashicorp/vault-action",
        secret: true,
        before: true,
      },
    ]);
  });
});
