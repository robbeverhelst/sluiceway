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

  // Record 0022 as amended: a constant string with nothing filled in, not the
  // stack's name and not the exit code the adapter picked it from.
  test("the stack does not exist in the backend", () => {
    expect(previewFailureText({ kind: "stack-not-found" })).toBe(
      "the stack does not exist in the backend",
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
});
