# Start read only

You can run the scan alone first, to see your dashboard with nothing that can deploy. It is [the workflow](workflow.md#the-workflow) with everything that can deploy taken out. Run the [check](workflow.md#check-your-setup) before it, in a pull request.

Put this in `.github/workflows/deploy-dashboard.yml` on the default branch. It uses the action at `@v0`. [Pin a commit](workflow.md#pin-a-commit) says how to pin a release by its commit SHA instead.

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
  checks: write

jobs:
  sluiceway:
    runs-on: ubuntu-latest
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
      # environment here. For Pulumi, credentials that can only read are
      # enough. A Helm or Kubernetes manifests preview is a server-side dry
      # run, which needs what a deploy needs (see Credentials). Whatever loads
      # a secret must also mask it.
      - uses: sluiceway/sluiceway@v0
```

And tell Sluiceway that nothing acts on a box, in `sluiceway.yaml` at the repo root:

```yaml
dashboard:
  readOnly: true
```

What this does and does not do:

- **Nothing can be deployed.** The workflow does not listen to issue edits, and with `dashboard.readOnly: true` the step only ever scans, on a push, the schedule and "Run workflow" alike. The dashboard shows that too: pending rows have no box, there is no rescan box, and a line under the Pending heading says the dashboard is read only. Without it the rows get boxes that do nothing, and a tick sits there until the next scan clears it. A scan only ever asks the tool for a preview. The token can read the code, write issues, read and write deployment records, and write check runs, and nothing else. A scan reads the deployment records, which is where Sluiceway keeps who deployed what and when, and with nothing that deploys there are none. `actions: read` lets it see whether a workflow run is over, and whether a run that an issue edit started is still on its way. `pull-requests: read` lets a row name the pull requests that made it pending. `checks: write` gives every pending stack its preview page.
- **The header image is served from an exact release tag or commit SHA.** Never from one that can move, so that a picture never changes behind a dashboard that was already written. Started from `@v0` or a branch, Sluiceway names the release tag of its own version, such as `v0.1.1`. Started from a copy inside your own repo (`uses: ./`), it names a commit that this repository does not have, and the picture is broken while the scan still works. `dashboard.personality: false` in `sluiceway.yaml` takes the picture out.
- **A push gives a narrowed scan**: only the stacks that claim a changed file are previewed, and every other row stays as it is. The schedule and "Run workflow" give a full scan. The first scan is always full.

To turn it into the whole workflow later, add the `issues` trigger of [the whole workflow](workflow.md#the-workflow), change `actions: read` to `actions: write`, load credentials that can deploy, and take `readOnly: true` out of `sluiceway.yaml`. The change to `sluiceway.yaml` makes the next push a full scan, and every pending row gets its box back.
