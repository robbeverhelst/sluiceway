# Reference

The modes of the action, its inputs and outputs, and what it needs to run. Every name here is the one in [`action.yml`](../action.yml), and a test holds this page to it. The settings of `sluiceway.yaml` are in [configuration](configuration.md).

## Modes

One action, seven modes, chosen with the `mode` input. Leave it out, and the step is `auto`: it runs the mode the event asks for, and [the workflow](workflow.md#the-workflow) needs one job.

| Mode | What it does | Runs the infrastructure tool |
|---|---|---|
| `auto` | The default. Reads the event of the run and runs what it asks for: `scan` on a push to the default branch and on the schedule, `resolve` and then `apply` for each stack it started and `settle` on an edit of the dashboard, `resolve` and `scan` on a dispatch, `check` on a pull request. Any other event, an edit of any other issue among them, ends with a notice. | Yes, through `scan` and `apply` |
| `scan` | Previews stacks and brings the dashboard up to date. | Yes |
| `resolve` | Reacts to a tick: checks who ticked, records the deploy and hands the stack to `apply`. | No |
| `apply` | Previews the stack again and deploys it if nothing moved since the tick. | Yes |
| `settle` | Gives a deploy a result when its workflow run ended without reporting one. | No |
| `check` | Reads the repo's files and says whether the setup is valid, and which credentials each stack needs, as names, and which of them nothing in the workflow provides ([credentials](credentials.md#what-the-check-says-about-them)). It needs no credentials, no tool and no GitHub API, so it is safe on any pull request. With `backend: true` it also asks the backend which stacks it holds, and with `pull-request-preview: true` it previews the stacks a pull request claims and writes a check run per stack, each with the credentials of its job. | Only with `backend: true` or `pull-request-preview: true` |
| `init` | Writes a starter workflow and `sluiceway.yaml` into your clone from what it finds there, and says what is left for you. You run it once on your own machine, as `npx sluiceway init`, and it commits nothing ([init](init.md)). | No |

## Inputs

| Input | Default | What it is |
|---|---|---|
| `mode` | `auto` | One of `auto`, `scan`, `resolve`, `apply`, `settle`, `check`, `init`. Leave it out for auto. The [split workflow](split-workflow.md) names one per job. |
| `concurrency` | one per core, up to 8 | How many previews a scan runs at the same time. Leave it out and the scan runs one preview for each core of the machine, from 1 to 8, and the first line before the previews says the number and where it came from. Previewing is bound by the CPU, so more previews than cores make each one slower and the scan no faster. Set it to pin the pool, for example on a machine that other jobs share. |
| `preview-timeout` | `10` | Time limit for one preview, in minutes. It counts from when the preview starts, never while it waits for a place in the pool. `apply` uses it for the preview it runs before the deploy. The deploy itself has no time limit of Sluiceway's unless `deploy-timeout` gives it one. |
| `strict` | `false` | `scan` and `auto` only. `true` turns the job red when any preview failed, after the dashboard is written. Off by default, because a job that is red for one broken stack on every push teaches people to ignore red. |
| `github-token` | the workflow token | Leave it at the default. Sluiceway always acts as the workflow's own `GITHUB_TOKEN`. A GitHub App token or a personal access token is not supported. `check` never uses it. |
| `deployment-id` | required in `apply` | The deployment record to deploy. It comes from the `matrix` output of `resolve`. An error in every other mode, `auto` too, which deploys what `resolve` hands on in the same step. |
| `dry-run` | `false` | `apply` and `auto` only. `true` rehearses a tick: the deployment record, the fresh preview and the check that it matches the row run as for a deploy, and then nothing is deployed. The record ends as `inactive` with "rehearsed, nothing was deployed", the row is pending again and Recently deployed says `rehearsed`. Set it on the Sluiceway step while you try out a new workflow. |
| `backend` | `false` | `check` and `auto` only. `true` also asks the backend which of the stacks the check found it holds, with the credentials your job loads before the step, and gives a ready-to-paste `ignore` block for the ones it does not hold. It runs the tool for that one question. An error in every other mode. See [the check](workflow.md#check-your-setup). |
| `pull-request-preview` | `false` | `check` and `auto` only. `true` also previews the stacks the pull request claims, as they would be after the merge, with the credentials your job loads before the step, and writes a check run per stack on the pull request's head commit, named `sluiceway / <stack id>`, for the reviewer. Nothing deploys from it and it leaves no row. A pull request from a fork is refused, and `pull_request_target` is never used. An error in every other mode. See [preview a pull request](workflow.md#preview-a-pull-request-for-its-reviewer). |
| `deploy-timeout` | none | `apply` and `auto` only. A time limit on the deploy itself, in whole minutes. When it runs out the tool is interrupted and gets two minutes to stop by itself, and the deploy fails with "the deploy ran out of its time limit of N minutes and the tool was stopped". The stack may then be half deployed, and the row shows what is left. Without it the job's own `timeout-minutes` is the limit. |
| `env-file` | none | `scan`, `apply` and `auto`, and `check` with `backend: true` or `pull-request-preview: true`. A file of `NAME=value` lines, relative to the checkout or absolute, that Sluiceway reads once for the tool's process: every value is masked in the job log before anything else, the file wins over a variable the job already has, and the job log names what it loaded and never a value. It may hold plain values or what a step before it resolved; Sluiceway resolves no secret reference. A file that is not there fails the step before the tool runs. On a step that never runs the tool it is a warning and the file is not read ([credentials](credentials.md#an-env-file)). |
| `slack-webhook-url` | none | `scan`, `resolve`, `apply` and `auto`. The address of a Slack incoming webhook, from a secret. Sluiceway posts a short message there on the events `notify.events` lists ([notifications](notifications.md)). |
| `telegram-bot-token` | none | `scan`, `resolve`, `apply` and `auto`. The token of a Telegram bot, from a secret. Needs `telegram-chat-id` too. |
| `telegram-chat-id` | none | The chat the Telegram bot posts to: a chat id or the `@` name of a public channel. |
| `webhook-url` | none | `scan`, `resolve`, `apply` and `auto`. An `http` or `https` address, from a secret, that gets a small JSON message on the same events. |
| `job-id` | the id of the running job | Leave it at the default. GitHub gives a step its job's id in no other way, and it needs no permission. A row's link to a failed preview uses it to land on the job's log. |

An input that is set to an empty string reads as its default, so a workflow can pass one through from its own inputs, as in `preview-timeout: ${{ inputs.preview-timeout }}`, and a trigger without that input still gets `10`. An empty `concurrency` leaves the pool to the cores of the machine, as if the input were left out. A value that is set and wrong still fails the step. `github-token`, and `deployment-id` in `apply`, have no default to fall back to, so an empty one fails.

## Outputs

| Output | Set by | What it is |
|---|---|---|
| `matrix` | `resolve`, `scan` | A JSON list with one `{ stack, environment, deployment }` entry per deploy that was started, or `[]`. A scan starts one after a merge from the dashboard ([Merge and deploy](workflow.md#merge-and-deploy)), and one for each stack set to [`deploy: on-merge`](configuration.md#stacksdeploy) that the scan of a push to the default branch hands on. |

`auto` sets what the modes it ran set. `scan` and `apply` also set outputs and write a result file, so a step after Sluiceway can chart numbers or send anything the built-in notifications do not. [Notifications](notifications.md) lists them, next to the built-in Slack, Telegram and webhook messages, and [what Sluiceway writes](what-sluiceway-writes.md) documents the result file, the markers and the deployment records, and what may change in them.

No output, result file or webhook message carries a time of day, only durations, so [`dashboard.timeZone`](configuration.md#dashboardtimezone) changes nothing here. It changes only what a person reads on the dashboard, and the markers in the issue keep UTC.

## Requirements

- **A GitHub repo with issues turned on.** The dashboard is an issue.
- **GitHub Actions runners with runner version 2.328.0 or newer.** Hosted runners qualify. Self-hosted runners need that version at least, and ARM32 is not supported.
- **Pulumi CLI 3.229.0 or newer** on the runners that preview and deploy, for Pulumi stacks. `pulumi/actions` installs it. With an older one every preview fails, and the job log says which version is needed.
- **OpenTofu 1.11.0 or newer**, for OpenTofu stacks, installed without a wrapper ([credentials](credentials.md#opentofu)). A repo with only Pulumi stacks never needs it.
- **Terraform 1.14.0 or newer**, for Terraform stacks, installed without a wrapper, **Terragrunt 1.0.0 or newer** for Terragrunt units, and **cdktf 0.21.0** for the stacks of a CDK for Terraform app ([credentials](credentials.md#terraform-terragrunt-and-cdk-for-terraform)). A repo without them never needs them.
- **Helm 3.18.0 or newer and the helm-diff plugin 3.15.11 or newer**, for Helm releases, with a kubeconfig for the cluster ([credentials](credentials.md#helm)). A repo without Helm releases never needs them.
- **kubectl 1.34.0 or newer** and a kubeconfig, for Kubernetes manifests stacks ([credentials](credentials.md#kubernetes-manifests)). A repo without them never needs it.
- **Node 22 or newer on your own machine**, only for `npx sluiceway init` and `npx sluiceway check` ([init](init.md#run-it)). The workflow needs none: the runner starts the action.
- **Your programs' own needs:** a language runtime, dependencies, credentials. The workflow installs and loads them, the same way your own CI or laptop does.
