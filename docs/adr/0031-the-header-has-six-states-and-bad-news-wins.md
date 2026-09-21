# The header has six states, bad news wins, and any delete or replace turns it plain

> Amended by 0038 and 0039: failing is drawn as a jam under a half-open gate, and pending has three pictures picked from the pending count. The six states and their order stay as they are here.

Record 0029 put a `<picture>` at the top of the body and left its states to the brand work. There is one header and often several things are true at once: 3 pending, 1 deploying, 1 preview failed. This record fixes the states and which one wins.

| Header state | When | Penny |
|---|---|---|
| `plain` | any pending or deploying row has a delete or replace | no face, no colour, no motion: a grey gate and a grey wordmark |
| `failing` | any preview failure, or any row with a failure line | jammed crooked, worried, a red lamp blinks, the stream is broken |
| `deploying` | any deploying row | lifted, grinning, the wheel turns, water rushes through |
| `pending` | any pending row | closed, cheeks puffed, eyes on the water piling up behind it, the gauge is high |
| `first-run` | the scan found no stacks | open, looking around, a dry bed |
| `in-sync` | none of the above | closed, asleep, calm water, a rubber duck drifts by |

The first row that matches wins, top to bottom. Bad news first means the header always agrees with the most serious thing on the counts line, and Penny only sleeps when the page is truly calm. Showing what is happening now first (deploying above failing) was rejected: a failure would vanish from the picture for the length of every deploy. Letting only preview failures count as failing was rejected too. A failure line stays on its row until someone deals with it (0029), and the header says the same.

The plain state looks at deploying rows as well as pending ones, which widens 0029. A stack that is deleting something right now must not run under a grinning gate.

## Consequences

- The header state is a pure function of the row markers: the `state`, `destroys` and `failed` keys (0009, 0027). Every writer can compute it for rows it only carries through, and the same input gives the same body (0004).
- This amends 0027: when `resolve` turns a pending row into a deploying row, it copies the `destroys` key from the old marker onto the new one. It still does not read the row's visible text.
- A redacted dashboard (0023) gets the same header. The marker keys survive redact.
- `first-run` means no stacks were found, not that nothing was ever deployed. A repo with stacks that are all in sync after the first scan is `in-sync`.
- The state changes by writing a different image URL into the body (0033), which is an ordinary body edit.
- The image's alt text is plain and fixed per state: `Sluiceway: no stacks yet`, `Sluiceway: everything is in sync`, `Sluiceway: changes are pending`, `Sluiceway: deploying`, `Sluiceway: something failed`, and `Sluiceway` for plain. The counts line right under it carries the numbers.
- Drift and queued rows (later.md) will need a place in this table when they arrive. Adding a state is a new file pair and a new line here, not a breaking change.
