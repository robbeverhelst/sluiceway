# The trail says what a deploy shipped, and a row names its changes outside behind a fold

Record 0026 fixed attribution for v1 and left four things out, each with a line in `docs/later.md`: shipped pull requests under recently deployed, a configurable lookback and number of names, naming changes outside a stack on its row, and the old path of a file a pull request renamed. Build plan slice 5.5 brings all four. Attribution still explains and never decides: nothing here reaches the diff hash (0008), a deploy or a tick.

This amends 0026 and 0062.

## Decision

- **The trail says what a deploy shipped.** A line of Recently deployed for a deploy that went out (a plain deploy or a drift repair) gets a second line inside its list item: `shipped #102 by dave, #101 by carol, and 1 change outside this stack · [compare](…)`. The range runs from the commit of the stack's success before it to its own commit, both from the deployment records (0003), and the claim rule of 0010 picks what is named, as on a row. The order of the line is the order of 0026, with `shipped` in place of `from`.
- **A walk, not a list stored at tick time.** 0026 named both ways. The walk needs no new field on the deployment payload, works on every record written since 0.1.0, and reuses the walk every writer already makes. Its cost is that a range whose older end left the lookback reads `and earlier changes`, and a deploy whose own commit left it gets no shipped line at all.
- **No guess.** A deploy with no success of its stack before it among the records read, a deploy that found nothing to deploy, a rehearsal and a failed deploy get no shipped line. Nor does a deploy whose range holds nothing the stack claims and nothing outside it. An empty success still counts as the success before the next one, as it does for a row's start (0026).
- **Only the lines shown are worked out.** `dashboard.recentlyDeployed` lines at most, so a trail of 50 costs no more reads than its ranges hold.
- **`attribution.lookback`**, 1 to 1,000 commits, default 100. The walk asks GraphQL for pages of 100 with the cursor of the page before. Measured on 2026-09-21 for 0026: a page of 100 costs about 7 points, so the longest lookback costs about 70 of the workflow token's 1,000 per hour.
- **`attribution.names`**, 0 to 20, default 5: how many pull requests and direct pushes a row and a shipped line name before the rest is a count. 0 names none, and the line is always the count that budget level 1 gives. Twenty keeps the longest line to about a thousand characters.
- **A job reads at most 100 changes one by one.** Direct pushes and pull requests that renamed a file, newest first, shared by the rows and the trail. A longer lookback would otherwise let a repo that pushes directly spend one request per commit, far past the budget of 0017. A change whose files were not read counts as a change outside every stack, which is what 0026 does with a push of 300 files: it never hides a change.
- **Changes outside a stack are named behind a fold.** The line keeps its count, and a fold `changes outside this stack` names each of them, newest first, the first twenty, then `and N more`. Each is a link written as HTML, `<a href="…/pull/20">#20</a> by renovate[bot]`, because inside a fold the text is an HTML block, where a Markdown link is not one. No file path is shown: a path can name a stack with redact on, and the hover card and the compare link show the files. 0026 rejected naming them on the line, where every row would carry the same long list. Behind a fold the list costs a click, not the reader's attention.
- **The fold comes last on the row.** An HTML block runs to the next blank line, so a Markdown line after it would not render. It follows the fold of changes and the drift fold, and on a deploying row it follows the attribution line. It is left out from budget level 1 on, with the names, and it stays with redact on, as the line does (0023).
- **The old path of a renamed file.** GraphQL gives a pull request's files by their new path only; seen on 2026-09-22, `PullRequestChangedFile` has `path` and `changeType` and no old path. The walk now asks for `changeType`, and a pull request in a range with a `RENAMED` file has its files read once more over REST (`GET /pulls/{number}/files`, one page of 100), which gives `previous_filename`. Both paths go to the claim rule, as they already do for a direct push. A pull request over 100 files is not read: it already counts as outside every stack.
- **The trail shortens first.** After the spinners (0063) and before any pending row, the size budget turns every shipped line into its count. The trail is history, and a row decides a deploy.

## Consequences

- `resolve` and `apply` write the trail too, so they make the walk when a shown line of the trail has a range, also when no row needs it. That is one GraphQL request per job for a dashboard with a deploy on its trail, where 0026 made none without a pending or deploying row.
- The result file (0061) and the summary are unchanged. The summary lists every claimed change in range already.
- A row pending only through shared changes now shows who made them one click away, and a lockfile bot's pull requests are listed there, not on the line.
- The port has two changes: `walkCommits` takes the lookback, and `listPullRequestFiles` is new. The fake pages the walk, counts one request per page and gives a renamed file under both paths over REST.

## Rejected

- **Storing the shipped list on the record at tick time.** It would change the payload of 0003, not cover records written before, and freeze a list that the claim rule of a later config would draw differently.
- **File paths in the outside fold.** See above.
- **A lookback without a cap on reads.** See above.
- **Reading every pull request's files over REST.** One request per pull request in range, to find the rare rename. `changeType` says which ones need it.
