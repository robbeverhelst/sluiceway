# The workflow

Sluiceway runs in two workflow files of your repo: a check on every pull request, and the workflow that scans, reacts to a tick and deploys.

Sluiceway is one GitHub Action, and that second file is one job with one Sluiceway step. The step reads the event that started the run and does what it asks for, so the file needs no `if:` and no `needs:`. This page is both files, part by part, and what merge and deploy, stack dependencies, self-hosted runners and GitHub Environments ask for.

Go one step at a time. Each step shows you something before the next one can change anything.

1. **[Check your setup](#check-your-setup).** A pull request check that reads your files and says which stacks Sluiceway found and whether `sluiceway.yaml` is valid. No credentials, no tool, no write.
2. **[Scan, read only](read-only-trial.md)**, if you like. The same workflow with nothing that can deploy.
3. **[The whole loop](#the-workflow).** The workflow that scans and deploys a tick. Then [your stacks](configuration.md) and [your credentials](credentials.md).

The examples use the action at `@v0`. [Pin a commit](#pin-a-commit) says how to pin a release by its commit SHA instead.

## What goes where

Two files have nearly the same name and do different jobs. Keep the workflow file's name different from `sluiceway.yaml`; the examples call it `deploy-dashboard.yml`.

| File | Belongs to | What it says |
|---|---|---|
| `.github/workflows/deploy-dashboard.yml` | GitHub Actions | When Sluiceway runs, on which runner, with which permissions, and the steps that install your tools and load your credentials before it. You choose the name. |
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
      # No mode: on a pull request Sluiceway runs the check.
      - uses: sluiceway/sluiceway@v0
```

The job log and the summary of the run say:

- whether `sluiceway.yaml` is valid, with the same messages a scan gives,
- every stack that discovery found, with its environment, its tick rule and its inputs,
- every directory of OpenTofu or Terraform files, with what [root module discovery](configuration.md#discoveryrootmodules) made of it: found as a stack and by what evidence, left out and why, or declared by a `stacks` entry. A pull request that adds such a directory, or bumps Sluiceway to a version that finds more, shows here what the dashboard will get before it gets it,
- which stacks each `ignore` glob leaves out. A glob that leaves out nothing is a warning. `ignore` matches the stack id, so `apps/web` ignores nothing, and the warning names the glob that would work (`apps/web:*`),
- the files that no stack claims, grouped by directory, `sluiceway.yaml` left out. A push that changes one of them previews every stack. The hint under the list names the lockfiles and package manifests among them, which stay off `scan.unrelated`. A ready-to-paste `scan.unrelated` block covers the ones that look like docs and tooling. Sluiceway never decides this for you, so leave out any file one of your programs reads.
- the files a stack's own files name as read and that the stack does not claim, with a ready-to-paste block of `stacks` entries that adds them as `inputs`: what a Pulumi YAML program reads with `fn::readFile`, `fn::fileAsset` or `fn::fileArchive`, a Pulumi config value that is the path of a file of the repo, and a Helm stack's local chart and values files. It is a warning when a push that changes the file would not preview the stack, because another stack claims it or `scan.unrelated` covers it. A path a program builds while it runs does not show here.
- what the workflow files in `.github/workflows` are missing for the jobs that run Sluiceway. A step with no mode is read as auto mode, which runs what the triggers of its file start. For the one-step workflow it warns about a missing trigger (`push`, the schedule, `workflow_dispatch`, issue edits), a missing permission that one of its modes needs, and a concurrency group without `queue: max` or with `cancel-in-progress`. It also warns about a `pull_request` trigger in that file, because the job would then load your credentials for code that is not merged. For the [split workflow](split-workflow.md) it reads the four jobs as before. It also names a ref that is not a release, such as a branch. Each is a warning. It also says when a workflow scans without anything that acts on a tick while `dashboard.readOnly` is off, so the boxes would do nothing. Before you add [the workflow](#the-workflow), it says that no workflow runs a scan yet.
- who decides who may deploy, for each job that deploys: the tick rule alone when the job names no GitHub Environment, or the environment's required reviewers if it has them. Whether an environment has reviewers is a setting of the repo, so the check names the environment and says it cannot see that ([a tick asks, an environment decides](security.md#a-tick-asks-an-environment-decides)).
- which credentials each stack needs, as names with alternatives and the file that names each: the backend and the passphrase of a Pulumi stack and the providers its program names, the providers, the backend and the variables without a default of a root module, the cluster of a Helm release or a manifests stack. For each job that runs the tool, which of them nothing in the workflow appears to provide, from the `env:` names of the workflow, the job and the step, an env file of the repo that a step loads, and the login actions before the step. A step the check cannot see into, one that writes to the environment or loads secrets, is named as a maybe. Never a value, and never a warning: a program can read any variable ([what the check says about credentials](credentials.md#what-the-check-says-about-them)).

The job is red only when the config is not valid or discovery fails. What a workflow lacks is a warning, because GitHub validates and runs the workflow, and the repo's default token permissions and an environment's rules are settings a file does not show. A check cannot say that a preview will work: a stack that does not exist in the backend, a missing credential or a registry the runner cannot reach shows only in a scan. The check reads the files of the checkout, so run it right after `actions/checkout`, before anything writes files into the workspace.

The same check runs on your own machine before any workflow exists: `npx sluiceway check` in your clone, with Node 22 or newer, prints the same lines and fails only where the job would be red. It asks no backend. [init](init.md#run-it) says more about the command line.

To learn before the first scan which stacks have files in the repo and no stack in the backend, which is the usual first red row, set `backend: true` on the check step and load the credentials of your state backend before it. The check then asks the tool for the list of stacks of each Pulumi project, changes nothing, and gives one ready-to-paste `ignore` block for the stacks the backend does not hold. A stack whose entry sets [`createInBackend: true`](configuration.md#stackscreateinbackend) is named with the line that the first scan creates it, and stays out of the block. It needs those credentials, so do not run it on pull requests from forks: a separate workflow on `workflow_dispatch` is the usual place. That workflow names the mode, because on a dispatch a step without one would scan. OpenTofu, Helm and Kubernetes manifests stacks are listed as not checked.

```yaml
      # Your credential step for the state backend goes here.
      - uses: sluiceway/sluiceway@v0
        with:
          mode: check
          backend: true
```

If your repo uses a merge queue and you make this check required, add `merge_group:` next to `pull_request:` in this file, so the queue gets its result. This is the only Sluiceway workflow that may have it.

### Preview a pull request for its reviewer

Opt in. A reviewer wants to see what a change does to the infrastructure while reviewing it, not after merging it. Set `pull-request-preview: true` on the check step of a job that installs your tool and loads credentials, and the check also previews the stacks the pull request claims, as they would be after the merge, and writes one check run per stack on the pull request's head commit, named `sluiceway / <stack id>`. Each shows what a row shows: resource types and names, the changed property paths, the counts and the destroy warning, and a value only at a path [`dashboard.showValues`](configuration.md#dashboardshowvalues) lists. A stack the merge would not change, and a preview that failed, get a page that says so. The pull request's checks list them, and the job summary lists them with their pages.

It never deploys, never opens a deployment record and leaves no row on the dashboard: the dashboard is about what is merged and waiting. The deploy still happens after the merge, from the fresh preview of the scan, and is refused when the change moved since, so a stale plan can never go out. Every page says so.

```yaml
name: deploy-dashboard-check

on:
  pull_request:

permissions:
  contents: read
  checks: write # a preview page per stack the pull request claims

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      # Install your tool, and load credentials that can read, not change:
      # read access to the state backend and the cloud is what a preview needs.
      - uses: sluiceway/sluiceway@v0
        with:
          pull-request-preview: true
```

Two rules are fixed, each in one sentence:

- **A pull request from a fork is refused outright, and Sluiceway never relies on GitHub withholding secrets from a fork's run.** A preview runs the pull request's code with the credentials of the job.
- **`pull_request_target` is never used, because it runs with the secrets of the base branch against code that is not merged.** The check warns about a step with the input in a file that runs on it.

Previewing a pull request runs the repo's own program with credentials. For Pulumi and CDK for Terraform that is arbitrary code from the branch, from anyone who may open a pull request in the repo. So give this job credentials that can read, not ones that can change things: a preview reads state and asks the cloud what would change. [Credentials](credentials.md) has the recipes. The workflow that deploys stays a file of its own and never runs on `pull_request` ([the workflow](#the-workflow)).

The cost is one preview per claimed stack per push to the pull request. Only the stacks that claim a changed file are previewed, by the same [claim rule](configuration.md#stacksinputs) a push uses, so a pull request that touches no stack previews nothing, and a file no stack claims is listed in the summary and not previewed for. To limit it further, keep the preview in a workflow of its own next to the check and filter its trigger by path:

```yaml
on:
  pull_request:
    paths:
      - infra/**
```

The checkout of a `pull_request` run is the merge of the branch into the base, so leave `ref:` off `actions/checkout`: that is what makes the preview show the merge. A pull request with a conflict has no merge, and GitHub does not start the job. A pull request that changes 300 files or more previews nothing, because GitHub's comparison cannot list its files whole, and the summary says so. The `preview-timeout`, `concurrency` and [`env-file`](credentials.md#an-env-file) inputs apply as in a scan.

## The workflow

This is the whole workflow, the same one the [README](../README.md#get-started) shows. It goes in `.github/workflows/deploy-dashboard.yml` on the default branch. The comments mark where your own steps go. [Example workflows](example-workflows.md) has it complete for a Node monorepo, a secret manager and a cloud with OIDC.

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
  contents: read # check out the code
  issues: write # write the dashboard and its comments
  deployments: write # record who deployed what, and when
  actions: write # the rescan box and settle start this workflow again
  pull-requests: read # name the pull requests behind a row
  checks: write # a preview page per pending stack

jobs:
  sluiceway:
    runs-on: ubuntu-latest
    # One run at a time, and none is dropped. An edit of any other issue gets
    # a group of its own, so it never waits for a scan or a deploy.
    concurrency:
      group: sluiceway-${{ github.event.issue.number }}
      queue: max
    steps:
      - uses: actions/checkout@v7
      # This installs Pulumi. For OpenTofu, Terraform, Helm or kubectl, install
      # that tool here instead (see Requirements).
      - uses: pulumi/actions@v7 # without a command this only installs the CLI
        with:
          pulumi-version: ^3.229.0
      # Install what your programs need, once, for example: npm ci
      # Load your credentials and your state backend settings into the job
      # environment here. They preview and deploy, so they must be able to
      # change things. Sluiceway passes the environment to the tool and never
      # looks inside. Whatever loads a secret must also mask it. Or name a
      # file of NAME=value lines with the env-file input on the step below,
      # and Sluiceway loads it for the tool and masks every value itself.
      - uses: sluiceway/sluiceway@v0
```

What the step does on each event:

| Event | What runs |
|---|---|
| A push to the default branch | A scan of the stacks that claim a changed file. A push to any other branch ends with a notice. |
| The schedule | `resolve`, which starts the stacks that waited for their [deploy window](configuration.md#deploywindowsdays) to open, then a full scan. |
| An edit of the dashboard | The step checks who ticked each box (`resolve`), deploys each stack that passed, one after the other, and then gives a result to any deploy that did not report one (`settle`). |
| `workflow_dispatch` | `resolve`, which starts the stacks that waited for another one to go out and hands on a deployment record that [a listed record writer opened for this run](what-sluiceway-writes.md#opening-a-record-yourself), then a full scan. The rescan box and a deploy that others wait for start the workflow this way. A run that deployed records opened that way and nothing else skips its scan. |
| An edit of any other issue, and any other event | Nothing. One notice on the run says why, and the run is green. |

What the parts are for:

- **One job, one Sluiceway step.** Leave the step's `mode` out. It is `auto`, which reads the event of the run. A step with a mode runs that mode alone, which is what the [split workflow](split-workflow.md) does.
- **The daily schedule stays.** A push previews only the stacks that claim a changed file. A program can read something that is not a file in the repo (another stack's output, a remote chart, a secret), and the daily full scan is what catches that.
- **Never add `pull_request` or `merge_group` to this workflow.** The job loads your credentials before Sluiceway runs, and on a pull request those steps would run code that is not on the default branch yet. The check has a workflow of its own for that. A merge queue ends in a push to the default branch, and the scan runs on that push.
- **`issues`, with the type `edited`**, is how a tick reaches Sluiceway. GitHub cannot start a run for one issue only, so an edit of any issue starts the job, and Sluiceway ends it with a notice when the issue is not the dashboard. It knows the dashboard by its label, `dashboard.label` in `sluiceway.yaml`, so the workflow names no label. The run still installs your tools and loads your credentials first, which costs a minute of runner time per edit. On a repo with many issue edits, the [split workflow](split-workflow.md) starts no runner for them.
- **`actions: write`** lets the rescan box and `settle` start the workflow again, and lets a scan see whether a run is still on its way. `id-token: write` is not in the block. Add it only if your credential step uses OIDC.
- **The concurrency group** makes the runs wait in line, one at a time, and `queue: max` keeps a waiting run from being dropped when a newer one arrives. Never add `cancel-in-progress`: it would stop a deploy half way. The group is named after the edited issue, so an edit of any other issue gets a group of its own and never waits behind a scan or a deploy. Any fixed name works too, and then those edits wait in line as well.
- **A tick deploys in the run it started.** `resolve` creates one deployment record per ticked stack in GitHub's Deployments list, and the same step deploys each of them in turn, the first one first. A deploy runs only while its record is still open, so "Re-run all jobs" deploys nothing. To try again, tick the box again. A deploy that fails does not stop the next one, and the job ends red.
- **A run that is cancelled in the middle of a deploy** still gets its records ended: the action's post step settles them, and starts a full scan that writes the rows again with the failure line.
- **Set `timeout-minutes` on the job** to fit your longest scan and the deploys one run may hold. A deploy has no time limit of Sluiceway's unless the `deploy-timeout` input gives it one.
- **`@v0`** follows every release from 0.1.0 until 1.0.0. A commit SHA stays the choice if you want to review every update ([Pin a commit](#pin-a-commit)).

## What one job gives up

One job is the setup with the fewest parts. It gives up a few things that four jobs can do, and the [split workflow](split-workflow.md) keeps them for a repo that needs them:

- **One set of credentials.** The job previews and deploys with the same credentials, so they must be able to change things. The split workflow gives the scan credentials that only read, and only the deploy job the ones that write.
- **GitHub Environments per stack.** A job names one environment or none, so the stacks cannot each wait for a reviewer of their own ([with GitHub Environments](#with-github-environments)).
- **A tick runs where the scan runs.** An edit of the dashboard starts the job with your tools and credentials, on the same runner as a scan. In the split workflow the job an edit starts holds no credentials and can stay on a hosted runner.
- **Deploys one at a time.** Stacks ticked together deploy one after the other in one job, and a tick waits for a deploy of another run that is going on. The split workflow deploys them side by side.
- **One set of outputs.** When one step deploys more than one stack, `outcome`, `stack` and `result-file` describe the last deploy ([notifications](notifications.md)).

## Self-hosted runners

Self-hosted runners work the same way: change `runs-on`. They need runner version 2.328.0 or newer, and ARM32 is not supported ([requirements](reference.md#requirements)). An edit of the dashboard then waits for a free runner of that pool too.

A scan previews as many stacks at once as the runner has cores, up to 8, and says in its job log which number it used. A runner in a container counts the CPU limit of its container, and one without a limit counts the cores of its host. A machine that runs other jobs at the same time has fewer cores to spare than it reports, so set the `concurrency` input on the Sluiceway step to the share it should use. To keep ticks on hosted runners while previews and deploys run on your own, use the [split workflow](split-workflow.md#self-hosted-runners).

A run whose job no runner takes stays queued, and none of its work starts: no scan, no deploy. When one has waited ten minutes or more, the next scan that does get a runner puts a line under the scan line that says a run of the dashboard's workflow has been waiting for a runner, for how long, with a link. It says that the run waits, not why, and it goes as soon as the run starts. A short wait says nothing, since a runner busy with another job, or one an autoscaler is still starting, is normal. When no run gets a runner at all, nothing of Sluiceway runs, so the dashboard cannot say it: the scan line stops moving. Either way, open the waiting run and check that a runner with every label in `runs-on` is online and idle, and, for a runner scale set, that its listener sees the job. The scan reads the queued runs with `actions: read`, which `actions: write` in the permissions block includes.

## With GitHub Environments

A tick decides who may ask for a deploy. An environment with required reviewers on the job that deploys decides who may deploy, and for a team whose deployers are fewer than its writers it is the answer, not an extra: leave `tickers` at its default and make the people who may deploy the environment's reviewers. That needs the [split workflow](split-workflow.md#with-github-environments), because in one job a reviewer would have to approve every run. [A tick asks, an environment decides](security.md#a-tick-asks-an-environment-decides) has the shape, what each one can and cannot do, and what happens while the deploy waits for a reviewer.

Every deploy starts from a tick. Where your plan has environments, they also keep the credentials from other branches, even without reviewers: store the credentials that can change things as secrets of an environment that is limited to the default branch. Every run of this workflow runs on the default branch, so the one job can name that environment:

```yaml
    environment:
      name: sluiceway
      deployment: false # Sluiceway already records the deploy
```

Without `deployment: false` GitHub records every run a second time. Do not add required reviewers to this environment: every run of the job, every scan and every edit of any issue, would wait for one. For a reviewer who approves each deploy, and an environment per stack, use the [split workflow](split-workflow.md#with-github-environments).

GitHub lists an environment for every name a deployment record uses, so your repo settings will show one named `sluiceway` (or the names you configured in `sluiceway.yaml`) even if you never use the feature. That entry is only a label.

[Security](security.md) has the three setups, from what every repo has to required reviewers, and what each one protects against.

## Merge and deploy

With `mergeAndDeploy.authors` in `sluiceway.yaml`, routine pull requests by those authors, such as Renovate's, get a row of their own under "Updates waiting to merge", and one tick merges the pull request and deploys its stack ([configuration](configuration.md#mergeanddeployauthors)). One whose checks have not all finished gets a line there with no box, which says it waits on its checks, and gets its box once they are green. It is off by default, and it needs one change to the workflow above, and a second for a narrowed scan after the merge.

The merge. Sluiceway merges with the workflow token, which needs `contents: write`. Change it in the permissions block:

```yaml
permissions:
  contents: write
  issues: write
  deployments: write
  actions: write
  pull-requests: read
  checks: write
```

With one job, the token of every run can then push to the repo, also while your programs preview. The [split workflow](split-workflow.md#merge-and-deploy) gives `contents: write` to the job that merges alone.

The deploy needs nothing more. A merge made with the workflow token starts no run of its push, so Sluiceway starts the workflow again instead, and the scan of that run deploys the merged change in the same step.

The scan after the merge. Sluiceway names the pull requests it merged in a dispatch input, and the scan then previews only what changed, as for a push. GitHub refuses a dispatch with an input the workflow does not declare, so it sends the input only when the workflow's `workflow_dispatch` trigger declares it. Without it the scan after a merge is a full scan:

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

- **`workflow_dispatch` stays.** Once a stack went out that others wait for, Sluiceway starts the workflow again, and `resolve` in that run starts the next layer, before its scan.
- **`actions: write` stays**, which that dispatch needs.

Without `dependsOn` or a phase, `resolve` on a dispatch reads one page of deployment records per environment, for a [record a listed record writer opened for the run](what-sluiceway-writes.md#opening-a-record-yourself), finds nothing to do in a few seconds and asks GitHub nothing more.

## Pin a commit

Every example here says `sluiceway/sluiceway@v0`. `v0` moves with every release until 1.0.0, so your workflow always runs the newest 0.x release. To review every update before it runs, pin the full commit SHA of a release instead, with its version as a comment:

```yaml
      - uses: sluiceway/sluiceway@f417adda434806ed641f551aa126402c923516a3 # v0.1.1
```

The [releases](https://github.com/sluiceway/sluiceway/releases) page lists every version. Dependabot and Renovate can raise a pull request when a new one is out. A branch such as `@main` runs code that is not released yet.

## What new users ran into

> [!WARNING]
> A stack config file with no stack in the backend becomes a red row. Leave it out with `ignore` and its full stack id, `<path>:<name>`: `apps/web:dev`, never `apps/web`, or let the scan create it with `createInBackend: true` on the stack's entry. The check warns about a glob that leaves out nothing.

> [!WARNING]
> A program that pulls from a private registry works on your laptop and fails on the runner. Log in to that registry in the workflow. [Credentials](credentials.md) has recipes.
