# Deletes and replaces sit open under the row, everything else is folded

> Amended by 0114: `dashboard.pendingDetail` may show less under a pending row's first line, `compact` or `names`. The failure line and every delete and replace line stay at every setting, and the marker is the same.
>
> Amended by 0113: one more row form, the row `settle` writes for a deploy it ended: `**id** · no preview since its deploy ended, the next scan previews it` with the state `preview-failed` and `failed="true"`, the failure line right under the first line and the lines of the deploying row carried under it.
>
> Amended by 0112: "HTML escaped" also writes `#` and `@` inside a span, the `-` of `GH-` before a digit inside a span, and a character reference for the dot of `www.` and the colon of `://`, because GitHub links an issue reference, a mention and a web address in a name otherwise.
>
> Amended by 0089: the failure line's time is in the repo's zone, `dashboard.timeZone`, and ends in its offset from UTC at that moment, such as `2026-07-21 12:02 UTC+2`. Without the key it is `UTC` as written here.
>
> Amended by 0044: a link that shows a stack's diff names the attempt of the run, and a preview failure's `run` links to the log of the job.
>
> Amended by 0062: one caution block above the pending list, the destroy alert, names the pending stacks with a delete or replace. The delete and replace lines stay open under the row.
>
> Amended by 0063: under a header, the first line of a deploying or queued row starts with a small animated spinner. Its words and marker do not change.

Records 0009, 0024 and 0026 fix the frame of a row: the marker at the end of the first line, attribution on its own line, destroys first and always warned about. They left the look to a prototype. Three row formats were rendered as real issues with 58 made-up stacks and judged in light theme, dark theme and on a phone. This record fixes the one that won.

```md
- [ ] **storage/buckets:prod** · 1 create, 1 update, **1 replace**, **1 delete**, 1 tracking only · [preview](run-url) <!-- sluiceway:row stack="storage/buckets:prod" state="pending" hash="2b44350653e84a11" destroys="2" -->
  from #433 by alice, #429 by alice, [3fa9c1e](commit-url) by bob, and 1 change outside this stack · [compare](compare-url)
  :warning: <kbd>DELETE</kbd> <code>aws:s3/bucketPolicy:BucketPolicy</code> <b>uploads-public-read</b>
  :warning: <kbd>REPLACE</kbd> <code>aws:s3/bucket:Bucket</code> <b>uploads</b> · forced by <code>bucket</code> · also changes <code>tags</code>
  <details><summary>3 other changes</summary>
  <kbd>move</kbd> <code>aws:s3/bucket:Bucket</code> <b>archive</b><br>
  <kbd>update</kbd> <code>aws:s3/bucketLifecycleConfiguration:BucketLifecycleConfiguration</code> <b>logs</b> · <code>rules</code><br>
  <kbd>create</kbd> <code>aws:s3/bucketVersioning:BucketVersioning</code> <b>uploads</b><br>
  </details>
  <!-- /sluiceway:row -->
```

The loud signal for a destroy is that it is never behind a click. An alert block cannot render inside a task list item (rendering research), so the brief's per row alert was never an option. Two other signals were tried. One `> [!CAUTION]` block above the pending list plus a bold tag on the row was rejected: the box is far from the row it warns about once the list is long, and the lines that matter are still folded. A quoted warning inside the row was rejected for the same second reason. With the lines open, the person about to tick reads the name of the thing that goes away without doing anything.

Counts are words with zeros left out: `2 updates, **1 replace**`. The brief's symbols (`+2 ~1 -0`) were rejected after seeing them with a fourth number for replaces. `+-1` needs a legend, and four numbers of which three are mostly zero are noise on 11 rows. Replaces and deletes are bold, so the first line alone already says a row destroys something.

Behind the fold, a change is one line of plain HTML: the op as a key cap, the type, the name in bold, then the changed property names. A fenced `diff` block was rejected although it is about a quarter cheaper in characters. It needs blank lines, which makes the whole list loose and spaced out (rendering research), only creates and deletes get a colour, and long lines scroll sideways on a phone where plain lines wrap. A table was rejected because it scrolls sideways on a phone too and also makes the list loose.

## Consequences

- The order of lines in a pending row block is fixed: first line, attribution line (0026), failure line, orphan tick note, one line per delete, one line per replace, the fold with every other change, closing marker. Inside each group changes are sorted by address (0024).
- A delete or replace line starts with `:warning:` and has its op in upper case in the key cap. A replace line reads `forced by` with its `replaceKeys` and then `also changes` with the remaining changed keys. When the tool gave no replace keys it lists the changed keys alone. The line is shown whole or not at all (0024).
- No line in a row block is blank and everything behind the fold is HTML, not Markdown, so every list on the dashboard stays tight. Lines inside the fold end in `<br>`. Types, names and property names are HTML escaped. They come from the user's code and the provider's schema and are never trusted as markup.
- The summary of the fold counts what is inside it: `3 other changes` on a row that also has open delete or replace lines, `3 changes` otherwise. A row with nothing but deletes and replaces has no fold.
- Counts are in the fixed order create, update, replace, delete, tracking only, each left out when zero, singular when one. Changes that have only a tracking change are counted as `N tracking only` (0007). Inside the fold their key cap carries the tracking word: `import`, `forget` or `move`. A tracking change never gets `:warning:` (0007).
- No personality anywhere in a row block that holds a delete or replace, as the map says. The warning sign, the upper case op and the plain names are the whole message.
- A redacted row (0023) has the same first line and attribution line. In place of the change lines it has one line. With a delete or replace: `:warning: **deletes 1, replaces 1.** Read the [summary](url) before you tick.` Without: `Changes are listed in the [summary](url)`.
- A deploying row has no checkbox and no counts, because `resolve` writes it without a diff (0014) and the visible text of the old row is never parsed (0009). It reads `**id** · deploying · ticked by carol · [run](url)` and keeps its attribution line (0026). While the record is still `queued` the word is `waiting to start`. A queued record cannot tell a wait for a reviewer from a wait for a runner, so the row does not guess.
- A preview failure row reads `**id** · preview failed: <failure reason> · [run](url)` with no checkbox (0022). An in sync row is the bare stack id, not bold, plus a failure line when it has one.
- The failure line reads `:x: last deploy failed: <failure reason> · ticked by alice · 2026-09-21 08:52 UTC · [run](url)`. The orphan tick note reads `:information_source: a tick on this row was not picked up. Tick again to deploy.`
- The row marker gains two optional keys after `hash`: `destroys="N"`, the number of deletes and replaces in the diff, and `failed="true"` when the row carries a failure line. Both are display caches like `state` (0009). A writer that carries a row through cannot read its text, and needs them for the header, the mascot state and section placement (0029). Nothing about a deploy is decided from them. New keys do not change the marker version.
- This format costs more characters than the alternatives: 37,607 for the 58 stack fixture against 30,637 with diff blocks. That is 57 percent of the hard limit, with two rows of 46 and 120 changes in it. The size budget (0028) handles the rest.

Prototype: the generator script and its output are on the `prototype/dashboard` branch. The rendered issues are in the private lab repo.
