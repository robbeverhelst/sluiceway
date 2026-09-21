# A key is a property path, and a row shortens it without ever showing a value

Record 0007 made changed keys top-level property names. The first real repo showed what that costs (onboarding log, hurdle 18): a Helm release row said `update kubernetes:helm.sh/v3:Release arc-tsarr-release · values`, and nothing more, eleven times. The person ticking could not see what a tick would deploy, which is the point of a gate. The owner decided on 2026-09-21 that rows, the summary, the result file and the hash use nested property paths before 0.1.0.

So `changedKeys` and `replaceKeys` of a change hold property paths, as the tool reports them. For Pulumi that is the keys of `detailedDiff`, and `diffReasons` and `replaceReasons` where `detailedDiff` is null or empty. The `Change` type, its field names and the result file keep their shape. What is in the strings changed.

## What a path may contain

A path is made of the names of properties, list indexes and map keys. Never a value. The Pulumi adapter reads the keys of `detailedDiff` and the entries of the two reason lists, and nothing that sits under a path. The schema that parses tool output drops the rest, as it always did (0021).

A map key is a name here, like a property name. It comes from the user's code or the provider's schema: an annotation key, a key under a ConfigMap's `data`, a key of a Secret. The value under it is never shown. So the rule of 0021 grows by one word: do not put a secret in a resource name or a map key.

## What the tool gives, seen with the real CLI

Recorded with v3.229.0 and v3.263.0 in the scenario `nested-paths`, a generated program with the Kubernetes provider in render mode, which needs no cluster:

- An update gives full paths in `detailedDiff`: `spec.template.spec.containers[0].image`, `spec.template.spec.containers[0].env[0].value` and `metadata.annotations["example.com/revision"]`. `diffReasons` is null there. The canary value sat in the value that changed and in no path.
- A replace forced by one key of a ConfigMap gives `detailedDiff` too, and `replaceReasons` holds the path `data["app.properties"]`, not the top-level name. Before this record the adapter cut the changed keys to `data` and kept the replace key whole, so the two disagreed.
- The providers of the example project (`random`, `command`, `local`) give `detailedDiff` null on a replace, and top-level names in both reason lists. Their replaces keep showing top-level names. That is all the tool says.
- A map key with characters other than letters, digits and underscores is quoted: `a["b.c"]`. A quote inside it is written `\"`, and a backslash is not escaped at all (seen by hand with the key `we"ird\key`). A path therefore cannot always be split back into its segments without guessing, so Sluiceway never parses one. It keeps the tool's text byte for byte, sorts it by code unit and hashes it.

No recording holds a Helm release, because previewing one needs a cluster. A test changes the recorded update into a release whose `values.controller.image.tag` changes, in the shape the tool gives for every other nested change.

## How a path is shown and shortened

- The summary, the job log and the result file show every path in full. They are where a shortened row points.
- A row in the issue shortens a path longer than 80 code points. It keeps the first segment, the property the provider defines, cut to 24 code points if it is longer, then `…`, then as much of the end, where the leaf is, as fits. The end starts at a segment when it holds one: `spec…containers[0].env[3].valueFrom.secretKeyRef.name`. Code points, so a cut never splits a character.
- A line inside a row's fold lists at most ten paths, then `, and 23 more`. One Helm release can change hundreds of keys at once, and without the cap one such row would be the reason every other row loses its details under the budget (0028). With it, 30 rows of 400 paths each fit the target in full.
- A delete or replace line lists every path, forcing or not. Record 0024 says such a line is shown whole or cut whole and never loses a key to save space. The size budget still cuts it whole at level 3.
- Shortening shows less than the hash covers, never more. That is the safe direction of 0008, the same as under redact (0023) and at every level of the budget (0028).

Rejected: splitting paths into segment arrays in the diff (the tool's quoting cannot be read back without guessing, and nothing needs the segments); showing only the leaf (`tag` says nothing without `values.controller.image`); grouping paths under a common prefix on a row (a second grammar for a display nicety); keeping top-level names on rows and paths only in the summary (the summary would show what the hash does not cover, which 0008 forbids).

## The hash

The canonical document of 0008 does not change: the same fields, the same order, the same escaping. The strings in `changedKeys` and `replaceKeys` are now paths, so the hash of any diff with an update or a replace changes, once. The fixed vectors of slice 1.1 still hold, because they hash hand-written documents. One vector was added on purpose: a Deployment and a ConfigMap with list indexes and quoted map keys, next to the same change told by top-level names, which gives another hash.

## Consequences

- Every pending row gets a new hash once, on the first scan with this version. A tick on a row written before that is refused as moved when `apply` previews again (0008), the record ends as `error`, and the row comes back with the new hash, ready for a fresh tick. A test runs that way with the recorded update. Rows with only creates, deletes and tracking changes keep their hash.
- A tick now approves "change these keys inside these properties on these resources", still at whatever value the code has when the deploy runs (0008). The promise is narrower than before, not stronger.
- Map keys reach the issue. On a public repo the keys of a Secret's `data` are public too. `dashboard.redact: true` keeps them out of the issue, as it does every other name.
- An OpenTofu adapter gives paths from `replace_paths` and from comparing `before` and `after` (0021), in its own notation. Paths are opaque text to the core, like addresses, so nothing else has to change.

Amends 0007 (changed keys are no longer top-level names) and 0008 (the same rule, with longer keys, and one new vector). The reasoning of 0021 that named top-level keys as a limit no longer applies to paths, and its rule does: names only, never values.
