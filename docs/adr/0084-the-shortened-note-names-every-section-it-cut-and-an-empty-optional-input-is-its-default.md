# The shortened note names every section it cut, and an empty optional input is its default

> Amends 0028 (what the note under the scan line counts and how it reads) and 0055 (its line that the note counts pending rows only). Built as slice 5.20.

Two small fixes, each filed as an issue, that change what a user sees.

## The note about shortened rows

Issue 188, found during the architecture pass (pull request 177). Record 0055 lets the size budget shorten a drifted row as it does a pending one, and kept the note under the scan line counting pending rows only. So a body whose shortened rows were all drifted cut rows and said nothing, and a body with both said "39 of 53 pending rows are shortened" while more rows than that were cut.

### Decision

- **The note counts every shortened row, and names each section that has one**, in the order of the body: pending, then drifted. A section with no shortened row is not named.
  - Only pending: `so 39 of 53 pending rows are shortened.` Byte for byte the sentence of 0028.
  - Only drifted: `so 2 of 5 drifted rows are shortened.`
  - Both: `so 39 of 53 pending rows and 2 of 5 drifted rows are shortened.`
- **The verb is `is` only when one row of one section is shortened**, as before. Two sections always take `are`.
- The rest of the note is the same: the summary that a shortened row links to shows every change, and deletes and replaces are the last thing to be cut.
- The count comes from the row markers, as 0028 settled for slice 1.8, so a writer that is not the scan keeps the note. The `shortened` key was already on a drifted row's marker.

### Why the sections and not only the number

- **The common case does not change.** Drift is off unless a repo turns it on, and a body that shortens only pending rows reads exactly as the owner judged it on the over budget prototype. Every snapshot of it stays.
- **It says where to look.** Pending and drifted rows are ticked for different reasons, and "2 of 5 drifted rows" tells the reader which list has rows that link out.
- **It stays true for any mix.** A bare number, `so 41 rows are shortened`, was the other choice. It is true too, but it drops the "of 53" the prototype showed, and a count of every row of the body would mix in rows the budget never shortens.
- A later section that the budget shortens adds one more clause, not a new sentence.

## An empty optional input

Issue 184, found while wiring a workflow that measures the scan. GitHub applies an action's default only when a workflow leaves the input out. A workflow that passes an input through from its own dispatch inputs, `concurrency: ${{ inputs.concurrency }}`, sends an empty string on every trigger that has no such input, and the scan failed with `The "concurrency" input must be a whole number of 1 or more, and it is "".` The only way round was `${{ inputs.concurrency || '4' }}`, a copy of the action's default in the caller's file.

### Decision

- **An empty optional input, or one of white space only, means its default.** That is `concurrency` (4), `preview-timeout` (10 minutes, in scan and in apply), `deploy-timeout` (no limit), and every boolean input: `strict`, `dry-run` and `backend` (false). `mode` (auto, 0077) and `job-id` (unknown, the links fall back, 0044) already read so, and so do the four notification channels (nothing is sent, 0078).
- **A value that is set and wrong still fails**, with the same message as before: a number that is not a whole number of 1 or more, and a boolean that is not `true` or `false`.
- **Two inputs still fail when empty, because they have no default to fall back to:**
  - `github-token`. Its default in `action.yml` is the run's own token (0017), so it is empty only when a workflow set it so, and nothing can act without it. White space only now counts as empty too.
  - `deployment-id` in apply mode, where it is required (0035). In every other mode an empty one is left alone, as before.
- The numbers live in `action.yml` and in `src/github/inputs.ts`. A test reads `action.yml` and holds that an empty input reads the same as its default, for the scan and for apply.

### Rejected

- **Failing an empty input with a message that says to leave it out.** The pass-through pattern is ordinary, and every such workflow would have to write the default a second time.
- **Treating an empty required input as absent too.** There is nothing to fall back to, and a deploy with no record or a run with no token cannot go on.
