import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { OPENTOFU_SCENARIOS, openTofuOps } from "../../scripts/fixtures/opentofu-scenarios.ts";
import { checkRecording, RECORDING_FILE, type Recording } from "../../scripts/fixtures/recorder.ts";
import { FIXTURE_TOFU_VERSIONS } from "../../scripts/fixtures/versions.ts";
import { MINIMUM_VERSION } from "../../src/adapters/opentofu/version.ts";

// The fixtures under test/fixtures/opentofu/ are what the real tofu printed
// (records 0001 and 0053). Nothing here can prove that, the recorder job in CI
// does. What these tests hold is that the committed sets are whole and still
// fit the scenarios.

const REPO = resolve(import.meta.dir, "../..");
const FIXTURES = join(REPO, "test/fixtures/opentofu");
const VERSIONS = Object.values(FIXTURE_TOFU_VERSIONS).sort();

function directories(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function savedOutput(version: string, scenario: string): string {
  const dir = join(FIXTURES, version, scenario);
  return readdirSync(dir)
    .filter((name) => name !== RECORDING_FILE)
    .map((name) => readFileSync(join(dir, name), "utf8"))
    .join("\n");
}

describe("the tofu versions of the fixtures", () => {
  test("the minimum is the adapter's", () => {
    expect(FIXTURE_TOFU_VERSIONS.minimum as string).toBe(`v${MINIMUM_VERSION.join(".")}`);
  });

  test("there is one set of fixtures per version", () => {
    expect(directories(FIXTURES)).toEqual(VERSIONS);
  });

  test("the recorder job in CI runs with the same versions", () => {
    const workflow = parse(readFileSync(join(REPO, ".github/workflows/ci.yml"), "utf8"));
    const matrix = workflow.jobs["fixtures-opentofu"].strategy.matrix.tofu as string[];
    expect(matrix.map((version) => `v${version}`).sort()).toEqual(VERSIONS);
  });
});

for (const version of VERSIONS) {
  describe(`the fixtures of tofu ${version}`, () => {
    test("hold every scenario and nothing else", () => {
      expect(directories(join(FIXTURES, version))).toEqual(
        OPENTOFU_SCENARIOS.map((scenario) => scenario.name).sort(),
      );
    });

    for (const scenario of OPENTOFU_SCENARIOS) {
      test(`${scenario.name}: fits the scenario, and parses as JSON where it should`, () => {
        expect(
          checkRecording(join(FIXTURES, version, scenario.name), scenario, openTofuOps),
        ).toEqual([]);
      });

      test(`${scenario.name}: was recorded with this version`, () => {
        const file = join(FIXTURES, version, scenario.name, RECORDING_FILE);
        const recording = JSON.parse(readFileSync(file, "utf8")) as Recording;
        expect(recording.cliVersion).toBe(version);
      });

      // Recorded on a CI runner. Any other home directory means a laptop
      // recording got in.
      test(`${scenario.name}: names nobody's home directory`, () => {
        expect(savedOutput(version, scenario.name)).not.toMatch(/\/Users\/|\/home\/(?!runner\/)/);
      });
    }
  });
}
