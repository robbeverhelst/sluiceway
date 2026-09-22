# A stack may read its dependencies from its stack references, and drift is set per stack

Records 0055 and 0056 built part 1 of drift and of dependencies, and each listed what it left for part 2. Build plan slice 4.7 picks what makes both complete enough for daily use. Dependencies: the check mode lists `dependsOn`, a dependency that `ignore` leaves out is refused with the reason, and a dependency may be read from Pulumi stack references as an opt-in, `dependsOn: auto`. Drift: `stacks[].drift`, a drifted row's changes listed like a pending row's, `drift` on the counts line with a dot, one drift picture, and a line of the trail that says a deploy repaired drift. This record fixes how.

Amends 0009, 0021, 0050, 0055 and 0056.

## Decision

### Dependencies

- **`stacks[].dependsOn: auto`** reads the stacks a stack depends on from its program's stack references, at every preview of the stack. It is the word `auto` in place of the list. Entries add up as before: a stack can have `auto` from one entry and a list from another, and then it depends on both.
- **Only a Pulumi program has stack references.** An entry with `tool` that says `auto` is a config error, so a stack of another tool never has an `auto` that waits on nothing and says nothing (0056).
- **The adapter reads one input, and hands on only stack ids.** A stack reference is a `read` step of the type `pulumi:pulumi:StackReference` in `pulumi preview --json`, before the stack was deployed and on every preview after, recorded on v3.229.0 and v3.263.0 (the `stack-reference` scenario). Its input `name` is the one input of a new state the adapter keeps, only on a step of that type. The adapter turns it into a stack id of the repo and drops it. No name a program wrote leaves the adapter, which keeps 0021.
- **How a name becomes a stack id.** `organization/project/stack` names the stack of that name in the project of that name. The project is the `name` of a directory's project file, not the directory. A stack name alone is a stack of the program's own project. Two parts are `project/stack`, as a file backend reads them, or else `organization/stack` of the program's own project, as Pulumi Cloud reads them. The organization is never compared: the repo's files do not say it. A name that fits no stack Sluiceway knows (a stack of another repo, an ignored one), or more than one, is counted, the scan's log says how many, and nothing waits on it. A reference to the stack itself is dropped.
- **The row carries what the preview read.** A row made from a preview of a stack with `auto`, pending, drifted or in sync, gets the marker key `depends-on` with the stack ids, after every older key, commas between them, and a comma or percent sign in an id escaped once more. A row carried through keeps it. A preview failure has none, and has no box either. A repo without `auto` writes no new key.
- **`resolve` reads the key, and only for a stack with `auto`.** `resolve` never previews, so the row is its one source, as it already is for a pending dependency (0056). What a stack depends on is then what the file names and what its row says. A read that names a stack discovery does not know, or the stack itself, is left out. A read that would close a circle, with the file's list or with another read, is dropped in stack id order, and the log says which. The file's own circles stay config errors. The rest of 0056 is unchanged: a tick waits only on the stacks its stack depends on directly, only while one is pending and not ticked, and a chain deploys one layer per run.
- **A `resolve` that a dispatch started** reads the records of every stack when any stack has `auto`, because only the rows know which stacks those are.
- **A dependency that `ignore` leaves out** is still a config error (0056), and the message quotes the reason of the `ignore` entry when it has one.
- **The check lists `dependsOn`.** Its job log adds "depends on" to a stack's settings, and its summary gets a column "Depends on" when any stack has one. `auto` is shown as auto: the check reads files only (0042), so it cannot know what a preview will read.

### Drift

- **`stacks[].drift.enabled`** turns the drift check on or off for the stacks of an entry, whatever the top level `drift.enabled` says. It is a mapping like the top level, so the same words work in both places. An entry with a name wins over one without, as for `environment`. The scans that check are the ones of 0055: a schedule, and a dispatch a person started, check every stack whose setting is on, and a push checks only those among them whose row showed drift. A stack whose setting is off is never checked. `true` or `false` alone is an error that shows how to write it.
- **A drifted stack gets a preview page**, a check run like a pending stack's (0050), that lists its drift like a pending row's changes: what happened, the type, the name and every path whole, never a value. The page of a pending stack that also drifted lists the drift after the changes and says the deploy puts it back. A drifted row's link is `preview`, and it lands on that page, or on the summary without one, as a pending row's does.
- **The counts line and the picture stay as 0055 built them.** `N drifted` with its orange dot is already on the counts line. One drift picture is enough: no picture per crate count.
- **The trail says a deploy repaired drift.** A successful record whose payload has `drift: true`, and that did not end as nothing to deploy, is listed under Recently deployed with "put back what changed outside the code". Rehearsals and "nothing to deploy" keep their own words.

## Rejected

- **Reading stack references from the program's source.** Every language writes them differently, and a name can be built at run time.
- **Reading them from the state** (`pulumi stack export`). It needs the backend, and `resolve` runs with no credentials and no tool (0014).
- **Handing the reference names to the core** and matching them there. A name is an input value of a resource, and 0021 keeps every value inside the adapter.
- **A map of every stack's dependencies on the root marker.** The row already is the cache of what the stack's last preview found, and a row carried through keeps its key with no extra work.
- **Comparing the organization.** A file backend always says `organization`, and the repo's files say nothing about a Pulumi Cloud organization. A false match would only hold a tick back, and the note would say which stack.
- **`drift: true` on a stack.** It is shorter, but the top level is a mapping, and a person who copies one into the other should not get an error.
- **A drift picture per crate count.** It would be thirteen more file pairs (later.md).

## Consequences

- The example project is unchanged. A stack reference to a stack that does not exist fails every preview, so the recorder adds the reference in the `stack-reference` scenario, after `network:prod` is deployed, the way `drift-changed` adds its resource.
- A wrong or missing `depends-on` key can at worst refuse a tick that could have gone out, or let one out that a person could have ticked by hand anyway, as 0056 says of the row state.
- What a stack reads is known only after its first preview with `auto`. Until then, and while its preview fails, it waits on what the file names.
- A stack that reads another through a stack reference whose value changes with the other's deploy gets a new hash after that deploy, and `apply` refuses it as moved (0056).

This record amends 0009 (the key `depends-on`, and `resolve` reading it), 0021 (the one input the adapter reads), 0050 (a page for a drifted stack), 0055 (drift per stack, the page, the trail) and 0056 (`auto`, and the reason on the ignore error).
