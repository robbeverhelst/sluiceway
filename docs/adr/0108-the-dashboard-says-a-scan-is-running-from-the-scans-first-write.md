# The dashboard says a scan is running, from the scan's first write

> Amends 0004 (a scan writes the body twice: once before its previews with no row of its own, once at the end), 0009 (two optional keys on the root marker), 0017 (five requests more per scan), 0025 (the rescan box is written back unticked at the scan's first write), 0029 (a line under the scan line) and 0086 (that line sits under this one). Built as slice 5.43, for issue 252.

While a scan runs, the dashboard says nothing about it. The scan line still names the last scan, the rows are the old rows, and a person who just pushed or ticked the rescan box has no sign that anything is happening until the body is written minutes later. A deploy has a row that says `waiting to start` and then `deploying` (0027, 0063), and a run that waits for a runner has a line (0086). A scan that is running had nothing. Decided by the owner on 2026-09-25.

## Decision

- **The scan says it is running, on the dashboard, as its first act.** Right after config, discovery and the scan plan, and before any preview, it writes one line under the scan line through the write loop (0004):

  `A scan is running since 2026-09-25 09:41 UTC+2 · [run](…/actions/runs/900)`

  The time stands alone, so it is in the repo's zone with its offset (0089), and the run is linked the way the scan line links its own. The tools are checked first, so a tool below the floor still fails the job with nothing written, as 0012 promises for config and discovery.
- **The line is a fact on the root marker, not text**: `scan-running`, the run id, and `scan-running-since`, when the scan started, ISO 8601 in UTC, after the `run-waiting` keys. Both keys or neither. Every other writer carries them as it carries the waiting run (0086), whatever run it is part of, because in every workflow a `resolve` or `apply` that writes the body in the scan's own run does so before the first write or after the write at the end. The keys are left out of `docs/what-sluiceway-writes.md` on purpose, like the `run-waiting` keys (0096): a hint that a scan is under way, not a fact about a stack.
- **The scan that wrote it takes it away** when it writes the body at the end: the end write's root marker has no such keys. A scan that dies before that write leaves the line. The next scan replaces it with its own, and the line says since when, so a stale one reads as stale. Sluiceway does not try to take the line back on a failure inside the scan: the run the line links is red then, and the next scan corrects it.
- **The first write is a row swap that swaps nothing.** The scan has no row of its own yet, so every row block is carried byte for byte, ticks included, the trail is drawn from the deployment records as they stand, with nothing settled or decided, and everything around the blocks is drawn again. So the rescan box, ticked, is written back unticked in that first write, and a person sees their tick taken at once instead of after the previews. The orphan tick sweep of 0025 is untouched: it runs at the late read of the write at the end, as before, and no tick is cleared by the first write.
- **It costs five requests per scan**: the find, the read, one page of deployment records per environment name, the write and the read back. The attribution walk (0026) moves in front of it, because the trail's shipped lines need it, and is paid once per job as before. On a narrowed scan of one stack that is about a second more; on a full scan it is nothing next to the previews.
- **A dashboard that is missing, closed or of another version gets no first write.** A first scan creates the dashboard at the end, as it always did, and the line has no scan line to sit under before that. A first write that GitHub refuses, or that would not fit, is one line of the job log, and the scan goes on to its previews and its write at the end: the line decides nothing and never turns a job red.
- **The `dashboard-changed` output** (0041) compares the body the scan wrote at the end with the body before its first write, so the line alone never counts as a change and a notify step can stay quiet as before. The notifications compare the same two bodies.
- **The job log says it**: `The dashboard says a scan is running, under the scan line, until this scan writes the body (record 0108): <run url>`.

### No header picture

The header shows one state and bad news wins (0031), and every state is a fact about the stacks. A scan running is not one: it is true for a few minutes on every dashboard, whatever the stacks are doing, and a picture for it would have to win over or hide under every other state. The line is enough, and the cost of a new picture set is about ninety files, two themes and every crate count and destroy sign. The crate on the quay stays on `docs/later.md`, for the owner to ask for.

### Not a row state, decides nothing

Nothing reads the keys but the renderer. A tick made while a scan runs is judged as today. `resolve` does not wait for the scan, `apply` does not look at it, the sweep does not use it, and no notification is sent for it. It is not a header state, not a count and not a row.

## Consequences

- Every scan writes the dashboard twice, and the edit history gets one bot entry more per scan. A bot entry inside a stretch is normal for the walk (0025).
- The worst case of 0017 and 0086 becomes 411 requests on the first try of a scan of 100 stacks and 813 with three tries, still below 1,000.
- A writer that meets the keys and a `scan-run` of the same run cannot happen: the write at the end drops them. A writer that meets keys naming a run long over draws the line as it is, and the next scan replaces it.
- The read-only dashboard (0045) gets the line like any other. It says nothing about ticking.

## Rejected

- **Taking the line back when the scan fails inside Sluiceway.** One more write on the failure path, for a line whose link already shows a red run and which the next scan replaces. It stays on `docs/later.md`, door open.
- **A header picture.** See above.
- **Creating the dashboard at the first write.** A dashboard with no rows and a scan line naming a scan that has not scanned would say less than no dashboard.
- **Writing the line without the trail.** The trail is drawn from the deployment records, and carrying its lines is not possible: they are text. Leaving it out for the length of the scan would take the shipped lines away and put them back minutes later, churn on every scan.
- **A threshold, or a setting to turn the line off.** It is one line, true from the first second, and it goes with the scan.
