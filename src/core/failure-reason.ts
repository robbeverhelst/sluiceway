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
// The reasons of `apply` join with the slice that builds it.
export type DeployFailureReason =
  // The workflow run of the deploy is over and the record never got a result
  // (record 0003).
  { kind: "run-ended" };

export function deployFailureText(reason: DeployFailureReason): string {
  switch (reason.kind) {
    case "run-ended":
      return "the run ended without a result";
  }
}
