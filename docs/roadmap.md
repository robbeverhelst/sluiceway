# Roadmap

What comes before Sluiceway 1.0, and what comes after. Sluiceway is in beta and released as 0.x, and every example uses the moving tag `v0`. 1.0.0 is a tag cut on purpose, not the next number in line, and with it comes the moving tag `v1`.

The part after 1.0 is generated from [docs/later.md](later.md), which says for every item why it is not built yet and where that was decided. A test fails when this page and that file disagree: change `docs/later.md`, then run `bun run roadmap`.

## What is built

The core loop: a scan previews every stack and writes the dashboard, a person ticks a box, exactly that stack deploys, and its row returns to in sync or says why it failed. Around it:

- Pulumi stacks and OpenTofu and Terraform root modules, found from their files, and the root modules the files cannot speak for (Terragrunt units and CDK for Terraform apps among them), Helm releases and Kubernetes manifests, declared in `sluiceway.yaml`.
- Five modes: `scan`, `resolve`, `apply`, `settle`, and `check`, which validates a setup on a pull request with no credentials.
- A push previews only the stacks it touches. Every row says which pull requests made it pending, and links to a page with that stack's diff.
- Rows name the property paths that change, never a value. A repo can list paths whose values may show, and can print the tool's own diff in the job log.
- A team can stop every deploy from the config, rehearse a tick, and leave a stack out with a written reason.
- One tick can merge a routine update and deploy it. Drift is shown and repaired by a tick, and can be turned on per stack. A stack can wait for the stacks it depends on, named by hand or read from its Pulumi stack references, and the check lists them.
- Opt-in messages to Slack, Telegram or a webhook of your own when stacks are pending, drift is found, a deploy fails or a tick is refused, and step outputs and a result file for anything else.

The [build plan](build-plan.md) says how each of these was built and proven, and the [decision records](adr) hold the rules.

## Before 1.0

- **The launch.** A listing on the GitHub Marketplace, a docs site, screenshots, a note on merge queues and the config schema in SchemaStore. Then the 1.0.0 tag and the `v1` moving tag.

## After 1.0

In plain words, the larger themes: more tools (AWS CDK), a bot with its own name and picture, teams in the tick rule, a log of deploys made outside the dashboard, and a hosted version with a dashboard for a whole organization. The previews and the deploys always stay in the user's own runners.

Every item, as `docs/later.md` lists it:

<!-- Generated from docs/later.md by `bun run roadmap`. Do not edit by hand. -->
### After 1.0, when someone needs it

No date and no order. Each waits for a user who asks, and none of them needs a breaking change. [docs/later.md](later.md#deferred-door-left-open) says why each one waited and where that was decided.

- Saying on the dashboard whether the tick rule or an environment decides who may deploy, and the check reading whether an environment has required reviewers
- `init` for the Terraform family: declaring Terraform root modules, Terragrunt units and the stacks of a CDK for Terraform app, and their setup steps (setup-terraform, terragrunt, cdktf)
- `dependsOn: auto` from a Terragrunt unit's `dependency` blocks, and zero-config discovery of Terragrunt units from `terragrunt.hcl`
- `varFiles` on a Terragrunt unit or a CDK for Terraform stack
- Root module discovery, part 2: a root module that reads `terraform.workspace`, has var files of its own or a `cloud` block with `tags`, found once per workspace or var file; root modules in a repo with Terragrunt files; a module source that is a Git address of the same repo
- A `backendConfig` option for OpenTofu (`tofu init -backend-config`)
- Helm, part 3: a `kubeContext` option, zero-config discovery from `Chart.yaml`, and `--take-ownership` for objects made outside the release
- Pruning of a Kubernetes manifests stack through kubectl's own ApplySet, and drift in fields its manifests do not set
- Zero-config discovery of kustomizations, and a hint in the check for a directory of manifests that no entry declares
- `init`, part 2: a credential step for a secret manager other than 1Password's env file of references or for a cloud through OIDC, a setup action for languages other than Node, a check workflow next to the starter workflow, adding to a `sluiceway.yaml` that is there, and Kubernetes manifests stacks (slice 4.9 landed while this slice was built)
- Credentials that only read in scans, and an environment per stack, without an `if:`: `resolve` dispatches a second workflow once per deploy, whose one job names the stack's environment, loads the credentials that write and deploys that record
- One set of outputs and one result file per deploy when one step deploys several stacks, and deploys side by side in one step
- A check in auto mode that knows a repo's issue edits are many and suggests the split workflow
- An AWS CDK and CloudFormation adapter (change sets as the preview)
- A branch preview of updates past the oldest 30, and a branch preview carried over by a scan that did not preview its stack
- Reading Renovate presets from npm, a web address or another platform, presets with parameters, and `packageRules`, for the merge method
- Waiting, in the scan after a merge, for a dependency that became pending after the merge
- A warning from the check when `mergeAndDeploy` is on and the workflow does not declare the `sluiceway-merged` input
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
- Links to the job, not the run, on the rows written from a deployment record (deploying rows, failure lines, Recently deployed)
- A link that lands on one stack's group in the job log (`#step:<n>:<line>`)
- The carried rows in the summary of a narrowed scan
- An empty `tickers` list, as a way to get a dashboard that nobody can tick
- A scan that works out by itself that its workflow has no `resolve` job, so that `dashboard.readOnly` is not needed
- `dashboard.readOnly` as a lock: `resolve` refusing a tick while it is on
- The stacks a narrowed scan carried, in the result file of a scan
- Who made a deploy outside the dashboard, from Pulumi Cloud's `requestedBy`
- Deploys made outside the dashboard for OpenTofu, Helm and kubectl stacks
- Reading the tool's history in a narrowed scan, gated by `pulumi stack ls` and its `lastUpdate`
- Placing the orphan tick note in the order of record 0027 when `resolve` adds it
- Carrying on with the other records after one deployment record could not be written
- A scan that carries a ticked rescan box while a `resolve` run is on its way
- The scan clearing an orphan tick with `clearTick` in place of a preview
- Telling a full edit history that lost nothing from a capped one
- Looking past the newest 100 runs that an issue edit started, when a scan asks whether a `resolve` run is on its way
- Sweeping an orphan tick off a row without previewing its stack
- The orphan tick sweep in a repo that keeps `scan` and `resolve` in two workflow files
- A real `uses:` step against the fake GitHub server in the e2e workflow
- Starting a deploy without a person ticking (unattended deploys of chosen stacks)
- Telling authors that their merge is waiting for a deploy
- The files of each change outside a stack, in the fold that names them
- Looking past a failed record for an older success to start attribution from
- Attribution for a scan of a commit that is not on the default branch
- A recently deployed list longer than 50 lines
- Reading a deployment record whose payload has another version
- Finding a stack's records after its `environment` label changed
- `settle` writing the row of a stack whose record it ended
- A failure line on a row that a narrowed scan carries through
- Allowing for a runner clock that differs from GitHub's
- A shortening level that also drops a row's links, for more than about 100 stacks pending at once
- A link to the summary in the note about shortened rows
- A finer personality switch (the header without the voice, or the reverse)
- A custom header image, or a palette setting
- A drift picture with crates, or drift above pending in the header
- Levels for deploying or failing (how many are deploying, how much failed)
- More than 20 exact crates
- The destroy sign painted on the wall right of the wordmark, or on a pole at the far right
- The overflow as a pile running off the edge
- Count dots as small images in the brand colours
- A cap above 10 KB per header file
- The header generator in this repo
- Header images for a fork of the action, or for an action repo under another name
- Final art for Penny
- Showing a change that touches only a stack's outputs
- Deploying the exact plan that was previewed, for Pulumi
- A size budget level for the summary beyond its two, or the full diffs as a file to download
- The count of changes outside a stack, `and earlier changes` and the compare link in the summary
- A link from the summary's note to the stack's group in the job log
- A live example dashboard in this repo
- A setting for which directories discovery never enters, or reading `.gitignore` for it
- The check reading git's own list of tracked files
- The check suggesting `inputs`, part 2: files a program in a general-purpose language builds a path to, OpenTofu var files and module sources outside the stack, the bases a kustomization names
- The check reading more of a workflow than triggers, permissions, the jobs, the ref, the concurrency groups, the status checks in `if:` and the second apply job: the label in the `if:` of `resolve`, the branch a `push` listens to, and a reusable workflow's caller
- The check asking the backend about OpenTofu workspaces, Helm releases or Kubernetes objects
- The `ignore` glob on the row of a stack that does not exist in the backend, or one ready-to-paste `ignore` block for all such stacks in the summary of a scan
- Reading a Pulumi project file for more than `stackConfigDir`
- Showing a Pulumi resource that only moves to a new address through an alias (`tracking: move`)
- Folding the Pulumi step ops that no recording shows (`create-replacement`, `delete-replaced`, `read-replacement`, `import-replacement`, `discard`, `discard-replaced`, `remove-pending-replace`)
- Previewing a Pulumi stack whose state holds a resource twice at one URN, such as a copy left waiting for deletion by a deploy that failed half way
- Naming the step op that Sluiceway did not know, in the job log
- Stopping GitHub from linking a `#123`, an `@name` or a web address that sits inside a resource name or a stack id
- Trying a dashboard write again after an API error
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
- A built-in notification for a failed preview, for a scan that failed before it wrote the dashboard, and for a deploy that `settle` ended
- `resolve` without a checkout, from the GitHub API: one recursive tree call for discovery's paths and GraphQL reads of the files it opens, for the `resolve` job of a split workflow on a very large repo
- A faster body write in `resolve`: the largest part of its own time after a tick, 1.2 to 2.8 s of 2.8 to 4.9 s on the test bed

### After 1.0, each its own plan

- A hosted GitHub App with an org-wide dashboard. A control plane only. Previews and deploys always run in the user's own runners. It reuses the open source core.
- GitLab and Bitbucket. The UI is a GitHub issue, so this is a different product surface.
- Interactive notifications (a tick from a button in Slack) and a metrics endpoint. A button needs an app that Slack can call back, and a GitHub Action is not running when someone clicks. The built-in messages go one way (0078), and metrics are pushed from the outputs. Both fit a hosted version.
- A policy engine, cost estimation. Non-goals for v1 in the brief.

### Not planned

31 ideas were rejected on principle. Bringing one back means reopening the decision that rejected it, not scheduling work: [docs/later.md](later.md#rejected-on-principle) lists them.
<!-- End of the generated part. -->
