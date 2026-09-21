# The tool's own diff may reach the job log, when a repo asks for it

Record 0021 keeps every value out of everything Sluiceway writes, the job log included, and record 0022 keeps the tool's own words in the job log and out of everything else. The first real user could not see what a tick would deploy: rows said that `values` changed on a Helm release, eleven times, and nothing more (onboarding log, hurdle 18). A gate a person cannot see through is a weak gate. Nested property paths (slice 2.15) say where inside a property a change is, and still never what it changes to. The owner decided on 2026-09-21 that a repo may also ask for the values, in one place.

So a repo can turn on `scan.logDiff`. A scan then runs the tool a second time for every pending stack and prints the tool's own diff, values included, in that stack's group of the job log. That group is the only place a value may appear. It never reaches the issue, a comment, the summary, the result file, an output, an annotation or a deployment record. `apply` prints the tool's own diff of its fresh preview the same way.

## Why the job log, and why off by default

The job log is the one surface that record 0022 already trusts with the tool's own words: GitHub masks every registered secret there, it expires with the run, it is never emailed and never indexed, and only people who can read the repo can open it. The issue has none of those limits (0021).

It is off by default for three reasons that 0021 gave and that still hold:

- **The tool only masks what somebody marked.** Pulumi prints `[secret]` for a value it holds as secret and every other value in plain text. A secret that nobody marked, or that a provider returns unmarked, is printed as it is.
- **Anyone who can read the repo can read its job logs.** In a public repo that is anyone at all. In a private one it is every person and every integration with read access, for as long as the repo's log retention keeps the run (90 days unless the owner changed it).
- **It costs one more run of the tool per pending stack.** A preview can take tens of seconds, so a scan with many pending stacks takes noticeably longer.

A repo that turns it on takes those three on knowingly. The docs say so where the setting is described, in `docs/security.md` and in the README.

## What masks a secret there

Two things, and nothing Sluiceway guesses (0022):

- **The tool's own marking.** Pulumi prints `[secret]` for a value it holds as secret, before and after. The recorded `log-diff-changed-secret` scenario shows a changed secret as `[secret] => [secret]` on both supported CLI versions.
- **The runner's registered masks.** Whatever the step that loaded the secrets registered with `::add-mask::` is masked in the whole log, this group included (0013).

Sluiceway adds no mask of its own and does not look inside the text. What the tool prints between those two nets is printed as it is.

## Decision

- **The setting** is `scan.logDiff` in `sluiceway.yaml`, `true` or `false`, default `false`. It sits under `scan` because it is about the preview, and `apply`'s fresh preview is the scan's preview done again (0035). It is not an action input: whether values may appear in a repo's logs is the repo's decision and belongs in its reviewed config, not in each workflow.
- **The second run** happens only for a stack whose preview is pending: a diff with changes. None for a stack in sync, a preview failure, or any stack while the setting is off. It runs in the same slot of the pool as the stack's preview, right after it, so the pool never runs the tool for more stacks at once than `concurrency` (0012). It gets the stack's own time limit, the same as its preview, as a limit of its own.
- **The command line** is the preview's without `--json`, with `--diff` for property level detail and `--suppress-outputs` to keep the stack outputs out, as on the deploy, because a change to outputs alone is not shown in v1 (0036): `pulumi preview --diff --suppress-outputs --non-interactive --color never --stack <name>`. No other flag, so it shows the same program with the same config as the preview (0015). The recordings of it come from the fixtures job in CI, like every other recording (0001).
- **It decides nothing.** The row, the diff hash, the counts and every other thing Sluiceway decides come from the `--json` preview alone. A second run that fails, times out or cannot start never changes the row or the job's result. Its group then says why, in a reason from the fixed list of 0022, and the tool's words follow. It gets no annotation of its own.
- **What the tool prints is not what was hashed.** It is a second run of the program. Between the two a data source can change, so the tool's diff is a close reading of what a tick deploys, not the approved thing itself. A tick still approves the diff hash of the preview (0008).
- **In the group**, the tool's diff follows Sluiceway's own lines and a line of Sluiceway's that says it follows and why. It is printed as it is, ANSI escapes stripped, between `::stop-commands::<token>` and `::<token>::`, with a token that is new for every group. A value that sits at the start of a line can therefore never act as a workflow command, such as an annotation that would show it on the run's page. The tool's other words keep the standing record 0012 gave them.
- **The type** that carries the text out of the adapter is `ToolDiffResult`. Only the job log takes its `text`. The canary test proves it: with the setting on, the canary value reaches that stack's group of the job log and no other place a scan or an `apply` writes to.
- **In a public repo** the run of a scan or an `apply` with the setting on gets a warning annotation that says anyone can read the values in its job log. Whether the repo is public is read from the event's payload. A payload that does not say gets no warning, and nothing is guessed.

## Where a click lands

Record 0044 sends a pending row's `preview` link to the summary of the attempt. With `scan.logDiff` on the summary holds less than the job log does, so the link goes to the log of the job that previewed the stack instead, `/actions/runs/<run>/job/<job id>`. The job's page shows the log. The stack's group is titled with its stack id, and the search box of the log finds it. GitHub gives no address for a line of a log that the action can know (0044), so that is as close as a link gets. Without the job's id the link stays on the summary.

The summary says under its counts where the tool's diff is: `The tool's own diff of every pending stack, values included, is in the job log, in the stack's group.`, with a link to the job. A person who opened the summary is one click from it.

The link follows the setting, not the second run: a failed second run does not change the row, its link included. The group it lands on then says why the tool's diff is missing, and still holds Sluiceway's own diff of the stack.

A row that `apply` writes from its fresh preview, after a change that moved, links to `apply`'s own job log the same way. A row made from the preview after a failed deploy links to the summary, because `apply` runs the tool's diff for its fresh preview only.

## Consequences

- Record 0021 is amended: a value may reach one place, the stack's group of the job log, and only when a repo turned `scan.logDiff` on. Everything else in 0021 holds: the `Diff` type has no field for a value, and the issue, comments, markers, deployment records, summaries, the result file, annotations and Sluiceway's own log lines never hold one.
- Record 0022 is amended: the tool's words in the job log may now include its own diff, printed with workflow commands stopped.
- Record 0044 is amended: with `scan.logDiff` on, a pending row's `preview` link lands on the job's log.
- The scan logs how long each second run took, next to its preview, so the cost can be read from the job log.
- A per stack switch, and the tool's diff for the preview after a failed deploy, are not in v1 (`docs/later.md`).
