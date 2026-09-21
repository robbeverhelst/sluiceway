# The issue body is a cache of row blocks, written without a lock

> Amended by 0011: only a full scan regenerates every row. A narrowed scan swaps its own row blocks, as `resolve`, `apply` and `settle` do.

Four modes write the dashboard body, but only `scan` has fresh previews for every stack, and GitHub has neither a partial update nor a compare-and-swap for issue bodies. So `scan` regenerates the whole body, while `resolve`, `apply` and `settle` fetch the live body, replace only the row blocks of their own stacks, and carry every other row through byte for byte. Re-previewing everything in every writer was rejected as far too slow for a tick. Persisting the last scan result as an artifact was rejected because it adds a second store with its own expiry that goes stale the moment an apply finishes.

The issue stays a rendered view. Nothing is decided from a cached row. The only things read from the body for action are a tick and a hash, and both are checked against discovery and a fresh preview before anything deploys. The worst a stale row can cause is an apply that aborts because the change moved.

## Consequences

- Every row is one self-delimiting block whose marker carries stack id, hash and row state, so a block can be moved between sections without understanding its content. The header counts are derivable from the markers alone.
- One row renderer is shared by all modes: the same inputs give a byte-identical row whoever writes it. "Regenerate, never patch" means never patch inside a row. Swapping whole rows is fine.
- There is no global write lock. Actions concurrency groups work per job, so a lock would hold ticks hostage for the length of a scan. Instead every mode writes the same way: do all slow work first, then read the live body and the open deployments, build the body, skip the write if it is byte-identical, write, and read back to verify. If the body is not what was written (another writer got in, or GitHub silently dropped an oversized body), repeat from the late read, at most three times.
- Scans never overlap: the scan job uses `concurrency: sluiceway-scan` with the default queue and no `cancel-in-progress`. A running scan finishes, and only the newest waiting scan survives.
- At its late read the scan defers to fresher facts. A stack with an open deployment renders as deploying. A stack with a Sluiceway deployment that changed after the scan started keeps its live row, because the scan's preview of it predates the deploy.
- A write lost in the remaining window heals itself. A "deploying" row that reverts to pending is repaired by the next tick (dropped because the record is open), by `apply`, or by `settle`. A finished row that reverts to a stale diff leads to an apply that aborts and renders the fresh diff. The dashboard can be briefly wrong. A deploy never is, because deploy safety rests on the deployment record and the hash check, not on the body.

## Settled while building (slice 2.1)

- "Changed after the scan started" is measured per stack: the time of the record's latest status against the moment the scan started its preview of that stack. That is the reason the record gives ("the scan's preview of it predates the deploy"), and a scan that previews a stack again late has a preview that does not predate it.
- When such a stack has no live row to keep, or a live row that still says deploying, the scan previews it once more and returns to its late read. Only once for each stack in a scan, then its fresh row is taken.
- A row says deploying exactly as long as a deployment is open. A scan that meets a deploying row with no open deployment previews that stack, a narrowed scan too, because the writer that would have replaced the row is gone. A live deploying row of an open deployment is kept byte for byte, since only `resolve` has its attribution line. Without one the row is made from the record, and its `destroys` come from the preview or from the marker of the row it replaces.
- A record that the scan itself ended has no writer behind it, so the stack gets the row of the scan's own preview, with the failure line.
- The late read of the deployment records runs inside the builder of the write loop, so every try sees the records as they are. It costs one request per environment name, per try.
- A full scan is a scan that previewed every stack, also when a stack then keeps its live row for one of the reasons above.

Research: https://github.com/sluiceway/sluiceway/blob/research/renovate-dashboard-mechanics/docs/research/renovate-dashboard-mechanics.md
