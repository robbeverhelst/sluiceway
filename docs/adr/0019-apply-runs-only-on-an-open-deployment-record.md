# Apply runs only on an open deployment record, so a fresh tick is the only retry

> Amended by 0025: a re-run of the whole workflow is still harmless, but for a simpler reason. `resolve` takes nothing from the replayed event. It reads the body as it is now and finds nothing to do, or finds a real tick and handles it like any other run.

GitHub lets anyone with write access press "Re-run failed jobs" on a workflow run. That runs the `apply` job again with its old inputs and skips `resolve`, and with it the whole authorization of 0018. On a stack whose tick rule is `admin`, a collaborator with write access could deploy it by re-running an admin's failed deploy. The hash check would still hold them to what the admin approved, but the rule would have a way around it, and the deployment record would name the wrong ticker.

So `apply` deploys only when the deployment record it was handed is still open. `resolve` creates the record as `queued` and passes it on (0003). On a first attempt `apply` finds it open and goes ahead. On a re-run the record already has a result, `failure` from the first attempt or `error` from `settle`, and `apply` deploys nothing. It says so in the log and the job summary ("This deploy already ended. Tick the box on the dashboard to try again.") and the job goes red, so nobody reads it as a deploy that worked.

Checking the permission of the person who pressed re-run was rejected. GitHub does name them (`triggering_actor`), but `apply` would then need the authorization logic too, the record would name a ticker who did not start this attempt, and there would be two ways to start a deploy. One rule is easier to defend: every deploy starts from a tick by a named person who was checked at that moment.

## Consequences

- A retry is a fresh tick: a new permission check, a fresh hash, a new record with the right ticker. The failure line on the row already points there (0003, 0004).
- Re-running the whole workflow is harmless without any new code. `resolve` replays the old event, finds the row no longer ticked in the live body, and emits nothing (0005).
- `apply` reads its record before it previews, so a refused re-run costs one API call and never touches the tool or its credentials.
- The re-run button that people know from CI does not retry a deploy. The message in the summary is the whole mitigation, and the docs say it once where failures are explained.
- The check also covers a record that `settle` closed after a cancel. A cancelled deploy cannot be brought back by a re-run either.

## Settled while building (slice 2.5)

- "Open" is the rule of 0003 as the scan reads it: no status yet, or any state that is no result. `success`, `inactive`, `failure` and `error` are results. So a record `settle` ended, and one another writer superseded, are refused too.
- The refusal reads the latest status only, which REST gives in one request. The record itself is read after that, so a re-run costs one request, as this record says.
- The summary of a refused re-run is the sentence above and nothing else. The record was read and nothing more, so there is no stack to name.
