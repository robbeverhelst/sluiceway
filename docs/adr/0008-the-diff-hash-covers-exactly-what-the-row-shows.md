# The diff hash covers exactly what the row shows, no more and no less

The hash excludes values, so it has a blind spot. Someone ticks a row that says `grafana: update, image`. Before the apply job starts, a second merge moves the image from `v2` to `v3`. Address, op and keys are the same, the hash matches, and `v3` deploys. We accept this, and fix the rule that bounds it: the hash is taken over the whole diff, and the renderer may show nothing about a change that is not in the diff. What a person approved and what was hashed cannot drift apart, because they are the same data (see 0002).

Amended by 0023: on a redacted dashboard the row shows less than the hash covers. The half of the rule that matters stays whole: nothing is shown that is not hashed.

Amended by 0052: a repo may list paths whose values are shown. Those values join the document as this record said they would, in a `values` field of the change that is left out when a change shows none, so a value that moved after the tick stops the deploy.

Amended by 0046: the keys in the document are property paths, so every pending row got a new hash once. A row shortens long paths and lists at most ten in its fold, which again shows less than the hash covers and never more.

Two ways to close the blind spot were rejected. A digest of the values would sit in an issue that may be public, where a low-entropy value the user forgot to mark secret can be guessed offline, and a salt has nowhere to live without a store. Putting the commit SHA in the hash would make every merge void every outstanding tick until the next full scan ends, which on a repo where Renovate merges all day means ticks that mostly abort. Narrowing that to commits under the stack's path would miss changes that arrive through a shared package.

## Consequences

- A tick approves the change as shown. While only property names are shown, a tick means "change these properties on these resources", at whatever value the code has when the deploy runs. This is a weaker promise than the brief implies, and the docs must say so. What went out stays traceable, because the deployment record carries the deployed commit SHA.
- Nothing enters the hash that is not already visible in the issue, so the hash cannot leak anything. If values are ever shown, they join the diff and are hashed by this same rule, and the blind spot closes exactly as far as the ticker could see.
- The input is a canonical JSON document: `stackId` and `changes`, with every field of every change (0007). Changes are sorted by address. `changedKeys` and `replaceKeys` are sorted with duplicates removed. Object keys are sorted, optional fields that are absent are left out, and there is no whitespace. Sorting is by plain code unit order with no locale. The text is encoded as UTF-8 and hashed with SHA-256. The first 16 hex characters, in lower case, are the diff hash.
- Anything derived from the diff stays out: counts and rendered text. So does everything on the row that says where a change came from and not what it does: scan time, commit, attribution to merges.
- When a row also shows drift, the drift diff joins the same document under its own key, and the one hash covers both. A row never has two hashes.
- There is no salt and no hash version. A diff hash only lives from one render to the next tick, so changing the algorithm or the diff shape costs a few outstanding ticks that abort as "the change moved" until the next scan. That is the safe direction.
- The diff hash is not a security boundary. A forged one can only approve what a fresh preview shows anyway (see 0004).
- Only rows that can be ticked carry a hash. For a deploying stack the approved hash is on the deployment record (see 0003).

Research: https://github.com/sluiceway/sluiceway/blob/research/pulumi-cli/docs/research/pulumi-cli.md
