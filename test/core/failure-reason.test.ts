import { describe, expect, test } from "bun:test";
import { deployFailureText, previewFailureText } from "../../src/core/failure-reason.ts";

// The fixed list of record 0022, in the one form every place shows it: lower
// case and no full stop, as the row of record 0027 reads. Only an exit code and
// a time limit are ever filled in, and both are facts Sluiceway produced itself.

describe("why a preview failed, in Sluiceway's own words", () => {
  test("the tool exited with an error", () => {
    expect(previewFailureText({ kind: "tool-error", exitCode: 255 })).toBe(
      "the tool exited with an error (exit code 255)",
    );
  });

  test("the tool could not be started, or a signal ended it", () => {
    expect(previewFailureText({ kind: "tool-error", exitCode: null })).toBe(
      "the tool exited with an error",
    );
  });

  test("the preview timed out", () => {
    expect(previewFailureText({ kind: "timed-out", minutes: 10 })).toBe(
      "the preview timed out after 10 minutes",
    );
    expect(previewFailureText({ kind: "timed-out", minutes: 1 })).toBe(
      "the preview timed out after 1 minute",
    );
  });

  // Slice 5.38 (record 0103): the file a stack names could not be loaded. A
  // constant string; the path and the line number are detail in the job log.
  test("the stack's env file could not be loaded", () => {
    expect(previewFailureText({ kind: "env-file-not-loaded" })).toBe(
      "the env file of the stack could not be loaded",
    );
  });

  // Record 0022 as amended: a constant string with nothing filled in, not the
  // stack's name and not the exit code the adapter picked it from.
  test("the stack does not exist in the backend", () => {
    expect(previewFailureText({ kind: "stack-not-found" })).toBe(
      "the stack does not exist in the backend",
    );
  });

  // Slice 5.9: four of the tool's documented exit codes, each a constant
  // string with nothing filled in, like the stack that does not exist.
  test("the reasons of the tool's documented exit codes", () => {
    expect(previewFailureText({ kind: "configuration-error" })).toBe(
      "the tool found the configuration invalid or incomplete",
    );
    expect(previewFailureText({ kind: "authentication-error" })).toBe(
      "the tool could not authenticate or is not authorized",
    );
    expect(previewFailureText({ kind: "resource-error" })).toBe(
      "a resource operation failed in the tool",
    );
    expect(previewFailureText({ kind: "tool-timed-out" })).toBe(
      "the tool gave up on a time limit of its own",
    );
  });

  test("the tool printed more than Sluiceway holds", () => {
    expect(previewFailureText({ kind: "output-too-large", megabytes: 128 })).toBe(
      "the tool printed more than the 128 MB Sluiceway holds",
    );
  });

  test("the tool's output could not be read", () => {
    expect(previewFailureText({ kind: "unreadable-output" })).toBe(
      "the tool's output could not be read",
    );
  });

  test("the tool reported a step Sluiceway does not know", () => {
    expect(previewFailureText({ kind: "unknown-step" })).toBe(
      "the tool reported a step Sluiceway does not know",
    );
  });
});

describe("why a deploy failed, in Sluiceway's own words", () => {
  test("the run ended without a result", () => {
    // The wording of the list in record 0022. It fits GitHub's 140 characters
    // for the description of a deployment status.
    expect(deployFailureText({ kind: "run-ended" })).toBe("the run ended without a result");
  });

  test("the change moved since the tick", () => {
    expect(deployFailureText({ kind: "moved" })).toBe("the change moved since the tick");
  });

  test("the tool exited with an error while it deployed", () => {
    expect(deployFailureText({ kind: "tool-error", exitCode: 255 })).toBe(
      "the tool exited with an error (exit code 255)",
    );
    expect(deployFailureText({ kind: "tool-error", exitCode: null })).toBe(
      "the tool exited with an error",
    );
  });

  test("the fresh preview before the deploy failed, with the reason of the preview", () => {
    expect(
      deployFailureText({ kind: "preview-failed", reason: { kind: "timed-out", minutes: 10 } }),
    ).toBe("the preview before the deploy failed: the preview timed out after 10 minutes");
  });

  test("the tool is missing or too old", () => {
    expect(deployFailureText({ kind: "tool-missing" })).toBe(
      "the tool is missing or older than Sluiceway needs",
    );
  });

  test("the stack is not in the repo any more", () => {
    expect(deployFailureText({ kind: "unknown-stack" })).toBe(
      "the stack is not in the repo any more",
    );
  });

  test("deploys are turned off (record 0051)", () => {
    expect(deployFailureText({ kind: "deploys-off" })).toBe(
      "deploys are turned off in sluiceway.yaml",
    );
  });

  test("the deploy stopped before the tool ran", () => {
    expect(deployFailureText({ kind: "not-started" })).toBe(
      "the deploy stopped before the tool ran",
    );
  });

  test("every reason fits GitHub's 140 characters for a status description", () => {
    const longest = deployFailureText({
      kind: "preview-failed",
      reason: { kind: "unknown-step" },
    });
    expect(longest.length).toBeLessThanOrEqual(140);
  });
});

// Record 0110: a reader that draws a row from the markers and the deployment
// records alone holds no reason, so it writes this one and keeps the
// action's sentence. Two constants with nothing filled in, one per list,
// each naming where the reason is.
describe("the reason word for a reason the reader does not hold", () => {
  test("a deploy: the reason is on the deployment record", () => {
    expect(deployFailureText({ kind: "on-record" })).toBe("the reason is on the deployment record");
  });

  test("a preview: the reason is in the summary of the run", () => {
    expect(previewFailureText({ kind: "in-summary" })).toBe(
      "the reason is in the summary of the run",
    );
  });
});
