# What does Pulumi's update history give us on a self-managed backend?

Research for a feature after v1: deploys made outside the dashboard (a `pulumi up` from a laptop, a script, another pipeline) also show up under recently deployed, ideally with who did it. Record 0016 says such deploys are legal and not detected. This note checks what Pulumi records about them, so a later design can start from facts.

Checked on 2026-09-21 against pulumi.com/docs (generated for CLI v3.263.0, the newest release, published 2026-09-16), the `pulumi/pulumi` source at tag `v3.263.0` (commit `ceb2e86`), and a local experiment. Every claim links to its source or is marked as observed.

The experiment ran CLI **v3.229.0** (Sluiceway's minimum, record 0001) and **v3.263.0**, both unpacked into a scratch directory and never put on a shared PATH. One throwaway YAML project, a `file://` backend, its own `PULUMI_HOME`, `PULUMI_CONFIG_PASSPHRASE=test`, the providers `random` and `command`, and every command started with `env -i` so that only named variables reached the CLI. The project was a git repo with one commit whose author ("Ada Author") and committer ("Carl Committer") were made up, and an `origin` remote at `github.com/example-org/example-repo`. The runs: an `up`, a `refresh`, a `preview`, a `refresh --preview-only`, a failed `up`, an `up` inside a faked GitHub Actions environment with `-m`, an `up` inside a faked GitLab environment with `GIT_AUTHOR_*` set, a slow `up` to hold the lock, a `destroy`, a no-op `up`, a `stack import`, a `state delete` and a targeted `up`. Unless a difference is called out, both CLI versions behaved the same.

## Answer

- **Fields of one entry: enough to describe a deploy, with one hole.** An entry holds `kind`, `startTime`, `endTime`, `result`, `message`, `resourceChanges` (counts by op), `environment` (a string map) and `config`. It also holds `version`, but on a self-managed backend `version` is always `0`. Times have one second of precision and come from the clock of the machine that ran the update. An entry has no id.
- **Who: not recorded on a self-managed backend.** Nothing in an entry names the person, the OS user or the machine that ran the update. `git.author` and `git.committer` describe the commit that was checked out, not the person who typed `pulumi up`. `USER`, `GITHUB_ACTOR` and the hostname were never written to the history. Inside GitHub Actions the entry does hold the run: `ci.system`, `ci.build.id` (the run id), `ci.build.number`, `ci.build.type` and `ci.build.url`. Pulumi Cloud adds `requestedBy` and a real `version`, but only through its REST API, not through `pulumi stack history`.
- **Config: yes, the history holds every config value.** Plain values are in plain text in `stack history --json` and in the raw files. Secret values are left out of the JSON unless `--show-secrets` is passed, and are stored encrypted in the raw files. To honour record 0021 the adapter drops `config` whole, never passes `--show-secrets`, and lets only a fixed list of `environment` keys through.
- **Cost and mechanics: cheap, read-only, no passphrase.** `stack history` needs backend access only. It worked with no passphrase and with a wrong one. It takes no stack lock and ran while an `up` held the lock. It took 0.10 s on a local file backend. `--page-size N` limits it to the newest N entries, but the self-managed backend still lists the whole history directory first. It works with `--stack` and `--cwd` with no stack selected, and even with no project directory when the stack name is fully qualified. `preview` and `refresh --preview-only` add no entry. A no-op `up`, a plain `refresh` and a failed `up` each add one. `stack import` and `state delete` add none.
- **Own deploy or outside deploy: match the GitHub run id.** `ci.build.id` in the entry equals `GITHUB_RUN_ID`, and the deployment record already carries the run id (record 0003). That is an exact match on a value that the outside deploy cannot have by accident. The history version number is useless on a self-managed backend because it is always `0`. Time windows are the weakest: one second of precision, a foreign clock, and no way to tell two deploys in the same window apart.
- **A cheaper signal exists: `lastUpdate` from `pulumi stack ls --json`.** It is the time in the checkpoint's manifest, one call gives it for every stack of a project, and it moved on every `up`, `refresh` and `destroy`. It also moves on a no-op `up` and in the middle of a running update, so it can say "look at the history of this stack", not "something was deployed". A self-managed state has no serial or version number at all. The bucket's modification time needs cloud credentials outside the tool, which Sluiceway never holds (0014).
- **OpenTofu later: a serial and a lineage, and no history.** The state has a `serial` that goes up on every write and a `lineage` that names the state. A changed serial says that something wrote the state. It does not say what, when, from which commit or from which CI run.

## Detail

### 1. What one history entry holds

**Command.** `pulumi stack history` "displays data about previous updates for a stack". Flags: `--full-dates`, `--page`, `--page-size` (default 10), `--show-secrets`, `--stack`, and `--output json`.
Source: https://www.pulumi.com/docs/iac/cli/commands/pulumi_stack_history/

**Trap: the JSON flag changed name.** On v3.229.0 the flag is `-j, --json` and `--output` does not exist (observed: `error: unknown flag: --output`). On v3.263.0 the documented flag is `--output json`, and `--json` still works as a hidden alias. An adapter that supports the minimum CLI has to pass `--json`.
Source: https://github.com/pulumi/pulumi/blob/ceb2e86de7a3aaa97c4fd9592ec2f44cae8afc90/pkg/util/outputflag/outputflag.go#L45-L49

**Stored type.** What the backend stores per update:

```go
type UpdateInfo struct {
	Kind        apitype.UpdateKind `json:"kind"`
	StartTime   int64              `json:"startTime"`
	Message     string             `json:"message"`
	Environment map[string]string  `json:"environment"`
	Config      config.Map         `json:"config"`
	Version         int                     `json:"version"`
	Result          UpdateResult            `json:"result"`
	EndTime         int64                   `json:"endTime"`
	ResourceChanges display.ResourceChanges `json:"resourceChanges,omitempty"`
}
```

Source: https://github.com/pulumi/pulumi/blob/ceb2e86de7a3aaa97c4fd9592ec2f44cae8afc90/pkg/backend/updates.go#L104-L124

`kind` is one of `update`, `preview`, `refresh`, `rename`, `destroy`, `import` (https://github.com/pulumi/pulumi/blob/ceb2e86de7a3aaa97c4fd9592ec2f44cae8afc90/sdk/go/common/apitype/history.go#L27-L38). `result` is `in-progress`, `succeeded` or `failed` (https://github.com/pulumi/pulumi/blob/ceb2e86de7a3aaa97c4fd9592ec2f44cae8afc90/pkg/backend/updates.go#L32-L42).

**JSON shape printed by the CLI.** `version`, `kind`, `startTime`, `message`, `environment`, `config`, `result`, `endTime`, `resourceChanges`. A config value is `{ "value"?, "objectValue"?, "secret" }`.
Source: https://github.com/pulumi/pulumi/blob/ceb2e86de7a3aaa97c4fd9592ec2f44cae8afc90/pkg/cmd/pulumi/stack/stack_history.go#L145-L167

**`version` is always 0 on a self-managed backend.** The self-managed backend builds the entry without setting `Version`, so it stays at Go's zero value. The Pulumi Cloud backend copies `update.Version` from the service.
Sources: https://github.com/pulumi/pulumi/blob/ceb2e86de7a3aaa97c4fd9592ec2f44cae8afc90/pkg/backend/diy/backend.go#L1449-L1461 and https://github.com/pulumi/pulumi/blob/ceb2e86de7a3aaa97c4fd9592ec2f44cae8afc90/pkg/backend/httpstate/backend.go#L2229-L2246
Observed: every entry on both CLI versions had `"version": 0`, in the JSON and in the raw files.

**Times are whole seconds.** Start and end are `time.Now().Unix()` on the machine that runs the update, printed as `2026-09-21T18:11:10.000Z`. `--full-dates` changes only the text output, not the JSON.
Source: https://github.com/pulumi/pulumi/blob/ceb2e86de7a3aaa97c4fd9592ec2f44cae8afc90/pkg/backend/diy/backend.go#L1393-L1421
Observed: two updates one after the other had the same `startTime`.

**`message`.** The text of `-m` when given. Otherwise the first line of the message of the commit at HEAD.
Source: https://github.com/pulumi/pulumi/blob/ceb2e86de7a3aaa97c4fd9592ec2f44cae8afc90/pkg/cmd/pulumi/metadata/metadata.go#L480-L487

**Order.** Newest first. "The first element of the result will be the most recent update record."
Source: https://github.com/pulumi/pulumi/blob/ceb2e86de7a3aaa97c4fd9592ec2f44cae8afc90/pkg/backend/diy/state.go#L573-L575

**Observed sample (CLI 3.229.0).** The `up` that ran inside a faked GitHub Actions environment, from `pulumi stack history --json`. Nothing was removed. The commit hash, names and addresses are the made-up ones of the scratch repo.

```json
{
  "version": 0,
  "kind": "update",
  "startTime": "2026-09-21T18:11:10.000Z",
  "message": "deploy from fake actions run",
  "environment": {
    "ci.build.id": "9876543210",
    "ci.build.number": "42",
    "ci.build.type": "issues",
    "ci.build.url": "https://github.com/example-org/example-repo/actions/runs/9876543210",
    "ci.pr.headSHA": "0123456789abcdef0123456789abcdef01234567",
    "ci.system": "GitHub Actions",
    "exec.kind": "cli",
    "git.author": "Ada Author",
    "git.author.email": "ada@example.invalid",
    "git.committer": "Carl Committer",
    "git.committer.email": "carl@example.invalid",
    "git.dirty": "true",
    "git.head": "59ff6e77e502bf395aae44f33ec3e94bc2897d02",
    "git.headName": "refs/heads/main",
    "pulumi.arch": "arm64",
    "pulumi.env.PULUMI_BACKEND_URL": "set",
    "pulumi.env.PULUMI_CONFIG_PASSPHRASE": "set",
    "pulumi.env.PULUMI_HOME": "set",
    "pulumi.env.PULUMI_SKIP_UPDATE_CHECK": "true",
    "pulumi.flag.message": "set",
    "pulumi.flag.skip-preview": "true",
    "pulumi.flag.stack": "set",
    "pulumi.flag.yes": "true",
    "pulumi.os": "darwin",
    "pulumi.version": "v3.229.0",
    "runtime.name": "yaml",
    "stack.environments": "[]",
    "updatePlan": "false",
    "vcs.kind": "github.com",
    "vcs.owner": "example-org",
    "vcs.repo": "example-repo",
    "vcs.root": "."
  },
  "config": {
    "histexp:cmdline":   { "value": "echo ok", "secret": false },
    "histexp:plainval":  { "value": "hello-plain", "secret": false },
    "histexp:secretval": { "secret": true }
  },
  "result": "succeeded",
  "endTime": "2026-09-21T18:11:10.000Z",
  "resourceChanges": { "same": 2, "update": 1 }
}
```

**The other runs, trimmed to what differs.**

| Run | `kind` | `result` | `resourceChanges` | Notes on `environment` |
|---|---|---|---|---|
| first `up`, `USER=alice` | `update` | `succeeded` | `{"create": 3}` | no `ci.*` keys, no user |
| `refresh`, `USER=bob` | `refresh` | `succeeded` | `{"same": 3}` | no `runtime.name` |
| `preview` | no entry | | | |
| `refresh --preview-only` | no entry | | | |
| failed `up` | `update` | `failed` | `{"same": 2}` | |
| `up` in faked GitLab CI, `GIT_AUTHOR_NAME="Eve Env"` | `update` | `succeeded` | `{"replace": 1, "same": 2}` | `ci.system: "GitLab CI/CD"`, `ci.build.id: "555"`. `git.author` stayed "Ada Author". |
| no-op `up` | `update` | `succeeded` | `{"same": 3}` | |
| `up --target ...` | `update` | `succeeded` | `{"create": 1, "same": 2}` | `pulumi.flag.target: "set"` |
| `destroy` | `destroy` | `succeeded` | `{"delete": 3}` | |
| `stack import`, `state delete` | no entry | | | |

So a list of what went out is: entries with `kind` `update` or `destroy`, `result` `succeeded`, and at least one count under a key other than `same`.

### 2. Who ran it

**What Pulumi collects.** `GetUpdateMetadata` fills the environment block from five places: the CLI itself, the VCS, the CI system, the execution kind, and ESC environments.
Source: https://github.com/pulumi/pulumi/blob/ceb2e86de7a3aaa97c4fd9592ec2f44cae8afc90/pkg/cmd/pulumi/metadata/metadata.go#L133-L157

The keys are documented as constants. The git keys describe the commit, in Pulumi's own words: `git.committer` is "the name of the person who committed the commit at HEAD" and `git.author` is "the name of the person who authored the commit at HEAD". There is no key for the OS user, the hostname or the logged-in account.
Source: https://github.com/pulumi/pulumi/blob/ceb2e86de7a3aaa97c4fd9592ec2f44cae8afc90/pkg/backend/updates.go#L44-L102

Observed: four different values of `USER` (`alice`, `bob`, `eve`, `runner`), plus `GITHUB_ACTOR`, `GITHUB_TRIGGERING_ACTOR`, `RUNNER_NAME`, `GITLAB_USER_LOGIN` and `GIT_AUTHOR_NAME`, were set during the runs. A search of every file in the backend directory for those values found nothing.

**So the honest reading of the git keys is weak.** On a laptop, `git.author` is whoever wrote the last commit on the branch that was checked out. After a merge that is often a different person from the one who ran `pulumi up`. `git.dirty: "true"` says that the working tree had changes that are in no commit, so even the commit is only roughly what went out. When there is no git repo, the same keys are filled from variables such as `PULUMI_GIT_AUTHOR` and `PULUMI_GIT_HEAD`, so they are also whatever a script says they are.
Source: https://github.com/pulumi/pulumi/blob/ceb2e86de7a3aaa97c4fd9592ec2f44cae8afc90/pkg/cmd/pulumi/metadata/metadata.go#L327-L390

**What a run inside GitHub Actions records.** The CI detector maps `GITHUB_RUN_ID` to `ci.build.id`, `GITHUB_RUN_NUMBER` to `ci.build.number`, `GITHUB_EVENT_NAME` to `ci.build.type`, `GITHUB_SHA` to `ci.pr.headSHA`, and builds `ci.build.url` as `https://github.com/<GITHUB_REPOSITORY>/actions/runs/<GITHUB_RUN_ID>`. It does not read `GITHUB_ACTOR`, `GITHUB_RUN_ATTEMPT`, `GITHUB_WORKFLOW` or `GITHUB_JOB`. The URL always starts with `github.com`, also on a GitHub Enterprise server.
Source: https://github.com/pulumi/pulumi/blob/ceb2e86de7a3aaa97c4fd9592ec2f44cae8afc90/sdk/go/common/util/ciutil/github_actions.go#L52-L63
Observed: see the sample above. The entry names the run. It does not name the actor. For an outside deploy from another workflow, the run link leads to the run page, and GitHub shows there who started it.

**Two other things the entry says about the caller.**
- The name of every environment variable that starts with `PULUMI_`, with the value replaced by `set` or, for known boolean variables, `true` or `false`. The name of every CLI flag that was passed, the same way. Values are never stored.
  Source: https://github.com/pulumi/pulumi/blob/ceb2e86de7a3aaa97c4fd9592ec2f44cae8afc90/pkg/cmd/pulumi/metadata/metadata.go#L160-L220
- `exec.kind` (`cli`, `auto.local` or `auto.inline`) tells the CLI from the Automation API. On v3.263.0, `exec.agent` names an AI coding agent when one is detected from the environment.
  Sources: https://github.com/pulumi/pulumi/blob/ceb2e86de7a3aaa97c4fd9592ec2f44cae8afc90/pkg/cmd/pulumi/metadata/metadata.go#L247-L266 and https://github.com/pulumi/pulumi/blob/ceb2e86de7a3aaa97c4fd9592ec2f44cae8afc90/sdk/go/common/util/agentdetect/agentdetect.go#L65-L91

**The user and the machine are known to Pulumi, but only while the update runs.** The self-managed backend's lock file holds `pid`, `username`, `hostname` and `timestamp`. It is deleted when the update ends, and nothing copies it into the history.
Source: https://github.com/pulumi/pulumi/blob/ceb2e86de7a3aaa97c4fd9592ec2f44cae8afc90/pkg/backend/diy/lock.go#L39-L60
Observed during the slow `up`: `{"pid":89706,"username":"mallory-laptop","hostname":"<hostname>","timestamp":"2026-09-21T20:12:32.57074+02:00"}` (the hostname is replaced here). The username is the `USER` that the run was started with. After the update the lock directory was empty.

**What Pulumi Cloud adds.** The REST API's list of stack updates returns, next to the same `info` block, `version` ("Version of the stack that this UpdateInfo describe"), `requestedBy` ("The user who requested the update"), `requestedByToken` and `githubCommitInfo`.
Source: https://www.pulumi.com/docs/reference/cloud-rest-api/stack-updates/
The CLI does not pass this on. Its type for the service's answer has no `requestedBy` field, and `pulumi stack history` converts only the fields that the self-managed backend also has, plus `version`.
Sources: https://github.com/pulumi/pulumi/blob/ceb2e86de7a3aaa97c4fd9592ec2f44cae8afc90/sdk/go/common/apitype/history.go#L99-L118 and https://github.com/pulumi/pulumi/blob/ceb2e86de7a3aaa97c4fd9592ec2f44cae8afc90/pkg/backend/httpstate/backend.go#L2229-L2246
Not tested: no Pulumi Cloud account was used. A real "who" on Pulumi Cloud means calling the REST API with the user's access token, which is outside a CLI-driven adapter (0001).

### 3. Config and secrets

**`stack history --json`, observed.** Plain config values are printed in plain text (`"value": "hello-plain"`). A secret has `"secret": true` and no `value` key at all. With `--show-secrets` the secret appears in plain text (`"value": "s3cr3t-value-123"`). This differs from `preview --json`, where `--show-secrets` does not unmask (see the earlier CLI research).
Source for the rule: https://github.com/pulumi/pulumi/blob/ceb2e86de7a3aaa97c4fd9592ec2f44cae8afc90/pkg/cmd/pulumi/stack/stack_history.go#L185-L200

**Raw files, observed.** Each update writes two objects under `.pulumi/history/<project>/<stack>/`:

```
dev-1790014270167954000.history.json      the entry
dev-1790014270167954000.checkpoint.json   a full copy of the state after the update
```

The number is `time.Now().UnixNano()` at the moment of writing. The raw entry stores times as Unix seconds and config like the stack file does:

```json
"config": {
  "histexp:cmdline": "echo ok",
  "histexp:plainval": "hello-plain",
  "histexp:secretval": { "secure": "v1:<ciphertext>" }
}
```

A search of the whole backend directory for the plain text of the secret found nothing. The checkpoint copy next to each entry is a complete state file, so it holds every resource property. `stack history` does not read it.
Sources: https://github.com/pulumi/pulumi/blob/ceb2e86de7a3aaa97c4fd9592ec2f44cae8afc90/pkg/backend/diy/state.go#L689-L712 and https://www.pulumi.com/docs/iac/concepts/state-and-backends/ ("DIY backends also maintain checkpoint history (in the `.pulumi/history/` directory)")

**What an adapter must drop for record 0021.**
- `config`, whole. A config value is a value, and only the ones somebody marked are hidden. This is the same argument as in 0021.
- `--show-secrets` is never passed. Then the passphrase is never needed either.
- Every `environment` key that is not on a fixed list. The block is an open string map and newer CLIs add keys. Keep: `ci.system`, `ci.build.id`, `ci.build.url`, `git.head`, `git.dirty`, and perhaps `vcs.owner` and `vcs.repo`.
- `message`. It is free text from `-m` or from a commit title. It is not a property value, but it is somebody's words from outside the repo's GitHub history, and a script can put anything in it. Sluiceway does not need it: the commit is linked through `git.head`.
- `git.author.email` and `git.committer.email`. Addresses of people do not belong on an issue that is mailed around and may be public.
- The raw output follows the rule for raw tool output: never printed, never in an error, never written to disk.

### 4. Cost and mechanics

| Question | Verdict | Evidence |
|---|---|---|
| Needs the passphrase? | No, unless `--show-secrets` | Observed: exit 0 with no `PULUMI_CONFIG_PASSPHRASE` and with a wrong one. With `--show-secrets` and no passphrase: `error: decrypting secrets: passphrase must be set ...`. The decrypter is only built when `showSecrets` is set: https://github.com/pulumi/pulumi/blob/ceb2e86de7a3aaa97c4fd9592ec2f44cae8afc90/pkg/cmd/pulumi/stack/stack_history.go#L94-L118 |
| Takes the stack lock? | No | Observed: it returned in 0.10 s while a 12 second `up` held the lock file. `GetHistory` has no `Lock` call, unlike the mutating calls in the same file: https://github.com/pulumi/pulumi/blob/ceb2e86de7a3aaa97c4fd9592ec2f44cae8afc90/pkg/backend/diy/backend.go#L1521-L1536 |
| How long? | 0.10 s wall time on `file://` with 7 to 11 entries, same as `stack ls` and `stack export` | Observed, three runs each. Not measured against a real bucket. |
| Newest N only? | Yes: `--page-size N`. Default is 10, and `--page-size 0` returns everything. | Observed. Docs: https://www.pulumi.com/docs/iac/cli/commands/pulumi_stack_history/ |
| Does a small page make it cheaper? | Only partly. The backend lists every object in the history directory (two per update, for the life of the stack), then reads only the entries of the page. The source says so: "we could consider optimizing the list operation using `page` and `pageSize`". `addToHistory` only adds, and no code was found that prunes. | https://github.com/pulumi/pulumi/blob/ceb2e86de7a3aaa97c4fd9592ec2f44cae8afc90/pkg/backend/diy/state.go#L576-L640 |
| `--stack` and `--cwd` without a selected stack? | Yes | Observed from another directory. With `--stack organization/histexp/dev` it also worked from an empty directory with no project file. |
| A stack that does not exist? | `error: no stack named 'nope' found`, exit 6 on v3.229.0 | Observed |
| Does `preview` add an entry? | No | Observed. The entry is written only when the run is not a dry run: https://github.com/pulumi/pulumi/blob/ceb2e86de7a3aaa97c4fd9592ec2f44cae8afc90/pkg/backend/diy/backend.go#L1463-L1468 |
| Does `refresh --preview-only` add an entry? | No | Observed. `lastUpdate` and the checkpoint stayed the same too. |
| What else adds no entry? | `stack import`, `state delete` | Observed. State surgery is invisible to the history. |

One call per stack reads: the stack's checkpoint (the command loads the stack first), one listing, and N small objects.

### 5. Own deploys and outside deploys

| Way | Works on a self-managed backend? | Why |
|---|---|---|
| Run id: `environment["ci.build.id"]` against the run id on the deployment record | Yes, exact | Pulumi writes `GITHUB_RUN_ID` into every entry made inside GitHub Actions (section 2). The deployment record's payload already carries the run id (0003). A laptop has no `ci.*` keys. Another pipeline has another run id or another `ci.system`. |
| History version stored at deploy time | No | `version` is always `0` (section 1). It would work on Pulumi Cloud only. |
| Time windows | Weak | One second of precision, a clock Sluiceway does not control, and an outside deploy that lands inside the window of an own deploy is taken for it. An own deploy whose record was never settled (a killed job) has no end time to match. |

The run id has two soft spots, both small.
- `GITHUB_RUN_ATTEMPT` is not recorded, so a re-run of the same run has the same id. That is harmless here: "is this entry ours" only asks whether any Sluiceway deployment record of this stack has this run id.
- A workflow that runs its own `pulumi up` on the same stack in the same run as Sluiceway's apply would be taken for Sluiceway's. That is an unusual workflow, and the count of matching entries can catch it: one deployment record, one entry.

If a stronger mark is ever wanted, `-m` is the documented channel: the adapter can pass `--message` on `up`, and the text comes back in `message` (observed). It costs the default message, which is the commit title, so it is not proposed here.

An entry with `ci.system: "GitHub Actions"`, this repo in `vcs.owner` and `vcs.repo`, and a run id that no deployment record has, is an outside deploy from another workflow of the same repo. Its `ci.build.url` is a useful link.

### 6. A cheaper signal than the history

| Signal | Verdict | Evidence |
|---|---|---|
| `pulumi stack ls --json`, field `lastUpdate` | Usable as a gate | On a self-managed backend it is the `time` in the checkpoint's manifest: https://github.com/pulumi/pulumi/blob/ceb2e86de7a3aaa97c4fd9592ec2f44cae8afc90/pkg/backend/diy/stack.go#L141-L148. Observed: it has millisecond precision, it moved on every `up`, `refresh` and `destroy`, also on a no-op `up` and on a failed `up`, and it did not move on `preview`, `refresh --preview-only`, `stack import` of the same state or `state delete`. It also moved in the middle of the slow `up`, before any history entry existed. One call covers every stack of the project, but the backend reads each stack's checkpoint to answer it. |
| `pulumi stack export`: a version or serial | Does not exist | Observed top level: `version` (the schema version, `3`) and `deployment` with `manifest`, `secrets_providers`, `resources`, `metadata`. No counter. `manifest.time` is the same value as `lastUpdate`. Export prints the whole state, which is a sensitive object under 0021. `--version` ("Previous stack version to export") needs a backend that can export older versions, and the self-managed one does not implement that: https://github.com/pulumi/pulumi/blob/ceb2e86de7a3aaa97c4fd9592ec2f44cae8afc90/pkg/cmd/pulumi/stack/stack_export.go#L84-L91 |
| Modification time of the checkpoint object in the bucket | Rejected | It needs a cloud SDK and the bucket's credentials outside the tool. Sluiceway never holds credentials (0014) and the adapter drives the CLI only (0001). It would also say nothing that `lastUpdate` does not say. |

So `lastUpdate` can answer "has this stack's state been written since I last looked" for a whole project in one call. It cannot answer "was something deployed", because a refresh and a no-op `up` move it too. The history has to be read to know.

### 7. OpenTofu, for later

OpenTofu keeps no update history. Its state has two fields for this: `serial`, which goes up with every write of the state, and `lineage`, an id that is set when the state is first created. The docs describe both through the safety checks of `tofu state push`: "Differing lineage: If the "lineage" value in the state differs, OpenTofu will not allow you to push the state", and "Higher remote serial: If the "serial" value in the destination state is higher than the state being pushed, OpenTofu will prevent the push" (https://opentofu.org/docs/cli/commands/state/push/). `tofu state pull` "downloads the state from its current location ... and outputs the raw format to stdout" (https://opentofu.org/docs/cli/commands/state/pull/), which is the only CLI way to read the serial, and it prints the whole state with every value in plain text. So an OpenTofu adapter could say "the state was written N times since Sluiceway's last deploy", if Sluiceway stored the serial at deploy time. It could not say when, from which commit, by which run, or whether the write was an apply at all. Record 0016's remark that OpenTofu "has nothing like it" stands. The capability below therefore has to be optional per adapter.

## Consequences for a later design

**Detection is possible on Pulumi, and the description is decent.** A successful outside `up` or `destroy` can be listed with its time, its counts by op, the commit that was checked out, whether the tree was dirty, and the CI run when there was one. Two costs that record 0016 named stay true: it is one more backend call per stack, and OpenTofu cannot do it.

**A proposal for the adapter capability.** Optional, so an adapter without a history simply lacks it.

```ts
// Optional. The newest finished runs of the tool on this stack, newest first.
recentRuns?(stack: Stack, limit: number): Promise<ToolRun[]>

type ToolRun = {
  kind: "deploy" | "destroy"        // Pulumi: update, destroy. Everything else is dropped.
  endedAt: string                    // ISO, whole seconds, the clock of the machine that ran it
  counts: Record<Op, number>         // the same ops as a Diff, without "same"
  commit?: { sha: string, dirty: boolean }
  ci?: { system: string, runId: string, url?: string }
}
```

- Pulumi: `pulumi stack history --stack <s> --cwd <dir> --json --page-size <limit>`. No passphrase needed, no lock taken. `--json`, not `--output json`, because of the minimum CLI.
- The adapter keeps entries with `result: "succeeded"`, `kind` `update` or `destroy`, and at least one count other than `same`. Failed runs stay out, in line with 0029.
- The schema that parses the output has no place for `config`, `message`, the e-mail keys or unknown `environment` keys, so none of them can ride along (0021). `ToolRun` has no field that can hold a value.
- The core decides what is outside: a `ToolRun` whose `ci.runId` equals the run id on a Sluiceway deployment record of that stack is Sluiceway's own and is skipped, because the record already produces a line. Everything else is an outside deploy.
- To avoid one call per stack per scan, a scan can first call `pulumi stack ls --json` once per project and read the history only for stacks whose `lastUpdate` differs from the value kept at the previous look. Where that value is kept (a marker key on the row is the obvious place) is a design question, as is whether a narrowed scan looks at all.

**A proposal for the dashboard line.** Under recently deployed, next to Sluiceway's own lines, in the same absolute time format (0029):

- From a CI run: `prod/network · 2026-09-21 18:11 UTC · deployed outside Sluiceway · +1 ~2 · commit 59ff6e7 · GitHub Actions run 9876543210` with the commit and the run linked.
- From anywhere else: `prod/network · 2026-09-21 18:11 UTC · deployed outside Sluiceway · +1 ~2 · commit 59ff6e7, with uncommitted changes`.
- With no git data: the time and the counts only.

**How honest the "who" can be.** On a self-managed backend Pulumi does not record who ran an update, so Sluiceway cannot say it, and should not suggest it.
- Never print `git.author` or `git.committer` as the deployer. They are the people behind the last commit. The line links the commit, and GitHub shows its author there.
- For a CI run, link the run. GitHub's run page names the person who started it, and that is a fact GitHub recorded, not one Sluiceway guessed.
- For a laptop or a script, the true statement is "somebody with access to the state and the cloud credentials". The line says "outside Sluiceway" and stops.
- The time is the other machine's clock. It can be shown, but it should not be used to order an outside deploy against an own deploy that is seconds away.
- Only Pulumi Cloud has a real `requestedBy`, and only in its REST API. Using it means a second, HTTP-driven path with the user's access token. That is a separate decision from this one.

**What stays invisible.** `pulumi stack import`, `pulumi state` edits and anything that writes the bucket directly add no history entry. An outside change made that way is still only found by the next preview, as today.
