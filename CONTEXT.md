# Sluiceway

Sluiceway keeps one GitHub issue, the dashboard, that shows which infrastructure stacks have changes waiting, and deploys a stack when someone ticks its box, or on merge for a stack the repo's config sets that way. This glossary fixes the words used for that.

## Language

### Stacks

**Stack**:
The smallest thing Sluiceway can preview and deploy on its own. It has its own state, one row on the dashboard and one checkbox. This is Sluiceway's word, not a tool's: a Pulumi stack is a stack, and so is an OpenTofu or Terraform root module with a chosen workspace and var files, a Terragrunt unit, a stack of a CDK for Terraform app, and a Helm release in a namespace. Not every stack is a Pulumi stack.
_Avoid_: Unit, project, workspace, module, target

**Stack id**:
The one string that names a stack everywhere: on its row, on its deployment records and in config. It is derived from where the stack lives and what it is called, so a stack that is moved or renamed is a new stack, unless a `stacks` entry gives it the id it had with `id`.
_Avoid_: Stack name, slug, key

**Discovery**:
Finding the stacks of a repo from its files alone. It never asks a backend and never starts the tool, so it can run in a job that holds no credentials. A stack that no file names does not exist for Sluiceway.
_Avoid_: Detection, lookup, stack listing

**Root module discovery**:
Discovery of OpenTofu and Terraform root modules from the repo's own files. A directory of their files is a stack only when no other directory uses it as a local module source, it is not under a `modules` directory, a `terraform` block gives it a backend or a `cloud` block, its code names one workspace and no var file chooses anything, and its lock file or `.tofu` files say which of the two tools runs it. Such a stack is the default workspace and its stack id is its path. When the files do not say all of it, the directory is left out, and the check says why. A directory a `stacks` entry declares is the entry's, and `discovery.rootModules: false` turns it off.
_Avoid_: Auto-detection, autodiscovery, heuristic, guess

**Declared stack**:
A stack that a `stacks` entry names with `tool`, because files alone cannot say what it is, or because the repo wants it exactly as the entry says: an OpenTofu or Terraform root module that root module discovery leaves out or that runs in another workspace, with the workspace and var files the entry gives, or with a wrapper in front of the tool a Terragrunt unit or the stack of a CDK for Terraform app the entry names, a Helm release in a namespace, with its chart and values files, or a directory of Kubernetes manifests or a kustomization, with the context and namespace the entry gives. Discovery still checks from the files that it can exist, and never starts the tool.
_Avoid_: Configured stack, manual stack, custom stack

**Wrapper**:
A tool that stands in front of OpenTofu or Terraform for one stack: Terragrunt, which runs the tool in one unit, or CDK for Terraform, whose synth writes the code the tool runs. The stack's `tool` still names the binary, and the plan is the binary's own.
_Avoid_: Driver, frontend, orchestrator

**Ignored stack**:
A discovered stack whose stack id matches an `ignore` glob. It has no row, is never previewed and claims nothing, and config cannot give it settings. When the `ignore` entry gives a reason, the stack is listed with it in a fold under In sync, and that is all the dashboard says about it.
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
The fixed number of previews a scan runs at the same time, in one job. It starts the next preview when one finishes, in stack id order, and never previews one stack twice at once. Its size is the `concurrency` input, or without it the number of cores of the machine, from 1 to 8. A preview's time limit counts from when it leaves the pool's queue and starts.
_Avoid_: Workers, threads, matrix, batch

**Claim**:
A stack claims a changed file when the file lies inside the stack's directory or matches one of the inputs configured for that stack. Several stacks can claim one file.
_Avoid_: Affects, owns, touches, depends on

**Scan plan**:
What a scan decides before it previews anything: a full scan with the reason for it, or a narrowed scan with the stacks to preview and why each one. A narrowed scan that cannot trust its comparison falls back to a full scan.
_Avoid_: Strategy, scan mode, selection

**Preparation**:
A step a tool needs before it can preview a stack, such as OpenTofu's init of a directory, CDK for Terraform's synth of an app, or Helm's build of a chart's dependencies. A scan runs every preparation one at a time and before the pool, and a failed one is a preview failure of each stack that needs it. A Pulumi stack needs one only when its entry sets `createInBackend: true`: the scan then makes the stack in the backend when the backend lacks it, and previews it as all creates. A deploy never creates a stack.
_Avoid_: Setup, init step, pre-hook

**Policy**:
A Rego rule set in a directory or file `policies` or `stacks[].policies` names, that Conftest runs over the preview document of every pending stack, right after its preview, in the same job. A policy that fails takes the box off the row until it passes, is named on the row in its own words, escaped as text, and stops a deploy on merge. A policy that could not run is a warning line, and the row keeps its box.
_Avoid_: Rule, check (that is the pass over the repo's files), gate, guardrail

**Preview document**:
The tool's own preview of a stack, values and all: Pulumi's preview JSON, the plan JSON of OpenTofu and Terraform, the manifests a Helm chart or a directory of Kubernetes manifests renders. An adapter hands it back only when asked, the policy runner writes it to a file of its own for as long as conftest runs, and nothing else takes it.
_Avoid_: Plan file (that is the saved plan), raw output, preview JSON

**Auto mode**:
What the action does when its step names no mode: it reads the event of the run and runs the modes that event asks for, one after the other in the same step. A push to the default branch scans, an edit of the dashboard resolves and then deploys and settles what it started, the schedule and a dispatch resolve and then scan, unless the dispatched run deployed outside records alone, a pull request checks, and any other event ends with a notice.
_Avoid_: Default mode, smart mode, magic mode, router

**One-step workflow**:
The workflow people copy: one job with one Sluiceway step in auto mode, and no `if:` and no `needs:`. It previews and deploys with one set of credentials.
_Avoid_: Simple workflow, single-job workflow, minimal workflow

**Split workflow**:
The same loop as four jobs, `scan`, `resolve`, `apply` and `settle`, each naming its mode and joined with `if:` and `needs:`. It is for credentials that only read in scans, an environment per stack, and a job an issue edit starts that holds no credentials.
_Avoid_: Advanced workflow, full workflow, four-job workflow

**Check**:
A pass over the repo's files and nothing else that says whether Sluiceway can read the setup: the config, the stacks discovery finds, what root module discovery found and left out and why, what `ignore` leaves out, which files no stack claims, which files a stack's own files name that it does not claim, and what the workflow files lack to run it. It holds no credentials and never starts the tool, so it can never say that a preview will work. The one exception is a workflow's own choice, `backend: true`: then it asks the backend which stacks it holds, with the credentials of its job, and nothing more.
_Avoid_: Validate, lint, dry run, preflight

**Init**:
A pass over the repo's files that writes a first workflow and, when there is none, a `sluiceway.yaml` into the checkout, and lists what it could not know. It declares the stacks files alone cannot name as its best reading, for a person to correct. It never commits, never overwrites a file but the workflow it writes when a person asks with `--force`, and holds the promise of the check: no credential, no tool, no GitHub call.
_Avoid_: Scaffold, generator, bootstrap, wizard, setup

**Command line**:
The `sluiceway` command a person runs on their own machine, from the npm package of the same name: `npx sluiceway init` and `npx sluiceway check`, and nothing else. It reads its arguments, never the environment, holds no token and reaches no GitHub API. Every other mode needs the run's identity and the workflow token, so the command line refuses it and points at the workflow. The package is released with the action, from the same tag and with the same version.
_Avoid_: CLI tool, npx mode, local mode, runner (that is the machine a workflow runs on)

### Diffs

**Diff**:
What deploying one stack would change, told as addresses, ops, tracking changes and the property paths that change. Never values.
_Avoid_: Plan, preview output, changeset

**Value**:
What a property is set to, before or after a deploy. A value never leaves the tool's adapter: Sluiceway shows that a property changes and never what it changes to, whether or not the tool marks it secret. There are two exceptions, both a repo's own choice: the tool diff, which it may turn on for the job log, and the value list. A value fingerprint is a hash and not a value, and it leaves.
_Avoid_: Secret (a secret is only one kind of value, and all values are treated alike), content, setting

**Value list**:
The property paths a repo names in `dashboard.showValues`, whose old and new value appear as `old → new` after the path, everywhere the path does. Only exact paths and globs a person wrote match, never a guess. A value the tool marks secret never shows, and `dashboard.redact` turns the list off. The diff hash covers a listed value as the row shows it, so a tick approves it.
_Avoid_: Allowlist, safe values, visible values

**Property path**:
Where inside a resource a change happens, as the tool writes it: property names, list indexes and map keys, such as `spec.containers[0].image` or `data["app.properties"]`. Never a value. A row shortens a long one, and the summary shows it whole.
_Avoid_: Key path, nested key, JSON path

**Tool diff**:
What a deploy of a stack would change as the tool itself displays it, values included, except the ones the tool marks secret. A second run of the tool, only for a pending stack and only when a repo turns on `scan.logDiff`. It goes to that stack's group of the job log and nowhere else, and nothing is decided from it: the row and the diff hash come from the preview.
_Avoid_: Full diff, native diff, raw diff, plan output

**Saved plan**:
The plan file that the fresh preview of `apply` keeps, for a tool that can save one. When its diff hash is the one the tick approved, the deploy applies that file and nothing else. It lives inside one `apply` job and is removed on every way out. Helm saves no plan: a digest of the manifests the fresh preview rendered stands in for one, kept in memory, and the deploy goes out only when a render right before it gives the same.
_Avoid_: Plan handle, plan artifact, cached plan

**Rendered set**:
The manifests of a Kubernetes manifests stack as one file: the files of its directory, or what kustomize builds of it. The preview diffs it and the deploy applies that same file, so it is the stack's saved plan. It holds every value of the manifests, lives in a directory of its own and is removed when the preview or `apply` ends.
_Avoid_: Bundle, rendered manifests, manifest set

**Inventory**:
The list of objects a Kubernetes manifests stack with `prune` deployed, kept by Sluiceway as one ConfigMap in the cluster next to them: API group, kind, namespace and name of each, never a value. It is the last object of the stack's rendered set. An object it lists that the manifests no longer hold is pruned: a delete on the row, and deleted by the deploy.
_Avoid_: ApplySet, manifest list, tracking ConfigMap

**Pending**:
Deploying the stack now would change something, because the code moved.
_Avoid_: Out of sync, dirty, changed

**Drift**:
A change made to real infrastructure outside the code: a property that changed, or an object that is gone. It is shown on the stack's own row, never on a second row. A stack with drift and nothing to deploy from its code is drifted. A tick deploys the code as it is, which puts the drift back.
_Avoid_: Out-of-band change, skew

**Drift check**:
A run of the tool that compares a stack's state with real infrastructure and changes neither. For a Helm release it is two diffs, one against the release helm stored and one against the live objects. With `drift.enabled`, or `stacks[].drift.enabled` for the stacks of an entry, a scan that a schedule or a person starts runs one for every such stack it previews, right after its preview. Its findings join the stack's diff hash, and `apply` runs it again before a deploy of a row whose hash covers drift.
_Avoid_: Refresh (that is the tool's word, and a plain refresh changes the state), drift scan, drift detection run

**In sync**:
Nothing to deploy and no known drift.
_Avoid_: Clean, up to date, green

**Diff hash**:
A hash of everything a stack's row shows about what a deploy would change. A tick approves it, and a deploy goes ahead only if a fresh preview still gives the same one.
_Avoid_: Checksum, signature, plan id, fingerprint (that is the value fingerprint's word)

**Value fingerprint**:
A hash of the values of a stack's diff that its row does not show, sixteen hex characters on the row next to the diff hash, and on the deployment record a tick opens. `apply` compares it after the hash: a value that changed since the tick stops the deploy, and the row and a comment say so without naming the value. A value the tool marks secret enters it as the tool's mark, never in the clear. On for every repo, off per repo or per stack with `valueFingerprint: false`, for a program whose values differ on every run.
_Avoid_: Value hash, values digest, second hash

**Cost line**:
The line under the first line of a pending row that says what the change does to the monthly bill, as a delta and never the bill: `about **31.20 USD** more a month`, `less a month`, or `about the same cost a month`. Opt in with `cost.enabled`, and only an OpenTofu or Terraform stack gets one, because the Infracost CLI reads their plans and nothing else. It is an estimate against a price list, it is not in the diff hash, and an estimate that failed leaves the line out and never fails the scan.
_Avoid_: Price, bill, cost report, budget

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
A person checking the box on a stack's row: a request to deploy that stack exactly as the row shows it. Unticking after `resolve` has created the deployment record does not stop the deploy.
_Avoid_: Approval, selection, click

**Ticker**:
The person whose edit made a tick, as the issue's edit history names them. The only identity a deploy from a tick is authorized against and attributed to. Always a person, never a bot. A tick whose ticker cannot be named deploys nothing. A deploy on merge has no ticker: it is attributed to whoever merged.
_Avoid_: Approver, actor, sender, deployer

**Edit history**:
GitHub's own list of every edit of the dashboard issue, newest first: who made the edit, when, and the whole body right after it. The only source for who ticked. GitHub keeps the original body and the newest 99 edits, and a person can delete the content of an entry.
_Avoid_: Revisions, audit log, event log

**Stretch**:
The unbroken run of edit history entries, from the newest one back, in which a row is ticked with the same stack id and diff hash. The ticker is the editor of its oldest entry. A stretch that holds an entry without a body, or that reaches the end of the kept history, names nobody.
_Avoid_: Streak, window, range

**Tick rule**:
What a person needs in order to tick a stack: a level of access to the repo, or a place on a list of named people who also have write access. It can narrow who may tick, never widen it. It decides who may ask for a deploy. Where the job that deploys runs in a GitHub Environment with required reviewers, the reviewers decide who may deploy; without one, the tick rule decides both.
_Avoid_: Approvers, reviewers, allowlist, access list

**Refused tick**:
A tick by a person the stack's tick rule does not allow, or by an account GitHub no longer has, as after a rename or a delete. Nothing deploys, the box is cleared and the person is told why.
_Avoid_: Unauthorized tick, rejected tick, denied tick

**Unverified tick**:
A tick whose ticker could not be checked because GitHub gave no answer about their access, twice: the lookup is tried once more after a short pause. Sluiceway fails closed: nothing deploys, the box is cleared, the person is asked for a fresh tick and the job goes red.
_Avoid_: Failed tick, errored tick, unknown tick

**Orphan tick**:
A tick that nothing picked up, so the box is checked but no deploy exists for it and none is on its way. A scan clears it and never deploys it.
_Avoid_: Stale tick, missed tick, lost tick

**Dropped tick**:
A tick on a stack that already has an open deployment. Nothing new starts for it, nobody is checked or told, and the row is brought back to deploying.
_Avoid_: Duplicate tick, ignored tick, second deploy

**Deploy on merge**:
A stack's own setting, `deploy: on-merge` in `sluiceway.yaml`, that lets it go out without a tick: the scan of a push to the default branch that finds it pending opens its deployment record, attributed to whoever pushed, and the same run deploys it through the fresh preview and the hash check of a tick. A delete or a replace, drift, a dependency that waits for a tick, any other scan, `deploys: false` and a read-only dashboard keep it waiting for a tick, and its row says why. The default is a tick. Its row says `deploying on merge · merged by`, and so does the trail, so it never reads as a tick.
_Avoid_: Auto-deploy, continuous deployment, apply on merge, autopilot

**Cost threshold**:
The change to the monthly bill, `cost.threshold` in `sluiceway.yaml` for the repo or for a stack, above which a stack set to deploy on merge waits for a tick instead, with its row saying why. A change whose cost could not be estimated waits too while a threshold is set: the gate fails closed. It changes nothing for a stack on a tick, and nothing for a stack whose tool has no estimate.
_Avoid_: Budget, cost gate, spend limit, guardrail

**Rescan box**:
The one checkbox on the dashboard that belongs to no stack. Ticked by a person with write access, it starts a full scan and deploys nothing. A read-only dashboard has none, and neither does one with `dashboard.rescanBox: false`.
_Avoid_: Refresh button, rescan tick, scan trigger

**Bulk box**:
The box under the pending rows, `Deploy all N pending stacks`, or under the drifted rows, `Repair all N drifted stacks`, when the section has two rows or more. A tick on it deploys nothing: it asks for a confirm box. There is none while deploys are off, on a read-only dashboard, or where `dashboard.deployAll` or `dashboard.repairAll` turns it off.
_Avoid_: Select all, deploy-all button, batch tick

**Confirm box**:
The box that takes the place of a ticked bulk box, naming the stacks of its section at their diff hashes and who asked. A tick on it is a tick on each of those rows, by its ticker, each judged by its own tick rule. It goes when the rows change under it, and when the second scan after it finds it unticked.
_Avoid_: Are-you-sure box, confirmation dialog, second tick

**Reviewer**:
A person who approves a waiting deploy in GitHub's own interface, where the repo's plan offers that. A second check after the tick, owned by GitHub. Sluiceway only waits for it. The reviewers of an environment decide who may deploy, where the tick rule only decides who may ask.
_Avoid_: Approver, second ticker

**Update waiting to merge**:
An open pull request by an author `mergeAndDeploy.authors` lists, green, and claimed by one or more stacks that do not depend on each other, that the dashboard offers to merge. Its row shows the stacks, the title and the pull request, and a tick on it merges the pull request and deploys each stack as the scan after the merge previews it. It is not a row of a stack and has no diff, and with `mergeAndDeploy.preview` it shows a branch preview.
_Avoid_: Renovate row, merge request, pending update, bump row

**Update waiting on its checks**:
An open pull request that would be an update waiting to merge, except that its checks have not all finished. The dashboard shows it as a line with no box under the updates waiting to merge, naming its stacks, its title and the pull request. It gets its box once its checks are green, and goes when a check fails or it stops qualifying.
_Avoid_: Blocked update, pending merge, stuck pull request

**Branch preview**:
The preview of an update waiting to merge as it would be after the merge: a copy of the checkout with the files of the pull request's head commit in place. Its counts go on the update's row. It approves nothing and deploys nothing: the scan after the merge previews again.
_Avoid_: PR preview, speculative plan, merge preview

**Pull request preview**:
The preview of the stacks a pull request claims, as they would be after the merge, for its reviewer: one check run per stack on the pull request's head commit, opt in with `pull-request-preview: true` on the check step of a job that holds credentials that read. It never deploys, never opens a deployment record and leaves no row. A pull request from a fork is refused outright, and `pull_request_target` is never used.
_Avoid_: PR preview, plan comment, speculative run, proposed run

**Merge record**:
The deployment record `resolve` opens for a merge it made: on the merge commit, with the ticker and the pull request and no diff hash. It waits for a scan that holds the merge, which ends it and opens the record that deploys the fresh diff.
_Avoid_: Pending merge, merge deployment, pre-deploy

**Scan after a merge**:
The scan `resolve` starts by dispatching its own workflow after it merged a pull request from the dashboard, because a merge made with the workflow token starts no run of its push. It hands the merged change to `apply`. It is a narrowed scan when the workflow declares the dispatch input that names the merged pull requests, and a full scan otherwise.
_Avoid_: Merge scan, post-merge scan

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

**Rehearsal**:
An `apply` run with `dry-run: true`: it takes the deployment record, previews the stack again and checks the diff hash like a deploy, and then deploys nothing. Its record ends as `inactive`, "rehearsed, nothing was deployed", the row is pending again, and the recently deployed list says rehearsed. It is not a deploy fact of the stack.
_Avoid_: Dry run (that is the input's name, not the thing), test deploy, simulation

**Settle**:
To give an open deployment a result when its workflow run ended without reporting one.
_Avoid_: Clean up, time out, expire

**Dependency**:
A stack that another stack names in `dependsOn`, because it reads something the dependency makes. With `dependsOn: auto`, also a stack that its Pulumi program reads through a stack reference, as its last preview found and its row says, and every stack of every phase before its own. A tick waits on a dependency only while its row is pending and nobody ticked it: the box is cleared with a note that names the dependency. A stack waits only on its own dependencies, not on theirs.
_Avoid_: Upstream (that is a side of Penny in the header), parent, prerequisite, blocker

**Phase**:
One step of a repo's deploy order, named in `phases`, such as infrastructure, then monitoring, then applications. A stack in a phase depends on every stack in every earlier phase, so a tick on it waits while one of them has a change waiting that nobody ticked, and the note names the phase. A stack's phase is written in `sluiceway.yaml`, or read from a key of its Pulumi project file.
_Avoid_: Stage, tier, wave, layer (a layer is what deploys in one run)

**Stack reference**:
Pulumi's way for a program to read the outputs of another stack, by a name such as `organization/project/stack`. With `dependsOn: auto` the adapter turns each one into the stack id of a stack of the repo, and nothing else of the name leaves it.
_Avoid_: Remote state (OpenTofu's word for something else), cross-stack link

**Queued stack**:
A ticked stack, or one that deploys on merge, whose deployment record waits behind its dependencies, because they were ticked in the same run or are deploying, or waits for its deploy window. Its row says "queued behind" them, or "queued for the deploy window" and when it opens, has no box and counts as deploying. It deploys in a later run once they went out and the window is open, under a record that carries what the tick approved, drift included, and never deploys when one of them did not.
_Avoid_: Blocked stack, waiting stack, pending stack (pending is a row state)

**Deploy window**:
When a stack may go out, as `deployWindows` in `sluiceway.yaml` writes it for the repo or for a stack: days of the week with a start and an end, in the dashboard zone. A tick outside every window is not refused: its record is opened now with what the tick approved and waits as a queued stack does, and the run that falls inside the window, the scheduled one, deploys it through the fresh preview and the hash check. A deploy on merge waits for it too. It is what this repo's file says, not a change freeze for a company.
_Avoid_: Maintenance window, freeze, blackout, schedule (that is the workflow's trigger)

**Layer**:
The stacks of a dependency chain that deploy in one workflow run, because nothing they wait behind is still to go out. `settle` starts the workflow again after a layer, and that run's `resolve` starts the next one.
_Avoid_: Wave, stage, batch, level

**Outside deploy**:
A deploy of a stack that did not go through a tick: from a laptop, a script or another pipeline. It is allowed, leaves no deployment record, and the next full scan brings the row back in line. A tick on the stale row finds nothing to deploy, and its record ends as a success that says so. Where the tool keeps a history of its deploys (Pulumi), a full scan finds it there and lists it on the trail with when and from which commit, never who.
_Avoid_: Manual deploy, rogue deploy, out-of-band deploy

**Outside record**:
A deployment record that a writer other than Sluiceway opened in the published shape, naming the run of a dispatch it made, and carrying neither `behind` nor `window`. The `resolve` of that run hands it to `apply` only when the login GitHub records as its creator is in `recordWriters`, the repo's reviewed list of who may open records; then the fresh preview and the hash check decide, the record is the lock, and the ticker on it is the writer's word. With the list empty, the default, every such record is left alone and the job log says so. A dispatched run that deployed outside records alone skips its scan.
_Avoid_: External record, injected record, foreign record, manual deployment

**Tool history**:
The tool's own list of the deploys of one stack, whoever ran them, as Pulumi keeps it. A full scan reads the newest entries of it for every stack whose tool keeps one, and every deploy there that no deployment record of the stack ran is an outside deploy. Only when, what kind, the commit and the run are read, never a config value, a message or a person.
_Avoid_: Update history, audit log, deploy log, state history

### Credentials

**Tool environment**:
Everything the infrastructure tool needs in order to run: credentials, the state backend, settings. The user's workflow prepares it before Sluiceway starts, and Sluiceway hands it to the tool whole without looking inside, with the values of the env file on top when a step names one, and the values of the stack's own env file on top of that when its entry names one.
_Avoid_: Secrets, env config, credentials config

**Credential need**:
What a stack's own files say its tool will want from the job environment: the credentials of a provider or a backend, a passphrase, a variable without a default, the cluster. Read from files as names with alternatives, never a value, and never a guarantee, because a program can read any variable. The check lists them per stack and says which of them nothing in the workflow appears to provide.
_Avoid_: Required secrets, missing secrets, env requirements, secret list

**Env file**:
A file of `NAME=value` lines that the `env-file` input names, or that a `stacks` entry names with `envFile` for its stacks alone, which the modes that run the tool read once for the tool's process: every value is masked in the job log first, the file wins over a variable the job already has, a stack's file wins over the step's, and the log names what was loaded for which stacks and never a value. A stack's file that cannot be loaded is a preview failure of that stack and of nothing else. They are the only files on the runner that Sluiceway reads on the user's word, and it resolves nothing in them: a file of secret references is not one until a step has resolved it.
_Avoid_: Dotenv, secrets file, `.env` (that is a name such a file may have), env config

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
The first line of text on the dashboard: how many stacks are pending, deploying, preview failed and in sync, all four unless `dashboard.zeroCounts: false` leaves a 0 out, and the pending count always. It adds how many stacks drifted, how many pending stacks destroy resources and how many rows carry a failure line, each only when it is not 0. Under a header it is centered and every count has a count dot.
_Avoid_: Header line, stats, totals

**Scan line**:
The line under the counts line that says which commit the last scan checked out, when, in which run, and when the last full scan was. Under a header it is centered with the counts line.
_Avoid_: Status line, timestamp, last updated

**Waiting run**:
A run of the dashboard's own workflow that GitHub has kept queued for ten minutes or more before a scan started, because no runner took its job. The next scan that does get a runner says so in one line right under the scan line, naming how long it waited and linking it, and counts any others. It says that the run waits for a runner, never why, and decides nothing. The line goes as soon as that run starts, or with the next scan after it ends.
_Avoid_: Stuck run, hung run, stalled scan, queued run (queued is a row state)

**Scan-running line**:
The line right under the scan line that says a scan is running, since when, and links its run. The scan writes it as its first act, before any preview, through the write loop, carrying every row as it is and the rescan box unticked, and takes it away when it writes the body at the end. Every other writer carries it. A scan that dies leaves it, and the next scan replaces it. It is a fact on the root marker and not a state: nothing is decided from it, and the header does not change for it.
_Avoid_: Progress line, in-progress banner, scan status, spinner (that is the crate on a deploying row)

**Dashboard zone**:
The time zone every time on the dashboard is shown in: UTC, or the IANA zone `dashboard.timeZone` names. It belongs to the repo, not the reader. The line under the trail names it, and a time that stands alone, on the scan line, the scan-running line, the waiting-run line or a failure line, says its offset from UTC at that moment. The markers keep UTC.
_Avoid_: Local time, user time zone, timezone setting

**Row state**:
Which group a stack's row belongs to: pending, drift, deploying, in sync, preview failed or queued. A queued row is placed and counted with the deploying ones. It is a label for placing and counting rows. Nothing about a deploy is ever decided from it, with one exception that only holds a deploy back and never starts one: `resolve` refuses a tick while a dependency's row is pending. A scan may read it for one thing only: to pick stacks worth previewing again.
_Avoid_: Status, stack state, phase

**Preview failure**:
A stack whose preview did not produce a diff. Its row has no checkbox and links to the run that failed. One stack's preview failure never stops the others. `settle` writes a row of the same state for a deploy it ended, which says there is no preview since the deploy ended and carries the failure line, until the next scan previews the stack.
_Avoid_: Error row, broken stack, failed stack

**Failure line**:
The note on a stack's row saying its last deploy failed. It rides on the row wherever the row sits and is not a row state. It goes once a deploy of the stack ends after the failure, from the dashboard or an outside deploy on the trail, and the trail keeps the failed deploy.
_Avoid_: Failed row, failed state, error row

**Trail**:
The Recently deployed list at the bottom of the dashboard: every deploy from the dashboard that ended, newest first, with who ticked it, or who merged for a deploy on merge, and when it went out, and the outside deploys a full scan found in the tool's history. A deploy that found nothing to deploy, a drift repair that found the drift already gone, a rehearsal and a failed deploy say so on their line. Its length is `dashboard.recentlyDeployed`. A deploy from the dashboard that went out has a shipped line. It is built from the deployment records and the tool's history, and decides nothing.
_Avoid_: History, audit log, deploy log, changelog

**Pending-again line**:
The note on a pending row whose newest deployment record is a deploy that went out with the same diff hash the row has now: the deploy did not bring the stack in sync. It suggests that a value in the program differs on every run, and points at the tool diff when the job log holds one. It explains a row and decides nothing.
_Avoid_: Flapping, drift, stuck row

**Failure reason**:
Why a preview or a deploy failed, in words from a short fixed list that Sluiceway owns. It never quotes the tool. The tool's own words stay in the job log, one link away.
_Avoid_: Error message, error text, tool error

**Reason word**:
The failure reason a reader outside Sluiceway writes when it draws a row from the markers and the deployment records and holds no reason: `the reason is on the deployment record` on a failure line, `the reason is in the summary of the run` on a preview failure row. Both are on the fixed list, and Sluiceway itself never writes either, because a scan and an `apply` always hold the reason.
_Avoid_: Placeholder reason, unknown reason, fallback text

**Summary**:
The page of a scan's workflow run where every stack's diff is shown, with far more room than the dashboard has. It shows the same kind of facts as a row and nothing more. It opens with an index of the stacks that rows link to, and every stack has its own anchor in it. Shortened and redacted rows link to it, and so does a pending row's preview link when the stack has no preview page. On the rare scan that does not fit even there, it says so and points at the job log, which holds every diff in full. An `apply` writes one too, about its one stack: what went out, or why nothing did.
_Avoid_: Full diff, report, native output

**Preview page**:
The page a pending or drifted row's preview link opens: a GitHub check run on the scanned commit, one per pending or drifted stack, named `sluiceway / <stack id>`, that shows that stack's diff and drift as the summary does. Never a value, and never the tool's own words. A scan of the same commit updates it in place. Without `checks: write` there is none, and the link opens the summary.
_Avoid_: Check (that is the pass over the repo's files), check page, status check, report

**Result file**:
A JSON file that a scan or an `apply` leaves in the job's temporary directory for a later step of the workflow, with what its summary holds and how long the job took, and nothing more. A published JSON schema describes it. Sluiceway never sends it anywhere: a step the user adds does, with its own secret.
_Avoid_: Report, artifact, export, metrics

**Published shape**:
What Sluiceway writes for a machine to read and promises to keep: the markers, the payload of each deployment record, and the result file with the step outputs. Each has a version. A documented key keeps its meaning while its version stands, a change that would make a reader misread raises the version, and what the docs leave out on purpose may change in any release. The page is `docs/what-sluiceway-writes.md`, and its examples are taken from a run.
_Avoid_: API, internals, public interface, protocol

**Notification**:
One short message Sluiceway posts to a channel the step names (Slack, Telegram or a webhook) when an event happens: stacks newly pending, drift newly found, a deploy that went out or failed, a tick that was refused. It holds stack ids and links and nothing else. Opt-in: each channel is an input of the step, from the repo's own secret, and `notify.events` picks the events. A send that fails is a warning and never changes a job.
_Avoid_: Alert, ping, webhook event, message hook

**Channel**:
Where a notification goes: a Slack incoming webhook, a Telegram chat through a bot, or a webhook address of the user's own. Always an input of the step, never a key of `sluiceway.yaml`, because its address or token is a secret.
_Avoid_: Target, sink, destination, integration

**Read-only dashboard**:
A dashboard drawn with nothing to tick, for a workflow that only scans: pending rows have no box, there is no rescan box, and the line under the Pending heading says so. Set with `dashboard.readOnly`. It changes what is drawn, not who may deploy: what keeps a workflow from deploying is that it has no `resolve` job.
_Avoid_: Dry run, view-only mode, preview mode, locked dashboard

**Layout key**:
One of the keys under `dashboard` in `sluiceway.yaml` that decide how the dashboard looks: the order of the sections, which of Deploying, Drifted and In sync are shown, the zero counts, the destroy alert, how much a pending row shows, the bulk boxes, the rescan box and the footer. Each defaults to the dashboard as it was, and every writer draws the same layout. A layout key never drops a row block and never changes a marker: a section that is off keeps its rows in one closed fold at the end of the sections. Pending and Preview failed are always shown, and no layout key hides a destroy, a preview failure or a failure line.
_Avoid_: Template, theme, view, dashboard mode

**Size budget**:
How large the dashboard body may get before rows are shortened. It exists because an issue body that is too large is dropped without an error.
_Avoid_: Limit, cap, quota

**Shortened row**:
A pending or drifted row that shows less than its whole diff because of the size budget, and links to the summary for the rest. The note under the scan line counts them, section by section. It keeps its checkbox, its counts and its warning. Its delete and replace lines are all listed or none are.
_Avoid_: Truncated row, collapsed row, summary row

**Attribution**:
The line on a stack's row that names the merged pull requests, and the direct pushes, that the stack claims since its last successful deploy from the dashboard. It explains why a row is pending and never decides that it is. Changes outside the stack are counted on the line and named in a fold at the end of the row.
_Avoid_: Blame, changelog, history, provenance

**Change outside a stack**:
A merged pull request or direct push in a stack's range that the stack does not claim and that holds a file no stack claims, such as a lockfile bump or a change to a shared package. It may reach any stack, so it is counted on the attribution line and named in the fold at the end of the row. A change that only other stacks claim is not one.
_Avoid_: Shared change, global change, unrelated change

**Shipped line**:
The line under a deploy on the trail that went out, which names what it shipped: the pull requests and direct pushes its stack claims from the stack's success before it to its own commit, in the words of the attribution line. A deploy with no success before it among the records read has none.
_Avoid_: Release notes, changelog, deploy contents

**Author**:
The person who opened a pull request that a row names, or who made a direct push. Written as a plain login that notifies no one. An author is never the ticker by role, even when they are the same person.
_Avoid_: Committer, merger, owner, contributor

**Direct push**:
A commit on the default branch that no merged pull request brought there. A row names it by its short commit id and the commit's author, so it is never left out.
_Avoid_: Unreviewed commit, hotfix, loose commit

**Lookback**:
How many of the newest commits on the default branch a job walks to work out attribution, `attribution.lookback`. A stack whose last deploy lies further back gets a line that says earlier changes exist.
_Avoid_: History depth, window, range

**Redact**:
The dashboard setting that keeps resource types, resource names and property names out of the issue, leaving stack ids, counts, warnings and links. The summary stays full. It limits how far names travel. It is not access control.
_Avoid_: Private mode, mask, hide

**Destroy**:
A change whose op is replace or delete: a real object goes away. Destroys are listed first, cut last, and always carry a warning, also on a redacted dashboard.
_Avoid_: Destructive change, dangerous change, removal

**Destroy alert**:
The one caution block right above the pending list that names every pending stack with a destroy, and in a paragraph of its own every drifted stack with a resource gone outside the code. It is an index to the delete and replace lines, which stay open under each row. It is computed from the row markers and decides nothing, and it shows under redact, without personality and at every layout too. With `dashboard.destroyAlert: always` a note takes its place when nothing is destroyed.
_Avoid_: Destroy warning (that is the line on the row and on the counts line), destroy banner, danger box

**Example dashboard**:
A whole dashboard body that the renderer gives for made-up rows, with every section at once, at the version of the checkout. It is committed as `assets/example-dashboard.md`, which other sites fetch raw at a release tag, and the README shows it made fit for a README. `bun run example` writes both and a test holds both to the renderer. It is never a real repo's body.
_Avoid_: Demo dashboard, sample dashboard, mock-up, live example (that is a real issue, which `docs/later.md` lists)

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
Which of seven states the header shows: failing, deploying, queued, pending, drift, first run or in sync. The first that applies wins, in that order. It is computed from the row markers and decides nothing. A destroy does not change it. Pending has twenty-one pictures and failing, deploying and queued twenty-two each, one per crate count, so there are ninety pictures for seven states, and eighty-seven of them exist three more times with the destroy signs. Drift is water seeping through the closed gate. Queued is the closed gate with the ticked crate tied up at it, while a queued stack waits and nothing deploys.
_Avoid_: Mood, dashboard status, health

**Destroy sign**:
One of two signs on a pole in the water in the header, right of the wordmark: the replace sign, an amber warning triangle, and under it the delete sign, an amber diamond with a cross. The pending, failing, deploying and queued pictures carry the replace sign whenever a pending, deploying or queued row has a replace, and the delete sign whenever one has a delete. They do not move, and the rest of the picture is unchanged. They are computed from the row markers and decide nothing. They took the place of a grey header state called plain.
_Avoid_: Plain, careful state, warning header, danger state, alarm

**Crate count**:
How many crates the pending, failing, deploying or queued picture shows: the number of pending rows, from 0 to 20, or `more` above 20. The same count picks the file in all four states, and a pending header always has at least 1. It is computed from the row markers and decides nothing. It replaced the pending level.
_Avoid_: Pending level, tier, severity, load

**Water step**:
How high the water stands upstream in a pending, failing or queued picture, one of five: 1 or 2 pending, 3 or 4, 5 to 7, 8 to 10, 11 or more. The gauge on the wall has one amber mark per step. It follows from the crate count. The failing picture with 0 crates has the lowest water. The deploying picture keeps one level at every count, because the open gate lets the water run.
_Avoid_: Pending level, water level (for the count)

**Overflow**:
The pending, failing, deploying or queued picture past the maximum of 20 crates: the row runs on with a half crate cut by the left edge, which reads as more than 20.
_Avoid_: Cap picture, max picture

**Upstream and downstream**:
The two sides of Penny in the header. Upstream is on the left, where water and crates pile up while changes are pending. Downstream is on the right, where water rushes while deploying. Level water on both sides is the picture of in sync. Water always moves left to right.
_Avoid_: Before and after, input and output, left and right side

**Crate**:
A box floating upstream in the header. One crate stands for one pending stack. Up to 20 the picture shows exactly as many crates as there are pending rows, some stacked on two others. Above 20 it shows the overflow.
_Avoid_: Package, box per stack, queue item

**Jam**:
How the failing header state is drawn: the gate stuck half open over a log, with a blinking red lamp. It means something is stuck and needs a person.
_Avoid_: Broken gate, angry gate, crash

**Count dot**:
The coloured dot in front of a count on the counts line: yellow pending, orange drifted, blue deploying, red preview failed and failed deploys, green in sync, white for a count of 0. Shown whenever there is a header.
_Avoid_: Badge, status light, bullet

**Result dot**:
A count dot's colour in front of a result, so a person sees it at a glance: on a line of the recently deployed list (only under a header), on a headline of the job log, and in a notification. Green went out, red failed, yellow refused, white nothing went out, purple rehearsed. The scan's headline takes the dot of the header state it wrote. Never on a row and never in a voiced line: it is a signal, not the voice.
_Avoid_: Status emoji, icon, badge

**Spinner**:
The small animated crate, bobbing in the water, at the start of a deploying row, so the stack a person ticked is visibly moving. A queued row gets the same crate standing still, so motion on a row always means deploying now. A light and a dark file each, served from the action ref like the header, and only shown when there is a header. It is the first thing the size budget drops.
_Avoid_: Loader, loading icon, progress indicator, throbber

**Voice**:
Wording with a water image in it. It is allowed in exactly two lines, the good-news line and the first-run line. Everything else Sluiceway writes is plain.
_Avoid_: Tone, copy, humour

**Good-news line**:
The line under the Pending heading when nothing is pending. With personality it is one of three warm lines, picked by the day of the scan, so the same scan day always gives the same line.
_Avoid_: Empty state, all clear message

**First-run line**:
The line under the Pending heading when the scan found no stacks.
_Avoid_: Onboarding message, welcome text

**Personality**:
The header and the voice together. `dashboard.personality: false` removes both.
_Avoid_: Branding, theme, fun mode
