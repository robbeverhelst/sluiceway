# Sluiceway

Sluiceway keeps one GitHub issue, the dashboard, that shows which infrastructure stacks have changes waiting, and deploys a stack when someone ticks its box. This glossary fixes the words used for that.

## Language

### Stacks

**Stack**:
The smallest thing Sluiceway can preview and deploy on its own. It has its own state, one row on the dashboard and one checkbox. This is Sluiceway's word, not a tool's: a Pulumi stack is a stack, and so is an OpenTofu root module with a chosen workspace and var files. Not every stack is a Pulumi stack.
_Avoid_: Unit, project, workspace, module, target

**Stack id**:
The one string that names a stack everywhere: on its row, on its deployment records and in config. It is derived from where the stack lives and what it is called, never chosen, so a stack that is moved or renamed is a new stack.
_Avoid_: Stack name, slug, key

**Discovery**:
Finding the stacks of a repo from its files alone. It never asks a backend and never starts the tool, so it can run in a job that holds no credentials. A stack that no file names does not exist for Sluiceway.
_Avoid_: Detection, lookup, stack listing

**Ignored stack**:
A discovered stack whose stack id matches an `ignore` glob. It has no row, is never previewed and claims nothing, and config cannot give it settings.
_Avoid_: Excluded stack, hidden stack, skipped stack

### Scans

**Scan**:
One pass that previews stacks and brings the dashboard up to date with the results. Every scan ends with exactly one row for every stack.
_Avoid_: Run, refresh, sync, plan

**Full scan**:
A scan that previews every stack.
_Avoid_: Complete scan, deep scan, rescan (that is the checkbox that asks for one)

**Narrowed scan**:
A scan that previews only the stacks that claim a file changed since the last scan, and keeps every other stack's row as it is. It is a full scan whenever a changed file has no claimant.
_Avoid_: Partial scan, incremental scan, affected scan, changed stacks

**Pool**:
The fixed number of previews a scan runs at the same time, in one job. It starts the next preview when one finishes, in stack id order, and never previews one stack twice at once. Its size is the `concurrency` input.
_Avoid_: Workers, threads, matrix, batch

**Claim**:
A stack claims a changed file when the file lies inside the stack's directory or matches one of the inputs configured for that stack. Several stacks can claim one file.
_Avoid_: Affects, owns, touches, depends on

**Scan plan**:
What a scan decides before it previews anything: a full scan with the reason for it, or a narrowed scan with the stacks to preview and why each one. A narrowed scan that cannot trust its comparison falls back to a full scan.
_Avoid_: Strategy, scan mode, selection

### Diffs

**Diff**:
What deploying one stack would change, told as addresses, ops, tracking changes and the names of changed properties. Never values.
_Avoid_: Plan, preview output, changeset

**Value**:
What a property is set to, before or after a deploy. A value never leaves the tool's adapter: Sluiceway shows that a property changes and never what it changes to, whether or not the tool marks it secret.
_Avoid_: Secret (a secret is only one kind of value, and all values are treated alike), content, setting

**Pending**:
Deploying the stack now would change something, because the code moved.
_Avoid_: Out of sync, dirty, changed

**Drift**:
A change made to real infrastructure outside the code. It is shown on the stack's own row, never on a second row.
_Avoid_: Out-of-band change, skew

**In sync**:
Nothing to deploy and no known drift.
_Avoid_: Clean, up to date, green

**Diff hash**:
A fingerprint of everything a stack's row shows about what a deploy would change. A tick approves that fingerprint, and a deploy goes ahead only if a fresh preview still gives the same one.
_Avoid_: Checksum, signature, plan id

**Address**:
The string that identifies one resource within one stack's diff. The tool's adapter defines it and nothing else looks inside it. It is unique within a diff and the same across two identical previews.
_Avoid_: URN, resource id, id

**Op**:
What a deploy would do to one real object: create, update, replace, delete, or nothing. Warnings about destroyed things depend on the op alone.
_Avoid_: Action, step, operation

**Tracking change**:
What a deploy would do to the tool's record of an object while the object itself is left alone: start tracking it (import), stop tracking it (forget), or track it under a new address (move). It can come with an op or on its own.
_Avoid_: State change, state-only op, no-op

### Ticks

**Tick**:
A person checking the box on a stack's row: a request to deploy that stack exactly as the row shows it. A tick is a commit, not a toggle.
_Avoid_: Approval, selection, click

**Ticker**:
The person whose edit made a tick, as the issue's edit history names them. The only identity a deploy is authorized against and attributed to. Always a person, never a bot. A tick whose ticker cannot be named deploys nothing.
_Avoid_: Approver, actor, sender, deployer

**Edit history**:
GitHub's own list of every edit of the dashboard issue, newest first: who made the edit, when, and the whole body right after it. The only source for who ticked. GitHub keeps the original body and the newest 99 edits, and a person can delete the content of an entry.
_Avoid_: Revisions, audit log, event log

**Stretch**:
The unbroken run of edit history entries, from the newest one back, in which a row is ticked with the same stack id and diff hash. The ticker is the editor of its oldest entry. A stretch that holds an entry without a body, or that reaches the end of the kept history, names nobody.
_Avoid_: Streak, window, range

**Tick rule**:
What a person needs in order to tick a stack: a level of access to the repo, or a place on a list of named people who also have write access. It can narrow who may tick, never widen it.
_Avoid_: Approvers, reviewers, allowlist, access list

**Refused tick**:
A tick by a person the stack's tick rule does not allow. Nothing deploys, the box is cleared and the person is told why.
_Avoid_: Unauthorized tick, rejected tick, denied tick

**Unverified tick**:
A tick whose ticker could not be checked because GitHub gave no answer about their access. Sluiceway fails closed: nothing deploys, the box is cleared, the person is asked for a fresh tick and the job goes red.
_Avoid_: Failed tick, errored tick, unknown tick

**Orphan tick**:
A tick that nothing picked up, so the box is checked but no deploy exists for it and none is on its way. A scan clears it and never deploys it.
_Avoid_: Stale tick, missed tick, lost tick

**Reviewer**:
A person who approves a waiting deploy in GitHub's own interface, where the repo's plan offers that. A second gate after the tick, owned by GitHub. Sluiceway only waits for it.
_Avoid_: Approver, second ticker

### Deploys

**Deploy facts**:
What is known about a stack's deploys that a preview cannot recompute: that one is running, how the last one ended, who ticked it, and when.
_Avoid_: State, history, status

**Deployment record**:
One attempt to deploy one stack, from tick to result. The only place deploy facts are kept.
_Avoid_: Deploy log, run, job

**Open deployment**:
A deployment record with no result yet. A stack with one is deploying.
_Avoid_: Pending deployment, active deployment, lock

**Settle**:
To give an open deployment a result when its workflow run ended without reporting one.
_Avoid_: Clean up, time out, expire

**Outside deploy**:
A deploy of a stack that did not go through a tick: from a laptop, a script or another pipeline. It is allowed, leaves no deployment record, and the next full scan brings the row back in line.
_Avoid_: Manual deploy, rogue deploy, out-of-band deploy

### Credentials

**Tool environment**:
Everything the infrastructure tool needs in order to run: credentials, the state backend, settings. The user's workflow prepares it before Sluiceway starts, and Sluiceway hands it to the tool whole without looking inside.
_Avoid_: Secrets, env config, credentials config

### Dashboard

**Bot**:
The one GitHub identity Sluiceway acts as. It creates and edits the dashboard, writes comments and records deploys. It is never a ticker.
_Avoid_: App, service account, Sluiceway user

**Write loop**:
The one way any mode writes the dashboard body: read the live body, build the new one, skip the write when nothing would change, write, and read back to check. A write that did not stick is tried again from the read, at most three times.
_Avoid_: Retry loop, save, sync, lock

**Marker**:
An HTML comment in the dashboard body that carries machine-readable facts as `key="value"` pairs. It is the only part of the body a writer ever reads. The visible text next to it is never parsed.
_Avoid_: Tag, annotation, metadata comment

**Row block**:
A stack's complete entry on the dashboard, bounded so it can be moved or replaced as a unit without reading what is inside.
_Avoid_: Entry, item, section

**Carried row**:
A row block that a writer takes from the live body and writes back as it is, because it has no diff for that stack. It is never read inside and never shortened.
_Avoid_: Kept row, old row, stale row

**Counts line**:
The first line of text on the dashboard: how many stacks are pending, deploying, preview failed and in sync, always all four. It adds how many pending stacks destroy resources and how many rows carry a failure line, each only when it is not 0. Under a header in colour it is centered and every count has a count dot.
_Avoid_: Header line, stats, totals

**Scan line**:
The line under the counts line that says which commit the last scan checked out, when, in which run, and when the last full scan was. Under a header it is centered with the counts line.
_Avoid_: Status line, timestamp, last updated

**Row state**:
Which group a stack's row belongs to: pending, deploying, in sync or preview failed. It is a label for placing and counting rows. Nothing about a deploy is ever decided from it. A scan may read it for one thing only: to pick stacks worth previewing again.
_Avoid_: Status, stack state, phase

**Preview failure**:
A stack whose preview did not produce a diff. Its row has no checkbox and links to the run that failed. One stack's preview failure never stops the others.
_Avoid_: Error row, broken stack, failed stack

**Failure line**:
The note on a stack's row saying its last deploy failed. It rides on the row wherever the row sits and is not a row state.
_Avoid_: Failed row, failed state, error row

**Failure reason**:
Why a preview or a deploy failed, in words from a short fixed list that Sluiceway owns. It never quotes the tool. The tool's own words stay in the job log, one link away.
_Avoid_: Error message, error text, tool error

**Summary**:
The page of a scan's workflow run where every stack's diff is shown, with far more room than the dashboard has. It shows the same kind of facts as a row and nothing more. Shortened and redacted rows link to it. On the rare scan that does not fit even there, it says so and points at the job log, which holds every diff in full.
_Avoid_: Full diff, report, native output

**Size budget**:
How large the dashboard body may get before rows are shortened. It exists because an issue body that is too large is dropped without an error.
_Avoid_: Limit, cap, quota

**Shortened row**:
A pending row that shows less than its whole diff because of the size budget, and links to the summary for the rest. It keeps its checkbox, its counts and its warning. Its delete and replace lines are all listed or none are.
_Avoid_: Truncated row, collapsed row, summary row

**Attribution**:
The line on a stack's row that names the merged pull requests, and the direct pushes, that the stack claims since its last successful deploy from the dashboard. It explains why a row is pending and never decides that it is. Changes the stack does not claim are counted, not named.
_Avoid_: Blame, changelog, history, provenance

**Author**:
The person who opened a pull request that a row names, or who made a direct push. Written as a plain login that notifies no one. An author is never the ticker by role, even when they are the same person.
_Avoid_: Committer, merger, owner, contributor

**Lookback**:
How many of the newest commits on the default branch a job walks to work out attribution. A stack whose last deploy lies further back gets a line that says earlier changes exist.
_Avoid_: History depth, window, range

**Redact**:
The dashboard setting that keeps resource types, resource names and property names out of the issue, leaving stack ids, counts, warnings and links. The summary stays full. It limits how far names travel. It is not access control.
_Avoid_: Private mode, mask, hide

**Destroy**:
A change whose op is replace or delete: a real object goes away. Destroys are listed first, cut last, and always carry a warning, also on a redacted dashboard.
_Avoid_: Destructive change, dangerous change, removal

### Personality

**Penny**:
The mascot: a sluice gate with a face, standing mid-channel in the header. The name is short for penstock. It is used in docs and never on the dashboard.
_Avoid_: The otter, the logo (the logo is Penny without a state), Sluicy

**Header**:
The image at the top of the dashboard, as wide as the issue and centered: Penny on a quay in one header state, in a light and a dark variant.
_Avoid_: Banner, hero, badge

**Action ref**:
The exact release tag of the running action, or its commit SHA. Never a moving tag. The header images are loaded from it and the footer shows it.
_Avoid_: Action version, image tag, release

**Header state**:
Which of six states the header shows: plain, failing, deploying, pending, first run or in sync. The first that applies wins, in that order. It is computed from the row markers and decides nothing. Pending has three pictures, one per pending level, so there are eight pictures for six states.
_Avoid_: Mood, dashboard status, health

**Plain**:
The header state with no face, no colour and no motion. It is shown whenever a pending or deploying row has a delete or replace. The counts line under it has no count dots.
_Avoid_: Serious mode, warning header, danger state

**Pending level**:
Which of the three pending pictures the header shows: 1 for 1 or 2 pending rows, 2 for 3 to 9, 3 for 10 or more. The water upstream is higher and carries more crates with each level. It is computed from the row markers and decides nothing.
_Avoid_: Tier, severity, load

**Upstream and downstream**:
The two sides of Penny in the header. Upstream is on the left, where water and crates pile up while changes are pending. Downstream is on the right, where water rushes while deploying. Level water on both sides is the picture of in sync. Water always moves left to right.
_Avoid_: Before and after, input and output, left and right side

**Crate**:
A box floating upstream in the header. Crates stand for waiting stacks. A picture never shows more crates than there are pending rows, and may show fewer.
_Avoid_: Package, box per stack, queue item

**Jam**:
How the failing header state is drawn: the gate stuck half open over a log, with a blinking red lamp. It means something is stuck and needs a person.
_Avoid_: Broken gate, angry gate, crash

**Count dot**:
The coloured dot in front of a count on the counts line: yellow pending, blue deploying, red preview failed and failed deploys, green in sync, white for a count of 0. Shown only under a header in colour.
_Avoid_: Badge, status light, bullet

**Voice**:
Wording with a water image in it. It is allowed in exactly two lines, the good-news line and the first-run line. Everything else Sluiceway writes is plain.
_Avoid_: Tone, copy, humour

**Good-news line**:
The line under the Pending heading when nothing is pending.
_Avoid_: Empty state, all clear message

**First-run line**:
The line under the Pending heading when the scan found no stacks.
_Avoid_: Onboarding message, welcome text

**Personality**:
The header and the voice together. `dashboard.personality: false` removes both.
_Avoid_: Branding, theme, fun mode
