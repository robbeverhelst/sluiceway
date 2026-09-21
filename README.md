<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/mascot/in-sync-dark.svg">
    <img alt="Sluiceway: Penny, the sluice gate, resting on a calm quay because every stack is in sync" width="880" src="assets/mascot/in-sync-light.svg">
  </picture>
</p>

Sluiceway keeps one GitHub issue that shows which infrastructure stacks have changes waiting, and deploys a stack when you tick its box.

> [!IMPORTANT]
> **Sluiceway is in beta.** It works end to end and is released as [0.1.1](https://github.com/sluiceway/sluiceway/releases/tag/v0.1.1). Use `sluiceway/sluiceway@v0`, or [pin a commit](#pin-a-commit) if you want to review every update. Please report every rough edge as an [issue](https://github.com/sluiceway/sluiceway/issues/new). The [onboarding log](docs/onboarding-log.md) lists the ones found so far.

## What it looks like

The dashboard is Markdown, so here is one. It is an example, rendered by Sluiceway's own code from the made-up data its tests use. In a real dashboard issue the boxes can be ticked. Here they cannot.

<details>
<summary><b>Open the example dashboard</b>: 13 stacks, 4 pending, one of them deleting resources</summary>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/sluiceway/sluiceway/v0.1.1/assets/mascot/pending-4-destroys-dark.svg">
    <img alt="Sluiceway: 4 stacks are pending, some delete or replace resources" width="880" src="https://raw.githubusercontent.com/sluiceway/sluiceway/v0.1.1/assets/mascot/pending-4-destroys-light.svg">
  </picture>
</p>

<div align="center">

🟡&nbsp;**4 pending** · ⚪&nbsp;0 deploying · ⚪&nbsp;0 preview failed · 🟢&nbsp;9 in sync · :warning: **1 pending stack destroys resources**

Scanned [`8c41f0e`](https://github.com/example-org/infra/commit/8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c) on 2026-09-21 10:02 UTC · [run](https://github.com/example-org/infra/actions/runs/17034455121) · <sub>last full scan 2026-09-21 06:00 UTC</sub>

</div>

### Pending

Tick a box to deploy that stack exactly as its row shows it.

- [ ] **apps/api:prod** · 1 update · [preview](https://github.com/example-org/infra/actions/runs/17034455121)
  from [#5](https://github.com/example-org/infra/pull/5) by alice, [#4](https://github.com/example-org/infra/pull/4) by renovate[bot] · [compare](https://github.com/example-org/infra/compare/4193607...8c41f0e)
  <details><summary>1 change</summary>
  <kbd>update</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>api</b> · <code>spec.template.spec.containers&#91;0&#93;.image</code><br>
  </details>
- [ ] **apps/legacy-worker:prod** · **3 deletes**, 1 tracking only · [preview](https://github.com/example-org/infra/actions/runs/17034455121)
  from [#427](https://github.com/example-org/infra/pull/427) by dave · [compare](https://github.com/example-org/infra/compare/284fd2d...8c41f0e)
  :warning: <kbd>DELETE</kbd> <code>aws:sqs/queue:Queue</code> <b>legacy-jobs</b>
  :warning: <kbd>DELETE</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>legacy-worker</b>
  :warning: <kbd>DELETE</kbd> <code>kubernetes:core/v1:Service</code> <b>legacy-worker</b>
  <details><summary>1 other change</summary>
  <kbd>forget</kbd> <code>aws:iam/role:Role</code> <b>legacy-worker</b><br>
  </details>
- [ ] **apps/web:prod** · 2 creates, 1 update · [preview](https://github.com/example-org/infra/actions/runs/17034455121)
  from [#418](https://github.com/example-org/infra/pull/418) by carol, and 2 changes outside this stack · [compare](https://github.com/example-org/infra/compare/1dfd7ad...8c41f0e)
  <details><summary>3 changes</summary>
  <kbd>update</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>web</b> · <code>metadata.labels&#91;&quot;app.kubernetes.io/version&quot;&#93;</code>, <code>spec.replicas</code><br>
  <kbd>create</kbd> <code>kubernetes:autoscaling/v2:HorizontalPodAutoscaler</code> <b>web</b><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:ConfigMap</code> <b>web-feature-flags</b><br>
  </details>
- [ ] **platform/ingress-nginx:prod** · 1 update · [preview](https://github.com/example-org/infra/actions/runs/17034455121)
  from [#437](https://github.com/example-org/infra/pull/437) by renovate[bot] · [compare](https://github.com/example-org/infra/compare/876b5b7...8c41f0e)
  <details><summary>1 change</summary>
  <kbd>update</kbd> <code>kubernetes:helm.sh/v3:Release</code> <b>ingress-nginx</b> · <code>values.controller.image.tag</code>, <code>values.controller.replicaCount</code><br>
  </details>

### In sync

<details><summary>9 stacks in sync</summary>

- apps/api:staging
- apps/auth:prod
- apps/auth:staging
- apps/web:staging
- data/postgres:prod
- data/postgres:staging
- infra/network:prod
- monitoring/grafana:prod
- platform/external-dns:prod

</details>

### Recently deployed

- apps/auth:prod · ticked by alice · 2026-09-21 09:41 UTC · [run](https://github.com/example-org/infra/actions/runs/17034388102)
- apps/auth:staging · ticked by alice · 2026-09-21 09:12 UTC · [run](https://github.com/example-org/infra/actions/runs/17034120455)
- platform/external-dns:prod · ticked by carol · 2026-09-20 17:30 UTC · [run](https://github.com/example-org/infra/actions/runs/17029910331)

---

- [ ] Rescan all stacks

<sub>[Sluiceway](https://github.com/sluiceway/sluiceway) v0.1.1 · [docs](https://github.com/sluiceway/sluiceway#readme)</sub>

</details>

## How it works

A sluiceway is a channel with a gate. Changes queue up behind the gate, and you decide what passes.

1. After a merge to the default branch, and once a day, a **scan** previews the stacks in the repo.
2. The scan writes the dashboard issue: one row per stack, and a box on every stack that has changes waiting.
3. You tick a box. That asks for that stack to be deployed exactly as its row shows it.
4. Sluiceway checks that you may tick that stack, and previews it again. It deploys only if the fresh preview still matches the row.
5. The row goes back to in sync, or says why the deploy failed, with a link to the run.

The issue is a view and never the source of truth. What is pending is always worked out again from a fresh preview. Pulumi is the first supported tool, and the adapter interface is built so that OpenTofu and Terraform can follow. [CONTEXT.md](CONTEXT.md) defines the words used here and in the code.

## Get started

Go one step at a time. Each step shows you something before the next one can change anything.

1. **Check your setup.** A pull request check that reads your files and says which stacks Sluiceway found and whether `sluiceway.yaml` is valid. No credentials, no tool, no write. [Step 1](#1-check-your-setup).
2. **Scan, read only.** One job that previews your stacks and writes the dashboard, with nothing that can deploy. `dashboard.readOnly: true` in `sluiceway.yaml` draws the dashboard without boxes, so nothing looks as if it could be ticked. [Start read only](#start-read-only).
3. **The whole loop.** The workflow with all four jobs, so a tick deploys. [Step 2](#2-add-the-workflow), then [your stacks](#3-tell-it-about-your-stacks) and [your credentials](#4-load-your-credentials).

What new users ran into, so you do not have to:

- A stack config file with no stack in the backend becomes a red row. Leave it out with `ignore`, and write its full id: `apps/web:dev`, never `apps/web`. The check warns about a glob that leaves out nothing.
- A program that pulls from a private registry works on your laptop and fails on the runner. Log in to that registry in the workflow. [Credentials](docs/credentials.md) has recipes.
- `resolve` and `settle` hold no secrets. Keep them on hosted runners even when `scan` and `apply` are self-hosted, so a tick shows on the dashboard in seconds instead of waiting for a busy runner.

### Pin a commit

Every example here says `sluiceway/sluiceway@v0`. `v0` moves with every release until 1.0.0, so your workflow always runs the newest 0.x release. To review every update before it runs, pin the full commit SHA of a release instead, with its version as a comment:

```yaml
      - uses: sluiceway/sluiceway@f417adda434806ed641f551aa126402c923516a3 # v0.1.1
```

The [releases](https://github.com/sluiceway/sluiceway/releases) page lists every version. Dependabot and Renovate can raise a pull request when a new one is out. A branch such as `@main` runs code that is not released yet.

## What it promises

- **It never holds your credentials.** Previews and deploys run in your own runners, with the secrets your workflow loads. No input carries a cloud or backend credential, and no code reads one by name. [Security](#security) has the five promises.
- **There is no backend.** It is a GitHub Action and nothing else: no server, no database, no hosted part. Sluiceway itself calls the GitHub API and nothing else.
- **A fresh preview before every deploy.** A tick deploys only what the row showed. If the change moved since, nothing is deployed and the row comes back with the new diff.
- **No values, ever.** Rows show resource types, resource names and the paths of changed properties, such as `values.controller.image.tag`. Never a value, secret or not.

## What it does not do yet

- **Pulumi only.** OpenTofu and Terraform can follow.
- **Only preview and deploy.** Destroying a stack, a refresh and repairing state stay with your own tooling.
- **A change to outputs alone is not shown**, and deploys from somewhere else are not detected. [Limits](#limits) says what that means for you.

[docs/later.md](docs/later.md) lists everything left out of this version, and why.

## Modes

One action, five modes, chosen with the `mode` input.

| Mode | What it does | Runs the infrastructure tool |
|---|---|---|
| `scan` | Previews stacks and brings the dashboard up to date. | Yes |
| `resolve` | Reacts to a tick: checks who ticked, records the deploy and hands the stack to `apply`. | No |
| `apply` | Previews the stack again and deploys it if nothing moved since the tick. | Yes |
| `settle` | Gives a deploy a result when its workflow run ended without reporting one. | No |
| `check` | Reads the repo's files and says whether the setup is valid. It needs no credentials, no tool and no GitHub API, so it is safe on any pull request. | No |

## Inputs

| Input | Default | What it is |
|---|---|---|
| `mode` | required | One of `scan`, `resolve`, `apply`, `settle`, `check`. |
| `concurrency` | `4` | How many previews a scan runs at the same time. |
| `preview-timeout` | `10` | Time limit for one preview, in minutes. `apply` uses it for the preview it runs before the deploy. The deploy itself has no time limit of Sluiceway's: set `timeout-minutes` on the job. |
| `github-token` | the workflow token | Leave it at the default. Sluiceway always acts as the workflow's own `GITHUB_TOKEN`. A GitHub App token or a personal access token is not supported. `check` never uses it. |
| `deployment-id` | required in `apply` | The deployment record to deploy. It comes from the `matrix` output of `resolve`. An error in every other mode. |
| `job-id` | the id of the running job | Leave it at the default. GitHub gives a step its job's id in no other way, and it needs no permission. A row's link to a failed preview uses it to land on the job's log. |

## Outputs

| Output | Set by | What it is |
|---|---|---|
| `matrix` | `resolve` | A JSON list with one `{ stack, environment, deployment }` entry per deploy that was started, or `[]`. |

`scan` and `apply` also set outputs and write a result file, so a step after Sluiceway can tell people or chart numbers. Sluiceway itself sends nothing. [docs/notifications.md](docs/notifications.md) lists them, with recipes that stay quiet unless something is pending or failed.

## Requirements

- **A GitHub repo with issues turned on.** The dashboard is an issue.
- **GitHub Actions runners with runner version 2.328.0 or newer.** Hosted runners qualify. Self-hosted runners need that version at least, and ARM32 is not supported.
- **Pulumi CLI 3.229.0 or newer** on the runners that preview and deploy. `pulumi/actions` installs it. With an older one every preview fails, and the job log says which version is needed.
- **Your programs' own needs:** a language runtime, dependencies, credentials. The workflow installs and loads them, the same way your own CI or laptop does.

## Setup

Four steps. The first one needs no credentials and changes nothing, so you learn whether Sluiceway understands your repo before anything can deploy.

The examples use the action at `@v0`. [Pin a commit](#pin-a-commit) says how to pin a release by its commit SHA instead.

### What goes where

Two files have nearly the same name and do different jobs. Keep the workflow file's name different from `sluiceway.yaml`; the examples call it `deploy-dashboard.yml`.

| File | Belongs to | What it says |
|---|---|---|
| `.github/workflows/deploy-dashboard.yml` | GitHub Actions | When Sluiceway runs, on which runners, with which permissions, and the steps that install your tools and load your credentials before it. You choose the name. All four jobs stay in this one file. |
| `.github/workflows/deploy-dashboard-check.yml` | GitHub Actions | The check that runs on every pull request. |
| `sluiceway.yaml` | Sluiceway, optional, at the repo root | Settings about your stacks: who may tick them, which ones to leave out, which files outside a stack's directory it reads. Never credentials, never runner settings. [Reference](docs/configuration.md). |
| Your secrets | GitHub secrets, your cloud, your secret manager | Credentials, backend settings, anything your programs read. They reach the job through the workflow, never through Sluiceway. [Credentials](docs/credentials.md). |

### 1. Check your setup

Start here. The `check` mode tells you, in a pull request, whether Sluiceway will understand your repo, before any workflow that previews or deploys is merged. It reads files and nothing else: no credentials, no infrastructure tool, no GitHub API, no write. It needs `contents: read`, so it is safe on `pull_request`, also from forks. Put this in `.github/workflows/deploy-dashboard-check.yml`:

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

The job is red only when the config is not valid or discovery fails. A check cannot say that a preview will work: a stack that does not exist in the backend, a missing credential or a registry the runner cannot reach shows only in a scan. The check reads the files of the checkout, so run it right after `actions/checkout`, before anything writes files into the workspace.

If your repo uses a merge queue and you make this check required, add `merge_group:` next to `pull_request:` in this file, so the queue gets its result. This is the only Sluiceway workflow that may have it.

### 2. Add the workflow

This is the whole workflow. It goes in `.github/workflows/deploy-dashboard.yml` on the default branch. The comments mark where your own steps go. [docs/example-workflows.md](docs/example-workflows.md) has it complete for a Node monorepo, a secret manager and a cloud with OIDC.

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
    if: github.event_name == 'issues' && contains(github.event.issue.labels.*.name, 'sluiceway')
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
- **The `if:` on `resolve`** keeps an edit of an ordinary issue from starting a runner. If you change `dashboard.label`, change it here too.
- **`resolve` hands `apply` a deployment record.** It creates one record per ticked stack in GitHub's Deployments list and puts `{ stack, environment, deployment }` in `matrix`. `apply` deploys only while that record is still open. "Re-run failed jobs" therefore deploys nothing. To try again, tick the box again.
- **`!cancelled()` on `apply`** lets the deploys that `resolve` started go ahead when `resolve` itself ended red, for example because one of several ticks could not be verified or the dashboard could not be written. Without a status check in its `if:`, GitHub skips a job whose `needs` failed. Every entry in `matrix` is a record that `resolve` created after it checked the ticker, so nothing else can get through here.
- **`settle`** gives a deploy a result when its job was cancelled or rejected, so a row never stays "deploying" for ever. It touches only the deployment records of its own run. When it ended one it starts a full scan, which writes the row again with the failure line, so it needs `actions: write` as well.
- **A deploy has no time limit of Sluiceway's.** Set `timeout-minutes` on the `apply` job.
- **`@v0`** follows every release from 0.1.0 until 1.0.0. A commit SHA stays the choice if you want to review every update ([Pin a commit](#pin-a-commit)).

Self-hosted runners work the same way: change `runs-on` for `scan` and `apply`. `resolve` and `settle` hold no infrastructure secrets, so they can stay on hosted runners.

#### With GitHub Environments

The tick is always a gate. Where your plan has environments, they make it a stronger one: store the credentials that can change things as secrets of an environment that is limited to the default branch, and add required reviewers where you have them. Give every stack an `environment` in `sluiceway.yaml`, and add this to the `apply` job:

```yaml
    environment:
      name: ${{ matrix.environment }}
      deployment: false # Sluiceway already records the deploy
```

GitHub lists an environment for every name a deployment record uses, so your repo settings will show one named `sluiceway` (or the names you configured) even if you never use the feature. That entry is only a label.

Without `deployment: false` GitHub records every deploy a second time. Custom deployment protection rules do not work with `deployment: false`. If you use them, leave it out and accept the second record. Sluiceway ignores it.

[docs/security.md](docs/security.md) has the three setups, from what every repo has to required reviewers, and what each one protects against.

### 3. Tell it about your stacks

Optional. Without `sluiceway.yaml` every stack that discovery finds gets a row and anyone with write access can tick. A stack's id is its directory and its name, `apps/web:prod`, and that is what `ignore` matches. A typical file:

```yaml
# Only maintainers may tick, unless a stack says otherwise.
tickers: maintain

# A stack config file with no stack in the backend.
ignore:
  - "apps/web:dev"

# Files no program reads: changing them previews nothing.
scan:
  unrelated:
    - "**/*.md"

stacks:
  # The program in apps/web also reads packages/ui.
  - path: apps/web
    inputs:
      - packages/ui/**
```

Every key, its default and its messages are in [docs/configuration.md](docs/configuration.md). The check of step 1 tells you whether the file is valid.

### 4. Load your credentials

The workflow puts everything the tool needs into the job environment, in steps before Sluiceway: the state backend, the cloud credentials, anything your programs read. Sluiceway passes that environment to the tool as it is and never loads a credential itself.

- Only `scan` and `apply` load credentials. `resolve` and `settle` never run the tool, so the job an issue edit starts holds no infrastructure secrets.
- `scan` needs no more than read access. Keep the credentials that change things for `apply`.
- The step that loads a secret has to mask it. Sluiceway never sees a secret as a secret.
- What your programs fetch, the runner has to be able to fetch: private packages, plugins, charts, images. Log in to those registries before Sluiceway too.

[docs/credentials.md](docs/credentials.md) has recipes for GitHub secrets, a cloud with OIDC, a secret manager and private registries, and how Sluiceway fits next to the tooling you already have.

### Start read only

You can run the scan alone first, to see your dashboard with nothing that can deploy. It is the workflow of step 2 with everything that can deploy taken out.

```yaml
name: deploy-dashboard

on:
  push:
    branches: [main]
  schedule:
    - cron: "0 6 * * *"
  workflow_dispatch:

# This block is everything Sluiceway can do in your repo.
permissions:
  contents: read
  issues: write
  deployments: write
  actions: read
  pull-requests: read

jobs:
  scan:
    runs-on: ubuntu-latest
    concurrency: sluiceway-scan
    steps:
      - uses: actions/checkout@v7
      - uses: pulumi/actions@v7 # without a command this only installs the CLI
        with:
          pulumi-version: ^3.229.0
      # Install what your programs need, once, for example: npm ci
      # Load your credentials and your state backend settings into the job
      # environment here. Credentials that can only read are enough. Whatever
      # loads a secret must also mask it.
      - uses: sluiceway/sluiceway@v0
        with:
          mode: scan
```

And tell Sluiceway that nothing acts on a box, in `sluiceway.yaml` at the repo root:

```yaml
dashboard:
  readOnly: true
```

What this does and does not do:

- **Nothing can be deployed.** The workflow has no `resolve` and no `apply` job, and it does not listen to issue edits. With `dashboard.readOnly: true` the dashboard shows that: pending rows have no box, there is no rescan box, and a line under the Pending heading says the dashboard is read only. Without it the rows get boxes that do nothing, and a tick sits there until the next scan clears it. A scan only ever asks the tool for a preview. The token can read the code, write issues, and read and write deployment records, and nothing else. A scan reads the deployment records, which is where Sluiceway keeps who deployed what and when, and with no `resolve` job there are none. `actions: read` lets it see whether a workflow run is over, and whether a run that an issue edit started is still on its way. `pull-requests: read` lets a row name the pull requests that made it pending.
- **The header image is served from an exact release tag or commit SHA.** Never from one that can move, so that a picture never changes behind a dashboard that was already written. Started from `@v0` or a branch, Sluiceway names the release tag of its own version, such as `v0.1.1`. Started from a copy inside your own repo (`uses: ./`), it names a commit that this repository does not have, and the picture is broken while the scan still works. `dashboard.personality: false` in `sluiceway.yaml` takes the picture out.
- **A push gives a narrowed scan**: only the stacks that claim a changed file are previewed, and every other row stays as it is. The schedule and "Run workflow" give a full scan. The first scan is always full.

To turn it into the whole workflow later, replace the file with the one of step 2, change `actions: read` to `actions: write`, and take `readOnly: true` out of `sluiceway.yaml`. The change to `sluiceway.yaml` makes the next push a full scan, and every pending row gets its box back.

## Using the dashboard

- **A row with a box has changes waiting.** Its details show the resources that would change and the paths of the properties that change, down to the key inside a map or a list. A delete or a replace is always shown open under the row, never folded away. When the dashboard grows past what an issue holds, the biggest rows are shortened first and link to the full diff in the run's summary.
- **Tick the box to deploy that stack.** Sluiceway checks that you may tick it, previews the stack again, and deploys only if the fresh preview still matches what the row showed. The row says deploying, then goes back to in sync, or shows a failure line with a link to the run.
- **A tick approves the change as shown.** The row shows which properties change, never their values, so a tick means "change these properties on these resources, at whatever value the code has when the deploy runs". A new resource, a delete or a different property stops the deploy and brings the row back with the fresh diff. [docs/security.md](docs/security.md#what-a-tick-promises) has the whole promise.
- **A refused tick deploys nothing.** The box is cleared and one comment on the dashboard says why.
- **The rescan box**, `Rescan all stacks` at the bottom, starts a full scan, for example after you deployed a stack from somewhere else. It deploys nothing.
- **To try a failed deploy again, tick the box again.** Re-running the job deploys nothing.

## Reading the job log

The job log of a scan says what it did, in fixed lines:

| Line | What it tells you |
|---|---|
| `This is a full scan: ...` | Every stack is previewed, and why. After a push it reads `This is a full scan. A push gives a narrowed scan, and this one fell back to a full scan: ...` with the reason. When the reason is a changed file that no stack claims, the group `Changed files that no stack claims` lists them. |
| `This is a narrowed scan: it previews 2 of 58 stacks and keeps the rows of the other 56 as they are.` | Only those stacks are previewed. One line per stack follows: `<stack id> is previewed: it claims <file>.` |
| `Previewing 58 stacks with a pool of 4 and a time limit of 10 minutes for each preview.` | The `concurrency` and `preview-timeout` this scan ran with. |
| `Previewed <stack id> in 8.3 s: pending` | How long one preview took, and how it ended. One line per preview, in the order they finish. |
| `Previewed 58 stacks in 412.6 s with a pool of 4. Added up, the previews took 1530.2 s. The slowest was <stack id> with 45.1 s.` | The total. The total against the sum shows what the pool gains. The slowest preview is what `preview-timeout` has to clear. |
| `Wrote the dashboard: <url> (41,210 of 65,536 characters).` | Where the dashboard is, and how full the issue body is. `Carried 56 rows through as they were` follows on a narrowed scan. |
| `Cleared an orphan tick on <stack id>: ...` | A box was ticked and nothing picked the tick up, so the scan cleared it and the row asks for a fresh one. A scan never deploys. While a run that an issue edit started is queued or in progress the line reads `Left the tick on <stack id> alone: ...` and the box stays ticked. |

Under those lines there is one group per previewed stack, titled with the stack id. It holds the whole diff and everything the tool printed. The tool's own words never leave the job log.

To see the values a tick would deploy, turn on `scan.logDiff` in `sluiceway.yaml`. Every pending stack's group then also holds the tool's own diff, values included, and a pending row's `preview` link opens the job log. It costs one more tool run per pending stack, and anyone who can read the repo can read its job logs: in a public repo, anyone. [docs/configuration.md](docs/configuration.md#scanlogdiff) and [docs/security.md](docs/security.md#the-tools-own-diff-in-the-job-log) say what to weigh first.

## Limits

- **A change that touches only a stack's outputs is not shown.** The tool's preview does not report it, so a stack whose only change is an added, removed or changed output is in sync and has no box. Deploy it from outside Sluiceway. Another stack that reads that output keeps failing its preview until then. An output nearly always changes together with a resource, and then the row is pending anyway.
- **Deploys from somewhere else are allowed and not detected.** They do not show under recently deployed, and a row they made stale stays pending until the next full scan or the rescan box. A tick on a stale row deploys nothing.
- **Sluiceway only previews and deploys.** Destroying a stack, a refresh and repairing state stay with your own tooling.
- **No values on the dashboard, ever.** Rows show resource types, resource names and property names. `dashboard.redact: true` keeps even those out of the issue. The one place a value can appear is the job log, and only when you turn on `scan.logDiff`.
- **One tool so far.** Pulumi is the first. The adapter interface is built so that OpenTofu and Terraform can follow.

[docs/later.md](docs/later.md) lists everything that was left out of this version, and why.

## Security

Sluiceway never holds credentials. That is five promises you can check against the code:

1. **No credential inputs.** The action takes one secret, the GitHub token. No input and no config key ever carries a cloud, backend or secret manager credential.
2. **Never read by name.** No Sluiceway code reads a credential variable. Your workflow prepares the environment, and it goes to the tool as one opaque block.
3. **Never stored, never sent.** Nothing from the environment reaches the issue, deployment records, job summaries, artifacts or caches. The only network calls are to the GitHub API and whatever the tool itself makes.
4. **Only the modes that run the tool need credentials.** `scan` and `apply` run the tool. `resolve` and `settle` never do, so the job that reacts to an issue edit holds no infrastructure secrets.
5. **A hosted version would keep all of this.** The tool always runs in your own runners.

The dashboard shows resource types, resource names and the paths of changed properties. It never shows a property value, whether or not the tool marks it secret. The job log shows values only when you turn on `scan.logDiff`, and then anyone who can read the repo can read them: in a public repo, anyone.

A tick rule protects against the wrong person ticking. On its own it does not protect against a collaborator with write access who means harm, because anyone with write access can push a workflow that reads the repo's secrets. Where your plan has GitHub Environments, lock the credentials that change things into one and the tick rules can be relied on. [docs/security.md](docs/security.md) explains the three setups.

## Documentation

- [docs/configuration.md](docs/configuration.md): every key of `sluiceway.yaml`.
- [docs/credentials.md](docs/credentials.md): how credentials reach the tool, recipes, private registries, and your own tooling.
- [docs/example-workflows.md](docs/example-workflows.md): complete workflows for common setups.
- [docs/security.md](docs/security.md): what a tick promises, and the three setups.
- [docs/notifications.md](docs/notifications.md): the outputs and the result file, and recipes that tell people when something is pending or failed.
- [docs/onboarding-log.md](docs/onboarding-log.md): every hurdle a new user met, and what was done about it.
- [CONTEXT.md](CONTEXT.md): the glossary.
- [docs/build-plan.md](docs/build-plan.md): what is being built, in which order, and how it is proven.
- [docs/adr](docs/adr): the decision records. Where a record and the brief disagree, the record wins.
- [docs/later.md](docs/later.md): what was left out of v1, and why.
- [docs/acceptance.md](docs/acceptance.md): the checklist that proves v1 against its first real user.
- [docs/brief.md](docs/brief.md): the original project brief, kept as history. Do not build from it.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE)
