# Sluiceway

Sluiceway keeps one GitHub issue, the dashboard, that shows which infrastructure stacks have changes waiting. You tick a stack's box and a GitHub Actions run deploys exactly that stack.

It is a GitHub Action and nothing else. There is no server, no database and no hosted part. Previews and deploys run in your own runners.

> [!WARNING]
> Sluiceway is not released yet, and only the first half works. `scan` works: it previews your stacks and writes the dashboard. `resolve` works too: it checks who ticked and records the deploy, and `settle` gives a result to a deploy that never reported one. `apply` still fails with "not implemented yet", so a ticked box deploys nothing. You can already run the scan read only, pinned to a commit: see [Try the scan, read only](#try-the-scan-read-only). Watch the releases to hear when the rest lands.

## How it works

1. After a merge to the default branch, and on a schedule, a **scan** previews the stacks in the repo.
2. The scan writes the results to the dashboard issue: one row per stack, with a checkbox on every stack that has changes waiting.
3. A person ticks a box. That is a request to deploy that stack exactly as the row shows it.
4. Sluiceway checks that the person is allowed to tick that stack, then previews the stack again. It deploys only if the fresh preview still matches what the row showed.
5. The row goes back to in sync, or shows why the deploy failed.

The issue is a rendered view and never the source of truth. What is pending is always worked out again from a fresh preview.

Pulumi is the first supported tool. The adapter interface is built so that OpenTofu and Terraform can follow.

[CONTEXT.md](CONTEXT.md) defines the words used here and in the code.

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
| `preview-timeout` | `10` | Time limit for one preview, in minutes. |
| `github-token` | the workflow token | Leave it at the default. Sluiceway always acts as the workflow's own `GITHUB_TOKEN`. A GitHub App token or a personal access token is not supported. `check` never uses it. |
| `deployment-id` | required in `apply` | The deployment record to deploy. It comes from the `matrix` output of `resolve`. Not in `action.yml` yet. |

## Outputs

| Output | Set by | What it is |
|---|---|---|
| `matrix` | `resolve` | A JSON list with one `{ stack, environment, deployment }` entry per deploy that was started, or `[]`. |

## Check your setup first

Start here. The `check` mode tells you, in a pull request, whether Sluiceway will understand your repo, before any workflow that previews or deploys is merged. It reads files and nothing else: no credentials, no infrastructure tool, no GitHub API, no write. It needs `contents: read`, so it is safe on `pull_request`, also from forks. Put this in `.github/workflows/sluiceway-check.yml`:

```yaml
name: sluiceway-check

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
      # Replace the zeros with a full commit SHA of sluiceway/sluiceway.
      - uses: sluiceway/sluiceway@0000000000000000000000000000000000000000
        with:
          mode: check
```

The job log and the summary of the run say:

- whether `sluiceway.yaml` is valid, with the same messages a scan gives,
- every stack that discovery found, with its environment, its tick rule and its inputs,
- which stacks each `ignore` glob leaves out. A glob that leaves out nothing is a warning. `ignore` matches the stack id, so `apps/web` ignores nothing, and the warning names the glob that would work (`apps/web:*`),
- the files that no stack claims, grouped by directory. A push that changes one of them previews every stack. A ready-to-paste `scan.unrelated` block covers the ones that look like docs and tooling. Sluiceway never decides this for you, so leave out any file one of your programs reads.

The job is red only when the config is not valid or discovery fails. A check cannot say that a preview will work: a stack that does not exist in the backend, a missing credential or a registry the runner cannot reach shows only in a scan. The check reads the files of the checkout, so run it right after `actions/checkout`, before anything writes files into the workspace.

## Try the scan, read only

Until the first release you can run the scan alone. Put this in `.github/workflows/sluiceway.yml` on the default branch. It is the workflow under [Usage](#usage) with everything that can deploy taken out.

```yaml
name: sluiceway

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
      # Replace the zeros with a full commit SHA of sluiceway/sluiceway.
      - uses: sluiceway/sluiceway@0000000000000000000000000000000000000000
        with:
          mode: scan
```

What this does and does not do:

- **Nothing can be deployed.** The workflow has no `resolve` and no `apply` job, and it does not listen to issue edits, so a ticked box starts nothing. The next scan clears the box again and leaves a note on the row. A scan only ever asks the tool for a preview. The token can read the code, write issues, and read and write deployment records, and nothing else. A scan reads the deployment records, which is where Sluiceway keeps who deployed what and when, and with no `resolve` job there are none. `actions: read` lets it see whether a workflow run is over, and whether a run that an issue edit started is still on its way. `pull-requests: read` lets a row name the pull requests that made it pending.
- **Pin the action to a full commit SHA**, all 40 characters, of a commit in this repository. No tag exists before the first release, so `@v0` does not resolve yet.
- **The header image only shows from a release tag or a commit SHA.** The images are served from the exact ref of the running action, never from one that can move, so that a picture never changes behind a dashboard that was already written. Started from a branch such as `@main`, Sluiceway falls back to the release tag of its own version, and before the first release that tag does not exist. Started from a copy inside your own repo (`uses: ./`), it names a commit that this repository does not have. In both cases the scan works and the picture is broken. `dashboard.personality: false` in `sluiceway.yaml` takes the picture out.
- **A push gives a narrowed scan**: only the stacks that claim a changed file are previewed, and every other row stays as it is. The schedule and "Run workflow" give a full scan. The first scan is always full.

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

## Usage

Only `scan` works yet (see the warning at the top). This is the whole workflow, the one the other modes are being built for. It goes in `.github/workflows/sluiceway.yml` on the default branch. For what runs today, see [Try the scan, read only](#try-the-scan-read-only).

```yaml
name: sluiceway

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

- **`actions: write`** lets the rescan box and `settle` start a scan, and lets a scan see whether a run is still on its way. `id-token: write` is not in the block. Add it only to the jobs that run the tool, and only if your credential step uses OIDC.
- **`sluiceway-scan`** makes scans run one at a time. A running scan finishes, and of the waiting ones only the newest runs.
- **`sluiceway-resolve`** does the same for ticks. Any `resolve` run handles every ticked box it finds, so a replaced run loses nothing. Replaced runs show as cancelled in the Actions list. That is normal.
- **`queue: max`** on `apply` keeps a waiting deploy from being cancelled by a newer one. Never add `cancel-in-progress` to this job.
- **The `if:` on `resolve`** keeps an edit of an ordinary issue from starting a runner. If you change `dashboard.label`, change it here too.
- **`resolve` hands `apply` a deployment record.** It creates one record per ticked stack in GitHub's Deployments list and puts `{ stack, environment, deployment }` in `matrix`. `apply` deploys only while that record is still open. "Re-run failed jobs" therefore deploys nothing. To try again, tick the box again.
- **`!cancelled()` on `apply`** lets the deploys that `resolve` started go ahead when `resolve` itself ended red, for example because one of several ticks could not be verified or the dashboard could not be written. Without a status check in its `if:`, GitHub skips a job whose `needs` failed. Every entry in `matrix` is a record that `resolve` created after it checked the ticker, so nothing else can get through here.
- **`settle`** gives a deploy a result when its job was cancelled or rejected, so a row never stays "deploying" for ever. It touches only the deployment records of its own run. When it ended one it starts a full scan, which writes the row again with the failure line, so it needs `actions: write` as well.
- **`v0`** is the moving tag until 1.0.0. Pin a commit SHA instead if you want to review every update.

Self-hosted runners work the same way: change `runs-on` for `scan` and `apply`. They need runner version 2.328.0 or newer, and ARM32 is not supported. `resolve` and `settle` hold no infrastructure secrets, so they can stay on hosted runners.

### With GitHub Environments

The tick is always a gate. Where your plan has environments, they make it a stronger one: store the credentials that can change things as secrets of an environment that is limited to the default branch, and add required reviewers where you have them. Give every stack an `environment` in `sluiceway.yaml`, and add this to the `apply` job:

```yaml
    environment:
      name: ${{ matrix.environment }}
      deployment: false # Sluiceway already records the deploy
```

GitHub lists an environment for every name a deployment record uses, so your repo settings will show one named `sluiceway` (or the names you configured) even if you never use the feature. That entry is only a label.

Without `deployment: false` GitHub records every deploy a second time. Custom deployment protection rules do not work with `deployment: false`. If you use them, leave it out and accept the second record. Sluiceway ignores it.

## Configuration

<!-- PLACEHOLDER: sluiceway.yaml reference. -->

> [!NOTE]
> **Placeholder.** Sluiceway reads an optional `sluiceway.yaml` at the repo root. The full reference arrives with the docs of M2. Until then the keys are listed in [docs/build-plan.md](docs/build-plan.md), section 3, and [schema/sluiceway.schema.json](schema/sluiceway.schema.json) describes them for editors. Unknown keys are an error.

## Credentials

Sluiceway never holds credentials. That is five promises you can check against the code:

1. **No credential inputs.** The action takes one secret, the GitHub token. No input and no config key ever carries a cloud, backend or secret manager credential.
2. **Never read by name.** No Sluiceway code reads a credential variable. Your workflow prepares the environment, and it goes to the tool as one opaque block.
3. **Never stored, never sent.** Nothing from the environment reaches the issue, deployment records, job summaries, artifacts or caches. The only network calls are to the GitHub API and whatever the tool itself makes.
4. **Only the modes that run the tool need credentials.** `scan` and `apply` run the tool. `resolve` and `settle` never do, so the job that reacts to an issue edit holds no infrastructure secrets.
5. **A hosted version would keep all of this.** The tool always runs in your own runners.

The dashboard shows resource types, resource names and the names of changed properties. It never shows a property value, whether or not the tool marks it secret.

## Documentation

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
