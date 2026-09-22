# A later deploy clears the failure line, outside deploys included

A row's failure line said "the last deploy of this stack from the dashboard failed", and it came from the deployment records alone (0003, 0027). A later deploy from the dashboard is a newer record, so it replaced the failure. A deploy made outside the dashboard leaves no record (0016), so it never did. Record 0029 kept that on purpose: an in sync row with a failure line is listed open above the fold, because the stack is in sync "often through an outside deploy" and nobody may have looked at the failure.

Since 0073 a full scan finds outside deploys in the tool's own history and lists them on the trail. On a real dashboard (owner, 2026-09-22) a stack failed a ticked deploy at 15:15, was deployed outside the dashboard at 15:24 and was in sync. Its row still said `:x: last deploy failed ... ticked by ... 15:15`, right above a trail line that showed the deploy that followed it. The row then says something that is no longer true about the stack. Build plan slice 5.11 fixes it.

This amends 0029 (an in sync row with a failure line) and 0062 (the failure line on the row next to its trail line).

## Decision

- **A row shows the failure line only while no deploy of its stack ended after the failure.** A deploy from the dashboard, or a deploy outside it. The rule is one pure function in the core, `standingFailure`, and every writer that draws a failure line asks it: the scan for every row it previews (pending, drifted, in sync and preview failed), and `apply` for the row it swaps in.
- **An outside deploy is one the trail lists.** For a full scan that is what it read of the tools' histories, and for every other stack and every other writer it is the lines the live body carries in their markers (0073). No writer reads more than it did.
- **A destroy counts as a deploy.** It ended after the failure, so the failure is no longer the last thing that happened to the stack.
- **"After" is strictly later, by the two times as they are.** The failure's time is the time of its record's status on GitHub. The outside deploy's time is the clock of the machine that ran it (0073). A deploy that ended at the same second does not clear the line.
- **A rehearsal is still no deploy.** It is not a deploy fact (0051), so the failure before it stands.
- **The trail keeps the failed deploy.** It is history, and the trail says what happened (0062). Only the row's line goes.
- **Every row counts the same.** An in sync, a pending, a drifted and a preview failure row lose the line under the same rule. The counts line, the `failed` marker key and the result file's `failedDeploys` follow, because they are counted from the rows (0029, 0041).

## Consequences

- The reported row is in sync with no failure line, and so goes back into the fold. Its trail shows `failed` at 15:15 and `deployed outside the dashboard` at 15:24.
- Only a tool that keeps a history (Pulumi, 0073) clears the line this way. An outside deploy of an OpenTofu, Terraform, Helm or kubectl stack is not seen, and its row keeps the failure line until a deploy from the dashboard, as before. That case is what 0029's open in sync row was for, and it still works for it.
- With `dashboard.recentlyDeployed: 0` no history is read and no outside line is carried, so no outside deploy clears a line either.
- An outside deploy that the trail's length cut off is no longer carried, so a narrowed scan or `apply` does not see it. The next full scan reads the history again and clears the line. The trail lists the newest lines first, so an outside deploy newer than a failure is cut only when the trail is full of newer lines still.
- A narrowed scan carries a row byte for byte (0011), so a carried row keeps the line it has. The full scan that found the outside deploy wrote that row fresh, so it holds no stale line.
- A machine whose clock runs behind can list a deploy that ended after the failure at a time before it. The line then stays until the next deploy.

## Rejected

- **Clearing the line whenever the row is in sync.** In sync says nothing about the failure: a later change of the code can make the same stack in sync without anyone deploying it, and a pending row with a failure line would keep it. The owner's rule is about deploys.
- **Deleting or hiding the failed line on the trail.** The trail is history, and a failed deploy happened.
- **Reading the history in `apply` or in a narrowed scan.** 0073 keeps the history to full scans for its cost, and the carried lines already hold what a full scan found.
