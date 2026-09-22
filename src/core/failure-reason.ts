// Why a preview failed, from the short fixed list of record 0022. Only facts
// that Sluiceway produced itself are filled in: an exit code, a time limit.
// Never a word the tool wrote.
export type PreviewFailureReason =
  // exitCode is null when the tool could not be started or a signal ended it.
  | { kind: "tool-error"; exitCode: number | null }
  // The stack has files in the repo and the backend holds no stack of that
  // name (record 0022 as amended). The adapter picks it from a fact of its
  // own, never from the tool's message.
  | { kind: "stack-not-found" }
  | { kind: "timed-out"; minutes: number }
  | { kind: "unreadable-output" }
  | { kind: "unknown-step" };

// The reason as a row, the summary, an annotation or a deployment status shows
// it. One form for all of them: lower case and no full stop, the wording of
// the list in record 0022, so it reads on after "preview failed:" on a row
// (record 0027). A place that wants a sentence builds one around it. Display
// text only: nothing is ever decided from it.
export function previewFailureText(reason: PreviewFailureReason): string {
  switch (reason.kind) {
    case "tool-error":
      return reason.exitCode === null
        ? "the tool exited with an error"
        : `the tool exited with an error (exit code ${reason.exitCode})`;
    case "stack-not-found":
      return "the stack does not exist in the backend";
    case "timed-out":
      return `the preview timed out after ${reason.minutes} ${reason.minutes === 1 ? "minute" : "minutes"}`;
    case "unreadable-output":
      return "the tool's output could not be read";
    case "unknown-step":
      return "the tool reported a step Sluiceway does not know";
  }
}

// Why a deploy failed, from the same fixed list (record 0022). It goes on the
// final status of the deployment record and from there on the failure line.
export type DeployFailureReason =
  // The workflow run of the deploy is over and the record never got a result
  // (record 0003).
  | { kind: "run-ended" }
  // The fresh preview of `apply` gave another diff hash than the tick
  // approved (record 0008). The record ends as `error`.
  | { kind: "moved" }
  // The deploy itself failed. exitCode is null when the tool could not be
  // started or a signal ended it.
  | { kind: "tool-error"; exitCode: number | null }
  // The fresh preview gave no diff, so there was nothing to compare.
  | { kind: "preview-failed"; reason: PreviewFailureReason }
  // The version check failed (record 0001).
  | { kind: "tool-missing" }
  // Discovery does not know the stack of the record (record 0035).
  | { kind: "unknown-stack" }
  // `deploys: false` in sluiceway.yaml (record 0051). `apply` checks it
  // before the tool runs.
  | { kind: "deploys-off" }
  // A queued record whose dependency did not go out (record 0056). It never
  // reached `apply`.
  | { kind: "upstream-failed" }
  // Anything else that stopped `apply` before the tool ran, such as a
  // broken `sluiceway.yaml`. The job log says what.
  | { kind: "not-started" };

export function deployFailureText(reason: DeployFailureReason): string {
  switch (reason.kind) {
    case "run-ended":
      return "the run ended without a result";
    case "moved":
      return "the change moved since the tick";
    case "tool-error":
      return reason.exitCode === null
        ? "the tool exited with an error"
        : `the tool exited with an error (exit code ${reason.exitCode})`;
    case "preview-failed":
      return `the preview before the deploy failed: ${previewFailureText(reason.reason)}`;
    case "tool-missing":
      return "the tool is missing or older than Sluiceway needs";
    case "unknown-stack":
      return "the stack is not in the repo any more";
    case "deploys-off":
      return "deploys are turned off in sluiceway.yaml";
    case "not-started":
      return "the deploy stopped before the tool ran";
    case "upstream-failed":
      return "a stack it depends on did not deploy";
  }
}
