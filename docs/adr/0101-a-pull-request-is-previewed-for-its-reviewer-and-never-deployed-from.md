# A pull request is previewed for its reviewer, and never deployed from

Every pull-request-shaped tool Sluiceway is compared with leads with a plan on the pull request: a reviewer wants to see what a change does to the infrastructure while reviewing it, not after merging it (issue 231). The check on a pull request deliberately runs no preview: it needs no credentials, no tool and no write access, which is what makes it safe to run on anything (0042). That property is worth keeping, so the preview is an opt-in second thing, not a change to the check. The owner decided on 2026-09-24. Build plan slice 5.36.

This amends 0042 and 0074 (the check may run the tool for one more reason, on request) and 0050 (a preview page may sit on a pull request's head commit).

## Decision

### Opt in, on the check step

- **A new input, `pull-request-preview`, `check` and `auto` only, `false` by default.** With `true`, the check also previews the stacks the pull request claims, with the environment of its job minus `INPUT_*` (0013), which holds whatever credentials the workflow loaded before the step. Every other mode refuses it, as they refuse `backend: true` (0074). It is an input and not a key of `sluiceway.yaml`, because the thing it says is about the job, not the repo: this job holds credentials and may preview. A key in the config file would make the credential-free check workflow of 0042 try previews on every pull request and fail them all.
- **It acts on the `pull_request` event only.** On any other event, `merge_group` included, the input is a line in the log and the summary that says the run names no pull request. The check keeps a workflow of its own (0077), and the docs show the preview as that workflow with the tool, credentials and `checks: write` added.
- **Which stacks: the ones the pull request claims**, by the claim rule of a narrowed scan (0010): a changed file inside a stack's directory or among its `inputs`, a renamed file under both paths, a file `scan.unrelated` covers claims nothing. The files come from GitHub's comparison of the pull request's base and head commits, the call a push's narrowed scan makes, which needs `contents: read` and no more. Unlike a narrowed scan, a file no stack claims does not turn this into a preview of every stack: a preview per pull request per push is runner time, and the scan after the merge is the full scan. Such files are listed in the summary. A comparison of 300 files or more may miss files, so it previews nothing and says so.
- **It previews the merge.** The checkout of a `pull_request` run is the merge of the branch into the base, so the preview runs on the checkout as it is, and no copy is made (0071 copies because a scan's checkout is the default branch). The docs say to leave `ref:` off the checkout step.
- **Where it goes: check runs, not comments.** One check run per claimed stack on the pull request's head commit, where the pull request shows its checks, named `sluiceway / <stack id>` like a scan's preview page, `completed` and `neutral`, found again by name and updated in place (0050). Its output is what a scan's page shows: types, names, property paths, counts, the destroy warning, a value only at a path `dashboard.showValues` lists, never the tool's own words. A stack the merge would not change and a preview that failed get a page too, in Sluiceway's words, so every claimed stack shows in the pull request's checks whatever the preview found. The job summary lists every stack with its page, and the job log holds the tool's words per stack. A comment was rejected: it notifies every subscriber on every push, and check runs are quieter and already exist.
- **Nothing deploys from it.** It opens no deployment record, writes no issue and leaves no row: the dashboard is about what is merged and waiting, and this is information for a reviewer. The deploy still happens after the merge, from the fresh preview of the scan, and `apply` refuses a change that moved (0008, 0019). Every page says so in one line, so the stale-plan failure a plan-on-the-pull-request tool can have cannot happen here.

### Two rules that are fixed

- **A pull request from a fork is refused outright.** GitHub withholds secrets from a fork's `pull_request` run by default, and Sluiceway does not rely on that: the refusal is the first thing the preview decides, before any request, from the payload alone. A head whose repository the payload does not name is a fork too. The docs say it in one plain sentence.
- **`pull_request_target` is never used.** It runs with the secrets of the base branch against code that is not merged, which is exactly what must not meet a stranger's code. The preview refuses it whatever the payload says, and the check warns about a step with the input in a file that runs on it. The docs say it in one plain sentence.
- **The job should carry credentials that read, not ones that change things.** Previewing a pull request runs the repo's own program with credentials; for Pulumi and CDK for Terraform that is arbitrary code from the branch, from anyone who may open a pull request. Every competitor does the same, and the docs still say it: a preview reads state and asks the cloud what would change, so read access is what it needs.

## Considered

- **A key in `sluiceway.yaml`.** Rejected, above: the opt-in is about the job that holds credentials.
- **A preview of every stack when a file no stack claims changes**, as a narrowed scan does. Rejected for cost: a lockfile bump would preview a fifty-stack repo on every push to the pull request, and the scan after the merge does that once.
- **A comment on the pull request.** Rejected, above. It stays in `docs/later.md`.
- **A `failure` conclusion for a failed preview.** Rejected: Sluiceway writes `neutral` check runs only (0050), so a page can never block a merge under a required name, and the title says the preview failed.
- **Listing the pull request's files through the pull requests API** past 300 files. It pages to 3,000 and needs `pull-requests: read`. Left out (`docs/later.md`).

## Consequences

- 0042 and 0074 are amended: the check runs the tool when, and only when, a workflow sets `backend: true` or `pull-request-preview: true`. Without either the promise is unchanged. The check job still cannot reach the port or the process runner by itself: the dispatcher hands in the part that previews, as it hands in the backend part, and the import walk of 0042 holds.
- 0050 is amended: a page of the same name may be written on a pull request's head commit by the check. A scan that later scans that commit, after a rebase or a fast-forward merge, finds the page and updates it in place, which is the right page for a commit on the default branch.
- 0100 is amended: the check reads the `env-file` input with `pull-request-preview: true` as with `backend: true`, once for both, because the preview runs the tool.
- 0077 is unchanged: `pull_request` runs the check in auto mode, and the check does the preview on request.
- The workflow check (0061) warns about a step with the input that lacks `checks: write`, and about one in a file that runs on `pull_request_target`.
- `CONTEXT.md` gains the pull request preview. `docs/later.md` loses the line about plan comments on pull requests and gains the comment and the file list.
