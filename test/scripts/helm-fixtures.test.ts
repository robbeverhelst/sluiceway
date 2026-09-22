import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { helmOps, helmScenarios } from "../../scripts/fixtures/helm-scenarios.ts";
import { checkRecording, RECORDING_FILE, type Recording } from "../../scripts/fixtures/recorder.ts";
import { FIXTURE_HELM_VERSIONS } from "../../scripts/fixtures/versions.ts";
import { MINIMUM_DIFF_VERSION, MINIMUM_VERSION } from "../../src/adapters/helm/version.ts";

// The fixtures under test/fixtures/helm/ are what the real helm and its diff
// plugin printed against a kind cluster (records 0001 and 0058). Nothing here
// can prove that, the recorder job in CI does. What these tests hold is that
// the committed sets are whole and still fit the scenarios.

const REPO = resolve(import.meta.dir, "../..");
const FIXTURES = join(REPO, "test/fixtures/helm");
const PAIRS = Object.values(FIXTURE_HELM_VERSIONS);
const VERSIONS = PAIRS.map(({ helm }) => helm).sort();

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

describe("the helm versions of the fixtures", () => {
  test("the minimums are the adapter's", () => {
    expect(FIXTURE_HELM_VERSIONS.minimum.helm as string).toBe(`v${MINIMUM_VERSION.join(".")}`);
    expect(FIXTURE_HELM_VERSIONS.minimum.diff as string).toBe(`v${MINIMUM_DIFF_VERSION.join(".")}`);
  });

  test("there is one set of fixtures per version", () => {
    expect(directories(FIXTURES)).toEqual(VERSIONS);
  });

  test("the recorder job in CI runs with the same versions", () => {
    const workflow = parse(readFileSync(join(REPO, ".github/workflows/ci.yml"), "utf8"));
    const include = workflow.jobs["fixtures-helm"].strategy.matrix.include as {
      helm: string;
      diff: string;
    }[];
    const found = include.map(({ helm, diff }) => ({ helm, diff }));
    expect(found).toEqual(PAIRS.map(({ helm, diff }) => ({ helm, diff })));
  });

  for (const { helm, diff } of PAIRS) {
    test(`${helm} was recorded with the diff plugin ${diff}`, () => {
      const version = readFileSync(
        join(FIXTURES, helm, "version", "plugin-version.stdout"),
        "utf8",
      );
      expect(`v${version.trim()}`).toBe(diff);
    });
  }
});

for (const version of VERSIONS) {
  // The deploy's command line differs between Helm 3 and Helm 4 (record 0069).
  const scenarios = helmScenarios(version);
  describe(`the fixtures of helm ${version}`, () => {
    test("hold every scenario and nothing else", () => {
      expect(directories(join(FIXTURES, version))).toEqual(
        scenarios.map((scenario) => scenario.name).sort(),
      );
    });

    for (const scenario of scenarios) {
      test(`${scenario.name}: fits the scenario, and parses as JSON where it should`, () => {
        expect(checkRecording(join(FIXTURES, version, scenario.name), scenario, helmOps)).toEqual(
          [],
        );
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
