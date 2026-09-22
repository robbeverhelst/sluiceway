# The workflow

Sluiceway is one GitHub Action that runs in two workflow files of your repo: a check on every pull request, and the workflow that scans, reacts to a tick and deploys. This page is both of them, part by part, and the changes that merge and deploy, stack dependencies, self-hosted runners and GitHub Environments ask for.

Go one step at a time. Each step shows you something before the next one can change anything.

1. **[Check your setup](#check-your-setup).** A pull request check that reads your files and says which stacks Sluiceway found and whether `sluiceway.yaml` is valid. No credentials, no tool, no write.
2. **[Scan, read only](read-only-trial.md)**, if you like. One job that previews your stacks and writes the dashboard, with nothing that can deploy.
3. **[The whole loop](#the-workflow).** The workflow with all four jobs, so a tick deploys. Then [your stacks](configuration.md) and [your credentials](credentials.md).

The examples use the action at `@v0`. [Pin a commit](#pin-a-commit) says how to pin a release by its commit SHA instead.

## What goes where

Two files have nearly the same name and do different jobs. Keep the workflow file's name different from `sluiceway.yaml`; the examples call it `deploy-dashboard.yml`.

| File | Belongs to | What it says |
|---|---|---|
| `.github/workflows/deploy-dashboard.yml` | GitHub Actions | When Sluiceway runs, on which runners, with which permissions, and the steps that install your tools and load your credentials before it. You choose the name. All four jobs stay in this one file. |
| `.github/workflows/deploy-dashboard-check.yml` | GitHub Actions | The check that runs on every pull request. |
| `sluiceway.yaml` | Sluiceway, optional, at the repo root | Settings about your stacks: who may tick them, which ones to leave out, which files outside a stack's directory it reads. Never credentials, never runner settings. [Configuration](configuration.md). |
| Your secrets | GitHub secrets, your cloud, your secret manager | Credentials, backend settings, anything your programs read. They reach the job through the workflow, never through Sluiceway. [Credentials](credentials.md). |

## Check your setup

Start here. The [`check` mode](reference.md#modes) tells you, in a pull request, whether Sluiceway will understand your repo, before any workflow that previews or deploys is merged. It reads files and nothing else: no credentials, no infrastructure tool, no GitHub API, no write. It needs `contents: read`, so it is safe on `pull_request`, also from forks. Put this in `.github/workflows/deploy-dashboard-check.yml`:

```yaml
name: deploy-dashboard-check

on:
  pull_request:

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: sluiceway/sluiceway@v0
        with:
          mode: check
```

The job log and the summary of the run say:

- whether `sluiceway.yaml` is valid, with the same messages a scan gives,
- every stack that discovery found, with its environment, its tick rule and its inputs,
- which stacks each `ignore` glob leaves out. A glob that leaves out nothing is a warning. `ignore` matches the stack id, so `apps/web` ignores nothing, and the warning names the glob that would work (`apps/web:*`),
- the files that no stack claims, grouped by directory. A push that changes one of them previews every stack. A ready-to-paste `scan.unrelated` block covers the ones that look like docs and tooling. Sluiceway never decides this for you, so leave out any file one of your programs reads.
- the files a stack's own files name as read and that the stack does not claim, with a ready-to-paste block of `stacks` entries that adds them as `inputs`: what a Pulumi YAML program reads with `fn::readFile`, `fn::fileAsset` or `fn::fileArchive`, a Pulumi config value that is the path of a file of the repo, and a Helm stack's local chart and values files. It is a warning when a push that changes the file would not preview the stack, because another stack claims it or `scan.unrelated` covers it. A path a program builds while it runs does not show here.
- what the workflow files in `.github/workflows` are missing for the jobs that run Sluiceway: a trigger (`push`, the schedule, `workflow_dispatch`, issue edits for `resolve`), a permission a mode needs, a job of the four that is not in the same file, a trigger that must not be there (`pull_request`, `merge_group`), a ref that is not a release, such as a branch, a concurrency group on `scan`, `resolve` or `apply` (one per stack, with `queue: max` and without `cancel-in-progress` on `apply`), `!cancelled()` in the `if:` of `apply` and `always()` in the `if:` of `settle`, a `settle` that does not wait for every apply job, and with merge and deploy the [second apply job](#merge-and-deploy). Each is a warning. It also says when a workflow scans without `resolve` while `dashboard.readOnly` is off, so the boxes would do nothing. Before you add [the workflow](#the-workflow), it says that no workflow runs a scan yet.

The job is red only when the config is not valid or discovery fails. What a workflow lacks is a warning, because GitHub validates and runs the workflow, and the repo's default token permissions and an environment's rules are settings a file does not show. A check cannot say that a preview will work: a stack that does not exist in the backend, a missing credential or a registry the runner cannot reach shows only in a scan. The check reads the files of the checkout, so run it right after `actions/checkout`, before anything writes files into the workspace.

To learn before the first scan which stacks have files in the repo and no stack in the backend, which is the usual first red row, set `backend: true` on the check step and load the credentials of your state backend before it, as in the scan job. The check then asks the tool for the list of stacks of each Pulumi project, changes nothing, and gives one ready-to-paste `ignore` block for the stacks the backend does not hold. It needs those credentials, so do not run it on pull requests from forks: a separate workflow on `workflow_dispatch` is the usual place. OpenTofu, Helm and Kubernetes manifests stacks are listed as not checked.

```yaml
      # Your credential step for the state backend goes here.
      - uses: sluiceway/sluiceway@v0
        with:
          mode: check
          backend: true
```

If your repo uses a merge queue and you make this check required, add `merge_group:` next to `pull_request:` in this file, so the queue gets its result. This is the only Sluiceway workflow that may have it.

## The workflow

This is the whole workflow, the same one the [README](../README.md#get-started) shows. It goes in `.github/workflows/deploy-dashboard.yml` on the default branch. The comments mark where your own steps go. [Example workflows](example-workflows.md) has it complete for a Node monorepo, a secret manager and a cloud with OIDC.

```yaml
name: deploy-dashboard

on:
  push:
    branches: [main]
  schedule:
    - cron: "0 6 * * *" # keep this: the daily full scan is part of the design
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
- **A deploy has no time limit of Sluiceway's.** Set `timeout-minutes` on the `apply` job.
- **`@v0`** follows every release from 0.1.0 until 1.0.0. A commit SHA stays the choice if you want to review every update ([Pin a commit](#pin-a-commit)).

## Self-hosted runners

Self-hosted runners work the same way: change `runs-on` for `scan` and `apply`. They need runner version 2.328.0 or newer, and ARM32 is not supported ([requirements](reference.md#requirements)).

`resolve` and `settle` hold no infrastructure secrets. Keep them on hosted runners even when `scan` and `apply` are self-hosted, so a tick shows on the dashboard in seconds instead of waiting for a busy runner.

## With GitHub Environments

The tick is always a gate. Where your plan has environments, they make it a stronger one: store the credentials that can change things as secrets of an environment that is limited to the default branch, and add required reviewers where you have them. Give every stack an `environment` in `sluiceway.yaml`, and add this to the `apply` job:

```yaml
    environment:
      name: ${{ matrix.environment }}
      deployment: false # Sluiceway already records the deploy
```

GitHub lists an environment for every name a deployment record uses, so your repo settings will show one named `sluiceway` (or the names you configured) even if you never use the feature. That entry is only a label.

Without `deployment: false` GitHub records every deploy a second time. Custom deployment protection rules do not work with `deployment: false`. If you use them, leave it out and accept the second record. Sluiceway ignores it.

[Security](security.md) has the three setups, from what every repo has to required reviewers, and what each one protects against.

## Merge and deploy

With `mergeAndDeploy.authors` in `sluiceway.yaml`, routine pull requests by those authors, such as Renovate's, get a row of their own under "Updates waiting to merge", and one tick merges the pull request and deploys its stack ([configuration](configuration.md#mergeanddeployauthors)). It is off by default, and it needs three changes to the workflow above, and a fourth for a narrowed scan after the merge.

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

## Pin a commit

Every example here says `sluiceway/sluiceway@v0`. `v0` moves with every release until 1.0.0, so your workflow always runs the newest 0.x release. To review every update before it runs, pin the full commit SHA of a release instead, with its version as a comment:

```yaml
      - uses: sluiceway/sluiceway@f417adda434806ed641f551aa126402c923516a3 # v0.1.1
```

The [releases](https://github.com/sluiceway/sluiceway/releases) page lists every version. Dependabot and Renovate can raise a pull request when a new one is out. A branch such as `@main` runs code that is not released yet.

## What new users ran into

What new users met first, so you do not have to:

- A stack config file with no stack in the backend becomes a red row. Leave it out with `ignore`, and write its full id: `apps/web:dev`, never `apps/web`. The check warns about a glob that leaves out nothing.
- A program that pulls from a private registry works on your laptop and fails on the runner. Log in to that registry in the workflow. [Credentials](credentials.md) has recipes.
- `resolve` and `settle` hold no secrets. Keep them on hosted runners ([self-hosted runners](#self-hosted-runners)).
