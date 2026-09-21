import { describe, expect, test } from "bun:test";
import { readScanInputs, readToken } from "../../src/github/inputs.ts";

// The inputs of scan mode (build plan, section 3). GitHub hands every input
// over as text, and an input that action.yml gives a default is never empty
// unless the workflow made it so.
function inputs(values: Record<string, string>) {
  return readScanInputs((name) => values[name] ?? "");
}

const GOOD = { concurrency: "4", "preview-timeout": "10", "github-token": "ghs_token" };

describe("the inputs of a scan", () => {
  test("reads the pool size, the time limit and the token", () => {
    expect(inputs(GOOD)).toEqual({ concurrency: 4, previewTimeoutMinutes: 10, token: "ghs_token" });
  });

  test("takes white space around a number", () => {
    expect(inputs({ ...GOOD, concurrency: " 8\n" }).concurrency).toBe(8);
  });

  test.each(["0", "-2", "1.5", "four", "", "4 stacks", "1e2", "0x10"])(
    "refuses a concurrency of %p",
    (value) => {
      expect(() => inputs({ ...GOOD, concurrency: value })).toThrow(
        `The "concurrency" input must be a whole number of 1 or more, and it is ${JSON.stringify(value.trim())}.`,
      );
    },
  );

  test.each(["0", "2.5", "ten"])("refuses a preview-timeout of %p", (value) => {
    expect(() => inputs({ ...GOOD, "preview-timeout": value })).toThrow(
      `The "preview-timeout" input must be a whole number of 1 or more, and it is ${JSON.stringify(value)}. It is a number of whole minutes.`,
    );
  });

  test("refuses an empty token, and says which token it wants", () => {
    expect(() => inputs({ ...GOOD, "github-token": "" })).toThrow(
      'The "github-token" input is empty. Leave it out of the workflow, so it takes the GITHUB_TOKEN of the run.',
    );
  });
});

// `resolve` reads one input, the token. It has no pool and starts no preview.
describe("the token, for a mode that reads nothing else", () => {
  test("is read without the inputs of a scan", () => {
    expect(readToken((name) => (name === "github-token" ? "ghs_token" : ""))).toBe("ghs_token");
  });

  test("an empty token is refused with the same words", () => {
    expect(() => readToken(() => "")).toThrow(
      'The "github-token" input is empty. Leave it out of the workflow, so it takes the GITHUB_TOKEN of the run.',
    );
  });
});
