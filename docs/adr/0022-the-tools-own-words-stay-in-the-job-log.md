# The tool's own words stay in the job log, and nothing is masked by guessing

Record 0021 keeps values out of the diff. The other way a value can reach the dashboard is free text: an error from the tool can quote a connection string, a rendered config file or a provider's request body. So text that the tool wrote never leaves the job log. The issue body, comments, deployment records and job summaries carry only words that Sluiceway wrote itself.

A short excerpt of the tool's error on the row, run through a token pattern mask, was rejected. It is more helpful at a glance, but a pattern mask is a guess, and a miss lands in an issue that is emailed and kept in edit history.

The brief also asks to "mask anything that looks like a token in captured tool output". That mask is dropped. Safety here comes from what is never written, not from guessing what a secret looks like. A guess-based mask catches some token formats, misses the rest, needs upkeep, and reads as a promise we cannot keep. That is the same reasoning as 0014: a false security claim is worse than none.

## Consequences

- Every failure shown outside the job log is a reason from a short fixed list in Sluiceway's code, plus a link to the run. The v1 list for a preview: the tool exited with an error, the preview timed out (0012), the tool's output could not be read, the tool reported a step Sluiceway does not know (0007). For a deploy: the change moved since the tick (0008), the tool exited with an error, the run ended without a result (settle, 0003).
- A reason is a constant string. The only things filled into it are facts Sluiceway produced itself: an exit code, a time limit, a stack id, a run link. Never a substring of tool output, never a path or message taken from a diagnostic.
- The "short failure reason" on a deployment status (0003) and the failure line on a row come from this list. So does the warning annotation on the run for a preview failure (0012), because annotations show on the run's summary page.
- The tool's stderr and its diagnostics go to the job log as they are, grouped per stack, with ANSI escapes stripped. The job log is the one place for them: GitHub masks every registered secret there, logs expire with the run, and they are never emailed. The row links to the run, so the detail is one click away.
- Sluiceway adds no masking of its own to the log and does not register masks. Secrets that the workflow loads are masked by the loading step, which is the user's (0013 and the secret manager findings). The docs repeat that rule: whatever loads secrets into the job must register them with `::add-mask::`.
- Sluiceway's own log lines follow 0021: no raw tool JSON, no values, no environment (0014).
- The list of reasons can grow without breaking anything. A reason is display text and nothing is decided from it.

## Amended, 2026-09-21

The fixed list for a preview gains one reason: the stack does not exist in the backend. The first real scan showed seven such rows as "the tool exited with an error (exit code 6)", which sent the user to the job log to learn that they had a stack config file for a stack they never created (onboarding log, hurdle 9). The reason is still a constant string chosen by Sluiceway. It is picked from facts the adapter can establish without quoting the tool, and slice 2.13 settles which: the exit code the tool documents for a missing stack, checked against the recorded `missing-stack` fixtures on both supported versions.
