# Reference

The modes of the action, its inputs and outputs, and what it needs to run. Every name here is the one in [`action.yml`](../action.yml), and a test holds this page to it. The settings of `sluiceway.yaml` are in [configuration](configuration.md).

## Modes

One action, six modes, chosen with the `mode` input.

| Mode | What it does | Runs the infrastructure tool |
|---|---|---|
| `scan` | Previews stacks and brings the dashboard up to date. | Yes |
| `resolve` | Reacts to a tick: checks who ticked, records the deploy and hands the stack to `apply`. | No |
| `apply` | Previews the stack again and deploys it if nothing moved since the tick. | Yes |
| `settle` | Gives a deploy a result when its workflow run ended without reporting one. | No |
| `check` | Reads the repo's files and says whether the setup is valid. It needs no credentials, no tool and no GitHub API, so it is safe on any pull request. With `backend: true` it also asks the backend which stacks it holds, with the credentials of its job. | No |
| `init` | Writes a starter workflow and `sluiceway.yaml` into your clone from what it finds there, and says what is left for you. You run it once on your own machine, and it commits nothing ([init](init.md)). | No |

## Inputs

| Input | Default | What it is |
|---|---|---|
| `mode` | required | One of `scan`, `resolve`, `apply`, `settle`, `check`, `init`. |
| `concurrency` | `4` | How many previews a scan runs at the same time. |
| `preview-timeout` | `10` | Time limit for one preview, in minutes. `apply` uses it for the preview it runs before the deploy. The deploy itself has no time limit of Sluiceway's: set `timeout-minutes` on the job. |
| `github-token` | the workflow token | Leave it at the default. Sluiceway always acts as the workflow's own `GITHUB_TOKEN`. A GitHub App token or a personal access token is not supported. `check` never uses it. |
| `deployment-id` | required in `apply` | The deployment record to deploy. It comes from the `matrix` output of `resolve`. An error in every other mode. |
| `dry-run` | `false` | `apply` only. `true` rehearses a tick: the deployment record, the fresh preview and the check that it matches the row run as for a deploy, and then nothing is deployed. The record ends as `inactive` with "rehearsed, nothing was deployed", the row is pending again and Recently deployed says `rehearsed`. Set it on the `apply` step while you try out a new workflow. |
| `backend` | `false` | `check` only. `true` also asks the backend which of the stacks the check found it holds, with the credentials your job loads before the step, and gives a ready-to-paste `ignore` block for the ones it does not hold. It runs the tool for that one question. An error in every other mode. See [the check](workflow.md#check-your-setup). |
| `job-id` | the id of the running job | Leave it at the default. GitHub gives a step its job's id in no other way, and it needs no permission. A row's link to a failed preview uses it to land on the job's log. |

## Outputs

| Output | Set by | What it is |
|---|---|---|
| `matrix` | `resolve`, `scan` | A JSON list with one `{ stack, environment, deployment }` entry per deploy that was started, or `[]`. A scan starts one only after a merge from the dashboard ([Merge and deploy](workflow.md#merge-and-deploy)). |

`scan` and `apply` also set outputs and write a result file, so a step after Sluiceway can tell people or chart numbers. Sluiceway itself sends nothing. [Notifications](notifications.md) lists them, with recipes that stay quiet unless something is pending or failed.

## Requirements

- **A GitHub repo with issues turned on.** The dashboard is an issue.
- **GitHub Actions runners with runner version 2.328.0 or newer.** Hosted runners qualify. Self-hosted runners need that version at least, and ARM32 is not supported.
- **Pulumi CLI 3.229.0 or newer** on the runners that preview and deploy, for Pulumi stacks. `pulumi/actions` installs it. With an older one every preview fails, and the job log says which version is needed.
- **OpenTofu 1.11.0 or newer**, for OpenTofu stacks, installed without a wrapper ([credentials](credentials.md#opentofu)). A repo with only Pulumi stacks never needs it.
- **Terraform 1.14.0 or newer**, for Terraform stacks, installed without a wrapper, **Terragrunt 1.0.0 or newer** for Terragrunt units, and **cdktf 0.21.0** for the stacks of a CDK for Terraform app ([credentials](credentials.md#terraform-terragrunt-and-cdk-for-terraform)). A repo without them never needs them.
- **Helm 3.18.0 or newer and the helm-diff plugin 3.15.11 or newer**, for Helm releases, with a kubeconfig for the cluster ([credentials](credentials.md#helm)). A repo without Helm releases never needs them.
- **kubectl 1.34.0 or newer** and a kubeconfig, for Kubernetes manifests stacks ([credentials](credentials.md#kubernetes-manifests)). A repo without them never needs it.
- **Your programs' own needs:** a language runtime, dependencies, credentials. The workflow installs and loads them, the same way your own CI or laptop does.
