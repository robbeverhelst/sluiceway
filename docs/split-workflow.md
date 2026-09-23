# The split workflow

This page is the loop of [the workflow](workflow.md#the-workflow) as four jobs, one per mode, joined with `if:` and `needs:`.

The workflow is one job with one Sluiceway step that reads the event and does what it asks for. The split workflow is longer and has more to keep right, and the [check](workflow.md#check-your-setup) reads every part of it. Use it only for what one job cannot do ([what one job gives up](workflow.md#what-one-job-gives-up)):

- **Credentials that only read for the scan**, and the ones that write only in the deploy job.
- **A GitHub Environment per stack**, with required reviewers who approve each deploy.
- **The job an issue edit starts holds no credentials** and never runs the tool, so it can stay on a hosted runner while previews and deploys run on your own, and an edit of an ordinary issue starts no runner at all.
- **Deploys side by side**, one job per ticked stack.

Every Sluiceway step here names its mode. It uses the action at `@v0` ([Pin a commit](workflow.md#pin-a-commit)).

```yaml
name: deploy-dashboard

on:
  push:
    branches: [main]
  schedule:
    - cron: "0 6 * * *" # keep this: a push previews only some stacks, this scan all
  workflow_dispatch:
  issues:
    types: [edited]

# This block is everything Sluiceway can do in your repo.
permissions:
  contents: read
  issues: write
  deployments: write
  actions: write
  pull-requests: read
  checks: write

jobs:
  scan:
    if: github.event_name != 'issues'
    runs-on: ubuntu-latest
    concurrency: sluiceway-scan
    steps:
      - uses: actions/checkout@v7
      - uses: pulumi/actions@v7 # without a command this only installs the CLI
        with:
          pulumi-version: ^3.229.0
      # Install what your programs need, once, for example: npm ci
      # Load your credentials and your state backend settings into the job
      # environment here. Sluiceway passes the environment to the tool and
      # never looks inside. Whatever loads a secret must also mask it.
      - uses: sluiceway/sluiceway@v0
        with:
          mode: scan

  resolve:
    if: github.event_name == 'workflow_dispatch' || (github.event_name == 'issues' && contains(github.event.issue.labels.*.name, 'sluiceway'))
    runs-on: ubuntu-latest
    concurrency: sluiceway-resolve
    outputs:
      matrix: ${{ steps.resolve.outputs.matrix }}
    steps:
      - uses: actions/checkout@v7
      # No tool and no credentials in this job. It never runs the tool.
      - id: resolve
        uses: sluiceway/sluiceway@v0
        with:
          mode: resolve

  apply:
    needs: resolve
    if: ${{ !cancelled() && needs.resolve.outputs.matrix != '' && needs.resolve.outputs.matrix != '[]' }}
    strategy:
      fail-fast: false
      matrix:
        include: ${{ fromJson(needs.resolve.outputs.matrix) }}
    runs-on: ubuntu-latest
    concurrency:
      group: sluiceway-apply-${{ matrix.stack }}
      queue: max
    steps:
      - uses: actions/checkout@v7
      - uses: pulumi/actions@v7
        with:
          pulumi-version: ^3.229.0
      # Same install and credential steps as in the scan job. These
      # credentials must be able to change things.
      - uses: sluiceway/sluiceway@v0
        with:
          mode: apply
          deployment-id: ${{ matrix.deployment }}

  settle:
    needs: [resolve, apply]
    if: always() && needs.resolve.outputs.matrix != '' && needs.resolve.outputs.matrix != '[]'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: sluiceway/sluiceway@v0
        with:
          mode: settle
```

What the parts are for:

- **All four jobs stay in one file.** A scan looks for waiting ticks among the runs of its own workflow, and the rescan box and `settle` start a scan by starting that same workflow again. Name the file as you like, and keep the name different from `sluiceway.yaml`.
- **Every Sluiceway step names its mode.** A step without one is auto mode, which would do the work of all four jobs in one.
- **The daily schedule stays.** A push previews only the stacks that claim a changed file. A program can read something that is not a file in the repo (another stack's output, a remote chart, a secret), and the daily full scan is what catches that.
- **Never add `pull_request` or `merge_group` to this workflow.** A scan writes the dashboard from the code it checked out, and on a pull request or in a merge queue that is code that is not on the default branch yet. A merge queue ends in a push to the default branch, and the scan runs on that push.
- **`actions: write`** lets the rescan box and `settle` start a scan, and lets a scan see whether a run is still on its way. `id-token: write` is not in the block. Add it only to the jobs that run the tool, and only if your credential step uses OIDC. A job's own `permissions:` replace the workflow's, so repeat the whole block there.
- **`sluiceway-scan`** makes scans run one at a time. A running scan finishes, and of the waiting ones only the newest runs.
- **`sluiceway-resolve`** does the same for ticks. Any `resolve` run handles every ticked box it finds, so a replaced run loses nothing. Replaced runs show as cancelled in the Actions list. That is normal.
- **`queue: max`** on `apply` keeps a waiting deploy from being cancelled by a newer one. Never add `cancel-in-progress` to this job.
- **The `if:` on `resolve`** keeps an edit of an ordinary issue from starting a runner. If you change `dashboard.label`, change it here too. `resolve` also runs when the workflow is dispatched, for [stack dependencies](#stack-dependencies).
- **`resolve` hands `apply` a deployment record.** It creates one record per ticked stack in GitHub's Deployments list and puts `{ stack, environment, deployment }` in `matrix`. `apply` deploys only while that record is still open. "Re-run failed jobs" therefore deploys nothing. To try again, tick the box again.
- **`!cancelled()` on `apply`** lets the deploys that `resolve` started go ahead when `resolve` itself ended red, for example because one of several ticks could not be verified or the dashboard could not be written. Without a status check in its `if:`, GitHub skips a job whose `needs` failed. Every entry in `matrix` is a record that `resolve` created after it checked the ticker, so nothing else can get through here.
- **`settle`** gives a deploy a result when its job was cancelled or rejected, so a row never stays "deploying" for ever. It touches only the deployment records of its own run. When it ended one it starts a full scan, which writes the row again with the failure line, so it needs `actions: write` as well. With `dependsOn`, it also starts the workflow again when a stack went out that others are queued behind ([stack dependencies](#stack-dependencies)).
- **A deploy has no time limit of Sluiceway's** unless the `deploy-timeout` input gives it one. Set `timeout-minutes` on the `apply` job either way.
- **`@v0`** follows every release from 0.1.0 until 1.0.0. A commit SHA stays the choice if you want to review every update ([Pin a commit](workflow.md#pin-a-commit)).

## Self-hosted runners

Self-hosted runners work the same way: change `runs-on` for `scan` and `apply`. They need runner version 2.328.0 or newer, and ARM32 is not supported ([requirements](reference.md#requirements)).

> [!TIP]
> `resolve` and `settle` hold no infrastructure secrets. Keep them on hosted runners even when `scan` and `apply` are self-hosted, so a tick shows on the dashboard in seconds instead of waiting for a busy runner.

## With GitHub Environments

Every deploy starts from a tick. Where your plan has environments, they add to it: store the credentials that can change things as secrets of an environment that is limited to the default branch, and add required reviewers where you have them. Give every stack an `environment` in `sluiceway.yaml`, and add this to the `apply` job:

```yaml
    environment:
      name: ${{ matrix.environment }}
      deployment: false # Sluiceway already records the deploy
```

GitHub lists an environment for every name a deployment record uses, so your repo settings will show one named `sluiceway` (or the names you configured) even if you never use the feature. That entry is only a label.

Without `deployment: false` GitHub records every deploy a second time. Custom deployment protection rules do not work with `deployment: false`. If you use them, leave it out and accept the second record. Sluiceway ignores it.

With required reviewers on the environment, the tick decides who may ask and the reviewers decide who may deploy, so a team whose deployers are fewer than its writers can leave `tickers` at its default ([a tick asks, an environment decides](security.md#a-tick-asks-an-environment-decides)). [Security](security.md) has the three setups, from what every repo has to required reviewers, and what each one protects against.

## Merge and deploy

With `mergeAndDeploy.authors` in `sluiceway.yaml`, routine pull requests by those authors, such as Renovate's, get a row of their own under "Updates waiting to merge", and one tick merges the pull request and deploys its stack ([configuration](configuration.md#mergeanddeployauthors)). It is off by default, and in the split workflow it needs three changes to the workflow above, and a fourth for a narrowed scan after the merge.

The merge. `resolve` merges with the workflow token, which needs `contents: write`. Give the `resolve` job its own block. A job's own `permissions:` replace the workflow's, so it repeats the rest:

```yaml
  resolve:
    permissions:
      contents: write
      issues: write
      deployments: write
      actions: write
      pull-requests: read
      checks: write
```

The deploy. A merge made with the workflow token starts no run of its push, so `resolve` starts the workflow again instead, and the scan of that run hands the merged change on through its own `matrix` output. `resolve` runs in that run too, so the scan's matrix gets an apply job of its own. Give the scan step an `id`, add a copy of the `apply` job that takes the scan's matrix, and let `settle` wait for both:

```yaml
  scan:
    outputs:
      matrix: ${{ steps.scan.outputs.matrix }}
    # ... the steps as above, with `id: scan` on the Sluiceway step

  # A copy of the apply job. Only these three keys differ: runs-on,
  # concurrency and the steps are the ones of apply.
  apply-merged:
    needs: scan
    if: ${{ !cancelled() && needs.scan.outputs.matrix != '' && needs.scan.outputs.matrix != '[]' }}
    strategy:
      fail-fast: false
      matrix:
        include: ${{ fromJson(needs.scan.outputs.matrix) }}

  settle:
    needs: [scan, resolve, apply, apply-merged]
    if: always() && ((needs.resolve.outputs.matrix != '' && needs.resolve.outputs.matrix != '[]') || (needs.scan.outputs.matrix != '' && needs.scan.outputs.matrix != '[]'))
```

The pull requests. The scan reads them with `pull-requests: read`, which the block above already gives.

The scan after the merge. `resolve` names the pull requests it merged in a dispatch input, and the scan then previews only what changed, as for a push. GitHub refuses a dispatch with an input the workflow does not declare, so `resolve` sends it only when the workflow's `workflow_dispatch` trigger declares it. Without it the scan after a merge is a full scan:

```yaml
on:
  workflow_dispatch:
    inputs:
      sluiceway-merged:
        description: Set by Sluiceway after a merge from the dashboard. Leave it empty.
        required: false
```

A merge never skips a check: branch protection and required reviews apply to the merge as to any other, and the deploy after it goes through the fresh preview and the hash check like every tick. When the change moved between the scan after the merge and the deploy, nothing is deployed, the row shows the fresh diff and the ticker gets a comment.

## Stack dependencies

With [`dependsOn`](configuration.md#stacksdependson) or [`phases`](configuration.md#phases) in `sluiceway.yaml`, a stack waits for the stacks it depends on, and ticks in one chain deploy one layer per run. The workflow above already has what that needs, so keep these two parts when you change it:

- **`resolve` runs on `workflow_dispatch`.** The `if:` of the `resolve` job lets a dispatched run through, not only an edit of the dashboard.
- **`settle` has `actions: write`.** Once a stack went out that others are queued behind, `settle` starts the workflow again. The `resolve` job of that run starts the stacks that were queued behind it, the next layer.

Without `dependsOn` or a phase, a dispatched `resolve` finds nothing to do in a few seconds and asks GitHub nothing.

