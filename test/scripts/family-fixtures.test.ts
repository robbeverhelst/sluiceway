import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { CDKTF_SCENARIOS } from "../../scripts/fixtures/cdktf-scenarios.ts";
import { openTofuOps, TERRAFORM_SCENARIOS } from "../../scripts/fixtures/opentofu-scenarios.ts";
import {
  checkRecording,
  RECORDING_FILE,
  type Recording,
  type Scenario,
} from "../../scripts/fixtures/recorder.ts";
import { TERRAGRUNT_SCENARIOS } from "../../scripts/fixtures/terragrunt-scenarios.ts";
import {
  FIXTURE_CDKTF_VERSIONS,
  FIXTURE_TERRAFORM_VERSIONS,
  FIXTURE_TERRAGRUNT_VERSIONS,
  FIXTURE_WRAPPED_TOFU_VERSION,
} from "../../scripts/fixtures/versions.ts";
import {
  MINIMUM_CDKTF_VERSION,
  MINIMUM_TERRAFORM_VERSION,
  MINIMUM_TERRAGRUNT_VERSION,
} from "../../src/adapters/opentofu/version.ts";

// The fixtures of the Terraform family (record 0068) under
// test/fixtures/terraform/, terragrunt/ and cdktf/ are what the real tools
// printed. Nothing here can prove that, the recorder jobs in CI do. What these
// tests hold is that the committed sets are whole, still fit the scenarios,
// and were recorded with the versions the adapter and CI name.

const REPO = resolve(import.meta.dir, "../..");
const workflow = parse(readFileSync(join(REPO, ".github/workflows/ci.yml"), "utf8"));

function directories(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function savedOutput(dir: string): string {
  return readdirSync(dir)
    .filter((name) => name !== RECORDING_FILE)
    .map((name) => readFileSync(join(dir, name), "utf8"))
    .join("\n");
}

const SETS: {
  tool: string;
  scenarios: Scenario[];
  versions: { minimum: string; newest: string };
  floor: readonly number[];
  // The versions of the tool in the matrix of its recorder job.
  matrix: () => string[];
}[] = [
  {
    tool: "terraform",
    scenarios: TERRAFORM_SCENARIOS,
    versions: FIXTURE_TERRAFORM_VERSIONS,
    floor: MINIMUM_TERRAFORM_VERSION,
    matrix: () =>
      (workflow.jobs["fixtures-terraform"].strategy.matrix.terraform as string[]).map(
        (version) => `v${version}`,
      ),
  },
  {
    tool: "terragrunt",
    scenarios: TERRAGRUNT_SCENARIOS,
    versions: FIXTURE_TERRAGRUNT_VERSIONS,
    floor: MINIMUM_TERRAGRUNT_VERSION,
    matrix: () => workflow.jobs["fixtures-terragrunt"].strategy.matrix.terragrunt as string[],
  },
  {
    tool: "cdktf",
    scenarios: CDKTF_SCENARIOS,
    versions: FIXTURE_CDKTF_VERSIONS,
    floor: MINIMUM_CDKTF_VERSION,
    matrix: () =>
      (workflow.jobs["fixtures-cdktf"].strategy.matrix.cdktf as string[]).map(
        (version) => `v${version}`,
      ),
  },
];

for (const set of SETS) {
  const fixtures = join(REPO, "test/fixtures", set.tool);
  const versions = [...new Set(Object.values(set.versions))].sort();

  describe(`the ${set.tool} versions of the fixtures`, () => {
    test("the minimum is the adapter's", () => {
      expect(set.versions.minimum).toBe(`v${set.floor.join(".")}`);
    });

    test("there is one set of fixtures per version", () => {
      expect(directories(fixtures)).toEqual(versions);
    });

    test("the recorder job in CI runs with the same versions", () => {
      expect(set.matrix().sort()).toEqual(versions);
    });
  });

  for (const version of versions) {
    describe(`the fixtures of ${set.tool} ${version}`, () => {
      test("hold every scenario and nothing else", () => {
        expect(directories(join(fixtures, version))).toEqual(
          set.scenarios.map((scenario) => scenario.name).sort(),
        );
      });

      for (const scenario of set.scenarios) {
        const dir = join(fixtures, version, scenario.name);
        test(`${scenario.name}: fits the scenario, and parses as JSON where it should`, () => {
          expect(checkRecording(dir, scenario, openTofuOps)).toEqual([]);
        });

        test(`${scenario.name}: was recorded with this version`, () => {
          const recording = JSON.parse(
            readFileSync(join(dir, RECORDING_FILE), "utf8"),
          ) as Recording;
          expect(recording.cliVersion).toBe(version);
        });

        // Recorded on a CI runner. Any other home directory means a laptop
        // recording got in.
        test(`${scenario.name}: names nobody's home directory`, () => {
          expect(savedOutput(dir)).not.toMatch(/\/Users\/|\/home\/(?!runner\/)|\/private\/tmp\//);
        });
      }
    });
  }
}

describe("the tofu behind terragrunt and cdktf", () => {
  test("is the one both recorder jobs install", () => {
    for (const job of ["fixtures-terragrunt", "fixtures-cdktf"]) {
      const steps = workflow.jobs[job].steps as {
        uses?: string;
        with?: { tofu_version?: string };
      }[];
      const tofu = steps.find((step) => step.uses?.startsWith("opentofu/setup-opentofu@"));
      expect(`v${tofu?.with?.tofu_version}`).toBe(FIXTURE_WRAPPED_TOFU_VERSION);
    }
  });
});
