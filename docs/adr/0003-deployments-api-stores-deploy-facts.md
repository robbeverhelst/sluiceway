# Deploy facts live in GitHub's Deployments API

> Named in 0035: the matrix that `resolve` emits is the `matrix` output with `{ stack, environment, deployment }` entries, `apply` takes the record as `deployment-id`, and `settle` finds the open records of its own run.
>
> Amended by 0051: an `inactive` status with the words "rehearsed, nothing was deployed" ends a rehearsal. It is no deploy fact of the stack and is listed in recently deployed as rehearsed. A `success` with the words "nothing to deploy, already in sync" is listed with them.
>
> Amended by 0056: a queued record carries `behind` in its payload and is not ended because its run is over, only when a stack it waits behind did not go out. It starts under a new record of a later run, and the queued one ends as `inactive` with "started in a later run", which is no deploy fact.

A preview can recompute what is pending, but not that a deploy is running, how the last one ended, or who ticked it. Those deploy facts are stored as GitHub deployment records that Sluiceway creates and reads back, and nowhere else. Markers in the issue body were rejected because any writer or hand edit can clobber them and the issue must stay a rendered view. Workflow run queries were rejected because a run is not tied to a stack and records neither the ticker nor the approved hash. GitHub is the database, so "zero backend" still holds.

## Consequences

- One record per deploy attempt of one stack, tagged `task: sluiceway:<stackId>`. The payload is versioned (`v: 1`) and carries the approved hash, the ticker and the run id. The run link and a short failure reason go on the final status. The reason comes from Sluiceway's own fixed list, never from the tool's output (0022). Sluiceway only ever reads records whose task starts with `sluiceway:`.
- `resolve` creates the record with status `queued` before it emits the matrix, not `apply`. Otherwise nothing durable says "this stack is taken" between the tick and the apply job starting, which can be hours on self-hosted runners. `apply` sets `in_progress`, then `success`, `failure`, or `error` when the hash moved.
- In every mode, a stack whose latest record is `queued` or `in_progress` renders as deploying with no checkbox, whatever the preview says. A second tick for that stack is dropped.
- A record is never ended by a timeout, because a job can wait on a reviewer for days. Liveness is tied to the workflow run: any render that meets an open deployment whose run has completed writes `error` ("the run ended without reporting a result"). A `settle` job (`needs: apply`, `if: always()`) does the same within seconds of a cancel or a rejection. This adds a fourth mode.
- Statuses are written with `auto_inactive: false`, and `inactive` is read as "succeeded, then superseded". Without this, one stack succeeding would flip the latest status of every other stack in the same environment.
- The environment on a record is only a label: the stack's configured environment, else the fixed name `sluiceway`. The record does not depend on the GitHub Environments feature, which is plan-gated on private repos. The job-level `environment:` key is optional and, where used, set with `deployment: false` so GitHub does not create a second record. Users of custom deployment protection rules cannot use `deployment: false` and will see a duplicate record with `task: deploy`, which Sluiceway ignores.
- The record carries the default-branch head SHA that `resolve` and `apply` run on, with `auto_merge: false` and `required_contexts: []`. "Commits since the last successful deploy of this stack" is the range from that SHA to HEAD.
- Reads are bounded: one GraphQL page of the newest deployments per environment name, then one REST call filtered by `task` for any pending stack not on that page. In-sync stacks need no lookup. "Recently deployed" is the newest successful records on the same page.
- Only the latest status of a record survives 90 days. Nothing the dashboard needs sits in the pruned history.
- The workflow needs `deployments: write` and `actions: read` (already covered by `actions: write`).

## Settled while building (slice 2.1)

- The REST fall back is two requests for a stack that has a record, not one: GitHub's REST list of deployments gives a record without its status, so the latest status is a request of its own. A stack without any record costs one. GraphQL has no filter on `task`, which is why the fall back is REST at all.
- A page that is not full holds every record of its environment, so a stack that is not on it has no record and needs no fall back. The fall back runs only when GitHub says the environment holds more than the page, and then for a pending stack and for a stack whose live row says deploying. The second is needed so that a deploying row is never taken for one that outlived its record.
- GraphQL gives `payload` as a string that holds the JSON text of a JSON string, so it is encoded twice, and gives `null` for an empty payload. REST gives the payload as JSON. The port reads both into the same value. Seen in the lab repo on 2026-09-21.
- A record whose payload is not `v: 1`, or misses a fact, is not read at all. The `run` in a payload must be a run id in digits, so no request and no link is built from text a person typed.
- A record with no status yet, or with a state that is no result, is an open deployment. Results are `success`, `inactive`, `failure` and `error`. So a stack that may be deploying never gets a box, also in a state GitHub adds later.
- The run links on the dashboard are built from the `run` in the payload, not read from the status, because the status GitHub writes for `inactive` has no link.
- The reason on a settled record is `the run ended without a result`, the wording of the list in 0022. Its `log_url` is the run of the deploy.
- A run that GitHub does not have any more (404) counts as over. Any other failure to read a run or a record fails the scan with GitHub's words and the permissions it needs, as every other API error does (slice 1.10).
- The scan job now needs `deployments: write` and `actions: read` too, because every scan does the late read. The scan-only workflow in the README has them.

## Settled while building (slice 2.22)

- A success fact keeps the hash from the payload of its record. When the newest record of a pending stack is a deploy that went out (`success` or `inactive`, not "nothing to deploy, already in sync", not a rehearsal) with the diff hash the fresh row has, the row gets the pending-again line (onboarding log, hurdle 21). The line decides nothing, and the scan reads no record for it that it did not already read.

Research: https://github.com/sluiceway/sluiceway/blob/research/github-actions-behaviors/docs/research/github-actions-behaviors.md
