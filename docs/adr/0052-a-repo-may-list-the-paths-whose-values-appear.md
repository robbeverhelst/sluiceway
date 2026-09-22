# A repo may list the property paths whose values appear, and nothing is guessed

Record 0046 gave rows nested paths, so a Helm release row now says `version` or `values.image.tag` where it used to say `values`. The first real user still could not tell a version bump from anything else without opening the code: "Could we show what is being updated, so I know it is just a version bump?" (onboarding log, hurdle 22). The owner decided on 2026-09-22 that a repo may list the paths whose old and new values appear, empty by default, with a list to copy in from the docs.

## Decision

- **`dashboard.showValues` is a list of property paths**, in `sluiceway.yaml`, default `[]`. A changed path on the list reads `old → new` right after the path, on a row, in the summary, on the preview page (0050), in the result file (0041) and in the job log's diff lines (0037). Nothing changes for a repo that does not set it.
- **An entry matches exact paths, or the globs a person wrote.** An entry is compared with the path as record 0046 keeps it, the tool's text byte for byte. `*` stands for any run of characters inside one name: it never crosses `.`, `[` or `]`. Everything else in an entry is literal, brackets and quotes included, because a path is never parsed. `**` is refused, and so is an entry made only of `*`, dots and brackets, because such an entry shows values nobody chose. So `values.*` matches `values.replicas` and not `values.githubConfigSecret.github_token`.
- **Never a value the tool marks secret, listed or not.** Pulumi prints `[secret]` in place of such a value in its preview document. A value that reads so, or that sits under a parent that reads so, shows nothing. This is the one place where the tool's marking is an input to Sluiceway, and it can only take a value away.
- **Only scalars.** A string of one line, a number or a boolean. An object or a list can hold a secret leaf next to a harmless one, a value of several lines does not fit on a row, and a value the tool knows only once the deploy runs is not a value yet: none of them shows. A side that is not there, because the key is new or removed, reads `nothing`.
- **Shortened past 40 code points, everywhere.** A longer value keeps its first 19 and its last 20 code points around `…`, because a version or an image tag sits at the end. The adapter shortens it, so the middle of a long value never leaves the adapter.
- **`dashboard.redact: true` turns the list off.** Scan and `apply` then hand the adapter an empty list, and no value is even read.
- **The diff hash does not cover values.** Record 0008 hashes names, and it still does: the canonical document names its fields one by one and `values` is not one of them. Turning the list on or off, or changing it, voids no tick.

## Why an allowlist and not a guess

A built-in rule such as "show it when it looks like a version" was rejected, for the reason of 0022: a pattern is a guess, and a miss lands in an issue that is emailed and kept in edit history. A chart can put a token anywhere in its `values`. The first user's charts have one at `values.githubConfigSecret.github_token`, rotated on every deploy and not marked secret by the tool. No pattern tells it from a harmless string, and the tool does not know. So the list matches only what a person wrote, and its safety is exactly that person's judgment. The docs say so next to the copy-in list (`version`, `chart.version`, `values.image.tag`, `image`), and the star stops at one level so that a short entry cannot sweep up a whole subtree.

## Where the values come from

The build plan said the schema keeps `detailedDiff` values for the listed paths. The tool's `detailedDiff` holds no values: each entry is `{ "kind": "update", "inputDiff": false }` in every recording on both CLI versions. The values are in the step's `oldState` and `newState`. So for a listed path of `detailedDiff`, the adapter reads the new value from `newState.inputs`, and the old one from `oldState.inputs` when the entry says `inputDiff: true` and from `oldState.outputs` otherwise, which is what the tool compared. Only paths from `detailedDiff` get values: a top-level name from `diffReasons` or `replaceReasons` has no entry that says which side was compared, and shows none.

Record 0046 says a path is never parsed. The adapter keeps that: it walks the state and writes the path of every property it passes the way the tool writes one (a name after a dot, `[0]` for an index, `["a.b"]` for a key that is not letters, digits and underscores, with `"` written `\"`), and follows a property only when the listed path starts with what it wrote. Where the tool writes a path differently, nothing matches and nothing shows, which is the safe direction. Two properties that write the same path show nothing.

All of this happens inside the schema that parses the tool's output. What leaves the schema is the display text of the listed values, and nothing else of either state. With an empty list the schema reads no state at all, as before.

## Consequences

- `Change` gets one optional field, `values`: `{ path, old?, new? }[]`, sorted by path, only for listed paths that changed. Amends 0007 (the shape) and 0021 (a value may leave the adapter, at a listed path only).
- The preview page shows the listed values too. Record 0050 said values there would need a decision of their own, because the runner's masks do not reach a check run. This is that decision, and it amends 0050: the page shows what the row shows. The page says so in its summary when it shows any value.
- The result file gets `values` on a change, only when there are any. It is an added field, so `version` stays 1.
- A tick still approves names, as 0008 and 0046 say: "change these keys at whatever value the code has when the deploy runs". A row that shows `17.0.3 → 17.0.4` can deploy `17.0.5` when a merge moved it after the tick and before the deploy, with the same hash. The docs say so next to the key.
- A listed value lives in the issue's edit history once it has been there. Removing a path from the list does not take it back.
- The canary test runs the recorded nested change with the canary value on a listed and on an unlisted path, and every scenario with a list of every changed path, where a secret and the tool's stand-in for one still never appear.

Amends 0007, 0021 and 0050. Follows 0022 in rejecting a guess.
