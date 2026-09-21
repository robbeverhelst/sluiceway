import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { CANARY_SECRET, CANARY_VALUE } from "../../scripts/fixtures/example.ts";
import { checkRecording, RECORDING_FILE, type Recording } from "../../scripts/fixtures/recorder.ts";
import { SCENARIOS } from "../../scripts/fixtures/scenarios.ts";
import { FIXTURE_CLI_VERSIONS } from "../../scripts/fixtures/versions.ts";

// The fixtures under test/fixtures/pulumi/ are what the real CLI printed
// (record 0001). Nothing here can prove that, the recorder job in CI does. What
// these tests hold is that the committed sets are whole, still fit the
// scenarios, and can make the canary test of record 0021 fail.

const REPO = resolve(import.meta.dir, "../..");
const FIXTURES = join(REPO, "test/fixtures/pulumi");
const VERSIONS = Object.values(FIXTURE_CLI_VERSIONS).sort();

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

describe("the CLI versions of the fixtures", () => {
  test("the minimum is the one record 0001 sets", () => {
    expect(FIXTURE_CLI_VERSIONS.minimum).toBe("v3.229.0");
  });

  test("there is one set of fixtures per version", () => {
    expect(directories(FIXTURES)).toEqual(VERSIONS);
  });

  test("the recorder job in CI runs with the same versions", () => {
    const workflow = parse(readFileSync(join(REPO, ".github/workflows/ci.yml"), "utf8"));
    const matrix = workflow.jobs.fixtures.strategy.matrix.pulumi as string[];
    expect([...matrix].sort()).toEqual(VERSIONS);
  });
});

for (const version of VERSIONS) {
  describe(`the fixtures of pulumi ${version}`, () => {
    test("hold every scenario and nothing else", () => {
      expect(directories(join(FIXTURES, version))).toEqual(
        SCENARIOS.map((scenario) => scenario.name).sort(),
      );
    });

    for (const scenario of SCENARIOS) {
      test(`${scenario.name}: fits the scenario, and parses as JSON where it should`, () => {
        expect(checkRecording(join(FIXTURES, version, scenario.name), scenario)).toEqual([]);
      });

      test(`${scenario.name}: was recorded with this version`, () => {
        const file = join(FIXTURES, version, scenario.name, RECORDING_FILE);
        const recording = JSON.parse(readFileSync(file, "utf8")) as Recording;
        expect(recording.cliVersion).toBe(version);
      });

      // The fixtures in the repo are recorded on a CI runner. /home/runner/ is
      // also what the tool's own build paths look like, and they are in every
      // preview. Any other home directory means a laptop recording got in.
      test(`${scenario.name}: names nobody's home directory`, () => {
        expect(savedOutput(version, scenario.name)).not.toMatch(/\/Users\/|\/home\/(?!runner\/)/);
      });

      test(`${scenario.name}: the tool masked the secret config value`, () => {
        expect(savedOutput(version, scenario.name)).not.toContain(CANARY_SECRET);
      });
    }

    test("the version scenario holds the version", () => {
      expect(savedOutput(version, "version").trim()).toBe(version);
    });

    // Without this the canary test of 0021 could pass on fixtures that never
    // held the value in the first place.
    for (const scenario of [
      "new-stack",
      "new-stack-yml-project",
      "same-preview-twice",
      "update",
      "nested-paths",
    ]) {
      test(`${scenario}: the raw output holds the canary value`, () => {
        expect(savedOutput(version, scenario)).toContain(CANARY_VALUE);
      });
    }
  });
}
