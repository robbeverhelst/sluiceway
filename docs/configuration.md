# Configuration

Sluiceway reads one optional file, `sluiceway.yaml`, at the root of the repo. `sluiceway.yml` is read the same way, and both at once is an error. Without it every stack that discovery finds gets a row, anyone with write access can tick, and every setting below has its default. Add the file when a default does not fit.

`sluiceway.yaml` is about your stacks: who may tick them, which ones to leave out, what files they read. When and on what runner Sluiceway runs is GitHub's business and lives in the workflow file under `.github/workflows/`. [What goes where](workflow.md#what-goes-where) has the table.

The file is read from the checkout of the job, so the rules in force are the ones on the default branch. With a protected default branch, a change to `tickers` is itself a reviewed change ([security](security.md)).

## How the file is read

- **Unknown keys are an error.** A typo in `tickers` would change who can deploy, so nothing is ever ignored. The message names the keys that are allowed there.
- **Every problem is listed at once**, top to bottom as the file has them, so you fix the file in one go.
- **Every mode stops on a file that is not valid.** The job goes red with the messages, and the dashboard is not written.
- **Editors can check the file as you type.** Put this line at the top and an editor with YAML support finds the schema: `# yaml-language-server: $schema=https://raw.githubusercontent.com/sluiceway/sluiceway/main/schema/sluiceway.schema.json`.
- **The `check` mode tells you in a pull request** whether the file is valid, which stacks it covers, which OpenTofu and Terraform directories discovery found or left out and why, and what `ignore` leaves out ([check your setup](workflow.md#check-your-setup)).

## Stacks and stack ids

Discovery finds the stacks from files alone. For Pulumi, a directory with `Pulumi.yaml` (or `Pulumi.yml`, `Pulumi.json`) is a project, and every stack config file next to it with the same extension, `Pulumi.<name>.yaml`, is a stack. Discovery never asks the backend, so a stack config file with no stack in the backend is still a stack. Its preview fails with "the stack does not exist in the backend", and the summary names the `ignore` line that takes it off.

Every stack has a **stack id**, derived from where it lives and what it is called: `<path>:<name>`, where the path is the directory relative to the repo root, with forward slashes. A stack `prod` in `apps/web` is `apps/web:prod`. A stack at the repo root is `.:prod`. The id is never chosen, so moving a directory or renaming a stack makes a new stack with no deploy history.

OpenTofu and Terraform root modules are found from their files too, and a `stacks` entry declares any the files cannot speak for. A root module and a shared module look the same on disk, so discovery asks for more than `.tf` files: a directory is a stack only when the repo's own files say it is a root module. No other directory uses it as a local module source, it does not sit under a `modules` directory, a `terraform` block gives it a `backend` or a `cloud` block, and its lock file or its `.tofu` files say whether OpenTofu or Terraform runs it. A found root module is one stack in the default workspace, and its stack id is its path, such as `infra/dns`. [`discovery.rootModules`](#discoveryrootmodules) has the whole rule, what it leaves out and why, and how to overrule it. When in doubt it finds nothing, and the `check` mode lists every directory of OpenTofu or Terraform files with what discovery made of it, on the pull request, before a row appears.

A `stacks` entry with `tool: opentofu` declares a root module the rule leaves out, or one in a workspace other than the default: the root module in `path`, with an optional `name`, workspace and var files. Its stack id is `path`, or `path:name` when the entry gives a name, so one directory in two workspaces is two stacks, such as `infra/network:dev` and `infra/network:prod`. A directory that an entry declares is the entry's, whatever discovery would find there, so a declared stack works exactly as it did before discovery existed. Discovery checks from the files that the directory holds OpenTofu files and that every var file is there, and still never starts the tool.

The Terraform family runs through the same adapter and reads the same plan JSON. `tool: terraform` declares a root module that `terraform` plans and deploys, exactly as `tool: opentofu` does with `tofu`. A Terragrunt unit is declared with the tool that Terragrunt runs and `wrapper: terragrunt`: the stack is the unit's directory, its stack id is `path`, and Sluiceway runs the tool there through `terragrunt run`, one unit at a time, never `run --all`. A stack of a CDK for Terraform app is declared with `wrapper: cdktf` at the app's directory, with the name the app gives the stack: `cdktf synth` writes every stack of the app, and the entry's name picks the one it deploys, so its stack id is always `path:name`. Discovery checks from the files that the directory holds `.tf` files for Terraform, a `terragrunt.hcl` for a unit, or a `cdktf.json` for an app.

For Helm there is no zero config either. A chart can be installed as any number of releases, in any namespace, so files alone cannot say which release a chart is. A `stacks` entry with `tool: helm` declares one: a release in a namespace, with the chart and the values files it is installed with. `path` is the directory the chart and the values files are relative to, and the directory the stack claims. Its stack id is `path`, or `path:name`, as for OpenTofu. Discovery checks from the files that the directory is there, that a local chart holds a `Chart.yaml` and that every values file is there, and never starts helm or reaches a cluster.

Kubernetes manifests have no zero config either: a directory of YAML says nothing about which cluster it belongs to. A `stacks` entry with `tool: kubectl` declares a directory of manifests or a kustomization as a stack, with an optional `name`, kubeconfig context and namespace. Its stack id is `path`, or `path:name`. Discovery checks from the files that the directory holds manifests (`*.yaml`, `*.yml`, `*.json`, one level deep, as `kubectl apply -f <dir>` reads them) or a kustomization, and never reaches a cluster.

A repo can hold Pulumi, OpenTofu, Terraform, Terragrunt, CDK for Terraform, Helm and Kubernetes manifests stacks side by side. They share one dashboard, one tick rule and one workflow.

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

The title of the dashboard issue. Sluiceway finds the issue by its label, never by its title, and every scan gives the issue this title when it has another one: change the key to rename the dashboard. A title changed by hand in the issue is put back by the next scan.

### `dashboard.label`

Default: `sluiceway`

The label the dashboard issue is found by. A scan that finds no open or closed issue of Sluiceway's with this label creates a new dashboard, so when you change the label on a repo that has a dashboard, put the new label on the existing issue as well. The workflow names no label: Sluiceway reads this one to tell an edit of the dashboard from an edit of any other issue.

```yaml
dashboard:
  label: deploys
```

In the [split workflow](split-workflow.md), change the `if:` of the `resolve` job too: `contains(github.event.issue.labels.*.name, 'deploys')`.

### `dashboard.pin`

Default: `true`

Pin the dashboard issue to the top of the repo's issue list. Every scan pins it when it is not pinned, so a dashboard you unpin is pinned again by the next scan: set `false` to keep it unpinned. Best effort: when GitHub will not pin it, for example because the repo has as many pinned issues as GitHub allows, the scan goes on and the job stays green. With `true` a scan makes one more request, to read which issues are pinned.

### `dashboard.redact`

Default: `false`

Keep resource types, resource names and property names out of the issue. A redacted row shows the stack id, the counts by op, the destroy warning, the failure line and a link to the run's summary, which stays full. It also turns [`dashboard.showValues`](#dashboardshowvalues) off, so no value is shown anywhere. In a repo with that list, turning redact on or off voids the ticks on rows that showed a value, once.

An issue body is emailed, sent to integrations and indexed on a public repo, while a job summary sits behind a click. Redact keeps names out of the issue, and anyone who can read the repo can still open the run and read the code that names the resources. Turning it on or off never voids a tick, unless `dashboard.showValues` is set: the diff hash covers the whole diff either way.

### `dashboard.personality`

Default: `true`

Show the header image and the two lines in the voice of the dashboard. `false` removes both and leaves the counts, the rows and the plain wording. Use it when the header image cannot load, for example when the action runs from a fork or from a copy inside your repo.

### `dashboard.readOnly`

Default: `false`

Draw a dashboard that nothing can be deployed from: pending rows have no box, there is no rescan box and no box that deploys a whole section, and the line under the Pending heading says that the dashboard is read only. Everything else is the same: the rows, the diffs, the counts, the links and the summary.

Turn it on for a workflow that only scans, such as the [read-only trial](read-only-trial.md). Such a workflow does not listen to issue edits, so a box would look live and do nothing. Sluiceway cannot see that from inside a scan, which is why it is a setting. With it on, a step with no mode only ever scans: it acts on no issue edit and on a dispatch it scans and does nothing else.

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
- **A tick covers the values it shows.** The diff hash covers them, so if a later merge moves `17.0.4` to `17.0.5` before the deploy, nothing deploys and the row comes back with `17.0.5`. A path that is not listed is approved at whatever value the code has, as before. See [what a tick promises](security.md#what-a-tick-promises).
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

### `dashboard.recentlyDeployed`

Default: `10`

How many lines the Recently deployed list at the bottom of the dashboard shows, newest first. A whole number from 0 to 50. `0` leaves the list out, heading and all.

Every deploy from the dashboard that ended is a line: one that went out, one that found nothing to deploy, a rehearsal, and a failed one, whose failure reason stays on its row. So is every deploy of a Pulumi stack made outside the dashboard that a full scan found in the tool's history. A full scan reads as many entries of each Pulumi stack's history as this number, with one call of `pulumi stack history` per stack, and `0` reads none. The list is built from the deployment records a writer already reads, one page of the newest 100 per environment, so a longer list costs no extra request. Each line is about 150 characters of the issue's room, which is why the list stops at 50.

```yaml
dashboard:
  recentlyDeployed: 25
```

### `dashboard.timeZone`

Default: `UTC`

The time zone every time on the dashboard is shown in, as an IANA name such as `Europe/Brussels`, `America/New_York` or `Asia/Kolkata`. Without the key the dashboard stays in UTC, byte for byte as before.

The zone belongs to the repo, not the reader: one issue is read by everyone, so it cannot follow a browser. Pick the zone the people who tick live in.

- The line under the Recently deployed heading names the zone, `Times are in Europe/Brussels.`, and the times on the list leave it out.
- A time that stands alone says its offset from UTC at that moment: the scan line (`on 2026-07-21 12:02 UTC+2`), the last full scan, the line about a run waiting for a runner, and the failure line on a row. A January time and a July time of one zone each say their own offset, because daylight saving changes it. A moment when the zone is at UTC, such as London in winter, says `UTC`.
- The markers in the issue keep UTC. Changing the zone moves no row and no hash, and a body written under one zone reads the same under another. A row that the next scan does not draw again keeps its failure line in the zone it was written in, which is why that line says its offset.

A name that is not a zone fails the config with an example of one. An offset such as `+02:00` or `UTC+2` is not a zone name, because it has no daylight saving. The zone is checked against the zone data of the runtime that runs the action. GitHub's runners and the `node24` runtime the action uses carry every zone. A runtime built without zone data knows `UTC` alone, and there any other name fails the config the same way rather than falling back to UTC in silence.

The job summaries, the preview pages and the notifications write no time of their own; GitHub shows the time of a run and a check in each reader's own zone.

```yaml
dashboard:
  timeZone: Europe/Brussels
```

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

A tick rule decides who may **ask** for a deploy. Who may **deploy** is decided by a GitHub Environment with required reviewers on the job that deploys, where you have one: the tick asks, and a reviewer lets the job go on or not. Without one, the tick rule decides both, and its ceiling is everyone who may edit the dashboard issue, because it narrows within write access and never goes beyond it. For a team whose deployers are fewer than its writers, leave `tickers` at its default and put the deploy job in an environment whose reviewers are the people who may deploy. The rule lives in this file and is Sluiceway's own; the environment is GitHub's, lives in the repo's settings and records each approval. [Security](security.md#a-tick-asks-an-environment-decides) has the shape, what each one can and cannot do, and what happens between the tick and the approval. The [check](workflow.md#check-your-setup) says, for each job that deploys, which of the two decides.

The rescan box has no rule of its own. Anyone with write access can tick it, and it only starts a full scan.

The box that deploys every pending stack, and the one that repairs every drifted stack, have no rule of their own either: a tick on them deploys nothing and only asks for a confirmation. A tick on the confirm box is judged as a tick on each row it names, by each stack's own rule, so a stack whose rule refuses you is left out with a line in the comment and the others deploy.

### `deploys`

Default: `true`

`false` stops every deploy from the dashboard, with one reviewed line in a pull request, and without touching the workflow:

```yaml
# Change freeze until the migration is done.
deploys: false
```

- The boxes that deploy every pending or every drifted stack at once are not drawn, and a confirm box that was already there goes ([record 0083](adr/0083-deploy-all-is-a-bulk-box-and-a-confirm-box-and-the-confirm-box-is-a-tick-on-each-row.md)).
- `resolve` clears every ticked box, puts a note on the row that says deploys are turned off, and starts nothing. No deployment record is made, nobody's access is looked up and no comment is written, because nothing could go out whoever ticked. The rescan box still works: a scan deploys nothing.
- A deploy that was ticked before the switch was merged and that starts after it ends before the tool runs. Its deployment record ends as `failure` with the reason "deploys are turned off in sluiceway.yaml", which the row shows as its failure line, the `outcome` output is `refused` and the job is red.
- Scans go on as before, so the dashboard keeps showing what is pending.

Setting it back to `true` (or taking the line out) is all it takes to deploy again. A tick that was cleared needs a fresh tick.

### `ignore`

Default: `[]`

Globs matched against the **stack id**, not the path. An ignored stack has no row, is never previewed, claims no files, and a `stacks` entry cannot give it settings.

> [!WARNING]
> Write the full stack id. The id of a named stack is `<path>:<name>`, so a bare directory matches none of its stacks: `apps/web` ignores nothing, and `apps/web:*` ignores every stack in `apps/web`.

A stack without a name, such as a root module discovery found, has its path as its id, so its bare directory does match it. Globs that end in `*` already cross the colon: `apps/*` matches `apps/web:prod`, and `sandbox*` matches every stack whose id starts with `sandbox`. `*` stops at a slash and `**` crosses slashes. The `check` mode warns about a glob that matches no stack, and names the glob that would work.

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

A file listed here claims nothing even inside a stack's directory, so `**/*.md` keeps a README change from previewing its stack. Never list a file one of your programs reads: its stack would show a stale row until the next full scan.

A few docs and tooling files force nothing without any setting: `**/*.md`, `**/LICENSE*`, `**/.gitignore`, `**/.gitattributes`, `.editorconfig` and `.github/**`. Unlike the list above they only matter where no stack claims the file: a README inside a stack's directory still previews that stack, and a program that reads one of them from elsewhere claims it through its stack's `inputs`. The `check` mode prints a ready-to-paste block for the other files that look like docs, and so does the summary of a push that fell back to a full scan because of files no stack claims, for the files of that push.

```yaml
scan:
  unrelated:
    - "docs/**"
```

Keep `sluiceway.yaml` itself off the list, and lockfiles and package manifests too. A change to one of them should preview every stack, and it does, with a line in the job log that says why, as long as no glob here covers it. The check and the summary of a push leave `sluiceway.yaml` out of the files that no stack claims, and name the lockfiles and package manifests they list as ones to keep off this list.

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

### `drift.enabled`

Default: `false`

Checks every stack for drift, changes made to real infrastructure outside the code, in each scan that a schedule starts, and in a scan that a person starts with "Run workflow". The scans that Sluiceway dispatches itself, after a deploy or for the rescan box, do not check. A stack whose code has nothing to deploy and whose real infrastructure changed gets a row under Drifted, with a box. A pending stack that also drifted shows the drift on its own row. A tick deploys the code as it is, which puts the drift back ([record 0055](adr/0055-drift-is-checked-by-a-scheduled-scan-shown-on-the-stacks-row-and-repaired-by-a-tick.md)).

```yaml
drift:
  enabled: true
```

- **When is the workflow's business.** There is no `drift.schedule`: add a `schedule` trigger to the workflow, and every scan it starts checks drift. A scan that a push starts checks only the stacks whose row showed drift, so known drift is not lost.
- **It costs one more tool run per stack** in those scans, in the same pool slot and with the same time limit as the stack's preview. For Pulumi it is `pulumi refresh --preview-only`, which changes neither the state nor anything real, and from v3.229.0 takes no stack lock, so it never blocks a deploy. For Helm it is two runs: the preview's diff once more, and the same diff with the plugin's `--three-way-merge --no-hooks`, which compares the chart with the live objects. What the second finds beyond the first is drift: a field changed with kubectl, or an object deleted ([record 0069](adr/0069-helm-drift-is-the-three-way-diff-beyond-the-plain-one-and-the-deploy-flags-follow-helm.md)).
- **The deploy of a row with drift reads what is real first.** For Pulumi it runs `pulumi up --refresh`. Helm merges the chart into the live objects on every deploy, and on Helm 4 a release it applies server-side gets `--force-conflicts`, so a field changed with kubectl is taken back. `apply` checks the drift again before it compares the diff hash, so drift that changed after the tick stops the deploy, as a moved change does.
- **What counts as drift is up to the tool.** A resource whose provider cannot read it back never drifts. A field a Helm chart does not set, such as a label added by hand, stays after a deploy and is no drift. OpenTofu stacks are not checked yet.
- **A Kubernetes manifests stack is checked only with [`prune`](#stacksoptionsprune) or [`forceConflicts`](#stacksoptionsforceconflicts).** Its preview compares with the live objects already, so a change made outside the code is on the row anyway: a create for an object someone deleted, a change for a field someone set, or a failed preview for a field another field manager took. The check says which of them came from outside the code: an object the stack's inventory lists that is gone, and, with `forceConflicts`, the fields another field manager set since the deploy. The deploy puts both back and needs nothing more ([record 0070](adr/0070-kubernetes-manifests-stacks-prune-from-an-inventory-of-their-own-and-read-drift-from-the-managed-fields.md)).
- **A drift check that fails** leaves the row as the preview made it, with a warning on the run and the tool's words in the job log.
- **A stack entry can turn it on or off** for its own stacks, with [`stacks[].drift.enabled`](#stacksdriftenabled).
- **A drifted row's `preview` link** opens a preview page that lists the drift, as a pending row's lists its changes. Without `checks: write` it opens the summary.

### `attribution.lookback`

Default: `100`

How many of the newest commits a job walks back from the scanned commit to say which pull requests made a row pending, and what each deploy on the Recently deployed list shipped. A whole number from 1 to 1000. A stack whose last deploy lies further back gets `and earlier changes` on its line, and the compare link still shows the whole range.

Every 100 commits cost one GraphQL request, about 7 points of the workflow token's 1,000 per hour. A job reads the files of at most 100 changes one by one (direct pushes, and pull requests that renamed a file); a change past that counts as a change outside every stack, so a long lookback never hides one.

```yaml
attribution:
  lookback: 300
```

### `attribution.names`

Default: `5`

How many pull requests and direct pushes a row, and a line of Recently deployed, names before the rest is a count (`and 3 more`). A whole number from 0 to 20. `0` names none, and the line always gives the count: `from 4 pull requests · compare`.

```yaml
attribution:
  names: 10
```

### `phases`

Default: `[]`

The names of the phases your stacks deploy in, in order. A stack says which phase it is in with [`stacks[].phase`](#stacksphase), and depends on every stack in every earlier phase: a tick on it waits while one of them has a change waiting that nobody ticked, and ticks across phases deploy one phase after the other, one layer per run, as [`dependsOn`](#stacksdependson) does. A repo that deploys in phases writes three lines instead of an edge for every pair of stacks ([record 0067](adr/0067-a-stack-may-name-its-phase-and-depends-on-every-stack-of-every-earlier-phase.md)).

```yaml
phases: [infrastructure, monitoring, applications]
stacks:
  - path: network
    phase: infrastructure
  - path: grafana
    phase: monitoring
  - path: web
    phase: applications
```

- **A name is a plain word**: letters, digits, `.`, `_` and `-`. Each phase is named once.
- **A phase with no stack is fine.** The phases after it wait on the ones before it all the same.
- **A stack without a phase** neither waits on a phase nor holds one back. `dependsOn` still works for it.
- **The note on a refused tick names the phase**, and at most five of the stacks in it that have a change waiting, not every stack it depends on: `this tick started nothing: it waits on the **infrastructure** phase: **network:prod** has a change waiting.`
- **The check lists the phases** in order, the stacks in each and what each stack depends on through its phase.

### `stacks[].path`

Required in every entry.

The directory of the stack, relative to the repo root, with forward slashes. `.` is the repo root. A leading `./` and a trailing slash are dropped. An absolute path, a backslash and `..` are errors.

A `stacks` entry adds settings to stacks that discovery found. **It never creates a stack**, except an entry with `tool`, which declares one. An entry that matches no stack, or only stacks that `ignore` leaves out, is an error, so a typo cannot pass quietly. Two entries with the same path and name are an error too: put the settings in one entry.

### `stacks[].name`

Default: every stack in the path.

The name of the stack, the part of the stack id after the colon. Without it the entry covers every stack in `path`. When an entry with a name and an entry without one both cover a stack, the entry with the name wins key by key, and `inputs` add up.

### `stacks[].tool`

Default: none, the entry adds settings to stacks that discovery found.

The tool of a stack that discovery cannot find from files alone, or that you want exactly as the entry says. The entry then declares the stack at `path`, and `options` holds that tool's options. A root module that [discovery](#discoveryrootmodules) finds needs no entry, and an entry with a tool at its path takes it over. Four tools take it in this version: `opentofu`, for an OpenTofu root module, `terraform`, for a Terraform root module, `helm`, for a Helm release in a namespace, and `kubectl`, for a directory of Kubernetes manifests or a kustomization. With [`wrapper`](#stacksoptionswrapper), an `opentofu` or `terraform` entry declares a Terragrunt unit or a stack of a CDK for Terraform app instead. Pulumi stacks are found from their files and need no `tool`.

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
  - path: legacy/vpc
    tool: terraform
  - path: live/prod/app
    tool: opentofu
    inputs: [modules/app/**, root.hcl]
    options:
      wrapper: terragrunt
  - path: cdk
    name: prod
    tool: terraform
    options:
      wrapper: cdktf
  - path: apps/web
    tool: helm
    inputs: [charts/web/**]
    options:
      release: web
      namespace: shop
      chart: ../../charts/web
      valuesFiles: [values.yaml, prod.yaml]
  - path: apps/ingress
    tool: helm
    options:
      release: ingress-nginx
      namespace: ingress
      chart: oci://ghcr.io/example/charts/ingress-nginx
      version: 4.11.3
  - path: deploy/web
    tool: kubectl
    options:
      context: prod
      namespace: web
```

An unknown tool, an unknown option or an option of the wrong kind stops every mode, with the same kind of message as any other mistake in the file, such as `stacks[0].tool: unknown tool "pulumi". Known tools: opentofu, terraform, helm, kubectl.`

Sluiceway runs `tofu init` for every directory of the stacks it is about to preview, one directory at a time, before the first preview. Then `tofu plan -refresh=false -out` and `tofu show -json` give the preview, and a tick deploys the plan file that `apply`'s own fresh preview saved and hashed, with `tofu apply` of that file. Install `tofu` in the workflow before Sluiceway, v1.11.0 or newer ([credentials](credentials.md)). A `terraform` stack runs the same commands with `terraform`, v1.14.0 or newer: Terraform and OpenTofu write the same plan JSON, and a recording of each gives the same diff. The stacks of one directory share its init, so they name the same tool and wrapper.

For Helm, Sluiceway runs `helm dependency build` for every local chart that has dependencies, one chart at a time, before the first preview. That includes the local charts a chart depends on through a `file://` repository, each built before the chart that depends on it: helm leaves out the objects of a subchart whose own dependencies were not built, and says nothing. `helm diff upgrade --install --reset-values --dry-run=server --output=structured`, from the [helm-diff](https://github.com/databus23/helm-diff) plugin, gives the preview: the objects the release would add, change and remove, and the path of every field that changes. A tick deploys with `helm upgrade --install --reset-values`, and `--rollback-on-failure` on Helm 4 or `--atomic` on Helm 3, whichever the installed helm knows. Helm saves no plan, so `apply` renders the chart with `helm template` in its fresh preview and once more right before the deploy, and deploys only when both renders are the same. A chart that renders differently every time, such as one with a random value, is refused as a moved change and never deploys. Install helm v3.18.0 or newer and the diff plugin v3.15.11 or newer in the workflow before Sluiceway ([credentials](credentials.md)). The release's namespace must exist, unless [`createNamespace`](#stacksoptionscreatenamespace) lets the deploy make it.

For `kubectl`, Sluiceway renders the stack into one set of manifests: the files of the directory as they are (and of its subdirectories with [`recursive`](#stacksoptionsrecursive)), or what `kubectl kustomize` builds when the directory holds a `kustomization.yaml`. `kubectl diff --server-side` of that set is the preview: the API server runs the apply as a dry run, so a field that cannot change in place, a field another manager owns and an object the server refuses all fail the preview, before anyone ticks. A tick deploys, with `kubectl apply --server-side`, the same set `apply`'s own fresh preview diffed and hashed. Three things to know:

- **Nothing is pruned unless you ask.** Without [`prune`](#stacksoptionsprune), an object taken out of the manifests stays in the cluster, and the row never shows a delete.
- **The namespace must exist**, or the preview fails. Put a `Namespace` in a stack of its own and make the others [depend on it](#stacksdependson).
- **A kustomization that reads files outside its directory**, such as `../base`, claims only its own directory: add the other directories to `inputs`, or a change there gives a full scan.

Install `kubectl` v1.34.0 or newer in the workflow before Sluiceway, and point it at the cluster with `KUBECONFIG` ([credentials](credentials.md)).

### `stacks[].id`

Default: the id derived from `path` and `name`

The id of the one stack the entry covers, in place of the derived one. Every place that names the stack uses it: its row, its deployment records, `ignore`, `dependsOn` and the job log. Use it when a stack moves: give the stack at its new path the id it had, and its row, its deploys and its trail stay with it instead of starting over as a new stack.

```yaml
stacks:
  - path: platform/network   # moved here from network/
    name: prod
    id: network:prod
```

The entry must cover exactly one stack, so give it a `name` when the directory holds more than one. The id is letters, digits and `. _ / : @ + -`, and it must differ from every other stack id, derived or given.

### `stacks[].environment`

Default: `sluiceway`

The environment name on the stack's deployment records, and the GitHub Environment the `apply` job of the [split workflow](split-workflow.md#with-github-environments) names when you use the feature. On its own it is only a label. The records work on every plan, and GitHub lists an environment for every name the records use, so your repo settings show one named `sluiceway` even when you never use the feature.

Give stacks their own environment when the credentials that change things should be locked into a GitHub Environment ([security](security.md)), or when that environment's required reviewers should decide who may deploy them ([a tick asks, an environment decides](security.md#a-tick-asks-an-environment-decides)). Stacks can share an environment.

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

The time limit for one preview of this stack, in whole minutes. It counts from when the preview starts, not while the stack waits for a place in the pool. A preview that runs longer is stopped and the stack gets a preview failure row. `apply` uses it for the fresh preview before a deploy. The deploy itself has no time limit of Sluiceway's unless the `deploy-timeout` input gives it one: set `timeout-minutes` on the `apply` job.

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

- **A tick waits for the stacks it depends on.** A tick on this stack is refused while a stack it depends on has a pending row that nobody ticked: the box is cleared, and a note on the row names that stack. The job stays green. Only a pending row holds a tick back, because only a change that has not gone out can change what this stack reads. A stack that is in sync, or whose preview failed, holds nothing back.
- **Ticks in one chain go out in order.** Tick both and the one it depends on deploys first. The other gets the row `queued behind <stack>` and a deployment record of its own, and deploys once that stack went out. If that deploy fails, the queued stack does not deploy and its row gets a failure line. The same happens when you tick this stack while a stack it depends on is deploying.

Each layer of a chain runs in a workflow run of its own. Sluiceway starts the workflow again when a layer went out, and `resolve` in that run starts the next layer, so the workflow has to run on `workflow_dispatch` as well as on `issues`. [The workflow](workflow.md#stack-dependencies) does.

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

Every id is checked against discovery, because a dependency that could never hold anything back would hold nothing back and never say so. A stack that was not found, one that `ignore` leaves out (with the reason of the `ignore` entry, when it has one), the stack itself and a circle are errors, such as:

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
- stacks[0].dependsOn: expected a list of stack ids, or auto, got "network:prod".
```

#### `dependsOn: auto`

With `auto` in place of the list, a Pulumi stack depends on the stacks its program reads through stack references, such as `new pulumi.StackReference("acme/network/prod")`. Sluiceway reads them at every preview of the stack, so the list follows the code ([record 0059](adr/0059-a-stack-may-read-its-dependencies-from-its-stack-references-and-drift-is-set-per-stack.md)).

```yaml
stacks:
  - path: app
    dependsOn: auto
```

- **A name becomes a stack id by its project.** `organization/project/stack` is the stack of that name whose project file says `name: project`, wherever its directory is. A stack name alone is a stack of the same project. Two parts are `project/stack`, or else `organization/stack` of the same project. The organization is never compared.
- **A reference to a stack this repo does not hold waits on nothing.** Neither does one that `ignore` leaves out, or a name that fits two stacks. The scan's job log says how many there were.
- **What a preview read goes on the stack's row**, in its marker, and `resolve` waits on those stacks as on the ones a list names. A read that would make a circle is dropped, and the job log of `resolve` says which.
- **Until the stack's first preview with `auto`, and while its preview fails,** it waits only on what a list in another entry names. Entries add up: one entry can say `auto` and another a list.
- **Only Pulumi.** An OpenTofu entry with `auto` is an error. The check mode lists `auto` as it is, because it reads files only and cannot know what a preview will read.

### `stacks[].phase`

Default: none.

The phase of the stacks of this entry, one of [`phases`](#phases). The stack then depends on every stack in every earlier phase, and a `dependsOn` list adds to that, also on stacks of its own phase. An entry with a name wins over one without, as for `environment`.

```yaml
phases: [infrastructure, applications]
stacks:
  - path: network
    phase: infrastructure
  - path: app
    phase: applications
    # Inside a phase, name the order by hand.
  - path: cache
    phase: applications
    dependsOn: [app:prod]
```

A phase that `phases` does not list is an error, and so is a `dependsOn` on a stack of a later phase, which would be a circle:

```yaml
# Not valid: a phase that is not listed
phases: [infrastructure, applications]
stacks:
  - path: network
    phase: infrastructure
  - path: app
    phase: aplications
```

```text
sluiceway.yaml is not valid:
- stacks[1].phase: "aplications" is not one of the phases. The phases are: infrastructure, applications.
```

#### `phase: { from }`

A repo that already writes each project's phase into its Pulumi project file, such as `platform:phase: infrastructure` under `config` in `network/Pulumi.yaml`, can point at that key instead of repeating it:

```yaml
phases: [infrastructure, monitoring, applications]
stacks:
  - path: network
    phase:
      from: "platform:phase"
  - path: grafana
    phase:
      from: "platform:phase"
```

- **Where the key is read.** Under `config` in the project file, as text or as a mapping with a text `value` or `default`, and else at the top level of the project file. These are the places Pulumi accepts a key a program does not use. A value marked `secret: true` is never read.
- **Only the text under that key leaves discovery.** Nothing else of the project file is read for it.
- **A stack whose project file has no such key, or whose text is not one of the phases, is an error.** The error names the key and the stack, and does not quote the text.
- **Only Pulumi.** An entry with `tool` that says `from` is an error: name the phase instead.

### `stacks[].drift.enabled`

Default: the top level `drift.enabled`.

Turns the drift check on or off for the stacks of this entry, whatever the top level says. The same scans check as for the top level: one a schedule starts and one a person starts with "Run workflow", and a push only for a stack whose row showed drift. A stack whose setting is off is never checked. An entry with a name wins over one without ([record 0059](adr/0059-a-stack-may-read-its-dependencies-from-its-stack-references-and-drift-is-set-per-stack.md)).

```yaml
drift:
  enabled: true
stacks:
  # A sandbox that changes by hand all day.
  - path: playground
    drift:
      enabled: false
```

It is a mapping, like the top level:

```yaml
# Not valid: true alone
stacks:
  - path: apps/web
    drift: true
```

```text
sluiceway.yaml is not valid:
- stacks[0].drift: expected a mapping, got true. Write it as the top level has it: drift: { enabled: true }.
```

### `stacks[].options.workspace`

Default: the workspace the job's environment selects, which is `default`.

Only with `tool: opentofu` or `tool: terraform`. The workspace of the stack. Sluiceway sets `TF_WORKSPACE` to it for every command of this stack: the plan, the plan's JSON, the tool diff and the deploy. A workspace that the backend does not hold is not an error for every backend: the local backend plans every resource as a create. The row then says so, before anyone ticks.

Named options are the only way to change the tool's command line. Sluiceway never passes free-form arguments to the tool (record 0015). A stack found from its files, such as a Pulumi stack, takes no options.

### `stacks[].options.varFiles`

Default: `[]`

Only with `tool: opentofu` or `tool: terraform`, and not with a `wrapper`. Var files, relative to the directory of the stack, handed to every plan with `-var-file` in this order. `terraform.tfvars` and `*.auto.tfvars` are read by the tool without being listed. A var file outside the directory of the stack is not claimed by it: add it to `inputs` too, or a change to it gives a full scan.

### `stacks[].options.wrapper`

Default: none, the tool runs by itself in the directory of the stack.

Only with `tool: opentofu` or `tool: terraform`. What stands in front of the tool:

- **`terragrunt`**: `path` is one Terragrunt unit, a directory with `terragrunt.hcl` or `terragrunt.hcl.json`. Every command runs as `terragrunt run --tf-forward-stdout --no-color --no-auto-init --tf-path <tofu or terraform> -- <command>` in that directory: `--tf-path` names the entry's tool, whatever `TG_TF_PATH` says, `--tf-forward-stdout` keeps the plan JSON as the tool printed it, and `--no-auto-init` leaves every init to the one Sluiceway runs before the previews. The unit's var files and inputs are in its `terragrunt.hcl`, so the entry takes no `varFiles`. Its code usually lives elsewhere, such as a `modules/` directory and a shared `root.hcl`: add them to `inputs`, or a change there gives a full scan. Sluiceway never runs `terragrunt run --all`, and a `dependency` block does not make a Sluiceway dependency: name it in [`dependsOn`](#stacksdependson). Install terragrunt v1.0.0 or newer.
- **`cdktf`**: `path` is a CDK for Terraform app, a directory with `cdktf.json`, and `name` is required: the name the app gives the stack. Before the previews Sluiceway runs `cdktf synth --output cdktf.out` in the app's directory, once for all its stacks, and then the tool's init in `cdktf.out/stacks/<name>` of each stack at hand. The plan, the tool diff and the deploy run in that directory. The app sets its variables in code, so the entry takes no `varFiles`. The workflow installs cdktf v0.21.0 and whatever the app's language needs, such as `npm ci`. HashiCorp archived CDK for Terraform in December 2025, and v0.21.0 is its last release.

```yaml
stacks:
  - path: live/prod/app
    tool: opentofu
    inputs: [modules/app/**, root.hcl]
    options:
      wrapper: terragrunt
  - path: cdk
    name: prod
    tool: terraform
    options:
      wrapper: cdktf
```

### `stacks[].options.release`

Required with `tool: helm`.

The name of the Helm release, by helm's own rule: lower case letters, digits, `-` and `.`, at most 53 characters. Two stacks in one directory are two releases, told apart by `name`.

### `stacks[].options.namespace`

Required with `tool: helm`. With `tool: kubectl`, default: the namespace of the context.

With `tool: helm`, the namespace of the release, passed with `--namespace` to every command of the stack. It must exist before the first deploy, unless `createNamespace` is on.

With `tool: kubectl`, the namespace of every object that names none, passed with `--namespace` to the preview, the tool diff and the deploy. An object that names another namespace is an error of the tool, so its preview fails.

For both tools a namespace is a DNS label: lower case letters, digits and `-`, at most 63 characters.

### `stacks[].options.chart`

Required with `tool: helm`.

The chart. A local chart is a path relative to the directory of the stack that starts with `./` or `../`, and must hold a `Chart.yaml` inside the repo. A chart outside the directory of the stack is not claimed by it: add it to `inputs`, or a change to it gives a full scan. Anything else is a chart reference: `repo/name` from a repository the workflow adds with `helm repo add`, or `oci://registry/name`.

### `stacks[].options.version`

Default: none. Required with a chart reference.

The exact version of a chart reference, such as `4.11.3`, never a range: the deploy installs the chart the preview saw. A local chart takes none, because the repo holds it.

### `stacks[].options.valuesFiles`

Default: `[]`

Only with `tool: helm`. Values files, relative to the directory of the stack, handed to every command with `--values` in this order, after the chart's own `values.yaml`. Every deploy starts from the chart's values and these files, with `--reset-values`, so nothing a release kept from an earlier deploy by hand stays. A values file outside the directory of the stack is not claimed by it: add it to `inputs` too.

### `stacks[].options.createNamespace`

Default: `false`

Only with `tool: helm`. With `true`, the deploy passes `--create-namespace`, so the first deploy makes the release's namespace when it is not there. The preview works without it: the diff and the render never need the namespace. The namespace is not an object of the release, so the row does not show it ([record 0069](adr/0069-helm-drift-is-the-three-way-diff-beyond-the-plain-one-and-the-deploy-flags-follow-helm.md)).

### `stacks[].options.context`

Default: the current context of the kubeconfig.

Only with `tool: kubectl`. The kubeconfig context of the stack, passed with `--context` to the preview, the tool diff and the deploy, so one repo can deploy to several clusters with one kubeconfig.

### `stacks[].options.recursive`

Default: `false`

Only with `tool: kubectl`, for a directory of manifests. `true` reads the manifests of every subdirectory too, the files `kubectl apply -R -f <dir>` reads, in the order it reads them. A kustomization lists its own files, so `recursive` on a kustomization is an error, and so is a kustomization in a subdirectory: `kubectl -R` would read it as a manifest. Declare such a directory as a stack of its own.

### `stacks[].options.prune`

Default: `false`

Only with `tool: kubectl`. `true` deletes an object taken out of the manifests when the stack deploys, and shows it as a delete on the row before anyone ticks, in the destroy caution block like any other delete.

`kubectl`'s own pruning cannot do this for a server-side apply (it is alpha and refuses such objects), so Sluiceway keeps a list of what the stack deployed: its inventory, one ConfigMap named `sluiceway-` and 16 hex characters, labelled `app.kubernetes.io/managed-by: sluiceway` and annotated with the stack id, in the stack's namespace. It lists every object of the stack by API group, kind, namespace and name, and holds no value. It goes out with every deploy as part of the set, and never shows on the row.

- The preview reads the inventory, and an object it lists that the manifests no longer hold, that is still in the cluster and that the stack's own field manager applied, is a delete. An object that another field manager took over since is left alone.
- The deploy applies the set first and deletes after, so an object that moves to a new name is never missing in between. The inventory keeps listing an object until a preview no longer finds it, so a delete that failed is tried again by the next deploy.
- The first deploy with `prune` writes the first inventory, so an object taken out before then is never pruned: delete it by hand.
- The kubeconfig needs to get and patch the ConfigMap in the stack's namespace (a server-side apply creates and changes it with a patch), and to get and delete every kind the stack deploys.
- Changing the stack's `namespace` or its stack id starts a new inventory, and what the old one listed is never pruned.

### `stacks[].options.forceConflicts`

Default: `false`

Only with `tool: kubectl`. `true` passes `--force-conflicts` to the preview and the deploy, so the deploy takes a field that another field manager holds, such as the replicas `kubectl scale` set by hand. Without it, such a field fails the preview with the conflict, as the deploy would fail. With it, the row shows the field as a change, and every deploy takes it back, from a person and from a controller alike: a Deployment whose replicas an autoscaler sets should not set them in its manifest.

### `stacks[].options.fieldManager`

Default: kubectl's own, `kubectl`.

Only with `tool: kubectl`. The field manager of the preview and the deploy, passed with `--field-manager`: letters, digits, `.`, `_` and `-`, at most 128 characters. A name of the stack's own, such as `sluiceway-web`, keeps a `kubectl apply --server-side` run by hand from counting as the stack's own change, and tells pruning and the drift check which objects and fields are the stack's. On a stack that was deployed with another field manager, the old one keeps holding every field it set, so a later change of such a field fails the preview with a conflict until `forceConflicts` takes it over.

### `discovery.rootModules`

Default: `true`

Find OpenTofu and Terraform root modules from their files, the way Pulumi stacks are found. `false` turns it off for the repo, and every OpenTofu and Terraform stack is then one a `stacks` entry declares, as before this key existed.

Discovery reads every directory of `*.tf`, `*.tofu`, `*.tf.json` and `*.tofu.json` files, and never starts the tool or asks a backend. It skips directories whose name starts with a dot, such as `.terraform` and `.terragrunt-cache`, and `node_modules` and `cdktf.out`. A directory is found as a stack when all of this holds, and the first thing that does not hold is the reason the `check` gives for leaving it out:

1. **No `stacks` entry with a tool names it.** Such a directory is the entry's.
2. **No other directory uses it as a local module source**, `source = "../network"` or `source = "./modules/vpc"` in a `module` block. This is the signal trusted most: it is the repo saying the directory is a module.
3. **It does not sit under a directory named `modules`.** That only leaves directories out. A directory next to a `modules` directory is not a root module for that.
4. **A `terraform` block has a `backend` or a `cloud` block.** Only a root module chooses where its state lives, and a root module that keeps its state on the runner would lose it after the deploy. An empty `backend "s3" {}` counts: the rest can come from the environment.
5. **It is built for one workspace.** Code that reads `terraform.workspace`, or a `cloud` block that picks its workspaces by `tags`, means the root module runs in workspaces its files do not name.
6. **No var file or backend file chooses anything.** A `*.tfvars` file other than `terraform.tfvars` and `*.auto.tfvars`, or a `*.tfbackend` file, in the directory or in a subdirectory that holds only such files (the `env/dev.tfvars` layout), is loaded only when a command names it, and which one a stack takes is yours to say.
7. **Its files say which tool runs it.** A `.terraform.lock.hcl` whose providers come from `registry.opentofu.org` means OpenTofu, from `registry.terraform.io` Terraform. `.tofu` files mean OpenTofu, which is the only one that reads them. Files that say both, or neither, are no stack: running the wrong one can upgrade the state past what the other reads.

A repo with a `terragrunt.hcl`, `terragrunt.hcl.json` or `terragrunt.stack.hcl` anywhere finds no root module at all: its stacks are its units, [declared](#stacksoptionswrapper) with `wrapper: terragrunt`, and the modules they run often carry an empty backend block. A CDK for Terraform app is declared too, because its stacks exist only in its program.

A found root module is one stack in the default workspace: no name, its path as its stack id, no var files and no `TF_WORKSPACE`. It is planned once and deployed from the saved plan, exactly like a declared one. To run it in another workspace or with var files, declare it: the entry takes the directory over.

Everything else in this file works on a found stack as on any stack: a `stacks` entry without `tool` gives it settings, and `ignore` leaves it out by its stack id.

```yaml
# Leave one found directory out, and say why on the dashboard.
ignore:
  - glob: bootstrap
    reason: Applied once by hand when the account was made
# Declare one discovery left out, in two workspaces.
stacks:
  - path: envs/app
    name: dev
    tool: opentofu
    options:
      workspace: dev
  - path: envs/app
    name: prod
    tool: opentofu
    options:
      workspace: prod
```

```yaml
# Only what stacks declares, as before.
discovery:
  rootModules: false
```

The rule can be wrong in one direction it cannot see: a shared module that another repo uses by a Git address, with a backend block and a lock file of its own, and nothing in this repo that calls it. The `check` shows it as found. Leave it out with `ignore`, or move it under `modules/`.

### `mergeAndDeploy.authors`

Default: `[]`

Logins whose open pull requests may be merged and deployed with one tick, such as `renovate[bot]` or `dependabot[bot]`. Empty turns merge and deploy off. An app is written with `[bot]`: `renovate` without it is a person's account, and is never read as the app.

A pull request by an author on the list is listed under "Updates waiting to merge", above Pending, when all of this holds:

- It is not a draft and merges into the default branch.
- The combined checks of its head commit are green. A pull request with no checks at all is not listed.
- It does not conflict with its base.
- A stack claims every file it changes, by the same rule a push uses (`inputs` included). Files `scan.unrelated` matches are left out. A pull request that two or more stacks claim is listed with every one of them, and one tick deploys each on its own record, unless one of those stacks depends on another (`dependsOn` or `phases`): one tick would then deploy them side by side. A pull request that changes a file no stack claims, or more than 100 files, or renames a file, is not listed.

Every one that qualifies is listed, oldest first, and all after the first 10 sit in a fold. The oldest 30 are always there. Past those, the body lists as many as fit its size target before any row of a stack is shortened, and the job log counts the rest, which are listed as the older ones merge. The open pull requests are read 100 at a time, all of them, which costs one request per 100 open pull requests on every scan. The row shows the stacks, the title of the pull request (left out when `dashboard.redact` is on) and its number and author, and with [`mergeAndDeploy.preview`](#mergeanddeploypreview) what the merge would change.

A tick merges the pull request at the commit the row showed, with the merge method Renovate would use. Sluiceway reads Renovate's config as Renovate does on GitHub: the first of `renovate.json`, `renovate.jsonc`, `renovate.json5`, the same three under `.github/`, `.renovaterc`, `.renovaterc.json`, `.renovaterc.jsonc`, `.renovaterc.json5` and the `renovate` key of `package.json`, as JSON5, with the presets in `extends`. A preset in this repo is read from the checkout. A preset of another GitHub repo (`github>owner/repo`, `local>owner/repo` or `owner/repo`, with `:name`, `:file/preset` or `//path/name`), and one at a tag (`#v1`), is read through the GitHub API with the workflow token, so it has to be public or in this repo. Its `automergeStrategy` is used when the repo allows it: `squash`, `rebase` or `merge-commit`. Otherwise, and for `auto` and `fast-forward`, the method is the first the repo allows of squash, a merge commit and rebase, as Renovate picks it. A preset from npm or a web address, one with parameters, and `packageRules` are not read, and the job log of `resolve` names the presets it skipped. Branch protection and required reviews stay in force: when GitHub refuses the merge, the ticker gets a comment with GitHub's words. The merge starts the scan after a merge, which previews the stack on the merged code and hands exactly that diff to `apply`, which previews again and deploys only if nothing moved. That scan is narrowed to what changed since the last scan when the workflow declares the `sluiceway-merged` input, and full otherwise. The tick rule of the stack is the tick rule of its pull requests. A pull request of several stacks needs the tick rule of every one of them.

A pull request that qualifies in every way but its checks, because they have not all finished, gets a line with no box under the rows of the section: `- **apps/odoo:prod** · Update Helm release odoo to v17.0.4 · #1137 by renovate[bot] · waits on its checks`. A check that runs for days, such as Renovate's `renovate/stability-days`, keeps it there all that time, so the dashboard shows why a routine update is not offered yet. The line gets its box once every check is green, and goes when a check fails or the pull request stops qualifying, for example after a commit that changes a file no stack claims. The oldest 10 are shown and the job log names the rest. The lines count toward none of the section's numbers: not the 10 before the fold, not the fold's count and not the 30 that always stay. A pull request whose checks failed, or with no checks at all, gets no line, and neither does one that would not qualify once its checks are green. With nothing to offer and nothing waiting, the section is not there.

Nothing is listed on a read-only dashboard or while `deploys` is `false`. The workflow needs more than the default: [Merge and deploy](workflow.md#merge-and-deploy) has what to add.

```yaml
mergeAndDeploy:
  authors:
    - renovate[bot]
```

### `mergeAndDeploy.preview`

Default: `false`

With `true`, every scan that lists updates waiting to merge also previews each of the oldest 30 as it would be after the merge, and the row says what that would change, in the counts a stack's row uses: `preview after the merge: 1 update, **1 replace**`, `no changes`, or that the preview failed. For a pull request of several stacks each stack gets its counts.

The preview runs in a copy of the checkout, in the runner's temporary directory, with the files the pull request changes as they are at its head commit, read through the GitHub API. The copy is removed after. So it previews the pull request on top of the code the scan checked out, which is what the merge would give. It costs one extra preview per stack of each update on every such scan, and one request per changed file.

The preview runs the pull request's code with the credentials of the job that scans, the way the scan after the merge would. That is why only the authors on the list are previewed, and a pull request whose branch lives in a fork never is. The preview is for reading: the tick still merges the commit the row showed, and what deploys is the diff the scan after the merge previews.

```yaml
mergeAndDeploy:
  authors:
    - renovate[bot]
  preview: true
```

### `notify.events`

Default: `["pending","drift","failed","refused"]`

The events Sluiceway sends a notification on, to each channel the step names in its inputs: `slack-webhook-url`, `telegram-bot-token` with `telegram-chat-id`, and `webhook-url`, each from a secret of your repo ([notifications](notifications.md)). Without a channel on the step this key does nothing.

- `pending`: a scan left stacks pending that were not pending before it, with a link to the dashboard. A stack that stays pending is not news again.
- `drift`: a scan found drift on stacks that showed none before it.
- `deployed`: a tick deployed a stack. Left out by default: the person who ticked is watching.
- `failed`: a deploy failed.
- `refused`: a tick deployed nothing, because the tick rule refused it or the change moved since the tick.

An empty list sends nothing, which turns notifications off with one reviewed line. Each event is written once. An event that is not one of the five is an error.

```yaml
notify:
  events: [pending, failed, refused, deployed]
```

## What the file does not hold

- **No credentials and no environment variables.** Your workflow puts them into the job environment before Sluiceway runs ([credentials](credentials.md)).
- **No notification channels.** A Slack webhook address, a Telegram bot token and a webhook address are secrets, so they are inputs of the step, read from your repo's secrets. A channel written under `notify` is an error that says so.
- **No `concurrency` or `preview-timeout`.** They belong to the runner, so they are inputs of the action. Without `concurrency` the scan runs one preview for each core of the runner, up to 8, so the same repo scans well on a small runner and a large one without a change here ([reference](reference.md#inputs)).
- **No list of stack ids.** Every id is derived from its path and name, unless a `stacks` entry gives one with [`id`](#stacksid).
- **No teams** in a tick rule. Not in this version.

A typo gets the list of keys that are allowed:

```yaml
# Not valid: a typo
ticker: admin
```

```text
sluiceway.yaml is not valid:
- unknown key "ticker". Known keys here: dashboard, tickers, deploys, ignore, scan, drift, attribution, phases, stacks, discovery, mergeAndDeploy, notify.
```
