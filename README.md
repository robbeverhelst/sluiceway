<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/mascot/in-sync-dark.svg">
    <img alt="Sluiceway: Penny, the sluice gate, resting on a calm quay because every stack is in sync" width="880" src="assets/mascot/in-sync-light.svg">
  </picture>
</p>

Sluiceway keeps one GitHub issue that shows which infrastructure stacks have changes waiting, and deploys a stack when you tick its box.

> [!IMPORTANT]
> **Sluiceway is in beta.** It works end to end and is released as [0.x](https://github.com/sluiceway/sluiceway/releases), and the [roadmap](https://docs.sluiceway.dev/roadmap/) says what comes before 1.0. Use `sluiceway/sluiceway@v0`, or [pin a commit](https://docs.sluiceway.dev/guides/workflow/#pin-a-commit) if you want to review every update. Please report every rough edge as an [issue](https://github.com/sluiceway/sluiceway/issues/new). The [onboarding log](https://docs.sluiceway.dev/onboarding-log/) lists the ones found so far.

## What it looks like

The dashboard is Markdown, so here is one. It is an example, rendered by Sluiceway's own code from the made-up data its tests use. In a real dashboard issue the boxes can be ticked. Here they cannot.

<details>
<summary><b>Open the example dashboard</b>: 13 stacks, 4 pending, one of them deleting resources</summary>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/sluiceway/sluiceway/v0.1.1/assets/mascot/pending-4-deletes-dark.svg">
    <img alt="Sluiceway: 4 stacks are pending, some delete resources" width="880" src="https://raw.githubusercontent.com/sluiceway/sluiceway/v0.1.1/assets/mascot/pending-4-deletes-light.svg">
  </picture>
</p>

<div align="center">

🟡&nbsp;**4 pending** · ⚪&nbsp;0 deploying · ⚪&nbsp;0 preview failed · 🟢&nbsp;9 in sync · :warning: **1 pending stack destroys resources**

Scanned [`8c41f0e`](https://github.com/example-org/infra/commit/8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c) on 2026-09-21 10:02 UTC · [run](https://github.com/example-org/infra/actions/runs/17034455121) · <sub>last full scan 2026-09-21 06:00 UTC</sub>

</div>

### Pending

Tick a box to deploy that stack exactly as its row shows it.

> [!CAUTION]
> 1 pending stack deletes or replaces resources: **apps/legacy-worker:prod**

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

Times are in UTC.

- 🟢&nbsp;apps/auth:prod · alice · 09-21 09:41 · [run](https://github.com/example-org/infra/actions/runs/17034388102)
- 🟢&nbsp;apps/auth:staging · alice · 09-21 09:12 · [run](https://github.com/example-org/infra/actions/runs/17034120455)
- 🟢&nbsp;platform/external-dns:prod · carol · 09-20 17:30 · [run](https://github.com/example-org/infra/actions/runs/17029910331)

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

The issue is a view and never the source of truth. What is pending is always worked out again from a fresh preview.

## Get started

**Check your setup.** A check on every pull request reads your files and says which stacks Sluiceway found and whether its settings are valid. It needs no credentials, no tool and no write access, so start with it before anything can deploy. [The check](https://docs.sluiceway.dev/guides/workflow/#check-your-setup) has the workflow file. To see your dashboard first with nothing that can deploy, [start read only](https://docs.sluiceway.dev/guides/read-only-trial/).

**Add the workflow.** This is the whole loop: one job with one Sluiceway step, and no `if:` anywhere. The step reads the event of the run and does what it asks for: a push or the schedule scans, a tick deploys, an edit of any other issue ends with a notice. It goes in `.github/workflows/deploy-dashboard.yml` on the default branch, and the comments mark where your own steps go. [The workflow](https://docs.sluiceway.dev/guides/workflow/) explains every part, and what merge and deploy, stack dependencies, self-hosted runners and GitHub Environments add. [Example workflows](https://docs.sluiceway.dev/guides/example-workflows/) has it complete for common setups, and [init](https://docs.sluiceway.dev/guides/init/) writes a first version from what it finds in your repo.

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
  sluiceway:
    runs-on: ubuntu-latest
    # One run at a time, and none is dropped. An edit of any other issue gets
    # a group of its own, so it never waits for a scan or a deploy.
    concurrency:
      group: sluiceway-${{ github.event.issue.number }}
      queue: max
    steps:
      - uses: actions/checkout@v7
      - uses: pulumi/actions@v7 # without a command this only installs the CLI
        with:
          pulumi-version: ^3.229.0
      # Install what your programs need, once, for example: npm ci
      # Load your credentials and your state backend settings into the job
      # environment here. They preview and deploy, so they must be able to
      # change things. Sluiceway passes the environment to the tool and never
      # looks inside. Whatever loads a secret must also mask it.
      - uses: sluiceway/sluiceway@v0
```

**Tell it about your stacks.** Optional. Without `sluiceway.yaml` every stack that discovery finds gets a row, and anyone with write access can tick. The file at the repo root says who may tick which stack, which stacks to leave out and which files outside a stack's directory it reads. [Configuration](https://docs.sluiceway.dev/guides/configuration/) has every key.

**Load your credentials.** The workflow puts what the tool needs into the job environment, in steps before Sluiceway. Sluiceway passes that environment to the tool as it is and never reads a credential by name. [Credentials](https://docs.sluiceway.dev/guides/credentials/) has recipes for GitHub secrets, a cloud with OIDC, a secret manager and private registries.

## What it promises

- **It never holds your credentials, and there is no backend.** Previews and deploys run in your own runners with the secrets your workflow loads, and Sluiceway itself calls the GitHub API and nothing else ([security](https://docs.sluiceway.dev/guides/security/)).
- **A fresh preview before every deploy.** A tick deploys only what the row showed. If the change moved since, nothing is deployed and the row comes back with the new diff ([what a tick promises](https://docs.sluiceway.dev/guides/security/#what-a-tick-promises)).
- **No values, unless you list them.** Rows show resource types, resource names and the paths of changed properties, never a value, except at the paths you list, and never one the tool marks secret ([what reaches the issue](https://docs.sluiceway.dev/guides/security/#what-reaches-the-issue)).

## What it does

- **Pulumi**, with stacks found from their files alone ([configuration](https://docs.sluiceway.dev/guides/configuration/#stacks-and-stack-ids)).
- **OpenTofu and Terraform**, also behind Terragrunt or CDK for Terraform, with stacks declared in `sluiceway.yaml`. A tick deploys the very plan file whose diff was approved ([`stacks[].tool`](https://docs.sluiceway.dev/guides/configuration/#stackstool)).
- **Helm**, with a release in a namespace declared in `sluiceway.yaml`. A tick deploys only what the chart rendered when the diff was checked ([`stacks[].tool`](https://docs.sluiceway.dev/guides/configuration/#stackstool)).
- **Kubernetes manifests**, with a directory of manifests or a kustomization declared in `sluiceway.yaml`. A tick deploys the very set of manifests that was diffed ([`stacks[].tool`](https://docs.sluiceway.dev/guides/configuration/#stackstool)).
- **Tick to deploy.** One box per stack with changes waiting, checked against who may tick ([using the dashboard](https://docs.sluiceway.dev/using-the-dashboard/)).
- **Merge and deploy**, for Renovate and other routine updates: one tick merges a green pull request and deploys its stack ([merge and deploy](https://docs.sluiceway.dev/guides/workflow/#merge-and-deploy)).
- **Drift**, opt-in: a scheduled scan finds changes made outside the code, and a tick puts them back ([`drift.enabled`](https://docs.sluiceway.dev/guides/configuration/#driftenabled)).
- **Stack dependencies** with `dependsOn` or `phases`: a stack waits for the stacks it depends on, or for every stack of the phases before its own, and a chain deploys one layer per run ([`dependsOn`](https://docs.sluiceway.dev/guides/configuration/#stacksdependson), [`phases`](https://docs.sluiceway.dev/guides/configuration/#phases)).
- **A preview page per pending stack**, a check run with the stack's whole diff ([using the dashboard](https://docs.sluiceway.dev/using-the-dashboard/#rows-and-ticks)).
- **The check mode**, which reads your files in a pull request and says what Sluiceway will find and what your workflow lacks ([check your setup](https://docs.sluiceway.dev/guides/workflow/#check-your-setup)).
- **Values at the paths you list** with `showValues`, such as a chart's version, and the tool's own diff in the job log if you ask ([`dashboard.showValues`](https://docs.sluiceway.dev/guides/configuration/#dashboardshowvalues)).
- **A kill switch and a rehearsal**: `deploys: false` stops every deploy, and `dry-run` rehearses a tick without deploying ([`deploys`](https://docs.sluiceway.dev/guides/configuration/#deploys), [`dry-run`](https://docs.sluiceway.dev/reference/action/#inputs)).
- **Notifications**, opt-in: a short message to Slack, Telegram or your own webhook when stacks are pending, drift is found, a deploy fails or a tick is refused, plus outputs and a result file for anything else ([notifications](https://docs.sluiceway.dev/guides/notifications/)).

## More

- [The documentation](https://docs.sluiceway.dev/): [the workflow](https://docs.sluiceway.dev/guides/workflow/), [using the dashboard](https://docs.sluiceway.dev/using-the-dashboard/), [configuration](https://docs.sluiceway.dev/guides/configuration/), [credentials](https://docs.sluiceway.dev/guides/credentials/), [security](https://docs.sluiceway.dev/guides/security/), [reference](https://docs.sluiceway.dev/reference/action/), [the roadmap](https://docs.sluiceway.dev/roadmap/) and [the glossary](https://docs.sluiceway.dev/reference/glossary/).
- [sluiceway/examples](https://github.com/sluiceway/examples): a repo with Sluiceway installed and a live dashboard.
- [CHANGELOG.md](CHANGELOG.md): what changed in each release.
- [CONTRIBUTING.md](CONTRIBUTING.md): how to build and test it. To report a vulnerability, see [SECURITY.md](SECURITY.md).
- [Apache-2.0](LICENSE).
