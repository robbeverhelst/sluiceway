# One tick merges a listed update, and the scan after the merge hands its diff to apply

> Amended by 0064: the scan after a merge is narrowed when the workflow declares the dispatch input `sluiceway-merged`. Renovate's config is found and read as Renovate reads it on GitHub (JSONC and JSON5, the `.gitlab/` files skipped, presets in this repo followed), `fast-forward` falls back to the repo's method, and the repo's method is the first allowed of squash, a merge commit and rebase. A merge row may carry a note under its line. Up to 30 updates are listed, folded after 10, and the open pull requests are read past the oldest 100.

Issue 102. The daily routine of the first real user was: open Renovate's dashboard, merge a bump, wait for the scan, then tick the stack on Sluiceway. The owner decided on 2026-09-22 that one tick on Sluiceway should do both: merge the pull request and deploy its stack. Renovate keeps finding versions and opening pull requests. This record fixes the trust decision and the shape. It was built as slice 4.2.

## The trust decision

Merging on a tick is a stronger act than deploying on one: it changes the default branch. It is allowed because the right it needs is the one the tick already checks. Merging a pull request in GitHub takes write access, and every ticker has write access (0018). The ticker is named by the edit history (0025) and judged by the tick rule of the stack the pull request belongs to, so a stack whose rule is `admin` also needs an admin to merge its updates here.

Three limits keep it narrow:

- **Off by default.** `mergeAndDeploy.authors` in `sluiceway.yaml` is empty unless a reviewed change fills it.
- **Explicit authors.** Only pull requests by a login on the list are offered. An app is written with `[bot]`: `renovate` is a person's account that anyone could register, and it is never read as `renovate[bot]`.
- **GitHub decides the merge.** Sluiceway calls GitHub's merge API with the workflow token, pinned to the head commit the row showed. Branch protection, required checks and required reviews apply as to any merge. When GitHub refuses, nothing is merged and the ticker is told GitHub's words.

## Which pull requests are listed

A pull request qualifies when its author is on the list, it is not a draft, it merges into the default branch, the combined checks of its head commit are green (a pull request with no checks is not green), it does not conflict, and the claim rule of 0010 gives every file it changes to one and the same stack. That is exactly a change whose push would narrow a scan to one stack. Files `scan.unrelated` matches claim nothing and force nothing, so they are left out, as for a push.

- **A pull request that two stacks claim never qualifies** (the owner's answer to issue 102, question 3). Two deploys on one tick would approve a stack nobody looked at.
- A pull request whose file list may be incomplete does not qualify: more than 100 files, or a renamed file, whose old path GitHub's GraphQL does not give and the claim rule needs.
- The list is one GraphQL query for the oldest 100 open pull requests with their files and checks. The scan makes it only when the list of authors is not empty, deploys are on and the dashboard is not read only. A query that fails keeps the rows of the live body and never fails the scan: a row only offers a merge, and `resolve` judges the pull request again before it merges.
- At most 10 are listed, oldest first, so the section never eats the size budget (0028).

## The row

The section "Updates waiting to merge" sits above Pending, with one line of text under its heading and one line per pull request:

```md
- [ ] **apps/odoo:prod** · Update Helm release odoo to v17.0.4 · #418 by renovate[bot] <!-- sluiceway:merge pr="418" stack="apps/odoo:prod" head="<commit id>" -->
```

- **No preview before the merge** (question 1). The row shows the bump from the title, and the fresh preview after the merge is the plan. Previewing the branch of every listed pull request would double the cost of a scan, and the diff that deploys is checked after the merge anyway.
- The title is the one place a pull request title reaches the issue. 0026 kept titles out because they are free text of any length. Here the title is the content: it says which dependency moves to which version. It is escaped like every text from outside, kept on one line, and cut at 80 characters. With `dashboard.redact` on it is left out.
- The row is not a row block of a stack (0009). It is one line with a marker of a new kind, `sluiceway:merge`, whose keys are the pull request, the stack and the head commit. A parser of an older version does not see it. Every writer carries the lines as they are, less the ones it merged, and only the scan draws them from the list.
- A tick is a tick on the pull request at one head commit, the way a row is ticked at one hash. A new head commit under a tick ends its stretch in the edit history (0025).

## The tick

`resolve` handles a merge tick next to the row ticks of the same run:

1. The ticker is named by the edit history and judged by the tick rule of the stack in the marker. A tick on a stack that has an open deployment, or while `deploys` is `false`, merges nothing and its box is cleared.
2. The pull request is read again and judged again. The marker is text a person can edit, and checks and files may have changed since the scan. A pull request that is not open, has a new head commit, no longer qualifies, or belongs to another stack than the marker says is not merged. The ticker gets a comment.
3. The method is the one Renovate would use (question 4): `automergeStrategy` from Renovate's config in the repo, when the repo allows that method, else squash, rebase or a merge commit, the first one the repo allows.
4. The merge call carries the head commit that was ticked. GitHub's refusal is an answer, not a failure: nothing is merged, the box is cleared, the comment quotes GitHub, and the job stays green (0012). An answer that is about Sluiceway, such as a missing permission, turns the job red and leaves the box ticked.
5. A merged pull request gets a deployment record on the merge commit, with `{ "v": 1, "ticker", "run", "merge": 418 }` and no hash, because nothing has been previewed. It is `queued`, the stack's row shows deploying, and it is not put in the `matrix`.
6. `resolve` starts a full scan by dispatching its own workflow, as for the rescan box.

## The hand-off

**A merge made with the workflow token starts no workflow run of its push.** GitHub's documented rule for the `GITHUB_TOKEN` (0017) holds for a merge too. The plan's slice row expected "the narrowed scan that the merge push starts": that scan never starts. `resolve` dispatches a full scan instead. It previews every stack, which costs more than a narrowed scan and is correct. Narrowing that scan is on `docs/later.md`.

Every scan hands on at its late read, where it reads the deployment records anyway, so a merge record costs no request of its own and is found whatever started the scan:

- An open record with `merge` in its payload waits for a scan whose checked-out commit holds the merge commit: the same commit, or one that GitHub's compare API says is ahead of it. Any other scan leaves it open, and the stack stays deploying.
- Its stack is previewed first, also by a narrowed scan that did not plan to.
- With a diff, the merge record ends as `inactive` with the words "merged, the deploy follows in a record of its own", and a new record opens with the fresh diff hash, the ticker of the merge record and the run of the scan. The scan puts it in its own `matrix` output, and the workflow's `apply` job takes it like any record. The merge record is ended first, so a hand-off can never be made twice: a scan that dies in between leaves a pending row, and a tick deploys it.
- With nothing to deploy, the merge record ends as `success`, "nothing to deploy, already in sync" (0051). With a failed preview it ends as `failure` with the preview's reason, and while `deploys` is `false` as `failure`, "deploys are turned off in sluiceway.yaml".
- `apply` previews again and compares the hash, as for every tick (0008). **When the change moved between the scan after the merge and the deploy** (question 2), nothing is deployed, the row shows the fresh diff, the outcome is `refused`, and the ticker gets the comment of 0051. The code is on the default branch and stays there.

## Consequences

- The `resolve` job of a workflow with merge and deploy needs `contents: write`: GitHub's merge endpoint needs it, and so do the merge settings of the repo. The plan's slice row said `pull-requests: write`. GitHub's permission tables say `contents: write`, and `pull-requests: read` is enough for the list. The README says to give `resolve` its own `permissions:` block rather than widen the whole workflow.
- `scan` now sets `matrix` too, always `[]` unless it handed a merge on. Since record 0056 a dispatched run also runs `resolve`, which sets its own `matrix`, so one expression that picks either output would drop one of them. The workflow gets a second apply job, a copy of `apply` that takes the scan's matrix, and `settle` waits for both. The README's default workflow is unchanged, because the feature is off by default, and its section on merge and deploy shows the three changes.
- **Dependencies (record 0056).** The merged change deploys on its own, outside the layers of 0056. So `resolve` does not merge for a stack whose `dependsOn` names a stack with a pending row or an open deployment, and the ticker is told which. The scan after the merge does not check again: a dependency that became pending in the minutes between the merge and that scan is not waited for. That gap is on `docs/later.md`.
- A merge record outlives the run of `resolve` that opened it. `settle` and every render that ends an open record whose run is over leave it alone. It is ended by the scan after the merge, or it stays open, and its stack deploying, until a scan holds the merge commit. The scheduled full scan is one.
- The record that deploys lives as long as the run of the scan, and `settle` in that run ends it if `apply` never reports, as for any record.
- An `inactive` record with the hand-off's words is no deploy fact and no line of Recently deployed: the record that deploys is both.
- A merge row is one line with no room for a note. A merge tick cleared for a deploying stack, for `deploys: false` or because nobody could be named says why in the job log only. A refused or failed merge gets the comment.
- Previewing the pull request's branch before the merge, merging a pull request that two stacks claim, reading Renovate's JSON5 config and presets, and narrowing the scan a merge starts are on `docs/later.md`.
- This amends 0009 (a marker kind of a new sort outside the row blocks), 0017 (the bot merges), 0018 (a tick on a pull request, judged by its stack's rule), 0025 (a scan may open a deployment record, and only for a merge), 0026 (a pull request title may reach the issue, on this row only), 0035 (`scan` sets `matrix`), and 0003 (the payload may carry `merge` in place of `hash`).
