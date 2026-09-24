import { describe, expect, test } from "bun:test";
import { readEnvFileInput, unusedEnvFileInput } from "../../src/github/inputs.ts";

// Slice 5.35 (record 0100): the `env-file` input names one file of the
// checkout, read for the tool's process by the modes that run the tool.

function inputs(table: Record<string, string>) {
  return (name: string) => table[name] ?? "";
}

describe("the env-file input", () => {
  test("is the path it names, with the white space around it gone", () => {
    expect(readEnvFileInput(inputs({ "env-file": " ci/deploy.env\n" }))).toBe("ci/deploy.env");
  });

  test("is nothing when it is left out or empty", () => {
    expect(readEnvFileInput(inputs({}))).toBeUndefined();
    expect(readEnvFileInput(inputs({ "env-file": "  " }))).toBeUndefined();
  });

  test("names one file, so a list is refused", () => {
    expect(() => readEnvFileInput(inputs({ "env-file": "ci/a.env\nci/b.env" }))).toThrow(
      'The "env-file" input names one file, and it holds more than one line. To load several files, join them in a step before Sluiceway.',
    );
  });
});

// Only the modes that run the tool read the file (record 0014, promise 4):
// scan and apply, auto which runs them, and the check with backend: true.
// Anywhere else it is a warning, and the file is never opened.
describe("the modes that never open it", () => {
  const set = inputs({ "env-file": "ci/deploy.env" });

  test("scan, apply and auto use it, and so does the check with backend: true", () => {
    for (const mode of ["scan", "apply", "auto"])
      expect(unusedEnvFileInput(mode, set)).toBeUndefined();
    expect(
      unusedEnvFileInput("check", inputs({ "env-file": "ci/deploy.env", backend: "true" })),
    ).toBeUndefined();
    // The pull request preview runs the tool too (record 0101).
    expect(
      unusedEnvFileInput(
        "check",
        inputs({ "env-file": "ci/deploy.env", "pull-request-preview": "true" }),
      ),
    ).toBeUndefined();
  });

  test("resolve, settle and init get a warning that names the modes that do", () => {
    for (const mode of ["resolve", "settle", "init"]) {
      expect(unusedEnvFileInput(mode, set)).toBe(
        `"env-file" is set on a step in ${mode} mode, which never runs the tool, so the file is not read. Only scan, apply and the check with backend: true or pull-request-preview: true do. Take it out of this step.`,
      );
    }
  });

  test("the check without backend: true gets one too", () => {
    expect(unusedEnvFileInput("check", set)).toBe(
      '"env-file" is set on a step in check mode without backend: true or pull-request-preview: true, which never runs the tool, so the file is not read. Only scan, apply and the check with backend: true or pull-request-preview: true do. Take it out of this step.',
    );
  });

  test("no warning when the input is not set", () => {
    for (const mode of ["resolve", "settle", "init", "check"]) {
      expect(unusedEnvFileInput(mode, inputs({}))).toBeUndefined();
    }
  });
});
