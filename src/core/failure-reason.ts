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
  // Four more of the tool's documented exit codes, picked the same way from
  // the exit code alone (slice 5.9): 2, 3, 4 and 9 for Pulumi.
  | { kind: "configuration-error" }
  | { kind: "authentication-error" }
  | { kind: "resource-error" }
  | { kind: "tool-timed-out" }
  | { kind: "timed-out"; minutes: number }
  | { kind: "unreadable-output" }
  // The tool printed more than the process runner holds in memory, so its
  // output is not whole (slice 5.9).
  | { kind: "output-too-large"; megabytes: number }
  | { kind: "unknown-step" }
  // An error thrown past the adapter: a bug of Sluiceway's own (slice 5.9).
  // The row says so, and the job still goes red.
  | { kind: "internal-error" }
  // The env file the stack's entry names could not be loaded (record 0103):
  // it is not there, or a line of it is refused. The tool never ran for the
  // stack, and the job log has the path and the line number.
  | { kind: "env-file-not-loaded" }
  // Not a way a preview fails: the word a reader outside Sluiceway writes
  // when it draws a preview failure row from the markers alone and holds no
  // reason (record 0110). The reason is in the summary of the run, and in
  // the result file. The scan never writes it.
  | { kind: "in-summary" };

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
    case "configuration-error":
      return "the tool found the configuration invalid or incomplete";
    case "authentication-error":
      return "the tool could not authenticate or is not authorized";
    case "resource-error":
      return "a resource operation failed in the tool";
    case "tool-timed-out":
      return "the tool gave up on a time limit of its own";
    case "timed-out":
      return `the preview timed out after ${reason.minutes} ${reason.minutes === 1 ? "minute" : "minutes"}`;
    case "unreadable-output":
      return "the tool's output could not be read";
    case "unknown-step":
      return "the tool reported a step Sluiceway does not know";
    case "output-too-large":
      return `the tool printed more than the ${reason.megabytes} MB Sluiceway holds`;
    case "internal-error":
      return "Sluiceway failed inside itself, which is a bug";
    case "env-file-not-loaded":
      return "the env file of the stack could not be loaded";
    case "in-summary":
      return "the reason is in the summary of the run";
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
  // The fresh preview gave the diff hash the tick approved and another value
  // fingerprint (record 0102): a value the row does not show changed since
  // the tick. `everyRun`: the dashboard's last scan was of this same commit,
  // so the value differs between two previews of the same code. The record
  // ends as `error`.
  | { kind: "value-changed"; everyRun: boolean }
  // The deploy itself failed. exitCode is null when the tool could not be
  // started or a signal ended it.
  | { kind: "tool-error"; exitCode: number | null }
  // The deploy ran out of the `deploy-timeout` input and the tool was
  // stopped (slice 5.9). The stack may be half deployed.
  | { kind: "timed-out"; minutes: number }
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
  | { kind: "dependency-failed" }
  // Anything else that stopped `apply` before the tool ran, such as a
  // broken `sluiceway.yaml`. The job log says what.
  | { kind: "not-started" }
  // Not a way a deploy fails: the word a reader outside Sluiceway writes
  // when it draws a failure line from the markers and the deployment records
  // and holds no reason, because the description of a status is not part of
  // the published shape (records 0096 and 0110). `apply` never writes it.
  | { kind: "on-record" };

export function deployFailureText(reason: DeployFailureReason): string {
  switch (reason.kind) {
    case "run-ended":
      return "the run ended without a result";
    case "moved":
      return "the change moved since the tick";
    case "value-changed":
      return reason.everyRun
        ? "a value changed since the tick with no new commit, so it may differ on every run: see valueFingerprint in sluiceway.yaml"
        : "a value changed since the tick";
    case "tool-error":
      return reason.exitCode === null
        ? "the tool exited with an error"
        : `the tool exited with an error (exit code ${reason.exitCode})`;
    case "timed-out":
      return `the deploy ran out of its time limit of ${reason.minutes} ${reason.minutes === 1 ? "minute" : "minutes"} and the tool was stopped`;
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
    case "dependency-failed":
      return "a stack it depends on did not deploy";
    case "on-record":
      return "the reason is on the deployment record";
  }
}
