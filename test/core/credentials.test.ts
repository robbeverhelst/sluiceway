import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  CLOUDS,
  type CredentialNeed,
  cloudWays,
  type JobEnvironment,
  jobEnvironment,
  judgeNeeds,
  wayWords,
} from "../../src/core/credentials.ts";
import type { JobProvides } from "../../src/core/workflow-check.ts";

// Slice 5.34, record 0099: the check says which credentials each stack
// needs, as names with alternatives, and which of them nothing in the
// workflow appears to provide. A guess never turns into a failure: what the
// files do not show is said as unknown, never as missing.

const NOTHING: JobProvides = { names: [], steps: [] };

function environment(provides: Partial<JobProvides>, root = "/nowhere"): JobEnvironment {
  return jobEnvironment({ ...NOTHING, ...provides }, root);
}

const backend: CredentialNeed = {
  what: "the Pulumi backend",
  namedIn: "network/Pulumi.yaml",
  ways: [{ names: ["PULUMI_ACCESS_TOKEN"] }, { names: ["PULUMI_BACKEND_URL"] }],
};

const aws: CredentialNeed = {
  what: "the aws provider",
  namedIn: "network/Pulumi.prod.yaml",
  ways: cloudWays("aws"),
};

describe("a need against what a job hands the tool", () => {
  test("a name the file sets with env: meets the need, and the judgement says where", () => {
    const [judged] = judgeNeeds(
      [backend],
      environment({ names: [{ name: "PULUMI_ACCESS_TOKEN", where: "env: on the step" }] }),
    );
    expect(judged).toEqual({
      need: backend,
      met: true,
      by: "PULUMI_ACCESS_TOKEN, env: on the step",
    });
  });

  test("a way of two names needs both", () => {
    const one = environment({ names: [{ name: "AWS_ACCESS_KEY_ID", where: "env: on the job" }] });
    expect(judgeNeeds([aws], one)[0]).toMatchObject({ met: false, maybe: [] });
    const both = environment({
      names: [
        { name: "AWS_ACCESS_KEY_ID", where: "env: on the job" },
        { name: "AWS_SECRET_ACCESS_KEY", where: "env: on the job" },
      ],
    });
    expect(judgeNeeds([aws], both)[0]).toMatchObject({
      met: true,
      by: "AWS_ACCESS_KEY_ID with AWS_SECRET_ACCESS_KEY, env: on the job",
    });
  });

  test("a login action before the Sluiceway step meets a need, and one after it does not", () => {
    const before = environment({
      steps: [
        {
          step: "aws-actions/configure-aws-credentials",
          uses: "aws-actions/configure-aws-credentials",
          before: true,
        },
      ],
    });
    expect(judgeNeeds([aws], before)[0]).toMatchObject({
      met: true,
      by: "a step that uses aws-actions/configure-aws-credentials",
    });
    const after = environment({
      steps: [
        {
          step: "aws-actions/configure-aws-credentials",
          uses: "aws-actions/configure-aws-credentials",
          before: false,
        },
      ],
    });
    expect(judgeNeeds([aws], after)[0]).toMatchObject({ met: false });
  });

  test("a command a run step before it holds meets a need that names one", () => {
    const cluster: CredentialNeed = {
      what: "the cluster",
      namedIn: "sluiceway.yaml",
      ways: cloudWays("kubernetes"),
    };
    const written = environment({
      steps: [{ step: "step 4", run: "aws eks update-kubeconfig --name prod", before: true }],
    });
    expect(judgeNeeds([cluster], written)[0]).toMatchObject({
      met: true,
      by: "a step that runs update-kubeconfig",
    });
  });

  test("a step the check cannot see into makes the answer a maybe, named after the step", () => {
    const loader = environment({
      steps: [
        {
          step: "Load the environment",
          run: "op run --env-file=ci/deploy.env -- bash .github/scripts/export-env.sh ci/deploy.env",
          before: true,
        },
        { step: "step 3", run: "echo done >> $GITHUB_ENV", before: true },
        { step: "step 5", run: "echo after >> $GITHUB_ENV", before: false },
        { step: "hashicorp/vault-action", uses: "hashicorp/vault-action", before: true },
        { step: "actions/setup-node", uses: "actions/setup-node", before: true },
      ],
    });
    expect(judgeNeeds([backend], loader)[0]).toEqual({
      need: backend,
      met: false,
      maybe: ["Load the environment", "step 3", "hashicorp/vault-action"],
    });
  });

  test("a step handed a secret is one the check cannot see into", () => {
    const handed = environment({
      steps: [{ step: "Fetch", run: "./fetch.sh", secret: true, before: true }],
    });
    expect(judgeNeeds([backend], handed)[0]).toMatchObject({ met: false, maybe: ["Fetch"] });
  });

  test("a need the table does not know is unknown, never unmet", () => {
    const unknown: CredentialNeed = { what: "the docker provider", namedIn: "x", ways: [] };
    expect(judgeNeeds([unknown], environment({}))[0]).toEqual({
      need: unknown,
      met: "unknown",
    });
  });

  test("the names an env file of the repo lists are provided by that file", () => {
    const root = mkdtempSync(join(tmpdir(), "sluiceway-credentials-"));
    mkdirSync(join(root, "ci"));
    writeFileSync(
      join(root, "ci/deploy.env"),
      [
        "# the state",
        "PULUMI_BACKEND_URL=op://infra/pulumi/url",
        "export PULUMI_CONFIG_PASSPHRASE = op://infra/pulumi/passphrase",
        "AWS_REGION=eu-west-1",
        "not a line",
        "",
      ].join("\n"),
    );
    const loaded = jobEnvironment(
      {
        names: [],
        steps: [
          {
            step: "Load the environment",
            run: "op run --env-file=ci/deploy.env --no-masking -- bash .github/scripts/export-env.sh ci/deploy.env",
            before: true,
          },
        ],
      },
      root,
    );
    expect([...loaded.names]).toEqual([
      ["PULUMI_BACKEND_URL", "listed in ci/deploy.env"],
      ["PULUMI_CONFIG_PASSPHRASE", "listed in ci/deploy.env"],
      ["AWS_REGION", "listed in ci/deploy.env"],
    ]);
    // A file the check could read is not a step it cannot see into.
    expect(loaded.opaque).toEqual([]);
    expect(judgeNeeds([backend], loaded)[0]).toMatchObject({
      met: true,
      by: "PULUMI_BACKEND_URL, listed in ci/deploy.env",
    });
  });

  test("an env file that is not in the repo makes the step one the check cannot see into", () => {
    const loaded = environment({
      steps: [{ step: "Load", run: "doppler run --env-file secrets.env", before: true }],
    });
    expect(loaded.names.size).toBe(0);
    expect(loaded.opaque).toEqual(["Load"]);
  });

  test("a value never reaches the environment the check builds", () => {
    const root = mkdtempSync(join(tmpdir(), "sluiceway-credentials-"));
    const file = join(root, ".env.ci");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "TOKEN=CANARY-VALUE\n");
    const loaded = jobEnvironment(
      {
        names: [],
        steps: [{ step: "Load", run: "op run --env-file=.env.ci -- true", before: true }],
      },
      root,
    );
    expect(JSON.stringify([...loaded.names, loaded.opaque])).not.toContain("CANARY");
  });
});

describe("the table of clouds", () => {
  test("every way is variable names, a login action or a command, and every cloud has one", () => {
    for (const cloud of CLOUDS) {
      const ways = cloudWays(cloud);
      expect(ways.length).toBeGreaterThan(0);
      for (const way of ways) {
        for (const name of way.names) expect(name).toMatch(/^[A-Z][A-Z0-9_]*$/);
        if (way.names.length === 0)
          expect(way.uses !== undefined || way.runs !== undefined).toBe(true);
      }
    }
  });

  test("a way is written as its names, or as the step that gives it", () => {
    expect(wayWords({ names: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"] })).toBe(
      "AWS_ACCESS_KEY_ID with AWS_SECRET_ACCESS_KEY",
    );
    expect(wayWords({ names: [], uses: "azure/login" })).toBe("a step that uses azure/login");
    expect(wayWords({ names: [], runs: "update-kubeconfig" })).toBe(
      "a step that runs update-kubeconfig",
    );
  });
});
