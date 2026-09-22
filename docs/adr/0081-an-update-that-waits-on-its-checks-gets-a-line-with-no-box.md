# An update that waits on its checks gets a line with no box

> Amends 0054 (what the section "Updates waiting to merge" holds, and a marker kind of a new sort). Built as slice 5.17.

Issue 170, seen on a real repo. A Renovate pull request that touched exactly one stack got no row under "Updates waiting to merge", and the only trace was one line of the job log: `#1137 is not listed to merge: its checks are not all green.` The check that held it back was Renovate's own `renovate/stability-days` ("Updates have not met minimum release age"), a commit status that stays pending for days and then clears itself. From the dashboard, merge and deploy looked as though it did nothing at all.

Record 0054 lists a pull request only when its checks are green, and that stays: a box merges, and a pull request whose checks have not finished is not ready to merge. What was missing is a word on the dashboard for a pull request that will be ready once its checks finish.

## Decision

### Which pull requests wait on their checks

- **A pull request waits on its checks when its checks have not all finished and it qualifies in every other way** (0054, 0071): its author is on the list, it is not a draft, it merges into the default branch, it does not conflict, every file it changes is known and claimed, and its stacks do not depend on each other. It is exactly the pull request that would be listed with a box if its checks were green. The rule is one pure function in the core, `waitsOnChecks`, which asks the qualify rule of 0054 with the checks taken as green.
- **Checks that failed never wait.** A failed check does not clear itself, and a new commit starts the checks again, so the pull request gets no line and keeps its line of the job log.
- **A failure anywhere wins over pending.** GitHub's combined state of the head commit (GraphQL's `statusCheckRollup`) is read as before. When it says pending, the scan also reads the first 100 checks under it, in the same query: a check run that completed with anything but success, neutral or skipped, or a commit status that is failure or error, makes the pull request failed, not waiting. So the line never depends on which state GitHub puts first when one check failed and another still runs. A check run that is queued, in progress or waiting and a commit status that is pending or expected are what waiting means.
- **A pull request with no checks at all does not wait.** 0054 counts it as not green, and nothing says a check is coming, so a line that waits for one could wait forever.
- **A pull request that would never qualify gets no line**, whatever its checks say: another author, a draft, another base, a conflict, a file no stack claims, no stack at all, or stacks that depend on each other. Its line of the job log now names that lasting reason, not its checks, because that is what keeps it off the list once the checks are green.
- **A pull request that several stacks claim waits like any other** and names every stack, since 0071 lets it qualify.

### The line

- **It sits under the rows of the section, and under the fold**, after a line of its own:

  ```md
  These wait on their own checks. Each gets a box here once its checks are green.

  - **apps/odoo:prod** · Update Helm release odoo to v17.0.4 · #1137 by renovate[bot] · waits on its checks <!-- sluiceway:waiting pr="1137" stack="apps/odoo:prod" -->
  ```

  With no update waiting to merge, the section has its heading, that line and the waiting lines, and not the line that says to tick a box. With nothing at all, there is no section.
- **No box.** Nothing can be merged, and the title of the section already says what the line is. It shows the stacks it would deploy, the title (escaped, on one line, cut at 80 characters and left out with `dashboard.redact`, as on a merge row), the number and the author.
- **A marker of its own kind, `sluiceway:waiting`**, with the pull request and its stacks, and no head commit because nothing is ticked on it. It is not a `sluiceway:merge` marker with a key, so no reader of merge rows, of this version or an older one, can ever read a box a person adds to the line as a tick. An older writer ignores the kind and drops the line, which the next scan draws again.
- **Only the scan draws the lines**, from the same list of open pull requests it reads for the merge rows, at no extra request. `resolve` and `apply` carry them as they stand. A list that cannot be read keeps the live lines, as it keeps the merge rows. A read-only dashboard and `deploys: false` have none, as they have no section.
- **The line goes when its checks go green**, because the next scan lists the pull request as an update waiting to merge, with a box, **or when a check fails or it stops qualifying**, because the next scan does not draw it again. A pull request that has a merge row never has a line too.

### It counts toward none of the section's numbers

The owner asked for this to be decided. A waiting line is not an update waiting to merge: the glossary term is a pull request that is green and offered, and each number of the section is about those. So a waiting line is not among the 10 shown before the fold, not in the fold's count ("N more updates waiting to merge"), not among the oldest 30 that always stay, not in the size budget's cut of the newer updates, and not in the log line "N pull requests wait to merge". It has its own count in the log, "N pull requests wait on their checks: ...".

- **At most 10 lines, the oldest first.** The job log names the rest. Renovate's stability gate can hold many updates at once, and a line that offers nothing should not take the room of one that does. Ten lines stay near 2,500 characters, about 4% of the body's target (0028), so the budget always keeps them, as it keeps the oldest 30 updates.
- **No branch preview.** `mergeAndDeploy.preview` previews updates that can be merged; a waiting line gets its preview once it has a box.

## Consequences

- The port asks for the checks under the combined state in its one GraphQL query per page (0064). That is still one request per page of the hourly budget (0017).
- A notification, the result file and the outputs do not count waiting lines. A line that waits for days is not news on every scan.
- `docs/using-the-dashboard.md`, the merge and deploy part of `docs/workflow.md` and `docs/configuration.md` say what the line means. The job log table names both lines about checks.
- This amends 0054: the section holds lines with no box, of a marker kind of a new sort outside the row blocks, and the log line of a pull request whose checks have not finished names its lasting reason when it has one.
