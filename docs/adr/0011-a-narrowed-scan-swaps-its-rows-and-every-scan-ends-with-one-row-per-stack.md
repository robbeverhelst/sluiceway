# A narrowed scan swaps its own rows, and every scan ends with one row per discovered stack

Record 0004 said `scan` regenerates the whole body because it has a fresh preview of every stack. A narrowed scan (0010) does not, so it writes the way `apply` does: it replaces the row blocks of the stacks it previewed, carries every other block through byte for byte, and regenerates everything around the blocks (0009). A full scan still replaces every row. This amends 0004, where "scan" now reads "full scan".

One invariant keeps rows from being lost: after any scan the dashboard has exactly one row for every discovered stack and no others. Every scan runs discovery, which is a file walk and costs no preview. Just before it writes, a scan goes through the discovered stacks. A stack with a fresh preview gets a freshly rendered row. Otherwise, a stack with a row block in the live body keeps that block. Otherwise the stack is previewed now, and the scan returns to its late read. Row blocks of stacks that discovery does not know are dropped. A new stack, a removed stack, a row deleted by hand and a body that lost half its rows are all repaired by this one rule, with no case of their own.

Keeping the last full scan's results as a workflow artifact and rendering from that was rejected for the reason given in 0004: it is a second store with its own expiry. The live body already is the cache.

## Consequences

- `scan-sha` on the root marker is always the commit the scan checked out, for a narrowed scan too. Under the claim rule every stack that was not previewed is unchanged between the old `scan-sha` and the new one, so "every row is current as of `scan-sha`" stays true, and the next narrowed scan compares from there. A scan that dies before its write moves nothing, and the next scan covers the wider range.
- A push that changes only unrelated files still gives a scan. It previews nothing new, moves `scan-sha` and rewrites the header.
- The root marker gains two keys, `full-scan-at` and `full-scan-run`, written by full scans and carried through by every other writer. The header shows the last scan as before and, less prominently, the last full scan. New keys do not change the marker version (0009).
- Rows carry no timestamp. The preview link on a row already points at the run that previewed that stack, and a carried row keeps its link. 58 timestamps would be noise and would cost body budget.
- A carried row keeps its attribution lines as they are. That is correct, because a commit that touched the stack would have made the stack claim a file.
- Every scan, full or narrowed, does the late read, defers to open deployments and to deployments that changed after it started (0004), and sweeps orphan ticks (0005). These cost API reads only.
- A narrowed scan that cannot use the body (no root marker, another version) is a full scan, decided at its first read (0010). If the body becomes unusable between the first read and the late read, the invariant above turns the scan into a full one by itself: every stack without a row gets previewed.
- Spreading one scan over several runners later needs no new merge rule. A shard would be a narrowed scan whose stacks are picked by another selector, writing through the same swap. It is left out of v1 (0012). The one thing it would add is several scan writers finishing close together, which the write loop of 0004 allows for but was not sized for.

## Settled while building (slice 1.12)

- The rule of one row per stack runs inside the builder of the write loop (0004), so it sees the late read on every try. When a stack has neither a fresh preview nor a row in that body, the builder stops, the scan previews those stacks through the pool, prints their groups in the job log, writes the summary again with every stack it has previewed so far, and starts the write again. The summary of a step is replaced, never added to.
- Rows under a root marker that is missing or of another version are not carried. Every stack then counts as having no row, which is how such a body turns the scan into a full one by itself.
- Of two row blocks with the same stack id the first in the body stays and the other is dropped. The log names every dropped row of a stack that discovery does not know.
- A scan that ends with a fresh row for every stack is a full scan, whatever it set out as, and writes `full-scan-at` and `full-scan-run`. That follows the glossary: a full scan is a scan that previews every stack. Any scan that carries at least one row carries the two keys through as they stand, and writes none when the live root has none.
- A narrowed scan is a writer that swaps rows, so it aims at the hard limit and shortens only its own rows (0028). Where 0028 has such a writer dispatch a scan when that is not enough, a narrowed scan is already one: it previews the stacks it carried, in the same job, and can then shorten every row. The log says `This scan falls back to a full scan: the body does not fit in one issue with 12 rows carried through`. If the body still does not fit, the scan fails and the old body stays, as before.
- With a fresh row for every stack the body does not depend on the live one, so a body that does not fit still fails the scan before any request to GitHub, as slice 1.11 had it.
- The version check of the tool runs only when there is something to preview. A push that changes only unrelated files needs no tool.
- The job result of 0012 counts the previews of the whole scan, the late ones included. The rows that were carried do not count.
- The late read of open deployments and the sweep of orphan ticks are not part of this slice (slices 2.1 and 2.7). Until then a carried row keeps its tick, byte for byte, and a fresh row has none.

