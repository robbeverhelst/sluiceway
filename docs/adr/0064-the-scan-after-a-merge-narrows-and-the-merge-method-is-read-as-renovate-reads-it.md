# The scan after a merge narrows, and the merge method is read as Renovate reads it

Record 0054 built merge and deploy, part 1: a tick on an update waiting to merge merges the pull request, `resolve` dispatches a full scan, and that scan hands the fresh diff to `apply`. It left five things in `docs/later.md`: a narrowed scan after the merge, Renovate's JSON5 config and presets, a note on a merge row whose tick was cleared without a comment, more than 10 updates, and pull requests past the oldest 100. Build plan slice 4.13 brings them in, so a Renovate tick costs one narrowed scan, not a full one.

## Decision

### The scan after a merge narrows

- **`resolve` names the merged pull requests in a dispatch input, `sluiceway-merged`**, as their numbers joined with commas: `418` or `418,421`. The run's payload carries it, and a scan that has it narrows as a push does (0010).
- **It compares from the `scan-sha` of the dashboard, as a push does, not from the merge commit's parent.** The scan compares the commit of the last scan with the commit it checked out and previews the stacks that claim a changed file. The merged pull request's files are in that comparison. So are the files of any push whose scan never ran: GitHub keeps one pending run per concurrency group (0004) and cancels an older one, so the dispatched scan can replace the scan of a push that came just before the merge. A comparison from the merge commit's parent would miss that push. For a rebase merge of several commits the parent of the merge commit is not even the base branch. Every fall back of a push holds here too: no dashboard, another marker version, a comparison that is not a straight line, the file cap and unclaimed files each give a full scan, and the log says "The scan after a merge gives a narrowed scan, and this one fell back".
- **The stack of the merge record is previewed whatever the comparison says**, as 0054 already made it for any narrowed scan, so the hand-off never depends on the comparison.
- **A workflow has to declare the input**, because GitHub refuses a dispatch with an input the workflow does not declare (HTTP 422, "Unexpected inputs provided"). `resolve` reads the running workflow's file in its checkout, which is the default branch that the dispatch runs on, and sends the input only when `on.workflow_dispatch.inputs` has `sluiceway-merged`. Otherwise it dispatches as before, the scan is full, and the job log says which input to declare. So a workflow written for 0.10.0 keeps working unchanged, and no request is spent on a dispatch that fails. The merge and deploy section of `docs/workflow.md` shows the lines to add.
- **Only a dispatch by the workflow token counts.** A person who fills the input in by hand under "Run workflow" gets a full scan, as every run a person starts does (0010, and the drift check of 0055 runs in it).
- **The rescan box still asks for a full scan.** When the same run of `resolve` handles the rescan box and a merge, it dispatches once, with no input.

### The merge method is read as Renovate reads it on GitHub

These facts come from Renovate's source on 2026-09-22 (`lib/config/app-strings.ts`, `lib/config/parse.ts`, `lib/util/common.ts`, `lib/config/presets/`, `lib/modules/platform/github/`), not from a run of Renovate.

- **The config file is the first that exists of** `renovate.json`, `renovate.jsonc`, `renovate.json5`, `.github/renovate.json`, `.github/renovate.jsonc`, `.github/renovate.json5`, `.renovaterc`, `.renovaterc.json`, `.renovaterc.jsonc`, `.renovaterc.json5` and the `renovate` key of `package.json`, in that order. The `.gitlab/` files, which 0054 read, are skipped: Renovate does not read them on GitHub.
- **Every file is read as JSON5.** Renovate reads `.json5` as JSON5 and every other file as JSONC with a fall back to JSON5, and JSON and JSONC are subsets of JSON5. Sluiceway has a small JSON5 reader of its own in `src/core/json5.ts`. A dependency was not worth it for one key, and the approved list of the build plan holds none (section 5). A file that does not read gives no strategy, and the fall back applies.
- **Presets are followed as far as they live in this repo.** An `extends` entry `github>owner/repo`, `local>owner/repo` or `owner/repo`, with `:name`, `:file/preset` or `//path/name`, whose repo is this one, is read from the checkout: `default` as `default.json` with Renovate's fall back to `renovate.json`, any other name as `<name>.json` unless it names its extension. Presets inside presets are followed up to 10 deep, and a loop is read once. A later entry wins over an earlier one and the file's own key wins over all of them, as Renovate merges them. A preset of another repo, one at a tag (`#v1`), one with parameters, a relative one, one from a web address or from npm is not read, because it lives outside the checkout; the job log names each. Renovate's own presets (`config:recommended`, `:automergeBranch` and the rest) set no `automergeStrategy`, so they are skipped without a word.
- **Only `automergeStrategy` is read.** `automergeType` does not change the method GitHub is asked for: with `pr` Renovate merges with the same method, and with `branch` it merges no pull request at all. `packageRules` are not read: which rule matches depends on the package manager's view of the update, which Sluiceway does not have.
- **The strategy maps as Renovate maps it on GitHub.** `squash` is squash, `rebase` is rebase, `merge-commit` is a merge commit. `auto` and `fast-forward` fall back to the repo's method: Renovate warns that GitHub has no fast-forward merge and uses the repo's method. Record 0054 read `fast-forward` as rebase, which is not what Renovate does.
- **The repo's method is the first allowed of squash, a merge commit and rebase**, the order of Renovate's GitHub platform. Record 0054 said squash, rebase, merge. Squash stays first, which was the owner's answer to issue 102, question 4, and the second and third follow what Renovate really does. A strategy the repo does not allow still falls back to the repo's method, as 0054 decided; Renovate would send it and let GitHub refuse.

### A merge row may carry a note

- **A merge row is its line and the indented note lines under it.** A tick cleared without a comment gets one fixed line of Sluiceway's own under the row, as a stack's row does (0025, 0051):
  - nobody could be named for the tick, or a scan swept it as an orphan: "a tick on this row was not picked up. Tick again to merge.";
  - the stack has an open deployment: "this tick merged nothing: the stack has a deploy in progress. Tick again once it is over.";
  - `deploys: false`: "deploys are turned off in `sluiceway.yaml`, so this tick merged nothing."
- A refused or failed merge still gets the comment of 0054 and no note. The note replaces any note the row had. Every writer carries the lines as they are. The scan draws the rows fresh from the list, as it draws a stack's row fresh, so a note lasts until the next scan that lists the pull request again, and a swept tick gets the orphan note from the scan itself.
- A parser of 0.10.0 reads the first line as the row and does not see the note, so a body written by this version is carried by an older writer without the note, and with everything else.

### Up to 30 updates, folded after 10, and paging

- **The dashboard lists the oldest 30 updates waiting to merge, and folds all after the first 10** in a `<details>` block whose summary says how many are inside: "5 more updates waiting to merge". A box in the fold ticks like any other. A line is about 250 characters at most, so 30 lines stay under an eighth of the body's target size (0028). The job log names how many more qualify and are not listed. They are listed as the older ones merge.
- **The open pull requests are read page by page**, 100 to a GraphQL page with its cursor, oldest first, up to 10 pages: the oldest 1,000. Each page is one request of the hourly budget (0017). `resolve` reads the same list before it merges, so a ticked pull request past the thousandth oldest is refused as not open. That is on `docs/later.md`.

## Consequences

- The merge and deploy section of `docs/workflow.md` gets a fourth change: declare the input on `workflow_dispatch`. `docs/configuration.md` names the config files, the presets and the method order.
- A scan after a merge on a workflow that declares the input previews only what changed since the last scan. The rest of the dashboard is carried, as for a push, so a row of a stack that was not previewed keeps its words.
- The fake GitHub counts one request per page of 100 open pull requests, records the inputs of a dispatch, and its HTTP server pages with a cursor.
- Still on `docs/later.md`: presets outside this repo and `packageRules`, more than 30 updates or 1,000 open pull requests, and a warning from the check when `mergeAndDeploy` is on and the workflow does not declare the input.
- This amends 0054 (the scan after a merge, the config files, the method order and `fast-forward`, the one-line row, the 10 updates and the 100 pull requests) and 0010 (a dispatch that names a merge narrows).
