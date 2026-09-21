import { describe, expect, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { readScanInputs } from "../src/github/inputs.ts";
import { MODES } from "../src/mode.ts";

const ROOT = resolve(import.meta.dir, "..");

type ActionMetadata = {
  inputs: Record<string, { description: string; required?: boolean; default?: string }>;
  runs: { using: string; main: string };
};

const action = Bun.YAML.parse(await Bun.file(resolve(ROOT, "action.yml")).text()) as ActionMetadata;

describe("action.yml", () => {
  test("runs the committed bundle on node24", () => {
    expect(action.runs.using).toBe("node24");
    expect(existsSync(resolve(ROOT, action.runs.main))).toBe(true);
  });

  // The line of the build plan, section 5. Growing past it is a question for
  // the owner, so CI fails here first. The dist check holds the committed
  // bundle to the source, so this is the size of what the source builds.
  test("the committed bundle stays under 3 MB", () => {
    expect(statSync(resolve(ROOT, action.runs.main)).size).toBeLessThanOrEqual(3_000_000);
  });

  test("the defaults of the scan inputs are the ones of the build plan, and the scan can read them", () => {
    const defaults = (name: string) => action.inputs[name]?.default ?? "";
    expect(readScanInputs((name) => (name === "github-token" ? "token" : defaults(name)))).toEqual({
      concurrency: 4,
      previewTimeoutMinutes: 10,
      token: "token",
    });
  });

  test("requires the mode input and names every mode", () => {
    expect(action.inputs.mode?.required).toBe(true);
    for (const mode of MODES) {
      expect(action.inputs.mode?.description).toContain(mode);
    }
  });

  test("declares only the inputs the decision records fix", () => {
    expect(Object.keys(action.inputs).sort()).toEqual([
      "concurrency",
      "github-token",
      "mode",
      "preview-timeout",
    ]);
  });
});
