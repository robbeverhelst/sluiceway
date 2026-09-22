# The tool's own words stay in the job log, and nothing is masked by guessing

> Amended by 0048: with `scan.logDiff` on, the tool's words in the job log include its own diff, printed with workflow commands stopped.
>
> Amended by 0051: the list for a deploy gains "deploys are turned off in sluiceway.yaml".
>
> Amended by 0056: the list for a deploy gains "a stack it depends on did not deploy".

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

## Settled while building (slice 2.13)

- The fact is the exit code alone: 6, which the tool documents as "the requested stack does not exist, cannot be found, or no stack is selected" (Pulumi docs, CLI exit codes). The tool calls that mapping a stable contract from v3.226.1 on, which is below the minimum of 0001, so no version check is needed for it. A preview always passes `--stack`, so for Sluiceway it means that the backend holds no stack of that name. The recorded `missing-stack` scenario exits with 6 on both supported versions.
- Every other non-zero exit code stays "the tool exited with an error (exit code N)". The tool's stderr and stdout are never read to pick a reason, so a message that says a stack is missing under another exit code is still a tool error, and exit code 6 with any message is the new reason. A test holds both.
- The reason is the constant `the stack does not exist in the backend`. The stack id is not filled in, because the row already starts with it, and the exit code is not either, because the reason already says what it means.
- The summary names the `ignore` glob next to each such stack, as a quoted string that pastes into `sluiceway.yaml` as it is: `create it, or take it off the dashboard with "network:dev" under ignore in sluiceway.yaml`. The glob is built from the stack id, which Sluiceway derived from the repo's files, with every character a glob acts on escaped, so it matches that stack and no other. The row does not name it (later.md).

## Settled while building (slice 2.5)

- The list for a deploy gains four reasons, each a constant string: the preview before the deploy failed (followed by the preview's own reason from the list above), the tool is missing or older than Sluiceway needs, the stack is not in the repo any more, and the deploy stopped before the tool ran. `apply` gives every record it took a result, and each of those ways out needed words. The last one covers a broken `sluiceway.yaml` and an error nobody planned for. The job log says which.
- "The tool exited with an error" on a deploy carries the exit code, as on a preview.
- What `pulumi up` prints without `--json` is the tool's own display: which resources it changes, and its diagnostics. It goes to the job log in a group titled `<stack id>: the deploy`, with ANSI escapes stripped, and nowhere else. `--suppress-outputs` keeps the stack outputs out of it, because an output can be a secret (0021). The recorded deploys on both CLI versions hold neither the canary value nor the secret.
