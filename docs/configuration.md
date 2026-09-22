# Configuration

Sluiceway reads one optional file, `sluiceway.yaml`, at the root of the repo. Without it every stack that discovery finds gets a row, anyone with write access can tick, and every setting below has its default. Add the file when a default does not fit.

`sluiceway.yaml` is about your stacks: who may tick them, which ones to leave out, what files they read. When and on what runner Sluiceway runs is GitHub's business and lives in the workflow file under `.github/workflows/`. The [README](../README.md#what-goes-where) has the table.

The file is read from the checkout of the job, so the rules in force are the ones on the default branch. With a protected default branch, a change to `tickers` is itself a reviewed change ([security](security.md)).

## How the file is read

- **Unknown keys are an error.** A typo in `tickers` would change who can deploy, so nothing is ever ignored. The message names the keys that are allowed there.
- **Every problem is listed at once**, top to bottom as the file has them, so you fix the file in one go.
- **Every mode stops on a file that is not valid.** The job goes red with the messages, and the dashboard is not written.
- **`dependsOn` and `drift` are not in this version.** They fail with a message that says so, and are never ignored.
- **Editors can check the file as you type.** Put this line at the top and an editor with YAML support finds the schema: `# yaml-language-server: $schema=https://raw.githubusercontent.com/sluiceway/sluiceway/main/schema/sluiceway.schema.json`.
- **The `check` mode tells you in a pull request** whether the file is valid, which stacks it covers and what `ignore` leaves out ([README](../README.md#1-check-your-setup)).

## Stacks and stack ids

Discovery finds the stacks from files alone. For Pulumi, a directory with `Pulumi.yaml` (or `Pulumi.yml`, `Pulumi.json`) is a project, and every stack config file next to it with the same extension, `Pulumi.<name>.yaml`, is a stack. Discovery never asks the backend, so a stack config file with no stack in the backend is still a stack. Its preview fails with "the stack does not exist in the backend", and the summary names the `ignore` line that takes it off.

Every stack has a **stack id**, derived from where it lives and what it is called: `<path>:<name>`, where the path is the directory relative to the repo root, with forward slashes. A stack `prod` in `apps/web` is `apps/web:prod`. A stack at the repo root is `.:prod`. The id is never chosen, so moving a directory or renaming a stack makes a new stack with no deploy history.

For OpenTofu there is no zero config. A root module and a child module look the same on disk, and a workspace lives in the backend, so files alone cannot say what a stack is. A `stacks` entry with `tool: opentofu` declares one: the root module in `path`, with an optional `name`, workspace and var files. Its stack id is `path`, or `path:name` when the entry gives a name, so one directory in two workspaces is two stacks, such as `infra/network:dev` and `infra/network:prod`. Discovery checks from the files that the directory holds OpenTofu files and that every var file is there, and still never starts the tool.

A repo can hold Pulumi and OpenTofu stacks side by side. They share one dashboard, one tick rule and one workflow.

`ignore` matches stack ids. `stacks` entries point at stacks by `path` and `name`.

## An example

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/sluiceway/sluiceway/main/schema/sluiceway.schema.json

dashboard:
  title: Infrastructure

# Only maintainers may tick, unless a stack says otherwise.
tickers: maintain

ignore:
  - "sandbox/*"      # every stack in sandbox/
  - "**/*:scratch"   # the scratch stack of every project
  - glob: "legacy/*"
    reason: Deployed by the platform team # listed with this under In sync

scan:
  unrelated:
    - "**/*.md"
    - "docs/**"

stacks:
  # Settings for every stack in apps/web.
  - path: apps/web
    environment: web
    inputs:
      - packages/ui/**

  # The prod stack of apps/web only. A list narrows: alice and bob still need
  # write access to the repo.
  - path: apps/web
    name: prod
    environment: web-prod
    tickers:
      - alice
      - bob
    previewTimeout: 20
```

## Keys

### `dashboard.title`

Default: `Sluiceway dashboard`

The title the dashboard issue gets when Sluiceway creates it. Sluiceway finds the issue by its label, never by its title, so after that you can rename the issue by hand and a change of this key does nothing to an issue that exists.

### `dashboard.label`

Default: `sluiceway`

The label the dashboard issue is found by. A scan that finds no open or closed issue of Sluiceway's with this label creates a new dashboard, so when you change the label on a repo that has a dashboard, put the new label on the existing issue as well. Change the `if:` of the `resolve` job in the workflow too, because that line keeps an edit of an ordinary issue from starting a runner:

```yaml
dashboard:
  label: deploys
```

Then the `resolve` job reads `contains(github.event.issue.labels.*.name, 'deploys')`.

### `dashboard.pin`

Default: `true`

Pin the dashboard issue to the top of the repo's issue list when Sluiceway creates it. Best effort: when GitHub will not pin it, for example because the repo has as many pinned issues as GitHub allows, the scan goes on and the job stays green. An issue that exists is left as it is, so a dashboard you unpin stays unpinned.

### `dashboard.redact`

Default: `false`

Keep resource types, resource names and property names out of the issue. A redacted row shows the stack id, the counts by op, the destroy warning, the failure line and a link to the run's summary, which stays full. It also turns [`dashboard.showValues`](#dashboardshowvalues) off, so no value is shown anywhere. In a repo with that list, turning redact on or off voids the ticks on rows that showed a value, once.

Redact is about reach, not access. An issue body is emailed, sent to integrations and indexed on a public repo. A job summary sits behind a click. But anyone who can read the repo can open the run and read the code that names the resources. **It is not access control.** Turning it on or off never voids a tick, unless `dashboard.showValues` is set: the diff hash covers the whole diff either way.

### `dashboard.personality`

Default: `true`

Show the header image and the two lines in the voice of the dashboard. `false` removes both and leaves the counts, the rows and the plain wording. Use it when the header image cannot load, for example when the action runs from a fork or from a copy inside your repo.

### `dashboard.readOnly`

Default: `false`

Draw a dashboard that nothing can be deployed from: pending rows have no box, there is no rescan box, and the line under the Pending heading says that the dashboard is read only. Everything else is the same: the rows, the diffs, the counts, the links and the summary.

Turn it on for a workflow that only scans, such as the read-only trial in the README. Such a workflow has no `resolve` job, so a box would look live and do nothing. Sluiceway cannot see that from inside a scan, which is why it is a setting.

```yaml
dashboard:
  readOnly: true
```

When you move to the whole workflow, take the key out. A change to `sluiceway.yaml` makes the next push a full scan, so every pending row gets its box back in that scan.

### `dashboard.showValues`

Default: `[]`

Property paths whose old and new value may appear on the dashboard. A listed path that changes reads `old → new` right after it, so a version bump shows as a version bump:

```
update kubernetes:helm.sh/v3:Release odoo-release · version 17.0.3 → 17.0.4
```

Without this key Sluiceway shows which properties change and never what they change to ([record 0021](adr/0021-no-property-value-ever-leaves-the-adapter.md)). The list is the one exception, and it is yours: Sluiceway never guesses that a value is safe.

- **An entry matches a path exactly as the row writes it**, such as `values.image.tag`, `spec.template.spec.containers[0].image` or `data["app.properties"]`. Quote an entry that holds `[` or `"` in YAML.
- **`*` stands for part of one name.** It never crosses a `.` or a bracket, so `values.*` matches `values.replicas` and not `values.image.tag`. `**` and an entry made only of `*` are refused.
- **A value the tool marks secret is never shown**, listed or not. Only the tool's own mark counts. A value you forgot to mark is shown if you list its path, so list only paths whose values you would put in an issue.
- **Only single-line text, numbers and booleans are shown.** A whole object or list, a value of several lines, and a value that is known only once the deploy runs show nothing. A value longer than 40 characters keeps its start and its end.
- **The same values appear in the summary, on the preview page, in the result file and in the job log.** The issue is emailed and kept in its edit history, so a value that reached it cannot be taken back.
- **`dashboard.redact: true` turns the list off.** No value is even read.
- **A tick approves the values it shows.** The diff hash covers them, so if a later merge moves `17.0.4` to `17.0.5` before the deploy, nothing deploys and the row comes back with `17.0.5`. A path that is not listed is approved at whatever value the code has, as before. See [what a tick promises](security.md#what-a-tick-promises).
- **Changing the list voids ticks once.** Adding or removing a path, or turning `dashboard.redact` on or off, gives the rows that show a value a new hash, so a tick on a row written before is refused as moved and the row asks for a fresh one.

A list to copy in, of paths that are nearly always safe to show:

```yaml
dashboard:
  showValues:
    - version          # a Helm release's chart version
    - chart.version
    - values.image.tag # the image tag in a chart's values
    - image            # a container image
```

Check every path against your own stacks before you add it. A chart can put a token anywhere in its `values`, such as `values.githubConfigSecret.github_token`, and the tool does not know it is one. That is why the list takes exact paths and `*` never reaches a level further down.

### `tickers`

Default: `write`

The tick rule for every stack that does not set its own: what a person needs in order to tick. One of:

- `write`: anyone with write access to the repo.
- `maintain`: people with the maintain or admin role.
- `admin`: people with the admin role.
- a list of GitHub usernames. It **narrows and never widens**: a person on the list still needs write access, and an admin who is not on it is refused.

Usernames are compared without regard to case. Write the login alone, without `@`. Access that comes through a team counts, so to let a team deploy, give the team the maintain or admin role on the repo and use that level. Team names in the list are not supported yet:

```yaml
# Not valid: a team in the list
tickers:
  - my-org/platform
```

```text
sluiceway.yaml is not valid:
- tickers[0]: "my-org/platform" looks like a team. Teams are not supported yet. Use a level ("write", "maintain", "admin") or usernames.
```

The rule is checked against GitHub's live answer at every tick. Nothing is cached, so a person whose access was removed is refused at their next tick. A refused tick deploys nothing, clears the box and gets one comment on the dashboard that says why. When GitHub gives no answer about a person, nothing deploys, the comment asks for a fresh tick and the job goes red.

The rescan box has no rule of its own. Anyone with write access can tick it, and it only starts a full scan.

### `deploys`

Default: `true`

`false` stops every deploy from the dashboard, with one reviewed line in a pull request, and without touching the workflow:

```yaml
# Change freeze until the migration is done.
deploys: false
```

- `resolve` clears every ticked box, puts a note on the row that says deploys are turned off, and starts nothing. No deployment record is made, nobody's access is looked up and no comment is written, because nothing could go out whoever ticked. The rescan box still works: a scan deploys nothing.
- A deploy that was ticked before the switch was merged and whose `apply` job starts after it ends before the tool runs. Its deployment record ends as `failure` with the reason "deploys are turned off in sluiceway.yaml", which the row shows as its failure line, the `outcome` output is `refused` and the job is red.
- Scans go on as before, so the dashboard keeps showing what is pending.

Setting it back to `true` (or taking the line out) is all it takes to deploy again. A tick that was cleared needs a fresh tick.

### `ignore`

Default: `[]`

Globs matched against the **stack id**, not the path. An ignored stack has no row, is never previewed, claims no files, and a `stacks` entry cannot give it settings.

Because the id is `<path>:<name>`, a bare directory matches nothing. `apps/web` ignores nothing, and `apps/web:*` ignores every stack in `apps/web`. Globs that end in `*` already cross the colon: `apps/*` and `sandbox*` work as you would expect. `*` stops at a slash and `**` crosses slashes. The `check` mode warns about a glob that matches no stack, and names the glob that would work.

A stack config file with no stack in the backend is the usual reason to ignore one:

```yaml
ignore:
  - "apps/web:dev"
```

An entry can also say why. Write it as a mapping with `glob` and `reason`, and every stack it leaves out is listed with the reason in a fold of its own under the In sync heading, so an exclusion stays in sight for as long as it lasts:

```yaml
ignore:
  - "apps/web:dev"
  - glob: "legacy/*"
    reason: Deployed by the platform team's pipeline until the move in March
```

A mapping without a `reason` is an error: write the glob as text instead. A stack that several entries match gets the reason of the first one in the file, and a stack whose first match is a glob as text is left out without a line. The reason is shown as text, never as Markdown.

### `scan.unrelated`

Default: `[]`

Globs for files that claim nothing and force nothing. A push previews only the stacks that claim a changed file (a narrowed scan), and a changed file that no stack claims makes it a full scan. That is the safe side, because Sluiceway cannot know what your programs read. List here the files that no program reads, so that changing them costs no preview at all.

A file listed here claims nothing even inside a stack's directory, so `**/*.md` keeps a README change from previewing its stack. Never list a file one of your programs reads: its stack would show a stale row until the next full scan. There are no defaults. The `check` mode prints a ready-to-paste block for the files that look like docs and tooling, and so does the summary of a push that fell back to a full scan because of files no stack claims, for the files of that push.

```yaml
scan:
  unrelated:
    - "**/*.md"
    - "docs/**"
    - ".github/**"
    - "LICENSE*"
```

Keep `sluiceway.yaml` itself off the list, and lockfiles and package manifests too. A change to one of them should preview every stack, and it does, with a line in the job log that says why, as long as no glob here covers it.

### `scan.logDiff`

Default: `false`

Prints the tool's own diff of every pending stack, values included, in that stack's group of the job log. It is the one way to see what a property changes to before you tick. The dashboard, the summary, the result file, annotations and deployment records never hold a value, with this on or off ([record 0048](adr/0048-the-tools-own-diff-may-reach-the-job-log-when-a-repo-asks.md)).

```yaml
scan:
  logDiff: true
```

Read this before you turn it on:

- **Anyone who can read the repo can read its job logs.** In a public repository that is anyone at all, and the scan warns about it on the run. In a private one it is every person and integration with read access, for as long as the repository keeps its logs (90 days unless you changed it).
- **Only what the tool marks as secret is masked, plus what your workflow registered with `::add-mask::`.** Pulumi prints `[secret]` for a secret config value and for a value a provider marks secret, and every other value in plain text. Sluiceway adds no mask of its own ([credentials](credentials.md)).
- **It helps with a stack that is pending again right after every deploy.** Its row then says so, and points at the job log, where the tool's own diff shows which value differs on every run.
- **It costs one more tool run per pending stack**, in the same pool slot and with the same time limit as the stack's preview. Stacks in sync and failed previews get no second run.

With it on, a pending row's `preview` link still opens the stack's preview page, which says the tool's diff is in the job log and links to it. The page itself never shows a value, because the masks your workflow registers do not reach it. Without a preview page, the link opens the job's log instead of the summary. In the job log, open the Sluiceway step and the group named after the stack, or type the stack id into the log's search box. The group holds Sluiceway's own list of changes, then the tool's diff. `apply` prints the tool's diff of its fresh preview too, in the group `<stack id>: the fresh preview`. When the second run fails, the group says why and the row does not change: the row and the diff hash always come from the preview itself.

### `stacks[].path`

Required in every entry.

The directory of the stack, relative to the repo root, with forward slashes. `.` is the repo root. A leading `./` and a trailing slash are dropped. An absolute path, a backslash and `..` are errors.

A `stacks` entry adds settings to stacks that discovery found. **It never creates a stack**, except an entry with `tool`, which declares one. An entry that matches no stack, or only stacks that `ignore` leaves out, is an error, so a typo cannot pass quietly. Two entries with the same path and name are an error too: put the settings in one entry.

### `stacks[].name`

Default: every stack in the path.

The name of the stack, the part of the stack id after the colon. Without it the entry covers every stack in `path`. When an entry with a name and an entry without one both cover a stack, the entry with the name wins key by key, and `inputs` add up.

### `stacks[].tool`

Default: none, the entry adds settings to stacks that discovery found.

The tool of a stack that discovery cannot find from files alone. The entry then declares the stack at `path`, and `options` holds that tool's options. One tool takes it in this version: `opentofu`, for an OpenTofu root module. Pulumi stacks are found from their files and need no `tool`.

```yaml
stacks:
  - path: infra/network
    name: prod
    tool: opentofu
    options:
      workspace: prod
      varFiles: [prod.tfvars]
  - path: infra/dns
    tool: opentofu
```

An unknown tool, an unknown option or an option of the wrong kind stops every mode, with the same kind of message as any other mistake in the file, such as `stacks[0].tool: unknown tool "terraform". Known tools: opentofu.`

Sluiceway runs `tofu init` for every directory of the stacks it is about to preview, one directory at a time, before the first preview. Then `tofu plan -refresh=false -out` and `tofu show -json` give the preview, and a tick deploys the plan file that `apply`'s own fresh preview saved and hashed, with `tofu apply` of that file. Install `tofu` in the workflow before Sluiceway, v1.11.0 or newer ([credentials](credentials.md)).

### `stacks[].environment`

Default: `sluiceway`

The environment name on the stack's deployment records, and the GitHub Environment the `apply` job names when you use the feature. On its own it is only a label. The records work on every plan, and GitHub lists an environment for every name the records use, so your repo settings show one named `sluiceway` even when you never use the feature.

Give stacks their own environment when the credentials that change things should be locked into a GitHub Environment ([security](security.md)). Stacks can share an environment.

### `stacks[].tickers`

Default: the top level `tickers`.

The tick rule for this stack, in the same form as the top level key. It replaces the top level rule for this stack and does not add to it: `tickers: write` on a stack lets every person with write access tick it, even when the top level says `admin`. Write access is always needed, whatever the rule.

### `stacks[].inputs`

Default: `[]`

Extra globs this stack claims, relative to the repo root. A stack always claims every file in its own directory. Add the files outside it that its program reads, so that a push that changes them previews this stack and not every stack:

```yaml
stacks:
  - path: apps/web
    inputs:
      - packages/ui/**
      - config/web.json
```

`inputs` only add claims. A shared file that every stack reads needs no entry: no stack claims it, so a change to it previews everything. That is also what the scheduled full scan is for.

### `stacks[].previewTimeout`

Default: the `preview-timeout` input, `10` minutes.

The time limit for one preview of this stack, in whole minutes. A preview that runs longer is stopped and the stack gets a preview failure row. `apply` uses it for the fresh preview before a deploy. The deploy itself has no time limit of Sluiceway's: set `timeout-minutes` on the `apply` job.

```yaml
# Not valid: minutes are whole numbers
stacks:
  - path: apps/web
    previewTimeout: 2.5
```

```text
sluiceway.yaml is not valid:
- stacks[0].previewTimeout: expected a whole number of minutes, 1 or more, got 2.5.
```

### `stacks[].dependsOn`

Default: none.

The stack ids of the stacks this stack depends on, such as a network stack that an app stack reads outputs from. Write each id as its row shows it. Two things follow:

- **A tick waits for a change upstream.** A tick on this stack is refused while a stack it depends on has a pending row that nobody ticked: the box is cleared, and a note on the row names that stack. The job stays green. Only a pending row holds a tick back, because only a change that has not gone out can change what this stack reads. A stack that is in sync, or whose preview failed, holds nothing back.
- **Ticks in one chain go out in order.** Tick both and the one it depends on deploys first. The other gets the row `queued behind <stack>` and a deployment record of its own, and deploys once that stack went out. If that deploy fails, the queued stack does not deploy and its row gets a failure line. The same happens when you tick this stack while a stack it depends on is deploying.

Each layer of a chain runs in a workflow run of its own. The `settle` job starts the workflow again when a layer went out, and the `resolve` job of that run starts the next layer, so the `resolve` job has to run on `workflow_dispatch` as well as on `issues`. The workflow in the [README](../README.md#2-add-the-workflow) does.

A stack waits only on the stacks it names, not on theirs. Entries add up, like `inputs`: an entry without a name gives its list to every stack in its path.

```yaml
stacks:
  - path: app
    dependsOn:
      - network:prod
  - path: site
    name: prod
    dependsOn:
      - app:prod
```

Every id is checked against discovery, because a dependency that could never hold anything back would be a gate that never says so. A stack that was not found, one that `ignore` leaves out, the stack itself and a circle are errors, such as:

- `stacks[0].dependsOn[0]: "network:staging" is not a stack that discovery found. Write the stack id as a row shows it, such as "network:dev".`
- `dependsOn goes round in a circle: app:prod depends on network:prod, which depends on site:prod, which depends on app:prod. Nothing in a circle could ever deploy first, so take one of these out.`

```yaml
# Not valid: a list of stack ids
stacks:
  - path: app
    dependsOn: network:prod
```

```text
sluiceway.yaml is not valid:
- stacks[0].dependsOn: expected a list, got "network:prod".
```

### `stacks[].options.workspace`

Default: the workspace the job's environment selects, which is `default`.

Only with `tool: opentofu`. The workspace of the stack. Sluiceway sets `TF_WORKSPACE` to it for every command of this stack: the plan, the plan's JSON, the tool diff and the deploy. A workspace that the backend does not hold is not an error for every backend: the local backend plans every resource as a create. The row then says so, before anyone ticks.

Named options are the only way to change the tool's command line. Sluiceway never passes free-form arguments to the tool (record 0015). A stack found from its files, such as a Pulumi stack, takes no options.

### `stacks[].options.varFiles`

Default: `[]`

Only with `tool: opentofu`. Var files, relative to the directory of the stack, handed to every plan with `-var-file` in this order. `terraform.tfvars` and `*.auto.tfvars` are read by the tool without being listed. A var file outside the directory of the stack is not claimed by it: add it to `inputs` too, or a change to it gives a full scan.

## What the file does not hold

- **No credentials and no environment variables.** Your workflow puts them into the job environment before Sluiceway runs ([credentials](credentials.md)).
- **No `concurrency` or `preview-timeout`.** They belong to the runner, so they are inputs of the action.
- **No stack ids.** They are derived.
- **No teams and no `drift`.** Not in this version:

```yaml
# Not valid: not in this version
drift: true
```

```text
sluiceway.yaml is not valid:
- "drift" is not in this version of Sluiceway yet. Remove it.
```

A typo gets the list of keys that are allowed:

```yaml
# Not valid: a typo
ticker: admin
```

```text
sluiceway.yaml is not valid:
- unknown key "ticker". Known keys here: dashboard, tickers, deploys, ignore, scan, stacks, mergeAndDeploy.
```
