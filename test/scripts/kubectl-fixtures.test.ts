import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import {
  KUBECTL_SCENARIOS,
  kubectlOps,
  racedWrite,
} from "../../scripts/fixtures/kubectl-scenarios.ts";
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

// Cut from what kubectl v1.37.0 printed for no-changes in CI run 35845121031
// (issue 207): the Deployment controller wrote the status of web between
// kubectl's read of the live object and the server-side dry run, so the two
// sides are two versions of the object and the diff is not empty.
const RACED = `diff -N -U1000000 /tmp/LIVE-2700576233/apps.v1.Deployment.sluiceway-example.web /tmp/MERGED-1153014565/apps.v1.Deployment.sluiceway-example.web
--- /tmp/LIVE-2700576233/apps.v1.Deployment.sluiceway-example.web	2026-09-23 09:51:03.740908034 +0000
+++ /tmp/MERGED-1153014565/apps.v1.Deployment.sluiceway-example.web	2026-09-23 09:51:03.740908034 +0000
@@ -1,12 +1,12 @@
 apiVersion: apps/v1
 kind: Deployment
 metadata:
   generation: 1
   name: web
   namespace: sluiceway-example
-  resourceVersion: "561"
+  resourceVersion: "572"
 status:
   observedGeneration: 1
+  replicas: 1
   unavailableReplicas: 1
+  updatedReplicas: 1
`;

// Made up: an object only on the merged side, and one only on the live side.
const CREATE = `diff -N -U1000000 /tmp/LIVE-1/v1.ConfigMap.sluiceway-example.extra /tmp/MERGED-1/v1.ConfigMap.sluiceway-example.extra
--- /tmp/LIVE-1/v1.ConfigMap.sluiceway-example.extra
+++ /tmp/MERGED-1/v1.ConfigMap.sluiceway-example.extra
@@ -0,0 +1,4 @@
+apiVersion: v1
+kind: ConfigMap
+metadata:
+  resourceVersion: "7"
`;
const GONE = `diff -N -U1000000 /tmp/LIVE-1/v1.ConfigMap.sluiceway-example.old /tmp/MERGED-1/v1.ConfigMap.sluiceway-example.old
--- /tmp/LIVE-1/v1.ConfigMap.sluiceway-example.old
+++ /tmp/MERGED-1/v1.ConfigMap.sluiceway-example.old
@@ -1,4 +0,0 @@
-apiVersion: v1
-kind: ConfigMap
-metadata:
-  resourceVersion: "5"
`;

const DIFF_OUTPUTS = new Set(["diff", "text"]);

describe("a kubectl diff that raced a write (slice 5.26)", () => {
  test("two versions of one object on the two sides are a race", () => {
    expect(racedWrite(RACED)).toBe(true);
  });

  test("a race in the second object of a diff is found too", () => {
    expect(racedWrite(CREATE + RACED)).toBe(true);
  });

  test("no output, a create and an update of one version are not", () => {
    expect(racedWrite("")).toBe(false);
    expect(racedWrite(CREATE)).toBe(false);
    for (const scenario of ["new-stack", "update"]) {
      const stdout = readFileSync(join(FIXTURES, "v1.37.0", scenario, "diff.stdout"), "utf8");
      expect([scenario, racedWrite(stdout)]).toEqual([scenario, false]);
    }
  });

  test("the version of one object on the live side and of another on the merged side is not", () => {
    expect(racedWrite(GONE + CREATE)).toBe(false);
  });

  test("every recorded kubectl diff is taken again when it raced", () => {
    for (const scenario of KUBECTL_SCENARIOS) {
      for (const step of scenario.steps) {
        if (step.kind !== "record" || step.argv[1] !== "diff") continue;
        expect([scenario.name, step.id, step.raced]).toEqual([scenario.name, step.id, racedWrite]);
      }
    }
  });
});

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

      // A diff that raced a write compares two versions of an object, and
      // would hold the controller's status as a change (slice 5.26).
      test(`${scenario.name}: no diff raced a write`, () => {
        const file = join(FIXTURES, version, scenario.name, RECORDING_FILE);
        const recording = JSON.parse(readFileSync(file, "utf8")) as Recording;
        for (const command of recording.commands) {
          if (command.argv[1] !== "diff" || !DIFF_OUTPUTS.has(command.stdoutFormat)) continue;
          const stdout = readFileSync(
            join(FIXTURES, version, scenario.name, command.stdout),
            "utf8",
          );
          expect([command.id, racedWrite(stdout)]).toEqual([command.id, false]);
        }
      });

      // Recorded on a CI runner. Any other home directory means a laptop
      // recording got in.
      test(`${scenario.name}: names nobody's home directory`, () => {
        expect(savedOutput(version, scenario.name)).not.toMatch(/\/Users\/|\/home\/(?!runner\/)/);
      });
    }
  });
}
