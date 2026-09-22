# Deploy all is a bulk box and a confirm box, and the confirm box is a tick on each row

> Amends 0009 (a marker kind of a new sort outside the row blocks), 0018 (two new boxes and how each is judged), 0025 (the walk reads both boxes, and the scan sweeps them), 0045 and 0051 (neither draws them). Built as slice 5.18.

The owner, 2026-09-22: "we need an all option for drifted and deploying which pops up an are u sure which u have to click again." A repo with twenty pending stacks after a shared change, or a morning with ten drifted stacks, meant twenty or ten ticks, one row at a time. This record fixes how one tick covers a section, and what makes it safe to offer.

## Decision

### Two boxes, each behind a confirm box

- **Under the pending rows, `Deploy all N pending stacks`. Under the drifted rows, `Repair all N drifted stacks`.** Deploying and queued rows get nothing: they are on their way already. Preview failed and in sync rows have nothing to deploy.
- **A tick on the bulk box deploys nothing.** `resolve` checks that the ticker is a person with write access, the rescan box's half of the test of 0018, because the box itself deploys nothing. Then it writes a **confirm box** in its place:

  ```md
  - [ ] **Confirm:** deploy all 3 pending stacks: **apps/api:prod**, **apps/web:prod**, **network:prod** · asked by alice <!-- sluiceway:bulk section="pending" confirm="alice" stacks="apps/api:prod,apps/web:prod,network:prod" hashes="...,...,..." scan-run="17034455121" -->
    Ticking this deploys each stack as its row shows it, in dependency order. A change to these rows first takes it back.
  ```

  It names the count, the stacks (ten by name, then how many more), and who ticked the bulk box, as plain text that notifies nobody.
- **A tick on the confirm box deploys, through the same path as a tick on each row it names.** `resolve` turns it into one row tick per stack, at the hash the confirm box holds, with the confirm box's ticker as the ticker of each. From there nothing is new: every stack is judged by its own tick rule, a stack that is taken is dropped, `dependsOn` and phases decide what goes now and what is queued (0056, 0067), a run starts at most 256 (0035), every stack gets its own deployment record with that ticker, `apply` previews each one fresh and checks its hash (0008), and the trail names the person who ticked the confirm box. Anything that refuses a single tick refuses it here.
- **A stack whose rule refuses the ticker is refused on its own, and the rest still go.** It gets its own item in the one comment of the run, which says it was ticked "through the confirm box of the pending stacks". A stack held back by a dependency gets the note of 0056 on its own row, although that row was never ticked, because the note is the only message a dependency refusal has.
- **A row ticked on its own in the same run keeps its own tick and its own ticker.** The confirm box adds no second tick for it.

### What a confirm box approves

- **The stacks at the diff hashes it names, and nothing else.** A tick on a row approves one hash (0008), so a tick on the confirm box approves the list of stacks and hashes in its marker. A person ticks it looking at those rows, so the rows are the promise.
- **It goes stale when the rows of its section change under it**: a stack joins the section, a stack leaves it (it went in sync, started deploying, or its preview failed), or a row gets a new diff hash. Every writer checks this, from the rows it is about to write: a scan that finds a new pending stack, an `apply` that brings a stack back to pending, a `resolve` that meets a stale confirm box under a tick. The confirm box then goes, nothing deploys, and the bulk box comes back with a note that says what changed, names at most ten stacks per clause, and asks for a fresh tick on the bulk box. The job log says the same.
- **It lives through one scan and not two.** The confirm box carries the `scan-run` of the body it was drawn into. The first scan after it keeps it, since that body's scan run is still the one it names. A later scan sees another scan run and takes it back, with a note that nobody ticked it in time. This is the orphan rule of 0025 for a box that asks a question: a question left open for a day would be answered about rows nobody looked at any more.
- **A tick on either box that nothing picked up is swept like an orphan tick** (0025): a scan that meets a ticked bulk box or a ticked confirm box while no run that an issue edit started is on its way clears it, with the orphan note, and deploys nothing. While a run is on its way, the scan keeps its hands off and the tick stays. Meeting such a tick makes the scan ask for the runs, as a ticked row does.

### When there is no box

- **Fewer than two rows in the section.** One row has its own box, and a box that deploys all of one is a second way to do the same thing. A confirm box whose section falls to one row goes without a note.
- **`deploys: false`** (0051) and **`dashboard.readOnly`** (0045): nothing could deploy, or nothing is meant to. Neither box is drawn, and a confirm box that was there goes. With `deploys: false`, a tick that `resolve` still finds on one deploys nothing and the box goes. On a read-only dashboard `resolve` acts on a tick it finds, as 0045 has it for a row: the switch is about what is drawn, and no box is drawn there to tick.
- **`dashboard.redact` changes nothing on these lines**: they hold stack ids, a count and a login, which redact keeps (0023). **`dashboard.personality`** changes nothing either: the lines are plain in both, and the voice stays in its two lines (0032).

### The marker

- **A marker kind of its own, `sluiceway:bulk`**, on a line outside the row blocks, like a merge row (0054). Keys: `section` (`pending` or `drift`); on a confirm box `confirm` (the login), `stacks` (the ids, comma separated and escaped as `depends-on` is), `hashes` (in the same order) and `scan-run`; on a bulk box with a note `note` (`orphan`, `expired` or `changed`) and for `changed` the lists `added`, `gone` and `moved`. The first line of a section counts. A line with a section this version does not know, or a confirm box with a login, a stack, a hash or its scan run missing, is not one.
- **Every writer draws it again**, from its marker, the live line and the rows it writes, so the count and the staleness are always those of the body written. The rule is one pure function in the core, `drawBulk` in `src/core/bulk.ts`. `resolve` hands it what it did with a tick (asked for a confirmation, handed the confirm box on, or cleared it), applied only while the live line still holds that tick; a newer edit belongs to the next run, as for a row (0025). An older version ignores the kind and drops the line, which the next scan draws again.
- **The walk reads both boxes** (0025): a bulk tick is the ticked bulk box of a section, and a confirm tick is its ticked confirm box at exactly the stacks and hashes it names. A confirm box drawn again with other hashes is another tick, so the bot is never named for it.

## Rejected

- **A bulk box that deploys at once.** The owner asked for the second click, and one stray tick deploying forty stacks is the mistake it guards against.
- **A confirm box that approves whatever is pending when it is ticked.** A person would then approve rows that appeared after they looked. Stale on any change is simpler to reason about than "stale unless the change is small".
- **One comment line for the whole refused part.** A refusal names the stack and the rule of that stack (0018), and stacks of one section can have different rules.
- **A box for preview failed or in sync.** Nothing to deploy.
- **A key in `sluiceway.yaml` to turn the boxes off.** No one asked, the two-box step is the guard, and every existing switch that should hide them already does. It can be added without a breaking change.

## Consequences

- A confirm tick is a stronger act than a row tick only in how much it covers. It needs nothing that ticking every row in one edit would not need, and writing a ticked confirm box by hand is exactly that: the walk names the editor, and every stack is judged by its own rule. The confirmation guards against a mistake, not against a person.
- A confirm box of many stacks is long in the raw body: about the length of each stack id plus 17 characters per stack, in the marker. A hundred stacks add about 5,000 characters, which a row swap has room for under the hard limit (0028). The visible line names ten.
- Notifications, the result file and the outputs do not count the boxes. A refused stack of a confirm tick is in the `refused` notification like any refused tick (0078).
- `docs/using-the-dashboard.md`, `docs/configuration.md` (`tickers`, `deploys`, `dashboard.readOnly`) and the README's example dashboard show the boxes. The job log table names the two scan lines about them.
