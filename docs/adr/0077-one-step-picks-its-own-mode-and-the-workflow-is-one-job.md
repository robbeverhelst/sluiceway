# One step picks its own mode, and the workflow is one job

The workflow people copied was four jobs, one per mode, joined by `if:` and `needs:`: `if: github.event_name == 'workflow_dispatch' || (github.event_name == 'issues' && contains(github.event.issue.labels.*.name, 'sluiceway'))` on `resolve`, `!cancelled()` and a matrix on `apply`, `always()` and two `needs` on `settle`, and two more jobs and a longer condition for merge and deploy. Every line was right, and every line was one more thing a person had to copy exactly and keep in step with `sluiceway.yaml`. The owner, 2026-09-22: "these crazy ifs, cant we make sure this isnt necessary anymore, we want the ux as simple as possible, easy to install and easy to configure." Build plan slice 5.12.

This amends 0014, 0017, 0025, 0035, 0042, 0061, 0065 and 0074.

## Decision

### Auto mode

- **`mode` is optional, and its default is `auto`.** A step with no mode, or with `mode: auto`, reads `GITHUB_EVENT_NAME` and the payload and runs what the event asks for. `src/core/auto-mode.ts` holds the rule, `src/modes/auto.ts` runs the modes one after the other, and the six explicit modes are unchanged.

  | Event | Runs |
  |---|---|
  | `push` to the default branch | `scan` |
  | `push` to any other ref | nothing, a notice |
  | `schedule` | `scan` |
  | `workflow_dispatch` | `resolve`, then `scan` |
  | `issues`, `edited`, on the dashboard | `resolve` |
  | `issues`, any other issue or any other action | nothing, a notice |
  | `pull_request`, `merge_group` | `check` |
  | anything else, `deployment` included | nothing, a notice |

- **What `resolve` and the scan hand on is deployed in the same step.** Each `matrix` entry goes to `apply`, one after the other, in the order it was handed on. When anything was handed on, `settle` runs last. A mode that ends red does not stop what follows: the deploys it started still run and `settle` still runs, as `!cancelled()` and `always()` did, and the step goes red at the end with every reason.
- **On a dispatch `resolve` runs first**, so the next layer of a chain (0056) goes out before the scan of that run previews, and the scan sees it deployed.
- **The dashboard is known by its label from `sluiceway.yaml`.** The cheap check of 0017 runs before any mode, from the payload: open, written by the bot with a root marker, and then the label. The workflow names no label, and changing `dashboard.label` needs no change to it.
- **`dashboard.readOnly` is read too.** With it on, a dispatch only scans and an issue edit ends with a notice, so the read-only trial is the same one-step workflow without the `issues` trigger.
- **A push to a branch that is not the default branch is not Sluiceway's** when the payload names the default branch, so a workflow without a branch filter scans only the default branch. The recommended workflow keeps `branches: [main]`, because the job loads credentials before Sluiceway runs.
- **`deployment` is not a trigger Sluiceway uses.** A deployment record made with the workflow token starts no run (0017), so `resolve` cannot hand a deploy to another run that way. A dispatch is the one event the workflow token may start.
- **Inputs.** Auto mode accepts every input of the modes it may run: `strict` for its scan, `dry-run` and `deploy-timeout` for its deploys, `backend` for its check. `deployment-id` is an error in auto mode, as in every mode but `apply`.
- **Outputs.** The step sets what each mode it ran sets. `matrix` is every deploy the step started. A step that deploys several stacks sets `outcome`, `stack` and `result-file` once per deploy, so a step after it sees the last one; the step is red when any failed. The job summary is the summaries of every mode it ran, in order.
- **A post step settles a run that was cancelled mid deploy.** `action.yml` gains `post: dist/post.js` with `post-if: always()`. The file is written by hand, sets a flag and loads the one bundle. The main step saves a state when it hands a deploy on and another when `settle` ran. The post step runs `settle` only in auto mode, only when a deploy was handed on and `settle` did not run. Where the runner kept no state, nothing runs, and the next render ends an open record whose run is over (0003).

### The one-step workflow

The README, `docs/workflow.md`, the read-only trial, the three example workflows and `init` all write the same shape, and a test holds each of them to it:

```yaml
jobs:
  sluiceway:
    runs-on: ubuntu-latest
    concurrency:
      group: sluiceway-${{ github.event.issue.number }}
      queue: max
    steps:
      - uses: actions/checkout@v7
      # the tool, the packages and the credentials
      - uses: sluiceway/sluiceway@v0
```

- **The triggers are the four of before**: `push` to the default branch, the schedule, `workflow_dispatch` and `issues` with the type `edited`. The permissions block is the one of before. With merge and deploy, `contents: write` moves into it, and the dispatch input of 0064 is declared as before.
- **The concurrency group is named after the edited issue, with `queue: max`.** Every run of a scan, a dispatch and a tick of the dashboard waits in line, and a waiting run is never dropped. A static group was tried first and rejected: GitHub starts the job for an edit of any issue, so on a busy or public repo those runs would wait behind scans and deploys and could flood the line ahead of a tick. With the issue in the name, an edit of another issue gets a group of its own and ends in seconds. `queue: max` is needed because the dispatched runs now carry deploys (the next layer, the merged change), and a replaced run would lose them. `cancel-in-progress` would stop a deploy half way.
- **Explicit modes and the split workflow stay**, for anyone who wants what one job cannot do (below). They are documented on their own page, `docs/split-workflow.md`, with their `if:` and `needs:`. It is the one page of the user docs that has any.

### What one job cannot do, and what it costs

- **One set of credentials.** The job previews and deploys with the same credentials, so they must be able to write. 0014 recommended credentials that only read for `scan`; that is the split workflow's now.
- **The job an issue edit starts loads the credentials.** 0014 called promise 4 "the real gain": the job anybody with issue access can cause holds no infrastructure secrets. In one job it does. What the run executes is only code of the default branch, the event reaches no step, and Sluiceway ends it with a notice before it reads the dashboard when the issue is not the dashboard, so the credentials are loaded and not used. The cost is one runner minute and one load from the secret store per edit, on a public repo per edit by anyone. Promise 4 still holds of the modes: `resolve` and `settle` are handed no process runner and no tool environment in auto mode either. The split workflow keeps the stronger reading.
- **No environment per stack.** `environment:` is a key of the job. One job can name one environment, limited to the default branch (setup 2 of 0020), and cannot have required reviewers, because every run would wait for one. Setup 3 of 0020 needs the split workflow.
- **Deploys in turn.** Stacks ticked in one edit deploy one after the other, and a tick waits for a run of the dashboard's group that is deploying. The split workflow deploys them side by side.
- **Ticks share the runner of scans.** A self-hosted runner pool serves ticks too. The split workflow can keep `resolve` and `settle` on hosted runners.
- **`contents: write` reaches the preview** with merge and deploy, where the split workflow gives it to `resolve` alone.
- **Different permissions per mode** are not possible in one job. The block is the union, which is the block the docs gave every workflow already.

## Considered

- **A reusable workflow at `sluiceway/sluiceway/.github/workflows`.** It could keep the four jobs, their `if:` and `needs:` and their groups inside Sluiceway's repo, and the caller would write one `uses:`. It was rejected as the harder one for users. A called workflow cannot run the caller's steps, so the tool install, the packages and the credential step (0013) would have to become inputs: a script string at best, never an action such as `aws-actions/configure-aws-credentials` or `1password/install-cli-action`, because `uses:` cannot be an expression. Secrets would pass through `secrets: inherit`, environments through more inputs, and a called workflow's permissions are capped by the caller's block anyway, so that block would still be the caller's to write. The one job keeps the file the person's own: the same steps they would write for any CI job, and one step of Sluiceway after them.
- **A static concurrency group** (`group: sluiceway`). Simpler to read, rejected for the queue above.
- **No concurrency group, and a lock of Sluiceway's own.** Two runs that resolve at once could make two records for one tick, and two deploys of one stack could run at once. A lock through the GitHub API is a new mechanism with its own failure modes, where GitHub's queue already exists.
- **Deploys side by side inside the step.** The job log of two deploys at once interleaves, and the order of a chain matters. In turn is simpler to read and to reason about.
- **Deploying from a `deployment` event.** Not possible, above.
- **Keeping the check in the same file.** `pull_request` runs the check in auto mode, but the job would load credentials for the pull request's code. The check keeps a workflow of its own, now with no mode either.

## Consequences

- 0014 is amended: promise 4 holds of the modes, and "the job an issue edit starts holds no infrastructure secrets" holds of the split workflow only. The docs say so.
- 0017 is amended: the cheap check also runs in auto mode, before any mode, and in the one-step workflow an edit of an ordinary issue does start a runner, which ends with a notice.
- 0025 and 0035 are amended: the groups of the one-step workflow are one per edited issue and one for everything else, with `queue: max`. `settle` runs in the step after the deploys, and in the post step after a cancelled run.
- 0042, 0061 and 0074 are amended: the check reads a step with no mode as auto mode and works out the modes it runs from the triggers of its file. For such a job it warns about a missing trigger, a permission any of those modes needs, a missing group, a group without `queue: max` or with `cancel-in-progress`, and a `pull_request` trigger next to it, with its own words. It no longer warns that a step has no mode. `if:`, `needs:` and a second apply job are not asked of it.
- 0065 is amended: `init` writes the one-step workflow, with `timeout-minutes: 60` on the job, no environment and one credential step that loads the env file that deploys. It refuses to write when any workflow runs Sluiceway beyond the check, a step with no mode included.
- `CONTEXT.md` gains auto mode, the one-step workflow and the split workflow.
- `docs/later.md` gains split credentials through a dispatched second workflow, one set of outputs per deploy, and a check that knows about busy issue trackers.
