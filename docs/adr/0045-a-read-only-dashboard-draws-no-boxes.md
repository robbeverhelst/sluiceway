# A read-only dashboard draws no boxes

> Amended by 0083: a read-only dashboard has no bulk box and no confirm box.

In the read-only trial the first real user ticked a box. The workflow had no `resolve` job and did not listen to issue edits, so nothing happened and nothing said why, and the tick sat there until the next scan cleared it with a note that said "tick again", in a workflow where no tick can ever work (onboarding log, hurdle 16). A scan cannot see from inside its job whether the workflow it runs in has a `resolve` job, so the person has to say so.

```yaml
dashboard:
  readOnly: true   # default false
```

With it on, every writer draws the dashboard without anything to tick:

- A pending row has no box. Its marker, its hash, its counts, its change lines and its links are what they would be with a box, so a pending row still says exactly what a deploy would do.
- There is no rescan box. It needs a `resolve` job as much as a row's box does.
- While rows are pending, the one line under the Pending heading (0029) says that the dashboard is read only and how to give the rows their boxes back. With nothing pending the line is the one it always is. The line is plain (0032).
- The warning on a shortened or redacted row with a destroy says "Read the summary." instead of "Read the summary before you tick."

A config key and not an input. An input would sit in the workflow file, next to the jobs it describes, and would go away by itself when the file is replaced by the whole workflow. But the switch changes what rows look like, and a narrowed scan carries rows byte for byte (0011): after a change of the workflow file alone, which many repos list under `scan.unrelated`, the rows of the other mode would stay until the next full scan. A push that changes `sluiceway.yaml` is a full scan (0010, and no stack is meant to claim it), so every row is drawn again the moment the key changes. Every writer reads the config, so `resolve` and `apply` draw the same dashboard as the scan. It also keeps the promise of `later.md` that a read-only mode gets its own key, and not an empty `tickers` list. The name follows the other keys: camel case, like `previewTimeout`.

## Consequences

- The switch is about what is drawn, not a lock. What makes a workflow read only is that it has no `resolve` and no `apply` job. A box that is still ticked on a row written before the switch is dropped by the next scan, which is full because the config changed. `resolve` with the switch on still acts on a ticked box it finds, as it always does.
- A scan with the switch on reads no tick from the live body. A ticked box goes with the box, with no note, because there is nothing to tick again, and the scan never asks whether a `resolve` run is on its way.
- The orphan note keeps its words. It is right in a workflow that has a `resolve` job, and a read-only dashboard never shows it.
- Row blocks with and without a box read back the same way (0009): a pending row without a box holds no tick.
- A scan that works out by itself that its workflow has no `resolve` job is left out (later.md).
