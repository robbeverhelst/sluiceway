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

Keep resource types, resource names and property names out of the issue. A redacted row shows the stack id, the counts by op, the destroy warning, the failure line and a link to the run's summary, which stays full. Values are never shown either way.

Redact is about reach, not access. An issue body is emailed, sent to integrations and indexed on a public repo. A job summary sits behind a click. But anyone who can read the repo can open the run and read the code that names the resources. **It is not access control.** Turning it on or off never voids a tick: the diff hash covers the whole diff either way.

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

### `ignore`

Default: `[]`

Globs matched against the **stack id**, not the path. An ignored stack has no row, is never previewed, claims no files, and a `stacks` entry cannot give it settings.

Because the id is `<path>:<name>`, a bare directory matches nothing. `apps/web` ignores nothing, and `apps/web:*` ignores every stack in `apps/web`. Globs that end in `*` already cross the colon: `apps/*` and `sandbox*` work as you would expect. `*` stops at a slash and `**` crosses slashes. The `check` mode warns about a glob that matches no stack, and names the glob that would work.

A stack config file with no stack in the backend is the usual reason to ignore one:

```yaml
ignore:
  - "apps/web:dev"
```

### `scan.unrelated`

Default: `[]`

Globs for files that claim nothing and force nothing. A push previews only the stacks that claim a changed file (a narrowed scan), and a changed file that no stack claims makes it a full scan. That is the safe side, because Sluiceway cannot know what your programs read. List here the files that no program reads, so that changing them costs no preview at all.

A file listed here claims nothing even inside a stack's directory, so `**/*.md` keeps a README change from previewing its stack. Never list a file one of your programs reads: its stack would show a stale row until the next full scan. There are no defaults. The `check` mode prints a ready-to-paste block for the files that look like docs and tooling.

```yaml
scan:
  unrelated:
    - "**/*.md"
    - "docs/**"
    - ".github/**"
    - "LICENSE*"
```

Keep `sluiceway.yaml` itself off the list, and lockfiles and package manifests too. A change to one of them should preview every stack, and it does, with a line in the job log that says why, as long as no glob here covers it.

### `stacks[].path`

Required in every entry.

The directory of the stack, relative to the repo root, with forward slashes. `.` is the repo root. A leading `./` and a trailing slash are dropped. An absolute path, a backslash and `..` are errors.

A `stacks` entry adds settings to stacks that discovery found. **It never creates a stack.** An entry that matches no stack, or only stacks that `ignore` leaves out, is an error, so a typo cannot pass quietly. Two entries with the same path and name are an error too: put the settings in one entry.

### `stacks[].name`

Default: every stack in the path.

The name of the stack, the part of the stack id after the colon. Without it the entry covers every stack in `path`. When an entry with a name and an entry without one both cover a stack, the entry with the name wins key by key, and `inputs` add up.

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

### `stacks[].options`

Default: `{}`

Named options for the tool's adapter. None exist in this version, so the only valid value is an empty mapping. Sluiceway never passes free-form arguments to the tool.

## What the file does not hold

- **No credentials and no environment variables.** Your workflow puts them into the job environment before Sluiceway runs ([credentials](credentials.md)).
- **No `concurrency` or `preview-timeout`.** They belong to the runner, so they are inputs of the action.
- **No stack ids.** They are derived.
- **No teams, no `dependsOn` and no `drift`.** Not in this version:

```yaml
# Not valid: not in this version
stacks:
  - path: apps/web
    dependsOn:
      - network
```

```text
sluiceway.yaml is not valid:
- stacks[0]: "dependsOn" is not in this version of Sluiceway yet. Remove it.
```

A typo gets the list of keys that are allowed:

```yaml
# Not valid: a typo
ticker: admin
```

```text
sluiceway.yaml is not valid:
- unknown key "ticker". Known keys here: dashboard, tickers, ignore, scan, stacks.
```
