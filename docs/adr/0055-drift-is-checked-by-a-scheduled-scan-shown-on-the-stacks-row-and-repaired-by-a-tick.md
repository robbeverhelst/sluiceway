# Drift is checked by a scheduled scan, shown on the stack's own row, and repaired by a tick

> Amended by 0059: `stacks[].drift.enabled` sets the check per stack, a drifted stack has a preview page and its row's link is `preview`, and the trail says when a deploy put drift back.

Records 0009, 0008 and 0031 left room for drift: a row state, a marker key that says the hash covers drift, one hash over both diffs, and a header state still to be drawn. Record 0015 left open whether a deploy should also repair drift. The build plan's slice 4.3 asks for part 1: detect it, show it, and repair it by a tick. This record fixes how.

Amends 0001, 0007, 0008, 0009, 0015, 0029, 0031, 0033, 0041 and 0043.

## Decision

- **`drift.enabled` in `sluiceway.yaml`, off by default.** With it on, every scan that a `schedule` starts checks every stack it previews for drift, and so does a `workflow_dispatch` that a person started with "Run workflow". A dispatch by the workflow token does not check: `settle` dispatches a full scan after every deploy (0035) and the rescan box dispatches one too, and checking there would read every real resource of every stack after every deploy. Whether a person started the run is the type of the event's sender, `User` or `Bot`. There is no `drift.schedule`: when a scan runs is the workflow's `on:` block, and the loader says so to anyone who writes one. `stacks[].drift` stays a reserved key: there is no drift setting per stack in part 1.
- **A push checks only what it must.** A scan that a push starts checks drift only for the stacks it previews whose row, at the first read, says its hash covers drift. Without that, a push that touches a drifted stack's files would drop drift that is known, and the row would claim in sync, which the glossary defines as "no known drift".
- **The check is an optional adapter method, `detectDrift`.** It changes neither the state nor anything real, runs in the same pool slot as the stack's preview, right after it and with the same time limit, so one stack never runs the tool twice at once. A stack whose preview failed is not checked: it has no row to show drift on. A tool without a drift check answers nothing, and its stacks are never checked. OpenTofu is not checked in part 1.
- **Pulumi: `pulumi refresh --preview-only --json`, streamed.** The command line of the Pulumi research. From v3.229.0, the minimum of 0001, it takes no stack lock on a file backend. The recorded `drift-locked` scenario proves it on both CLI versions: with a lock held the way a running deploy holds it, the check runs, and a deploy in the same place fails on that lock.
- **Drift is a list of changes on the diff, `Diff.drift`.** Two ops, what happened to the real object outside the code: `update`, a property changed, with the paths the tool names, and `delete`, the object is gone. No value is ever read from the check, and `dashboard.showValues` does not reach it (0021, 0052).
- **The one hash covers both** (0008). A drift list that is not empty joins the canonical document under the key `drift`, between `changes` and `stackId`, sorted by address like the changes. A diff without drift hashes as it always did, so no row of a repo without drift gets a new hash.
- **The row state `drift`** is a stack whose preview has nothing to deploy and whose drift check found drift. It has a box. A pending stack that also drifted stays `pending` and shows its drift under its changes. The precedence of 0009 becomes: deploying, then preview failed, then pending, then drift, then in sync.
- **The marker key `drift="true"`**, after every older key, on any row whose hash covers drift. `resolve` copies it onto the deployment record's payload as `drift: true`, an added key, so the payload stays version 1. A reader that does not know the key compares without drift and ends as a moved change, which is the safe direction.
- **`apply` checks drift again** when the payload says so, after the fresh preview and before it compares. Drift that moved after the tick ends as a moved change with a fresh row, as 0008 promises. A drift check that fails ends the record as a failure, as a failed preview does. Drift that was put back outside the dashboard, with nothing to deploy from the code, is nothing to deploy (0051).
- **A tick on a row with drift repairs it.** The deploy reads what is real first and then deploys the code over it. For Pulumi that is `pulumi up --refresh`, added only when the fresh check found drift. Recorded on both CLI versions: after it, the check finds no drift, for a removed file and for a changed property.
- **Where drift shows.** A section "Drifted" right under Pending, with a fixed line. `N drifted` on the counts line, with an orange dot, only when it is not 0, so a repo that never checks keeps its counts line byte for byte. The row's link goes to the summary, which lists the drift of every stack in full under "Drifted" and in the entry of a pending stack. The job log's group of the stack, the result file (a `drift` state and a `drift` list) and the summary of an `apply` list it too.
- **The header state `drift`**, water seeping through the closed gate, with Penny awake and puzzled. It sits after pending and before first run: failing, deploying, pending, drift, first run, in sync. Its alt text is `Sluiceway: something changed outside the code`.

## What real behavior changed

The Pulumi research took from the source that a drifted property turns a refresh step into an `update` with `detailedDiff`. Recorded on v3.229.0 and v3.263.0, the one JSON document of `refresh --preview-only --json` lists such a resource as a plain `refresh` step, no paths, old and new state equal, and only its `changeSummary` counts the update. A removed resource does show as `delete`. The engine events do name both: with `PULUMI_ENABLE_STREAMING_JSON_PREVIEW=true` the tool prints one event per line, and the event that closes a resource carries the real op. So the check sets that variable for its own command line. It changes only how the tool prints, which 0013 allows ("Sluiceway sets only what makes the tool behave in CI"). The check reads the op, the URN and the paths of those events and drops everything else, and it refuses a stream whose summary counts more changes than its events name, or that has no summary at all. That guard would catch the tool moving the op out of the events the way it is missing from the document.

The research also noted that the `local` provider reports a file with other content as gone, not as changed. The recordings confirm it: that is the provider's answer, and the row says gone. A changed property is recorded from a resource of the TypeScript example whose provider reads its file back, which the `drift-changed` scenario adds.

## Rejected

- **Drift as a second row, or a section of its own for pending stacks with drift.** 0009 and the glossary say one row per stack.
- **Repairing drift with a plain deploy.** A plain `up` compares the code with the state, and the state still holds what the code says, so it changes nothing and the drift stays. 0015 rejected a free `refresh` flag because a flag that reaches the deploy and not the preview breaks the promise of a tick. Here the deploy gets it only when the approved hash covers drift, and `apply` has just checked the drift again with the same check the scan ran, so what went out is what the row showed: the code's changes and the drift put back. The named `refresh` option of later.md, a refresh on every preview and deploy of a stack, is still not built.
- **`apply` trying the hash with and without drift.** It would work without a marker key, but 0009 asks for the key, and a key makes the record say what the tick approved.
- **Drift above pending in the header.** Drift is news, but the picture of drift is a closed gate with nothing waiting. With pending rows the crates and the water say more, and the counts line still says `N drifted`.
- **Checking drift in every dispatched scan,** as the build plan's row reads. `settle` dispatches one after every deploy, so the cost would follow the deploys and not the team's schedule.
- **Checking drift in every scan.** A drift check reads every real resource of a stack. A repo where Renovate merges all day would pay for it on every push. The schedule is where a team decides how often to pay.
- **The one JSON document with a count of drifted resources that the document cannot name.** A row that says "1 changed" without saying which cannot be approved.

## Consequences

- A repo that does not turn drift on sees nothing new: no check, no new key, no new line, the same hashes and bodies.
- The size budget shortens a drifted row as it does a pending one, to one line that points at the summary. The note about shortened rows still counts pending rows only.
- A drifted stack has no preview page (0050). Its link goes to the summary.
- Scan outputs do not change. There is no `drifted` output in part 1 (later.md).
- The e2e does not change. The drift loop is proven on the fake GitHub against recorded drift, and against the real CLI in the recordings.
- 0031's table gets its drift row, and the twenty-two files of 0043 and the sixty-two of 0047 become sixty-four with `drift-light.svg` and `drift-dark.svg`, generated on the `prototype/header-drift` branch of the private lab repo.

Research: https://github.com/sluiceway/sluiceway/blob/research/pulumi-cli/docs/research/pulumi-cli.md (section 2, drift detection, as corrected here).
