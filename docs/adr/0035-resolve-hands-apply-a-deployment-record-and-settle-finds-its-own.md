# `resolve` hands `apply` a deployment record, and `settle` finds its own

Records 0003 and 0019 say that `resolve` creates the deployment record and passes it on, and that `apply` deploys only on an open record. No record named the inputs and outputs that carry this through a workflow. The brief's names (`stack`, `expected-hash`, a matrix of `{ stack, environment, expectedHash }`) no longer fit: the approved hash lives on the record (0003), so handing it over a second time would give two sources for one fact. This record fixes the names.

`resolve` has one output, `matrix`: a JSON array with one entry per deploy it started.

```json
[{ "stack": "apps/grafana:prod", "environment": "sluiceway", "deployment": 1234567890 }]
```

`apply` has one input of its own, `deployment-id`. It reads the record and takes everything from it: the stack id from the `task`, the approved hash and the ticker from the payload. `stack` and `environment` are in the matrix entry for the workflow, not for the action: the per stack concurrency group needs the stack id (0006), and the optional job level `environment:` key needs a name (0003, 0020).

A `stack` input on `apply` next to `deployment-id` was rejected. `apply` would have to check that the two agree, and a mismatch could only ever be a mistake in the workflow file. An `expected-hash` input was rejected for the reason above.

`settle` takes no input. It reads the open deployment records whose payload carries the run id of its own workflow run and gives each the result `error` (0003). Handing it the matrix was rejected: a `resolve` that failed after it created a record has no output to hand over, and that is one of the cases `settle` exists for.

The two names the bootstrap chose stay: the `github-token` input, which is also what `pulumi/actions` and most other actions call it, and `preview-timeout` in whole minutes.

## Consequences

- `action.yml` in v1 has five inputs: `mode`, `concurrency`, `preview-timeout`, `github-token`, `deployment-id`. It has one output, `matrix`, which only `resolve` sets.
- `resolve` always sets `matrix`, to `[]` when it started nothing. It sets the output directly after it created the records and before it writes the body, so a failed body write does not lose the hand-off.
- `deployment-id` is required in `apply` mode and an error in every other mode. A record that is not Sluiceway's (its `task` does not start with `sluiceway:`), or whose stack discovery does not know, deploys nothing and the job goes red.
- The `environment` in a matrix entry is the label on the record: the stack's configured environment, else the fixed name `sluiceway` (0003).
- A workflow run has at most 256 matrix jobs. `resolve` starts at most 256 deploys in one run, in stack id order. Ticks beyond that are cleared with the note that asks for a fresh tick (0025).
- The example workflow's groups are `sluiceway-scan`, `sluiceway-resolve` and `sluiceway-apply-<stack id>`. Only the last one uses `queue: max` (0025).
- The `apply` job is green only when the stack deployed. It goes red when the tool failed, when the change moved since the tick (0008), and when the record had already ended (0019). This is the rule of 0012 seen from the other side: a person who opens a green `apply` job must be able to read it as "this went out".
- The `settle` job in the example runs with `if: always()` and only when `resolve` started at least one deploy, so a refused tick or a rescan costs no third runner.
- The per stack time limit of 0012 is the config key `previewTimeout` on a stack's entry, in whole minutes like the input.
- A later `stack` input for a deploy without a tick (`docs/later.md`) stays free, because nothing uses that name now.

## Settled while building (slice 2.4)

- The order of one `resolve` run: the cheap check on the payload, the body and the history in one read, the open deployments of the ticked stacks, the permission lookups, the deployment records as `queued` in stack id order, the `matrix` output, the dispatch for the rescan box, the body write, the comment for refused ticks, and only then a red job.
- `resolve` sets `matrix` on every path, also when it fails before it created a record. The output is then `[]`.
- A failure after the first record does not stop the run. What was started is handed on and shown on the dashboard, and the job goes red at the end with every reason. Creating records is the exception: it stops at the first record that cannot be written, so a missing `deployments: write` costs one request and not 256.
- A red `resolve` job would make GitHub skip `apply`, because a job whose `if:` has no status check is skipped when a job it `needs` failed. Then `settle` would give every record of the run `error`, and the hand-off this record protects would be lost after all. So the `if:` of the example's `apply` job starts with `!cancelled()`. Every entry in `matrix` is a record that `resolve` created after it checked the ticker, so a red `resolve` lets nothing else through.
- A record whose `queued` status could not be written is still handed on. A record without a status is an open deployment (0003), so `apply` takes it.
- The `sha` on a record is `GITHUB_SHA` of the `resolve` job. An `issues` event always runs on the head of the default branch.
- The cheap check reads the payload in two halves. Open, authored by the bot and a root marker on the first line need no config. Only then is `sluiceway.yaml` read for the label. A broken config file therefore never turns an edit of an ordinary issue red.
- `resolve` acts on the issue of its event and lists no issues. A duplicate dashboard can take a tick until the next scan closes it, which 0017 accepts.
- 258 pending rows as a scan writes them do not fit in one issue: the smallest shortened row is about 280 characters and the hard limit is 65,536. The cap of 256 is kept, because a body can also be edited by hand, and it costs nothing.
- The dispatch for the rescan box, and for a body of another version (0009), is `POST /repos/{owner}/{repo}/actions/workflows/{file}/dispatches` with the file and the ref of `GITHUB_WORKFLOW_REF`: this same workflow, on the ref this job runs on. The example's scan job runs for every event that is not `issues`, so the dispatched run is a full scan. Without `actions: write` GitHub answers 403, and the job goes red with a message that names the permission.

## Settled while building (slice 2.6)

- `settle` reads the page of the newest records of every environment name its stacks use, and gives `error` to every record of Sluiceway's whose payload names its own run and that has no result yet. Each record is judged on its own, so it does not have to be the newest of its stack. It never asks whether a run is over: its own run is not, and the `apply` jobs it `needs` are. Every other record is left alone, an open record of another run whose run is over too. That one is ended by the next render, as 0003 says.
- The reason is `the run ended without a result` from the fixed list (0022), and the `log_url` is the run, which is both the run of the deploy and the run of `settle`.
- The REST fall back of 0003 runs only when an environment holds more than its page, which happens when a hundred deploys went out while one of this run waited on a reviewer. Only then is the live dashboard read, the issue of the run's event, and the fall back asks for the stacks whose row says deploying or is still ticked (a `resolve` whose body write failed). A run with nothing open costs one request per environment name and writes nothing.
- `settle` writes no row. It runs no tool (0014), so it has no diff, and none of the row forms of 0027 fits a stack whose change is unknown. When it ended at least one record it starts a full scan by dispatching this same workflow on this same ref, the way `resolve` does for the rescan box. That scan meets a deploying row with no open deployment, previews the stack and writes its row with the failure line (0004, slice 2.1). This amends 0004 and 0009, which list `settle` among the writers that swap rows. The `settle` job needs `actions: write`, which the example gives the whole workflow.
- It stops at the first status it cannot write, as `resolve` stops at the first record, and the job goes red naming `deployments: write`. A scan it cannot start turns the job red after the records are ended, naming `actions: write`. Otherwise the job is green, also when it ended records: the red job of that deploy is `apply`'s, or the run was cancelled.
