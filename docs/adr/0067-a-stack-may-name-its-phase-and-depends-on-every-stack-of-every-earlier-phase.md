# A stack may name its phase, and depends on every stack of every earlier phase

Records 0056 and 0059 made dependencies a list of stack ids, or `auto` from Pulumi stack references. A repo that deploys in phases, infrastructure first, then monitoring, then the applications, would have to write an edge from every stack of a phase to every stack of every phase before it: forty edges for a small repo, and one more for each new stack. Build plan slice 4.16 asks for the general form: a repo names its phases once, and each stack says which one it is in. This record fixes how.

Amends 0056 and 0059.

## Decision

- **`phases` at the top of `sluiceway.yaml` is an ordered list of names.** A name is a plain word (letters, digits, `.`, `_` and `-`), so it reads the same in a note, the check and the job log, and each is named once. The default is none.
- **`stacks[].phase` names the phase of an entry's stacks.** It must be one of `phases`, checked when the file loads. An entry with a name wins over one without, as for `environment`.
- **A stack in a phase depends on every stack in every earlier phase.** The edges are derived when config is laid over the stacks, and from there on they are dependencies like the ones `dependsOn` names: every rule of 0056 holds for them unchanged. A tick is refused while one of them has a pending row that nobody ticked, ticks across phases deploy one layer per run, a stack ticked while an earlier phase deploys is queued behind it, and `settle` starts the next layer.
- **`dependsOn` adds to the phase.** Inside a phase it orders stacks by hand. A `dependsOn` on a stack of a later phase is a circle, and the loader says so in words that name both phases. Any other circle through a phase is named with the phase, "waits on the infrastructure phase, which holds network:dev", never with every stack in it.
- **A stack without a phase** neither waits on a phase nor holds one back. A phase with no stack is allowed, and the phases after it wait on the ones before it all the same.
- **A refusal names the phase.** The note under the row reads "this tick started nothing: it waits on the **infrastructure** phase: **network:prod** has a change waiting", and names at most five stacks of a phase, counting the rest, as a row names at most five authors (0029). Only the stacks that hold the tick back are named, not every stack the phase gives. A stack that `dependsOn` names and that is not in an earlier phase is named by itself, as before. Without phases the note is byte for byte what it was.
- **The check lists the phases** (0042): a group "Phases" in the job log with each phase, its stacks and the phases it waits on, a column "Phase" and a table "Phases" in the summary, and each stack's derived edges in its settings line, named with the phase that gives them. The summary's "Depends on" cell names the phase, not its stacks.
- **`phase: { from: <key> }` reads the phase from the tool's own file.** A repo that already writes each project's phase into its Pulumi project file points at that key. Discovery reads the text under it, and nothing else of the file, where Pulumi accepts a key a program does not use: under `config`, as text or as a mapping with a text `value` or `default`, and else at the top level. Pulumi v3.198 took all three forms without a word in a preview. A value marked `secret: true` is never read. The text must be one of `phases`; a stack whose file has no such key, or whose text is not a phase, is a config error that names the key and the stack and does not quote the text. An entry with `tool` that says `from` is an error, as `auto` is (0059): no other tool has a project file.
- **A `resolve` that a dispatch started** looks for queued stacks when any entry has `dependsOn` or `phase`.

## Rejected

- **Deploying the earlier phase without a tick.** The slice says a tick on a later phase "deploys the earlier phase first". Read without the rule of 0056 it would deploy stacks nobody ticked, which breaks the one promise of the dashboard: a tick deploys exactly what the row showed. So the earlier phase goes first when it is ticked too, in the same edit or before, and a tick alone is refused with the note.
- **Phase nodes in the deployment records.** `behind` stays a list of stack ids (0056). A queued record waits on the stacks that went out, and a phase is only a way to write the edges.
- **Every stack must have a phase once `phases` is set.** A repo moving to phases does it one directory at a time, and a stack no phase names is simply outside the order.
- **Quoting the text of a `from` key in an error.** It is a value of the tool's file, and 0021 keeps those out of what Sluiceway writes. A text that is a phase is shown, because then it is a name from `sluiceway.yaml`.
- **Reading a phase from files of other tools** (a label in `Chart.yaml`, a comment in OpenTofu). Nothing asks for it yet (later.md).

## Consequences

- A phase is a derived list of edges, so a repo with many stacks per phase gets long `behind` lists on queued records and long "queued behind" rows when many stacks are ticked at once. Only ticked or deploying stacks are in `behind`, so a usual tick queues behind a few.
- The circle check sees a phase as one node, so a circle is found without walking every pair of stacks.
- Adding a stack to an early phase makes every stack of every later phase wait on it from the next `resolve` on.

This record amends 0056 (dependencies from a phase, and the note that names the phase) and 0059 (the check lists phases, and `from` is Pulumi's only).
