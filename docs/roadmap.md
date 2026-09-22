# Roadmap

What comes before Sluiceway 1.0, and what comes after. Sluiceway is in beta and released as 0.x, and every example uses the moving tag `v0`. 1.0.0 is a tag cut on purpose, not the next number in line, and with it comes the moving tag `v1`.

The part after 1.0 is generated from [docs/later.md](later.md), which says for every item why it is not built yet and where that was decided. A test fails when this page and that file disagree: change `docs/later.md`, then run `bun run roadmap`.

## What is built

The core loop: a scan previews every stack and writes the dashboard, a person ticks a box, exactly that stack deploys, and its row returns to in sync or says why it failed. Around it:

- Pulumi stacks, found from their files, and OpenTofu root modules and Helm releases, declared in `sluiceway.yaml`.
- Five modes: `scan`, `resolve`, `apply`, `settle`, and `check`, which validates a setup on a pull request with no credentials.
- A push previews only the stacks it touches. Every row says which pull requests made it pending, and links to a page with that stack's diff.
- Rows name the property paths that change, never a value. A repo can list paths whose values may show, and can print the tool's own diff in the job log.
- A team can stop every deploy from the config, rehearse a tick, and leave a stack out with a written reason.
- One tick can merge a routine update and deploy it, drift is shown and repaired by a tick, and a stack can wait for the stacks it depends on.
- Step outputs and a result file, so a workflow can tell people what happened. Sluiceway itself sends nothing.

The [build plan](build-plan.md) says how each of these was built and proven, and the [decision records](adr) hold the rules.

## Before 1.0

- **Stack dependencies and drift, part 2.** The check lists what each stack depends on, dependencies can be read from Pulumi stack references on request, drift can be turned on per stack, and a drifted row lists what drifted the way a pending row lists its changes. Slice 4.7.
- **The launch.** A listing on the GitHub Marketplace, a docs site, screenshots, a note on merge queues and the config schema in SchemaStore. Then the 1.0.0 tag and the `v1` moving tag.

## After 1.0

In plain words, the larger themes: more tools (Kubernetes manifests, the Terraform binary and the tools built on it, AWS CDK), a bot with its own name and picture, teams in the tick rule, a log of deploys made outside the dashboard, and a hosted version with a dashboard for a whole organization. The previews and the deploys always stay in the user's own runners.

Every item, as `docs/later.md` lists it:

<!-- Generated from docs/later.md by `bun run roadmap`. Do not edit by hand. -->
### After 1.0, when someone needs it

No date and no order. Each waits for a user who asks, and none of them needs a breaking change. [docs/later.md](later.md#deferred-door-left-open) says why each one waited and where that was decided.

- The Terraform binary behind the OpenTofu adapter
- Zero-config discovery for OpenTofu (a directory with a backend block or a lock file as a stack)
- A `backendConfig` option for OpenTofu (`tofu init -backend-config`)
- A hint in the check for a directory of `.tf` files that no entry declares
- Helm, part 2: a drift check (the diff plugin's `--three-way-merge` compares with the live objects), a `createNamespace` option, a `kubeContext` option, zero-config discovery from `Chart.yaml`, and `--take-ownership` for objects made outside the release
- `--rollback-on-failure` in place of `--atomic` for the Helm deploy
- A Kubernetes manifests adapter (kustomize or plain YAML, `kubectl diff` for the preview, `kubectl apply` for the deploy)
- The Terraform family beyond OpenTofu (Terragrunt, CDK for Terraform)
- An AWS CDK and CloudFormation adapter (change sets as the preview)
- A preview of a pull request's branch before its merge, on the row of an update waiting to merge
- Merging a pull request that two stacks claim, with one deploy each
- A narrowed scan after a merge from the dashboard
- Reading Renovate's JSON5 config, its presets and its `packageRules` for the merge method
- A note on the row of an update waiting to merge whose tick was cleared without a comment
- Waiting, in the scan after a merge, for a dependency that became pending after the merge
- Listing more than 10 updates waiting to merge, or pull requests beyond the oldest 100 open ones
- Drift detection, part 3
- Stack dependencies, part 3
- A named `refresh` option (preview, re-preview and deploy with refresh on every run of a stack)
- Showing property values on the dashboard or in the summary without a list
- A finer `dashboard.redact` (per stack, or a middle level such as types without names)
- Teams in the tick rule
- A GitHub App token or PAT as the bot identity
- Spreading one scan over several runners (sharding)
- A full scan whenever `sluiceway.yaml` changes, also in a repo with a stack at the root
- Treating the files of an ignored stack as unrelated
- Paging past the 300 files of a comparison, or reading the files commit by commit
- Links to the job, not the run, on the rows written from a deployment record (deploying rows, failure lines, Recently deployed)
- A link that lands on one stack's group in the job log (`#step:<n>:<line>`)
- The carried rows in the summary of a narrowed scan
- An empty `tickers` list, as a way to get a dashboard that nobody can tick
- A scan that works out by itself that its workflow has no `resolve` job, so that `dashboard.readOnly` is not needed
- `dashboard.readOnly` as a lock: `resolve` refusing a tick while it is on
- Trying a failed permission lookup again in the same `resolve` run
- Telling an account that was renamed or deleted after its tick apart from a failed lookup
- A cap on the names a refusal comment lists from a tick rule
- Attribution in the result file (the pull requests and direct pushes a pending stack claims)
- Timings in the result file of an `apply`, and the stacks a narrowed scan carried in the result file of a scan
- The JSON schema of the result file as a committed file next to `schema/sluiceway.schema.json`
- `sluiceway.yml` as a second spelling of the config file
- Logging deploys made outside the dashboard under recently deployed (a manual `pulumi up` from a laptop, a script, another pipeline), with when and from which commit
- A link to the scan that the rescan box started
- Placing the orphan tick note in the order of record 0027 when `resolve` adds it
- Carrying on with the other records after one deployment record could not be written
- A scan that carries a ticked rescan box while a `resolve` run is on its way
- The scan clearing an orphan tick with `clearTick` in place of a preview
- A job summary for `resolve`
- Telling a full edit history that lost nothing from a capped one
- Looking past the newest 100 runs that an issue edit started, when a scan asks whether a `resolve` run is on its way
- Sweeping an orphan tick off a row without previewing its stack
- The orphan tick sweep in a repo that keeps `scan` and `resolve` in two workflow files
- A real `uses:` step against the fake GitHub server in the e2e workflow
- An `id:` override for a stack in `sluiceway.yaml`
- Starting a deploy without a person ticking (unattended deploys of chosen stacks)
- Telling authors that their merge is waiting for a deploy
- Shipped pull requests under recently deployed
- A configurable lookback, or number of pull requests named on a row
- Naming changes outside a stack on its row (shared package, lockfile)
- Paging through a pull request with more than 100 changed files, or a direct push with 300 or more
- The old path of a file that a pull request renamed
- Looking past a failed record for an older success to start attribution from
- Attribution for a scan of a commit that is not on the default branch
- Failed deploys in the recently deployed list
- A configurable length for recently deployed
- The real time of a deploy that was later superseded, under recently deployed
- Reading a deployment record whose payload has another version
- Finding a stack's records after its `environment` label changed
- `settle` writing the row of a stack whose record it ended
- A failure line on a row that a narrowed scan carries through
- Allowing for a runner clock that differs from GitHub's
- A shortening level that also drops a row's links, for more than about 100 stacks pending at once
- A link to the summary in the note about shortened rows
- One alert block above the pending list that names the stacks with a delete or replace
- A finer personality switch (the header without the voice, or the reverse)
- A custom header image, or a palette setting
- A rotating set of good-news lines
- A header state for queued stacks
- A drift picture with crates, or drift above pending in the header
- Levels for deploying or failing (how many are deploying, how much failed)
- A sign of its own for a delete, next to the one for a replace
- The destroy sign on the failing picture
- More than 12 exact crates
- Deploying with the number of crates still waiting
- The destroy sign painted on the wall right of the wordmark, or on a pole at the far right
- The overflow as a pile running off the edge
- Count dots as small images in the brand colours
- A cap above 10 KB per header file
- The header generator in this repo
- Header images for a fork of the action, or for an action repo under another name
- Final art for Penny
- Showing a change that touches only a stack's outputs
- Deploying the exact plan that was previewed, for Pulumi
- A strict mode input that turns the scan job red on any preview failure
- Default globs for `scan.unrelated` (such as `**/*.md`)
- A size budget level for the summary beyond its two, or the full diffs as a file to download
- The count of changes outside a stack, `and earlier changes` and the compare link in the summary
- A link from the summary's note to the stack's group in the job log
- A live example dashboard in this repo
- A setting for which directories discovery never enters, or reading `.gitignore` for it
- The check reading git's own list of tracked files
- The check reading the workflow files (triggers, permissions, a pinned SHA) or suggesting `inputs`
- Checking discovered stacks against the backend (`pulumi stack ls`)
- A preview failure reason of its own for more of the tool's documented exit codes (2 configuration, 3 authentication, 4 resource, 9 timeout)
- The `ignore` glob on the row of a stack that does not exist in the backend, or one ready-to-paste `ignore` block for all such stacks
- Reading a Pulumi project file for more than `stackConfigDir`
- Showing a Pulumi resource that only moves to a new address through an alias (`tracking: move`)
- Folding the Pulumi step ops that no recording shows (`create-replacement`, `delete-replaced`, `read-replacement`, `import-replacement`, `discard`, `discard-replaced`, `remove-pending-replace`)
- Previewing a Pulumi stack whose state holds a resource twice at one URN, such as a copy left waiting for deletion by a deploy that failed half way
- Naming the step op that Sluiceway did not know, in the job log
- A limit on how much tool output a preview may hold in memory
- Stopping GitHub from linking a `#123`, an `@name` or a web address that sits inside a resource name or a stack id
- Renaming an existing dashboard when `dashboard.title` changes
- Pinning a dashboard that already exists, on every scan
- Trying a dashboard write again after an API error
- A bound on how many closed issues are read when looking for a closed dashboard
- The tool's output in the job log while a preview is still running
- Links on a row to the attempt of a run that was run again
- A preview failure row for a fault inside Sluiceway itself
- A time limit of Sluiceway's on the deploy itself
- A preview after a deploy that went out, to check the row
- A row of its own for a deploy that ended before any preview (the tool missing, the stack gone, a broken `sluiceway.yaml`)
- Deploying a record from another run
- A budget for the summary of an apply
- `scan.logDiff` per stack, or as an action input
- The tool's own diff for the preview after a failed deploy, and for a narrowed scan's carried rows
- Stopping workflow commands around the tool's other words (its stderr and diagnostics)
- Values on a preview page from a list of its own
- `dashboard.showValues` per stack
- A value at a path that only `diffReasons` or `replaceReasons` names
- A value that is an object, a list or several lines, and `**` in the list
- Blanking or marking the preview page of a stack that is no longer pending
- A preview page for the pending row that `apply` writes after a change that moved
- A link from the preview page to the dashboard's own number
- `checks: write` on the scan job alone

### After 1.0, each its own plan

- A hosted GitHub App with an org-wide dashboard. A control plane only. Previews and deploys always run in the user's own runners. It reuses the open source core.
- GitLab and Bitbucket. The UI is a GitHub issue, so this is a different product surface.
- A notifier built into Sluiceway (Slack, Telegram, webhooks) and a metrics endpoint. It would hold a secret and call a third party. v1 gives step outputs and a result file, and the workflow sends (0041). Native notifications and history fit a hosted version.
- A policy engine, cost estimation. Non-goals for v1 in the brief.

### Not planned

31 ideas were rejected on principle. Bringing one back means reopening the decision that rejected it, not scheduling work: [docs/later.md](later.md#rejected-on-principle) lists them.
<!-- End of the generated part. -->
