import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { INFRACOST_SCENARIOS } from "../../scripts/fixtures/infracost-scenarios.ts";
import { openTofuOps } from "../../scripts/fixtures/opentofu-scenarios.ts";
import { checkRecording, RECORDING_FILE, type Recording } from "../../scripts/fixtures/recorder.ts";
import {
  FIXTURE_INFRACOST_VERSIONS,
  FIXTURE_WRAPPED_TOFU_VERSION,
} from "../../scripts/fixtures/versions.ts";

// The fixtures under test/fixtures/infracost/ are what the real Infracost CLI
// printed over a real tofu plan, against the fake pricing API of the recorder
// (record 0105). Nothing here can prove that, the recorder job in CI does.
// What these tests hold is that the committed set is whole, still fits the
// scenarios, and was recorded with the version CI installs.

const REPO = resolve(import.meta.dir, "../..");
const FIXTURES = join(REPO, "test/fixtures/infracost");
const VERSIONS = [...new Set(Object.values(FIXTURE_INFRACOST_VERSIONS))].sort();
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

describe("the Infracost version of the fixtures", () => {
  test("there is one set of fixtures per version", () => {
    expect(directories(FIXTURES)).toEqual(VERSIONS);
  });

  test("the recorder job in CI installs the same version, and the tofu the other wrapped recordings use", () => {
    const job = workflow.jobs["fixtures-infracost"];
    expect((job.strategy.matrix.infracost as string[]).map((v) => `v${v}`).sort()).toEqual(
      VERSIONS,
    );
    const steps = job.steps as { uses?: string; with?: { tofu_version?: string } }[];
    const tofu = steps.find((step) => step.uses?.startsWith("opentofu/setup-opentofu@"));
    expect(`v${tofu?.with?.tofu_version}`).toBe(FIXTURE_WRAPPED_TOFU_VERSION);
  });
});

for (const version of VERSIONS) {
  describe(`the fixtures of infracost ${version}`, () => {
    test("hold every scenario and nothing else", () => {
      expect(directories(join(FIXTURES, version))).toEqual(
        INFRACOST_SCENARIOS.map((scenario) => scenario.name).sort(),
      );
    });

    for (const scenario of INFRACOST_SCENARIOS) {
      const dir = join(FIXTURES, version, scenario.name);
      test(`${scenario.name}: fits the scenario, and parses as JSON where it should`, () => {
        expect(checkRecording(dir, scenario, openTofuOps)).toEqual([]);
      });

      test(`${scenario.name}: was recorded with this version`, () => {
        const recording = JSON.parse(readFileSync(join(dir, RECORDING_FILE), "utf8")) as Recording;
        expect(recording.cliVersion).toBe(version);
      });

      // Recorded on a CI runner. Any other home directory means a laptop
      // recording got in. The CLI names its own credentials file under the
      // home the recorder gives it, /tmp/sluiceway-fixtures/home, which
      // names nobody either.
      test(`${scenario.name}: names nobody's home directory`, () => {
        expect(savedOutput(dir)).not.toMatch(
          /\/Users\/|\/home\/(?!runner\/|\.config\/infracost\/)|\/private\/tmp\//,
        );
      });

      // The CLI's own words to stderr are what the job log gets, so a key of
      // the recorder must not be in them, and no recording holds a real key.
      test(`${scenario.name}: holds no key`, () => {
        expect(savedOutput(dir)).not.toContain("ico-recorded");
      });
    }
  });
}
