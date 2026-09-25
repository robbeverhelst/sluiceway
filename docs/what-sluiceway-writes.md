# What Sluiceway writes

Sluiceway writes three things that a script, another tool or an agent can read: the **markers** in the dashboard issue, the **payload of each deployment record**, and the **result file** of a scan or a deploy, with the step outputs beside it. Together they are Sluiceway's published shape, and this page is their contract. What it documents keeps its meaning under the rule below, and what it leaves out may change in any release (record 0096).

None of the three holds a secret or any of the tool's own words. The markers and the deployment records hold no property value either: a value fingerprint is a hash of sixteen hex characters, never a value. The result file holds one only where your repo asks for it: the old and new value at a path listed in [`dashboard.showValues`](configuration.md#dashboardshowvalues), never one the tool marks secret. The markers sit in an issue, which everyone who can read the repo can read, and on a public repo that is everyone. Everything on this page is public in the same way.

Every example on this page comes from a run: a scan of the example project, a tick, and a deploy that went out and one that failed, with what the real Pulumi CLI printed (`bun run example:written`), and from the [example dashboard](../assets/example-dashboard.md). A test fails when the page and the code disagree.

## The rule

Each of the three has a version: `v` on the root marker, `v` in the payload, and `version` in the result file. All three are `1`.

- **New things may appear in any release without a new version**: a key on a marker, a marker kind, a row state, a key in the payload, a field in the result file, an output. Read what you know and pass over the rest.
- **A key or field documented here keeps its meaning** for as long as its version stands. An optional one may be absent, also on what an older release wrote.
- **A change that would make a reader misread raises the version.** Where it is cheap, Sluiceway then writes both versions for at least one minor release, such as a second result file. A body and a payload have room for one version, so there the release notes say it ahead.
- **A reader of an older version stops, and does not guess.** Check the version first, and treat one you do not know as nothing to read. Sluiceway itself does the same: a writer that meets another marker version leaves the body alone, and a record whose payload is not `v: 1` is not read at all.

The published schemas are strict: they name every field this version writes and no other, so a file or payload with a field that came later fails them. Take the schema from the release tag of the version you run, or ignore fields you do not know rather than validating strictly.

## The GitHub API version

Sluiceway reads and writes all three through GitHub's REST and GraphQL APIs, and every request names the REST API version `2026-03-10` in the `X-GitHub-Api-Version` header. A request that names no version runs under GitHub's default, `2022-11-28`, which GitHub supports until 10 March 2028, so a script beside Sluiceway can name the same version to read what Sluiceway read.

The dashboard body is written with GitHub's issue update, one call per write, so each write is one entry in the issue's edit history. The tick rule reads the ticker from that history (record 0025), and a reader of it can count on the same.

## The markers

A marker is an HTML comment in the dashboard body, `<!-- sluiceway:<kind> key="value" ... -->`. GitHub does not show it. The marker is the fact, and the text next to it is only presentation: it may be reworded, restyled or moved in any release. Never parse the visible text.

- **Where it sits.** The root marker is the first line of the body. Every other marker sits at the end of its line, after a list item's `- ` and, where there is one, its box `[ ]` or `[x]`. A line is one regex, anchored on the start of the line and the marker at its end.
- **A row block** is every line from the one that ends in a row marker through the one that holds `<!-- /sluiceway:row -->`, the row's last line.
- **Where a row sits says nothing.** A row block may sit under its section's heading, in a fold, or in the one closed fold of the sections a repo turned off with the [layout keys](configuration.md#dashboardsections), and the order of the sections is the repo's own. Every row block is in the body at every setting and its marker is the same, so find rows by their markers, never by the heading above them.
- **Values** are percent-encoded as UTF-8 bytes with upper case hex, for `%`, `"`, `<`, `>`, and every byte up to `0x20` and `0x7F`. Nothing else is encoded, so `apps/grafana:prod` reads as itself. Decode any run of `%XX`.
- **A list** of stack ids is one value, split on commas. An id escapes `,` as `%2C` and `%` as `%25` before the value is encoded.
- **Key order is fixed** so the body is byte for byte the same between runs, but do not depend on it. A key that is absent has its default: a count of 0, `false`, no hash.
- **Times** are ISO 8601 in UTC, whatever [`dashboard.timeZone`](configuration.md#dashboardtimezone) is.

The dashboard is the issue with the `sluiceway` label (or [`dashboard.label`](configuration.md#dashboardlabel)), written by `github-actions[bot]`, whose first line is a root marker.

### The root marker

| Key | Meaning |
|---|---|
| `v` | The marker version, `1`. Stop reading when it is another |
| `scan-sha` | The commit the last scan checked out |
| `scan-run` | The id of the workflow run of the last scan |
| `scan-at` | When the last scan ran |
| `full-scan-at` | When the last full scan ran. Absent until there was one |
| `full-scan-run` | The id of the workflow run of the last full scan |

<!-- example: root-marker -->
```md
<!-- sluiceway:dashboard v="1" scan-sha="0123456789abcdef0123456789abcdef01234567" scan-run="4242" scan-at="2026-09-21T06:00:00.000Z" full-scan-at="2026-09-21T06:00:00.000Z" full-scan-run="4242" -->
```
<!-- /example -->

### A row

One row per stack. Its state says where the row sits and is counted, and nothing more: no step of Sluiceway decides anything from it, and a deploy is always held to a fresh preview.

| Key | Meaning |
|---|---|
| `stack` | The stack id |
| `state` | `pending`, `deploying`, `queued`, `preview-failed`, `drift` or `in-sync`. A state you do not know: pass over the row. `preview-failed` is also the row `settle` writes for a deploy it ended, with its failure line, until the next scan previews the stack ([record 0113](adr/0113-settle-writes-the-row-of-a-deploy-it-ended-with-the-failure-line.md)) |
| `hash` | The diff hash of what the row shows, 16 hex characters. Only on a row rendered from a diff |
| `destroys` | How many deletes and replaces the diff holds |
| `deletes` | How many of the destroys are deletes. Written whenever `destroys` is. Absent on a row written before the key came |
| `failed` | `true` when the row carries a failure line: a deploy failed and no later one cleared it |
| `drift` | `true` when the hash covers drift, found in a scan that checked it |
| `gone` | On a drifted row, how many resources were found gone outside the code |
| `changed` | On a drifted row, how many resources were found changed outside the code ([record 0110](adr/0110-the-row-marker-carries-its-counts-and-what-a-queued-row-waits-behind-and-the-example-is-data.md)). Absent on a row written before the key came |
| `depends-on` | For a stack with `dependsOn: auto`, the stack ids its preview read from its stack references |
| `fingerprint` | The value fingerprint, 16 hex characters over the values of the diff that the row does not show ([record 0102](adr/0102-a-tick-covers-the-values-it-does-not-show-through-a-value-fingerprint.md)). Only on a pending or drifted row whose diff holds any, and only while `valueFingerprint` is on for the stack |
| `policy` | `failed` when a policy of the repo failed on the change, so the row has no box ([record 0106](adr/0106-policies-run-against-the-preview-and-a-hard-failure-takes-the-box-off-the-row.md)). A tick on such a row is refused. Absent otherwise |
| `creates` | On a pending row, how many creates the diff holds (record 0110). Each of the four counts is absent at 0, and on a row written before the keys came |
| `updates` | How many updates |
| `replaces` | How many replaces. The same number as `destroys` less `deletes` |
| `tracking` | How many changes only touch the tool's record of a resource: an import, a forget or a move, with no op |
| `behind` | On a queued row, the stack ids it waits behind, as its deployment record's `behind` names them (record 0110). Absent on a row that waits for its deploy window alone, and on a row written before the key came |

A pending row from the run, the whole block:

<!-- example: row-block -->
```md
- [ ] **network:dev** · 4 creates · [preview](https://github.com/acme/infra/runs/106538952701) <!-- sluiceway:row stack="network:dev" state="pending" hash="378429630657b00c" fingerprint="fa5c9bfcd54da64a" creates="4" -->
  not deployed from this dashboard yet
  <details><summary>4 changes</summary>
  <kbd>create</kbd> <code>command:local:Command</code> <b>banner</b><br>
  <kbd>create</kbd> <code>local:index/file:File</code> <b>notes</b><br>
  <kbd>create</kbd> <code>random:index/randomPet:RandomPet</code> <b>name</b><br>
  <kbd>create</kbd> <code>random:index/randomString:RandomString</code> <b>subnet</b><br>
  </details>
  <!-- /sluiceway:row -->
```
<!-- /example -->

Row markers of the example dashboard: deploying, queued behind the deploying one, pending with an update and a create, pending with a replace, pending with deletes and a tracking change, drifted with a resource changed, drifted with a resource gone, and in sync:

<!-- example: row-markers -->
```md
<!-- sluiceway:row stack="apps/api:prod" state="deploying" -->
<!-- sluiceway:row stack="apps/worker:prod" state="queued" behind="apps/api:prod" -->
<!-- sluiceway:row stack="apps/billing:prod" state="pending" hash="1d0a03db50bc7070" creates="1" updates="1" -->
<!-- sluiceway:row stack="infra/network:prod" state="pending" hash="32cbe8fae705b3a9" destroys="1" deletes="0" updates="1" replaces="1" -->
<!-- sluiceway:row stack="apps/legacy-worker:prod" state="pending" hash="63a63bc225aca792" destroys="3" deletes="3" tracking="1" -->
<!-- sluiceway:row stack="monitoring/grafana:prod" state="drift" hash="3317badb7e6c946b" drift="true" changed="1" -->
<!-- sluiceway:row stack="platform/external-dns:prod" state="drift" hash="78b602d7bc070d24" drift="true" gone="1" -->
<!-- sluiceway:row stack="apps/auth:prod" state="in-sync" -->
```
<!-- /example -->

#### Drawing a row from its marker

The markers hold enough to draw every row's first line without the diff: the state, the counts, what a queued row waits behind, and whether a failure line rides on it. Two things a row shows are on no marker, on purpose, and a reader that draws a row writes a fixed sentence of Sluiceway's own in their place (record 0110):

- **The reason a deploy failed** is the description of the `failure` or `error` status on the deployment record, which is not part of this page. A failure line drawn from the facts alone reads `the reason is on the deployment record`.
- **The reason a preview failed** is in the summary of the run and in the [result file](#a-preview), not on the row's marker. A preview failure row drawn from the facts alone reads `the reason is in the summary of the run`.

Both sentences are on the fixed list of reasons (record 0022), so they keep their meaning like a documented key. The renderer draws them as any other reason:

<!-- example: drawn-rows -->
```md
- **apps/web:staging** · preview failed: the reason is in the summary of the run · [run](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="apps/web:staging" state="preview-failed" -->
  <!-- /sluiceway:row -->
- apps/web:prod <!-- sluiceway:row stack="apps/web:prod" state="in-sync" failed="true" -->
  :x: last deploy failed: the reason is on the deployment record · ticked by bob · 2026-09-20 16:40 UTC · [run](https://github.com/example-org/infra/actions/runs/17029855012)
  <!-- /sluiceway:row -->
```
<!-- /example -->

The example dashboard is also data: `scripts/example-dashboard.ts` exports its rows, trail and outside deploys as `EXAMPLE`, and `exampleBody` draws the whole body from them under any setting, so a reader redraws the example with the renderer instead of taking it through these markers.

### An update waiting to merge

A pull request that one tick merges and deploys ([merge and deploy](workflow.md#merge-and-deploy)).

| Key | Meaning |
|---|---|
| `pr` | The number of the pull request |
| `stack` | The stack ids its files are claimed by, one deploy each |
| `head` | The commit at its head. A tick approves merging exactly that commit |

<!-- example: merge-row -->
```md
- [ ] **platform/ingress-nginx:prod** · Update Helm release ingress-nginx to v4.13 · #519 by renovate&#91;bot&#93; · preview after the merge: 1 update <!-- sluiceway:merge pr="519" stack="platform/ingress-nginx:prod" head="32d634bb4e4fcf75f93bccbc43860dc17b62c088" -->
```
<!-- /example -->

### An update waiting on its checks

The same kind of pull request, while its checks run. It has no box.

| Key | Meaning |
|---|---|
| `pr` | The number of the pull request |
| `stack` | The stack ids it would deploy |

<!-- example: waiting-line -->
```md
- **apps/web:prod** · Update dependency next to v15.5 · #521 by renovate&#91;bot&#93; · waits on its checks <!-- sluiceway:waiting pr="521" stack="apps/web:prod" -->
```
<!-- /example -->

### A bulk box

A box that deploys every row of a section at once. After a tick it becomes a confirm box with the same kind and section, which a second tick confirms.

| Key | Meaning |
|---|---|
| `section` | `pending` or `drift` |

<!-- example: bulk-box -->
```md
- [ ] Deploy all 4 pending stacks <!-- sluiceway:bulk section="pending" -->
```
<!-- /example -->

<!-- example: confirm-box -->
```md
- [ ] **Confirm:** repair all 2 drifted stacks: **monitoring/grafana:prod**, **platform/external-dns:prod** · asked by carol <!-- sluiceway:bulk section="drift" confirm="carol" stacks="monitoring/grafana:prod,platform/external-dns:prod" hashes="3317badb7e6c946b,78b602d7bc070d24" scan-run="17034455121" -->
```
<!-- /example -->

### The rescan box

A tick starts a full scan. The marker has no keys. A read-only dashboard has none, and neither does one with [`dashboard.rescanBox: false`](configuration.md#dashboardrescanbox).

<!-- example: rescan-box -->
```md
- [ ] Rescan all stacks <!-- sluiceway:rescan -->
```
<!-- /example -->

### A deploy outside the dashboard

A line of the trail that a full scan found in the tool's own history.

| Key | Meaning |
|---|---|
| `stack` | The stack id |
| `kind` | `deploy` or `destroy` |
| `at` | When it ended, by the clock of the machine that ran it |
| `commit` | The commit that was checked out, whole. Absent when the tool did not record one |
| `dirty` | `true` when the checkout held changes that are in no commit |

<!-- example: outside-line -->
```md
- 🟢&nbsp;data/postgres:prod · deployed outside the dashboard, from [`35bf0b7`](https://github.com/example-org/infra/commit/35bf0b7251cdfd47085dc72ea2ba4c6aff3b7237) · 09-21 09:30 <!-- sluiceway:outside stack="data/postgres:prod" kind="deploy" at="2026-09-21T09:30:18.000Z" commit="35bf0b7251cdfd47085dc72ea2ba4c6aff3b7237" -->
```
<!-- /example -->

## The deployment record

A tick creates a GitHub deployment record for the stack before anything deploys, and the record is the only place Sluiceway keeps what a preview cannot work out again: that a deploy is running, who ticked it, and how it ended. It is also the lock. While a stack's newest record has no result, the stack is deploying, its row has no box, and a second tick is dropped.

| Field | Meaning |
|---|---|
| `task` | `sluiceway:<stack id>`. Only records with this prefix are Sluiceway's |
| `environment` | The stack's [`environment`](configuration.md#stacksenvironment), else `sluiceway`. A label |
| `sha` | The commit of the default branch the deploy ran on |
| `payload` | The facts below |

Statuses, newest last: `queued` when the tick is taken, `in_progress` when the deploy starts, then one result. `success` means that afterwards the stack was at the approved hash, also when there turned out to be nothing to deploy. `failure` and `error` mean it did not go out as approved. `inactive` after a `success` means a later deploy superseded it. `inactive` without one means nothing was deployed under this record: a rehearsal, a queued record started again in a later run, one that waited for its deploy window and was started the same way, or a merge record. A record with no status yet, or one this list does not name, is open. The description of a status is presentation, like the text of a row. GitHub keeps only the newest status of a record after 90 days.

The record of the run, and the statuses the deploy gave it:

<!-- example: record -->
```json
{
  "task": "sluiceway:network:dev",
  "environment": "sluiceway",
  "sha": "0123456789abcdef0123456789abcdef01234567",
  "payload": {
    "v": 1,
    "hash": "378429630657b00c",
    "ticker": "alice",
    "run": "5151",
    "attempt": "1",
    "fingerprint": "fa5c9bfcd54da64a"
  },
  "statuses": [
    {
      "state": "queued",
      "description": ""
    },
    {
      "state": "in_progress",
      "description": ""
    },
    {
      "state": "success",
      "description": ""
    }
  ]
}
```
<!-- /example -->

### The payload

Its schema is [`schema/deployment-payload.schema.json`](../schema/deployment-payload.schema.json). Sluiceway checks every payload against it before writing one.

| Key | Meaning |
|---|---|
| `v` | The payload version, `1`. A record of another version is not Sluiceway's to read |
| `hash` | The diff hash the tick approved. The deploy goes out only when a fresh preview gives the same hash |
| `ticker` | The login of whoever ticked, plain. On a [deploy on merge](configuration.md#stacksdeploy), whoever merged |
| `run` | The id of the workflow run that deploys. The record stays open as long as that run does |
| `attempt` | The attempt of that run which created the record. Absent on a record written before the key came |
| `behind` | A queued record: the stack ids it waits behind |
| `drift` | `true` when the hash covers drift, and the deploy puts the drift back |
| `onMerge` | `true` on a record that the scan of a merge opened for a stack set to deploy on merge |
| `fingerprint` | The value fingerprint the tick approved. The deploy goes out only when a fresh preview gives the same one, or none. Absent on a record written before the key came, or with `valueFingerprint` off for the stack |
| `window` | `true` on a queued record that waits for the stack's [deploy window](configuration.md#deploywindowsdays) and for no stack. A run inside the window starts it under a record of its own, and this one ends as `inactive` |
| `merge` | The pull request a tick merged. Such a record has no hash and never deploys itself: the scan after the merge opens the record that does |

A tick from the run, then records of a queued stack, a drift repair, a deploy on merge, a deploy that waits for its window and a merge, one per line:

<!-- example: payloads -->
```json
{"v":1,"hash":"378429630657b00c","ticker":"alice","run":"5151","attempt":"1","fingerprint":"fa5c9bfcd54da64a"}
{"v":1,"hash":"1d0a03db50bc7070","ticker":"alice","run":"17034455121","attempt":"1","behind":["infra/network:prod"]}
{"v":1,"hash":"3317badb7e6c946b","ticker":"carol","run":"17034455121","attempt":"1","drift":true}
{"v":1,"hash":"ec5ef272e21b14c0","ticker":"erin","run":"17034455121","attempt":"1","onMerge":true}
{"v":1,"hash":"9b7e1f3c5d2a4068","ticker":"frank","run":"17034455121","attempt":"1","window":true}
{"v":1,"ticker":"dave","run":"17034455121","attempt":"1","merge":519}
```
<!-- /example -->

The REST API gives the payload as JSON. GraphQL gives it as a string that holds the JSON text of a JSON string, so decode it twice there.

### Opening a record yourself

Something other than Sluiceway can open a record in this shape, and the workflow then deploys it (record 0109), when the repo lets it: [`recordWriters`](configuration.md#recordwriters) in `sluiceway.yaml` lists the logins whose records go on, and the login is the one GitHub records as the creator of the deployment, never a name in the payload. With the list empty, which is the default, every such record is left alone and the job log says so. Create the deployment for the stack, in the stack's environment, with the `task` above, `auto_merge: false`, no required contexts, and a payload of `v`, `hash` (the diff hash on the row's marker), `fingerprint` (the value fingerprint on the same marker, when the row has one; without it a row whose values are hidden is refused as moved), `ticker` (a login; it is your word, and the row and the trail show it) and `run`. The `run` is the id of a run you start with `workflow_dispatch`, so dispatch first, take the run's id from GitHub's answer (`workflow_run_id`, which API version `2026-03-10` always gives), then open the record before that run's `resolve` reads the records. With the concurrency group's queue there is usually time, and a record that comes late is ended by a later render as one whose run is over. `resolve` in that run hands the record to `apply`, which previews the stack again and deploys only when the fresh preview gives the same hash and fingerprint, exactly as for a tick; a record the preview does not match ends as `error` and deploys nothing. A run that deployed such records and nothing else skips its scan, because the deploy wrote its own row. A record with `behind`, `window` or `merge`, one of a stack Sluiceway does not know, and one whose stack has a newer record are left alone. It takes `deployments: write` and `actions: write` on the repo. The tick rule is not asked, because an app has no access level for it to read: the list is the repo's reviewed word on who may open records.

## The result file and the outputs

A `scan` and an `apply` write a result file under `RUNNER_TEMP`, `sluiceway-scan-result.json` or `sluiceway-apply-result.json`, and set the step output `result-file` to its path. Its schema, for both files, is [`schema/result-file.schema.json`](../schema/result-file.schema.json), and Sluiceway checks every file against it before writing one. The file holds what the job summary holds. Sluiceway sends it nowhere, and the runner removes it when the job ends.

| Mode | Result file |
|---|---|
| `scan` | The scan's, on every way out once it wrote its first summary, also on a red scan |
| `apply` | The apply's, on every way out |
| `auto` | What the modes it ran write. A step that deploys several stacks writes the apply's file once per deploy, so it holds the last one |
| `resolve`, `settle`, `check`, `init` | None |

The outputs are listed with their meaning in [notifications](notifications.md#what-sluiceway-hands-over) and [the reference](reference.md), and fall under the same rule. The outputs of the scan and of the deploy of the run:

<!-- example: outputs -->
```text
# scan
pending=1
preview-failed=0
in-sync=0
dashboard-changed=true
matrix=[]
dashboard-url=https://github.com/acme/infra/issues/1
result-file=/home/runner/work/_temp/sluiceway-scan-result.json
# apply
outcome=deployed
stack=network:dev
result-file=/home/runner/work/_temp/sluiceway-apply-result.json
```
<!-- /example -->

#### The file of a scan

| Field | Meaning |
|---|---|
| `version` | `1` |
| `mode` | `scan` |
| `run` | The web address of the run |
| `commit` | The commit the scan checked out |
| `seconds` | How long the scan took |
| `dashboard` | The dashboard after this scan. `null` when the scan did not get as far as writing it |
| `dashboard.url` | The web address of the dashboard issue |
| `dashboard.changed` | `true` when this scan wrote a body that differs from the one before |
| `dashboard.pending` | Pending rows on the dashboard, carried rows included |
| `dashboard.deploying` | Deploying and queued rows |
| `dashboard.previewFailed` | Rows whose preview failed |
| `dashboard.inSync` | Rows in sync |
| `dashboard.failedDeploys` | Rows with a failure line |
| `stacks` | Every stack this scan previewed, in stack id order. A narrowed scan leaves out the stacks whose rows it carried |

#### A scanned stack

A scanned stack has every field of a preview, below, and these:

| Field | Meaning |
|---|---|
| `stack` | The stack id |
| `seconds` | How long its preview took |
| `attribution` | The pull requests and direct pushes it claims since its last successful deploy, newest first. Absent when the lookup failed, an empty list when nothing it claims changed |
| `attribution[].kind` | `pull-request` or `push` |
| `attribution[].number` | The pull request's number |
| `attribution[].title` | The pull request's title, text a person wrote |
| `attribution[].url` | The web address of the pull request or the commit |
| `attribution[].author` | The login of its author, when GitHub has one |
| `attribution[].commit` | The commit of a direct push |
| `attribution[].message` | The first line of a direct push's message, text a person wrote |
| `ignore` | On a preview that failed because the backend does not hold the stack: the glob that takes it off the dashboard |

<!-- example: scan-result -->
```json
{
  "version": 1,
  "mode": "scan",
  "run": "https://github.com/acme/infra/actions/runs/4242",
  "commit": "0123456789abcdef0123456789abcdef01234567",
  "seconds": 2.5,
  "dashboard": {
    "url": "https://github.com/acme/infra/issues/1",
    "changed": true,
    "pending": 1,
    "deploying": 0,
    "previewFailed": 0,
    "inSync": 0,
    "failedDeploys": 0
  },
  "stacks": [
    {
      "stack": "network:dev",
      "seconds": 0.5,
      "state": "pending",
      "counts": {
        "create": 4,
        "update": 0,
        "replace": 0,
        "delete": 0,
        "trackingOnly": 0
      },
      "changes": [
        {
          "type": "command:local:Command",
          "name": "banner",
          "op": "create",
          "changedKeys": [],
          "replaceKeys": []
        },
        {
          "type": "local:index/file:File",
          "name": "notes",
          "op": "create",
          "changedKeys": [],
          "replaceKeys": []
        },
        {
          "type": "random:index/randomPet:RandomPet",
          "name": "name",
          "op": "create",
          "changedKeys": [],
          "replaceKeys": []
        },
        {
          "type": "random:index/randomString:RandomString",
          "name": "subnet",
          "op": "create",
          "changedKeys": [],
          "replaceKeys": []
        }
      ],
      "attribution": []
    }
  ]
}
```
<!-- /example -->

#### The file of an apply

| Field | Meaning |
|---|---|
| `version` | `1` |
| `mode` | `apply` |
| `run` | The web address of the run |
| `commit` | The commit the job checked out |
| `deployment` | The id of the deployment record the job was handed |
| `dashboard` | `null` when the job did not start from an edit of the dashboard |
| `dashboard.url` | The web address of the dashboard issue |
| `outcome` | `deployed`, `in-sync` (nothing to deploy), `rehearsed` ([`dry-run`](reference.md)), `refused` (the change moved since the tick, the record was not one this job may deploy, or `deploys: false`) or `failed` |
| `stack` | The stack id. `null` when the job never learned it |
| `ticker` | The login on the record. `null` when the job never read it |
| `reason` | Why the deploy did not go out, from Sluiceway's fixed list. `null` when it did |
| `seconds` | How long the job took |
| `deploySeconds` | How long the tool's deploy took. `null` when it was never asked to deploy |
| `preview` | The fresh preview the tick was held against: after a deploy what went out, after a rehearsal what would have. `null` when there was none |
| `after` | The preview after a deploy that failed half way: what is pending now. `null` otherwise |

A deploy that went out:

<!-- example: apply-result -->
```json
{
  "version": 1,
  "mode": "apply",
  "run": "https://github.com/acme/infra/actions/runs/5151",
  "commit": "0123456789abcdef0123456789abcdef01234567",
  "deployment": 1,
  "dashboard": null,
  "outcome": "deployed",
  "stack": "network:dev",
  "ticker": "alice",
  "reason": null,
  "seconds": 1.5,
  "deploySeconds": 0.5,
  "preview": {
    "state": "pending",
    "counts": {
      "create": 4,
      "update": 0,
      "replace": 0,
      "delete": 0,
      "trackingOnly": 0
    },
    "changes": [
      {
        "type": "command:local:Command",
        "name": "banner",
        "op": "create",
        "changedKeys": [],
        "replaceKeys": []
      },
      {
        "type": "local:index/file:File",
        "name": "notes",
        "op": "create",
        "changedKeys": [],
        "replaceKeys": []
      },
      {
        "type": "random:index/randomPet:RandomPet",
        "name": "name",
        "op": "create",
        "changedKeys": [],
        "replaceKeys": []
      },
      {
        "type": "random:index/randomString:RandomString",
        "name": "subnet",
        "op": "create",
        "changedKeys": [],
        "replaceKeys": []
      }
    ]
  },
  "after": null
}
```
<!-- /example -->

A deploy that failed:

<!-- example: apply-result-failed -->
```json
{
  "version": 1,
  "mode": "apply",
  "run": "https://github.com/acme/infra/actions/runs/5151",
  "commit": "0123456789abcdef0123456789abcdef01234567",
  "deployment": 1,
  "dashboard": null,
  "outcome": "failed",
  "stack": "network:dev",
  "ticker": "alice",
  "reason": "the tool exited with an error (exit code 1)",
  "seconds": 1.5,
  "deploySeconds": 0.5,
  "preview": {
    "state": "pending",
    "counts": {
      "create": 4,
      "update": 0,
      "replace": 0,
      "delete": 0,
      "trackingOnly": 0
    },
    "changes": [
      {
        "type": "command:local:Command",
        "name": "banner",
        "op": "create",
        "changedKeys": [],
        "replaceKeys": []
      },
      {
        "type": "local:index/file:File",
        "name": "notes",
        "op": "create",
        "changedKeys": [],
        "replaceKeys": []
      },
      {
        "type": "random:index/randomPet:RandomPet",
        "name": "name",
        "op": "create",
        "changedKeys": [],
        "replaceKeys": []
      },
      {
        "type": "random:index/randomString:RandomString",
        "name": "subnet",
        "op": "create",
        "changedKeys": [],
        "replaceKeys": []
      }
    ]
  },
  "after": {
    "state": "pending",
    "counts": {
      "create": 4,
      "update": 0,
      "replace": 0,
      "delete": 0,
      "trackingOnly": 0
    },
    "changes": [
      {
        "type": "command:local:Command",
        "name": "banner",
        "op": "create",
        "changedKeys": [],
        "replaceKeys": []
      },
      {
        "type": "local:index/file:File",
        "name": "notes",
        "op": "create",
        "changedKeys": [],
        "replaceKeys": []
      },
      {
        "type": "random:index/randomPet:RandomPet",
        "name": "name",
        "op": "create",
        "changedKeys": [],
        "replaceKeys": []
      },
      {
        "type": "random:index/randomString:RandomString",
        "name": "subnet",
        "op": "create",
        "changedKeys": [],
        "replaceKeys": []
      }
    ]
  }
}
```
<!-- /example -->

#### A preview

| Field | Meaning |
|---|---|
| `state` | `pending`, `drift` (nothing to deploy from the code, and drift found), `in-sync` or `preview-failed` |
| `counts` | How many changes of each kind |
| `counts.create` | Creates |
| `counts.update` | Updates |
| `counts.replace` | Replaces |
| `counts.delete` | Deletes |
| `counts.trackingOnly` | Changes to the tool's record of a resource only, such as an import |
| `changes` | The changes: deletes, then replaces, then the rest |
| `drift` | What changed outside the code, when a scan checked and found some. `update` is a property that changed, `delete` a resource that is gone |
| `reason` | On a preview that failed, why, from Sluiceway's fixed list. The only field then, with `state` |

#### A change

| Field | Meaning |
|---|---|
| `type` | The resource type, as the tool names it |
| `name` | The resource name |
| `op` | `create`, `update`, `replace`, `delete` or `none` |
| `tracking` | `import`, `forget` or `move`, when the change touches the tool's record of the resource |
| `changedKeys` | The property paths that change, never their values |
| `replaceKeys` | The property paths that force a replace |
| `values` | Only at a path listed in `dashboard.showValues`: the old and new value, a scalar of one line and never one the tool marks secret. The one field that may hold a value |
| `values[].path` | The property path |
| `values[].old` | The value before. Absent when the property is new |
| `values[].new` | The value after. Absent when the property goes |

Resource names, types and property paths come from your code, as they do on the dashboard, so do not put a secret in a resource name or a map key. A title or a commit message is text a person wrote: treat it as such where you send it.

## Worked examples

### Read the result file in a later step

Give the Sluiceway step an `id`, and hand the path to your step through `env`:

```yaml
- name: List what is pending
  if: always() && steps.sluiceway.outputs['result-file'] != ''
  env:
    RESULT_FILE: ${{ steps.sluiceway.outputs['result-file'] }}
  run: |
    jq -e '.version == 1' "$RESULT_FILE" > /dev/null
    jq -r '.stacks[]? | select(.state == "pending")
      | "\(.stack): \(.counts.create) to create, \(.counts.update) to update, \(.counts.replace) to replace, \(.counts.delete) to delete"' "$RESULT_FILE"
```

[Notifications](notifications.md#steps-of-your-own) has steps that send the file or parts of it to Slack, Telegram, a webhook or a Pushgateway.

### The last deploy of a stack, from the Deployments API

The newest record of the stack that has a `success` status, with the GitHub CLI. It needs `deployments: read`:

```sh
REPO=acme/infra STACK=network:dev
for id in $(gh api "repos/$REPO/deployments?task=sluiceway:$STACK&per_page=30" --jq '.[] | select(.payload.v == 1) | .id'); do
  if gh api "repos/$REPO/deployments/$id/statuses" --jq '.[].state' | grep -qx success; then
    gh api "repos/$REPO/deployments/$id" --jq '{sha, created_at, ticker: .payload.ticker, hash: .payload.hash}'
    break
  fi
done
```

The list is newest first. GitHub's own apps for Slack and Teams, and anything else that reads the Deployments API, can use the same records.

### What is waiting, from the dashboard alone

The stack ids of the pending rows, read from the markers of the body, with no call but the one that reads the issue:

```sh
gh issue view "$DASHBOARD" --json body --jq .body |
  grep -o '<!-- sluiceway:row [^>]*-->' |
  grep ' state="pending"' |
  sed -E 's/.* stack="([^"]*)".*/\1/'
```

`state="drift"` gives the drifted rows the same way. A stack id with `%` in it is percent-encoded here: decode it before you use it.

## What is left out on purpose

Every documented key is a promise, and each one costs a version to change, so the list is as short as a reader needs. These are written but not promised, and may change or go in any release without a new version:

- **The text of the body**: rows, headings, the header, counts, notes, links and pictures. The markers carry the facts.
- **`shortened`** on a row: how far the size budget shortened it, a note for the layout.
- **`run-waiting`, `run-waiting-since` and `run-waiting-more`** on the root marker: a run of the workflow that waits for a runner, a hint about the runners and not a fact about a stack.
- **`scan-running` and `scan-running-since`** on the root marker: a scan that is under way, written by the scan before its previews and taken away by its write at the end. A hint that the body is about to change, not a fact about a stack.
- **`note`, `added`, `gone` and `moved`** on a bulk box, and **`confirm`, `stacks`, `hashes` and `scan-run`** on a confirm box: the hand-over between one tick and the next. A script must never tick a confirm box, so it has no reason to read one.
- **The description of a deployment status.** The state is the fact, and the words are for people.
- **Writing.** This page documents what to read. A tick is an edit of the issue by a person, and Sluiceway judges it by who made the edit ([security](security.md)).
- **The job summary, the job log, the preview pages and the notifications.** They are for people. The webhook message has a `version` of its own and is documented with the [notifications](notifications.md).
