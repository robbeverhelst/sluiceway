import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { KUBECTL_SCENARIOS, kubectlOps } from "../../scripts/fixtures/kubectl-scenarios.ts";
import { checkRecording, RECORDING_FILE, type Recording } from "../../scripts/fixtures/recorder.ts";
import { FIXTURE_KUBECTL_VERSIONS } from "../../scripts/fixtures/versions.ts";
import { MINIMUM_VERSION } from "../../src/adapters/kubectl/version.ts";

// The fixtures under test/fixtures/kubectl/ are what the real kubectl printed
// against a kind cluster (records 0001 and 0060). Nothing here can prove
// that, the recorder job in CI does. What these tests hold is that the
// committed sets are whole and still fit the scenarios.

const REPO = resolve(import.meta.dir, "../..");
const FIXTURES = join(REPO, "test/fixtures/kubectl");
const VERSIONS = Object.values(FIXTURE_KUBECTL_VERSIONS).sort();

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

describe("the kubectl versions of the fixtures", () => {
  test("the minimum is the adapter's", () => {
    expect(FIXTURE_KUBECTL_VERSIONS.minimum as string).toBe(`v${MINIMUM_VERSION.join(".")}`);
  });

  test("there is one set of fixtures per version", () => {
    expect(directories(FIXTURES)).toEqual(VERSIONS);
  });

  test("the recorder job in CI runs with the same versions, each on a node of its minor", () => {
    const workflow = parse(readFileSync(join(REPO, ".github/workflows/ci.yml"), "utf8"));
    const matrix = workflow.jobs["fixtures-kubectl"].strategy.matrix.include as {
      kubectl: string;
      node: string;
    }[];
    expect(matrix.map((entry) => entry.kubectl).sort()).toEqual(VERSIONS);
    for (const entry of matrix) {
      const minor = entry.kubectl.split(".").slice(0, 2).join(".");
      expect(entry.node).toStartWith(`kindest/node:${minor}.`);
    }
  });
});

for (const version of VERSIONS) {
  describe(`the fixtures of kubectl ${version}`, () => {
    test("hold every scenario and nothing else", () => {
      expect(directories(join(FIXTURES, version))).toEqual(
        KUBECTL_SCENARIOS.map((scenario) => scenario.name).sort(),
      );
    });

    for (const scenario of KUBECTL_SCENARIOS) {
      test(`${scenario.name}: fits the scenario`, () => {
        expect(
          checkRecording(join(FIXTURES, version, scenario.name), scenario, kubectlOps),
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
