# What does the Pulumi CLI give us for preview, drift and apply?

Research for issue #4. Checked on 2026-09-20 against pulumi.com/docs (generated for Pulumi CLI v3.263.0, the latest release, published 2026-09-16), the `pulumi/pulumi` source at tag `v3.263.0`, and a local experiment. Every claim links to its source or is marked as observed.

The experiment ran Pulumi CLI **v3.198.0** (the version installed locally, about a year behind latest) in a scratch directory with an isolated `PULUMI_HOME`, a `file://` backend set through `PULUMI_BACKEND_URL`, `PULUMI_CONFIG_PASSPHRASE=test`, and the credential-free providers `random`, `command` and `local`. One project used the YAML runtime, one used TypeScript (`@pulumi/pulumi` 3.248.0). Both had a secret config value and a secret output. Where behavior differs between 3.198.0 and 3.263.0 this is called out, because it matters for the minimum CLI version Sluiceway supports.

## Answer

- **Preview JSON shape: usable, with two traps.** `pulumi preview --json` prints one JSON document: `config`, `steps[]`, `diagnostics[]`, `duration`, `changeSummary`. Each step has `op`, `urn`, `provider`, `oldState`, `newState`, `diffReasons`, `replaceReasons`, `detailedDiff`. A replacement is one step with `op: "replace"`. Trap 1: `detailedDiff` was `null` on every create, delete and replace step observed, and only filled on an in-place update. Changed keys must fall back to `diffReasons` and `replaceReasons`. Trap 2: `steps` also contains `same` steps, and their order changes between identical runs.
- **Secrets: masked, but only if marked secret.** Secret config, inputs and outputs appear as the string `"[secret]"`. `--show-secrets` does not unmask `--json` output. Any value not marked secret appears in plain text in `oldState` and `newState`, so Sluiceway must read keys only and never pass values through.
- **Drift without mutating state: works.** `pulumi refresh --preview-only --json` is the documented way and left the state file byte-identical. Caveats: on a DIY backend it takes the stack lock before v3.229.0, a deleted resource shows as `op: "delete"` while unchanged ones show as `op: "refresh"`, and providers that do not implement Read report no drift.
- **Non-interactive `up`: works.** `pulumi up --yes --skip-preview --stack <s>`. Without `--yes` or `--skip-preview` it refuses to run. `up --json` streams engine events as JSON lines, not one document.
- **Exit codes: only meaningful from v3.226.1.** Newer CLIs map failures to codes 1 to 9 and 255 (`--expect-no-changes` with changes gives 7). CLI 3.198.0 returned 255 for every failure tested. Treat any non-zero as failure and read the reason from output.
- **`--expect-no-changes`: exists on preview, up and refresh.** On preview and `refresh --preview-only` it is a clean "is anything pending" check. On `up` and plain `refresh` the check happens after the operation is applied.
- **Update plans: still experimental.** `preview --save-plan` is labeled `[PREVIEW]`, `up --plan` is labeled `[EXPERIMENTAL]` and is hidden unless `PULUMI_EXPERIMENTAL` is set. The docs say the file format may change. Do not build on them.
- **`Pulumi.yml` is supported, and the stack file must use the same extension.** Accepted project files: `Pulumi.yaml`, `Pulumi.yml`, `Pulumi.json`. The stack config name is built from the project file's extension, so `Pulumi.yml` pairs with `Pulumi.prod.yml`. A mismatched `Pulumi.prod.yml` next to `Pulumi.yaml` is silently ignored. This contradicts the brief's discovery rule.
- **Listing stacks: `pulumi stack ls --json` needs the backend, not a login.** Setting `PULUMI_BACKEND_URL` is enough, no `pulumi login` step. It does make a network call to the bucket. Inferring stacks from `Pulumi.<stack>.yml` files works offline and is a good zero-config default, but a file can exist without a stack in the backend (preview then fails with "no stack named") and a stack can exist without a file.
- **Output stability: values are stable, order is not.** Two previews with no change differed only in `duration` for the YAML project. The TypeScript project also swapped the order of two steps. Sorting by URN before hashing is required, and the brief already plans that.
- **Cost and parallelism: cheap and safe across stacks.** A tiny TypeScript preview took about 1.3 s, three previews in parallel took 1.5 s total. Preview takes no backend lock. Risks are shared plugin downloads on a cold cache and a side effect: preview writes a `Pulumi.<stack>.yaml` with a new `encryptionsalt` when the stack config file is missing.
- **CLI versus Automation API: nothing blocks the CLI driver.** The Automation API shells out to the same CLI, its `preview()` result has no per-resource steps (only `stdout`, `stderr`, `changeSummary`), and it bundles to 13.9 MB against 234 bytes for an `execFile` wrapper. It did bundle and run under Bun 1.3.14, so the cost is size and dependency surface, not a hard failure.

## Detail

### 1. JSON output of `pulumi preview`

**Flag.** `-j, --json`: "Serialize the preview diffs, operations, and overall output as JSON. Set PULUMI_ENABLE_STREAMING_JSON_PREVIEW to stream JSON events instead."
Source: https://www.pulumi.com/docs/iac/cli/commands/pulumi_preview/

**Types.** The document is a `PreviewDigest`:

```go
type PreviewDigest struct {
	Config        map[string]string   `json:"config,omitempty"`   // "Any secrets will be blinded."
	Steps         []*PreviewStep      `json:"steps,omitempty"`
	Diagnostics   []PreviewDiagnostic `json:"diagnostics,omitempty"`
	Duration      time.Duration       `json:"duration,omitempty"`
	ChangeSummary ResourceChanges     `json:"changeSummary,omitempty"`
	MaybeCorrupt  bool                `json:"maybeCorrupt,omitempty"`
}
type PreviewStep struct {
	Op             StepOp                  `json:"op"`
	URN            resource.URN            `json:"urn"`
	Provider       string                  `json:"provider,omitempty"`
	OldState       *apitype.ResourceV3     `json:"oldState,omitempty"`
	NewState       *apitype.ResourceV3     `json:"newState,omitempty"`
	DiffReasons    []resource.PropertyKey  `json:"diffReasons,omitempty"`    // "for updating steps only"
	ReplaceReasons []resource.PropertyKey  `json:"replaceReasons,omitempty"` // "for replacement steps only"
	DetailedDiff   map[string]PropertyDiff `json:"detailedDiff"`
}
type PropertyDiff struct {
	Kind      string `json:"kind"`
	InputDiff bool   `json:"inputDiff"`
}
```

Source: https://github.com/pulumi/pulumi/blob/v3.263.0/pkg/display/json.go

**Observed (CLI 3.198.0).** A preview with one of each op gave `"changeSummary": {"create": 1, "delete": 1, "replace": 2, "same": 2, "update": 1}` and these steps (trimmed: `oldState`, `newState`, `stackTrace` and `sourcePosition` removed, which are most of the bytes):

```json
{ "op": "same",    "urn": "urn:pulumi:prod::exp::pulumi:pulumi:Stack::exp-prod", "detailedDiff": null }
{ "op": "replace", "urn": "urn:pulumi:prod::exp::random:index/randomPet:RandomPet::pet",
  "provider": "urn:pulumi:prod::exp::pulumi:providers:random::default::<uuid>",
  "diffReasons": ["prefix"], "replaceReasons": ["prefix"], "detailedDiff": null }
{ "op": "update",  "urn": "urn:pulumi:prod::exp::command:local:Command::cmd",
  "diffReasons": ["environment"],
  "detailedDiff": {
    "environment.ADDED": { "kind": "add",    "inputDiff": false },
    "environment.PLAIN": { "kind": "update", "inputDiff": false },
    "environment.TOKEN": { "kind": "update", "inputDiff": false } } }
{ "op": "create",  "urn": "urn:pulumi:prod::exp::random:index/randomPet:RandomPet::newpet", "detailedDiff": null }
{ "op": "replace", "urn": "urn:pulumi:prod::exp::local:index/file:File::file",
  "diffReasons": ["content", "contentBase64sha256", "contentBase64sha512", "contentMd5",
                  "contentSha1", "contentSha256", "contentSha512", "id"],
  "replaceReasons": ["content"], "detailedDiff": null }
{ "op": "delete",  "urn": "urn:pulumi:prod::exp::random:index/randomString:RandomString::str", "detailedDiff": null }
```

What this shows:

- A replacement is a single `replace` step by default. `--show-replacement-steps` splits it into create and delete steps; do not pass it. Source for the flag: https://www.pulumi.com/docs/iac/cli/commands/pulumi_preview/
- `detailedDiff` keys are property paths (`environment.TOKEN`), not top-level names. `diffReasons` holds top-level names.
- `detailedDiff` was `null` on all create, delete and replace steps. For replace steps the keys are only in `diffReasons` and `replaceReasons`. Note that `diffReasons` of the `local:File` replace includes computed output names (`contentMd5`, `id`), while `replaceReasons` holds the one input that caused it.
- `same` steps are included for resources that carry no change. The root `pulumi:pulumi:Stack` resource always appears.
- On create there is no `oldState`, on delete there is no `newState`.
- The default provider URN in a preview ends with a fixed placeholder UUID (`04da6b54-80e4-46f7-96ec-b56ff0331ba9`), identical across runs.

**Secrets.** Source: secrets are replaced with the literal string `[secret]`, and the JSON path hard-codes `showSecrets` to false:

```go
// For now, replace any secret properties as the string [secret] and then serialize what we have.
inputs = MassageSecrets(s.Inputs, false)
outputs = MassageSecrets(s.Outputs, false)
```

Source: https://github.com/pulumi/pulumi/blob/v3.263.0/pkg/backend/display/json.go

Observed:

```json
"config": { "exp:len": "8", "exp:token": "[secret]" }
"inputs": { "create": "echo hello", "environment": { "PLAIN": "visible", "TOKEN": "[secret]" } }
"outputs": { "cmdOut": "hello", "petName": "b-arriving-bird", "secretOut": "[secret]" }
```

- The secret config value never appeared in any output file (`grep` count 0), including with `--json --show-secrets` and in `--diff` text output.
- A changed secret still shows as a changed key (`environment.TOKEN: update`). Key names are visible, values are not.
- Values that are not marked secret (`PLAIN: visible`, file contents, hashes) are in `oldState` and `newState` in plain text. The masking is only as good as the user's secret marking.
- `additionalSecretOutputs` lists output names the provider marks secret (`["bcryptHash", "result"]` for `RandomPassword`).

**Errors.** Observed on 3.198.0:

- Program error (unknown resource type): exit 255, stdout still holds a valid `PreviewDigest` with a `diagnostics` array (`"severity": "info#err"`). Diagnostic messages contained ANSI color escapes even with `--color never` and `NO_COLOR=1`, so strip them.
- Missing required config, missing stack, missing project file: exit 255, message on stderr, stdout empty or `{}`. Do not assume stdout parses when the exit code is non-zero.
- A panic inside the JSON serializer has happened in a recent release (v3.230.0 to v3.232.0, `--json` with an empty glob). Source: https://github.com/pulumi/pulumi/issues/23403

**Human-readable diff.** `--json` replaces the normal output completely. There is an open request to get both at once. Source: https://github.com/pulumi/pulumi/issues/22515
So `NormalizedDiff.rendered` needs either a second run with `--diff --color never` (observed: secrets show as `[secret]` there too) or a renderer built from the JSON keys. The second option costs no extra preview and cannot leak a value.

**Will the shape change?** There is no schema version in the document. An open design issue (milestone 0.140, created 2026-04-29) proposes that `--json` on `preview` should emit the JSONL engine event stream like `up` does, with the rolled-up document moving to `--format=json`. Not shipped as of v3.263.0. Source: https://github.com/pulumi/pulumi/issues/22754
The streaming form already exists behind `PULUMI_ENABLE_STREAMING_JSON_PREVIEW` since v3.17.0. Source: https://github.com/pulumi/pulumi/blob/v3.263.0/changelog/v3.17.0.md
The engine event `StepEventMetadata` carries the same information under different names (`keys`, `diffs`, `detailedDiff`). Source: https://github.com/pulumi/pulumi/blob/v3.263.0/sdk/go/common/apitype/events.go

### 2. Drift detection without mutating state

**Flag.** `pulumi refresh --preview-only`: "Only show a preview of the refresh, but don't perform the refresh itself". Added in v3.105.0.
Sources: https://www.pulumi.com/docs/iac/cli/commands/pulumi_refresh/ and https://github.com/pulumi/pulumi/blob/v3.263.0/changelog/v3.105.0.md

The drift guide calls it the canonical way: "It does not modify the state file and does not change any cloud resources." For CI it recommends `pulumi refresh --preview-only --expect-no-changes`.
Source: https://www.pulumi.com/docs/iac/operations/stack-management/drift/

**Observed.** `pulumi refresh --preview-only --json --stack prod` prints the same `PreviewDigest` shape. After deleting the file behind a `local:File` resource:

```json
"changeSummary": { "delete": 1, "same": 5 }
{ "op": "refresh", "urn": "...::random:index/randomPet:RandomPet::pet", "detailedDiff": null }
{ "op": "delete",  "urn": "...::local:index/file:File::file",          "detailedDiff": null }
```

- The SHA-1 of the state file (`.pulumi/stacks/exp/prod.json`) was identical before and after `refresh --preview-only`, `refresh --preview-only --expect-no-changes` and `preview --refresh`.
- Unchanged resources appear with `op: "refresh"` and count as `same` in `changeSummary`. Filter them out.
- Per the source, a refresh step is rewritten to `update` (with `detailedDiff`) when properties drifted, or to `delete` when the resource is gone. Only the delete case could be reproduced with credential-free providers. Source: https://github.com/pulumi/pulumi/blob/v3.263.0/pkg/backend/display/json.go (the `ResourceOutputsEvent` branch)
- Step order differed between two identical refresh runs.
- `--expect-no-changes` with drift: exit 255 on 3.198.0, message "no changes were expected but changes occurred". With no drift: exit 0.

**Caveats.**

- **Lock.** On CLI 3.198.0 with a file backend, `refresh --preview-only` took the stack lock: it failed while an `up` was running ("the stack is currently locked by 1 lock(s)"), and of two concurrent drift checks on the same stack one failed. Fixed in v3.229.0: "[backend/diy] Remove state lock for refresh --preview-only for diy backend". Sources: https://github.com/pulumi/pulumi/blob/v3.263.0/changelog/v3.229.0.md and https://github.com/pulumi/pulumi/blob/v3.263.0/pkg/backend/diy/backend.go (the `PreviewOnly` branch of `Refresh` calls `b.apply` without `b.Lock`)
- **Provider coverage.** Drift is whatever each provider's Read returns. `random` and `command` resources can never drift. This is a property of refresh, not of the flag.
- **`preview --refresh`** is a different question: it refreshes in memory, then shows what `up` would do. Observed: it did not write state either, and the deleted file showed up as a `create`. The docs present it as "preview the remediation". Use `refresh --preview-only` for `detectDrift` and keep `preview` without `--refresh` for code-versus-state, so the two diffs stay separate.
- **`--run-program`** exists on refresh to run the program for up-to-date provider config. Default is off, and config validation is skipped when it is off. Source: https://www.pulumi.com/docs/iac/cli/commands/pulumi_refresh/

### 3. Non-interactive `up`, exit codes, `--expect-no-changes`

**Flags.** `-y, --yes`, `-f, --skip-preview`, `--non-interactive`, `-s, --stack`, `-C, --cwd`. Source: https://www.pulumi.com/docs/iac/cli/commands/pulumi_up/

Observed: with stdin closed and neither flag, `up` fails with "--yes or --skip-preview must be passed in to proceed when running in non-interactive mode". `pulumi up --yes --skip-preview --stack prod` ran to completion. Since the apply job has just run its own preview for the hash check, `--skip-preview` avoids a third program run.

`up --json` is not one document. It streams engine events, one JSON object per line, including progress events:

```json
{"sequence":0,"timestamp":1789897840,"progressEvent":{"type":"plugin-download","id":"plugin-download:local-0.1.6", ...}}
```

Source for the split between `preview` and the other commands: https://github.com/pulumi/pulumi/blob/v3.263.0/changelog/v3.17.0.md

**Exit codes.** Documented taxonomy: 0 success, 1 generic, 2 configuration or validation (includes a missing `--yes`), 3 authentication, 4 resource or deployment error, 5 policy, 6 stack not found, 7 no changes expectation not met, 8 canceled, 9 timeout, 255 internal error. "The global CLI exit code mapping described here was introduced in Pulumi CLI v3.226.1. Earlier versions may behave differently."
Sources: https://www.pulumi.com/docs/iac/cli/exit-codes/ and https://github.com/pulumi/pulumi/blob/v3.263.0/pkg/cmd/pulumi/cmd/exit_codes.go

Observed on 3.198.0: exit 255 for a failed resource during `up`, a program error in preview, a missing stack, missing config, a missing `--yes`, a locked stack and `--expect-no-changes` with changes. All the same code.

**`--expect-no-changes`.**

- `preview`: "Return an error if any changes are proposed by this preview". Observed exit 0 with no changes, 255 with changes (7 on v3.226.1 and later). With `--json` the full digest is still printed to stdout before the error.
- `up`: "Return an error if any changes occur during this update. This check happens after the update is applied". It does not prevent the changes.
- `refresh`: same wording as `up`. Combined with `--preview-only` nothing is applied, so it is a pure check.

Sources: the three CLI reference pages linked above.

Sluiceway does not need the flag: it already parses `changeSummary` and `steps`, which also tells it what changed.

### 4. Update plans

Still experimental. The CLI reference labels `preview --save-plan` as `[PREVIEW]` and `up --plan` and `up --strict` as `[EXPERIMENTAL]`. Observed on 3.198.0: `--plan` is absent from `pulumi up --help` unless `PULUMI_EXPERIMENTAL=1` is set, while `preview --save-plan` worked without it and wrote a 12 KB plan file.

The concept page says: "This is an experimental feature. Experimental features are opt-in ..., may change or be removed at any time, and are not necessarily supported." and "Update plans as a feature will not be deprecated, but the format of the JSON file could change." It lists real limits: unknown values are recorded as unknown, resources created inside an `apply` on an unknown value are missing from the plan and fail at update time, and explicit providers with unknown inputs produce incomplete plans. `--show-secrets` together with `--save-plan` writes secrets into the plan file in plain text.
Sources: https://www.pulumi.com/docs/iac/concepts/update-plans/ and https://www.pulumi.com/docs/iac/cli/commands/pulumi_up/
Open plan bugs: https://github.com/pulumi/pulumi/issues/18748 and https://github.com/pulumi/pulumi/issues/19708

The brief's hash-and-re-preview design stays the right call.

### 5. Project file naming and listing stacks

**Project file.** "The project file must begin with a capital P and have an extension of either .yml or .yaml."
Source: https://www.pulumi.com/docs/iac/concepts/projects/project-file/

The source accepts three extensions, tried in this order: `.json`, `.yaml`, `.yml` ("Although \".yml\" is not a sanctioned YAML extension, it is used quite broadly; so we will support it.").
Sources: https://github.com/pulumi/pulumi/blob/v3.263.0/sdk/go/common/encoding/marshal.go and `findProjectInDir` in https://github.com/pulumi/pulumi/blob/v3.263.0/sdk/go/common/workspace/paths.go

**Stack config file.** The docs say `Pulumi.<stack-name>.yaml`. The source builds the name from the project file's extension:

```go
fileName := fmt.Sprintf("%s.%s%s", ProjectFile, qnameFileName(stackName), filepath.Ext(projPath))
if proj.StackConfigDir != "" {
	return filepath.Join(filepath.Dir(projPath), proj.StackConfigDir, fileName)
```

Sources: https://www.pulumi.com/docs/iac/concepts/projects/stack-settings-file/ and https://github.com/pulumi/pulumi/blob/v3.263.0/sdk/go/common/workspace/paths.go

Observed:

- With `Pulumi.yml`, `pulumi config set` created `Pulumi.prod.yml`. A TypeScript project with `Pulumi.yml` and `Pulumi.prod.yml` previewed fine. This is the homelab layout and it works.
- After renaming the project file to `Pulumi.yaml` and leaving `Pulumi.prod.yml`, the stack config was ignored: preview failed with "Stack 'prod' is missing configuration value 'exp:token'".
- In that same failed run, preview **created** a new `Pulumi.prod.yaml` containing only a fresh `encryptionsalt`. A preview can dirty the working tree when the stack config file is missing.
- The YAML language runtime only accepts `Pulumi.yaml`: with `Pulumi.yml` it failed with "reading template Main: open .../Pulumi.yaml: no such file or directory". This affects `runtime: yaml` projects only, not TypeScript.
- `stackConfigDir` in the project file moves stack config files to another directory. Discovery must read it.

**Listing stacks.** `pulumi stack ls` lists "stacks with the same project name as the current workspace" unless `--all` is passed. Docs for v3.263.0 show `--output json`. `--json` and `-j` remain as a hidden alias "for backwards compatibility", and `--json` is the only form on 3.198.0, so `--json` is the portable spelling.
Sources: https://www.pulumi.com/docs/iac/cli/commands/pulumi_stack_ls/ and https://github.com/pulumi/pulumi/blob/v3.263.0/pkg/util/outputflag/outputflag.go

Observed output on a file backend:

```json
[ { "name": "prod", "current": false, "lastUpdate": "2026-09-20T09:51:48.997Z", "resourceCount": 9 } ]
```

Does it need a login and network?

- No `pulumi login` step is needed. The backend can come from `PULUMI_BACKEND_URL`. Source: https://www.pulumi.com/docs/iac/concepts/state-and-backends/ . Observed: every command in the experiment ran with only the env var set and an empty `PULUMI_HOME`.
- With no backend configured at all it fails: "PULUMI_ACCESS_TOKEN must be set for login during non-interactive CLI sessions".
- It does need the backend to be reachable. With an S3 URL pointing at a closed port it failed with `read ".pulumi/meta.yaml" ... connection refused`. On S3 it uses `s3:ListBucket` "to enumerate stacks and locks" plus `s3:GetObject`. Source: https://www.pulumi.com/docs/iac/operations/stack-management/using-a-diy-backend/
- MinIO URL form: `s3://<bucket>?endpoint=my.minio.local:8080&disableSSL=true&s3ForcePathStyle=true`. Same source.
- DIY backends created before v3.61.0 keep stacks in a global namespace, not per project, until `pulumi state upgrade` is run. Same source. In that mode stack names are not scoped by project, so do not assume the `<project>/<stack>` layout.

Can stacks be inferred from files alone? Mostly. It is offline, fast and needs no credentials, which suits `discover` and `resolve`. Two gaps: a stack config file without a backend stack (observed: `preview --stack ghost` gives "no stack named 'ghost' found", exit 255, exit 6 on new CLIs), and a backend stack without a config file (config files are optional). The first gap surfaces as a normal error row. The second is only found by `stack ls`.

### 6. Stability of preview output between identical runs

Observed, two consecutive runs with no change in between:

- YAML project, create preview (19 KB) and mixed preview (43 KB): the only differing line was `duration`.
- TypeScript project with three resources created in a `map`: besides `duration`, two steps swapped places (`pet3, pet2, pet1` versus `pet2, pet3, pet1`). Registration is concurrent, so step order is not deterministic.
- Two `refresh --preview-only` runs also listed steps in different orders.
- URNs, ops, `diffReasons`, `replaceReasons` and `detailedDiff` keys were identical across runs. `diffReasons` comes back as an array; sort it too, the source gives no ordering promise.
- Run-specific or machine-specific content exists in fields the hash should not touch: `duration`, and `sourcePosition` and `stackTrace` (file paths and line numbers of the program and SDK).

A hash over sorted `(urn, op, sorted changed keys)` is stable. Hashing raw output is not.

One thing the hash cannot see: a value change that keeps the same key set. If a second merge changes `image: v2` to `image: v3` while `v1 -> v2` was approved, URN, op and keys are identical and the hash still matches. That is a consequence of "never values" and belongs in the hash design ticket, not here. The preview JSON does carry the values needed for a salted value digest if that is wanted.

### 7. Cost of a preview and parallel safety

**Cost.** A preview runs the program in the language host, starts each provider plugin, and asks providers to check and diff each resource. It makes no cloud calls for plain resources; programs that use provider functions (data sources) or stack references do make calls, and `--refresh` reads every resource. Observed wall times on an M-series laptop, file backend:

| Run | Time |
| --- | --- |
| YAML project, first preview, cold plugin cache (downloads `random`, `command`) | 4 s |
| YAML project, warm | about 1 s |
| TypeScript project (3 resources), first run | 2.0 s |
| TypeScript project, warm | 1.3 s |
| Three previews in parallel (two stacks of one TS project plus the YAML project) | 1.5 s total |

Real stacks will be slower: TypeScript startup grows with the program and the shared components package, and an S3 or MinIO backend adds a state download per stack. No number for the 51-project homelab was measured, on purpose (the real stacks were not touched). Expect seconds to low tens of seconds per stack, mostly CPU for Node startup, so bounded concurrency helps.

**Parallel safety.**

- Different stacks: safe. Each stack has its own state object and lock path (`locks/<project>/<stack>/`). Source: https://www.pulumi.com/docs/iac/operations/stack-management/using-a-diy-backend/
- Preview takes no lock on a DIY backend: `Preview` goes to `backend.Preview` without `b.Lock`, while `Update`, `Refresh` and `Destroy` lock. Source: https://github.com/pulumi/pulumi/blob/v3.263.0/pkg/backend/diy/backend.go . Observed: a preview succeeded while an `up` on the same stack held the lock, and two previews of the same stack ran at once.
- So an `apply` on one stack never blocks scans. A scan that overlaps an apply of the same stack may show a diff that is about to disappear, which the re-scan after apply corrects.
- Always pass `--stack` and `--cwd`. Never call `pulumi stack select`, which writes shared workspace state under `PULUMI_HOME`.
- Plugin cache: installs are guarded by lock files (observed `resource-random-v4.21.2.lock` next to each plugin directory), so concurrent previews sharing one `PULUMI_HOME` are safe, but a cold cache means every stack may try to download at once. Plugin version lookups hit the GitHub API (the observed error text points at `api.github.com/.../releases/latest` and suggests `GITHUB_TOKEN`), which is rate limited. Caching `~/.pulumi/plugins` in the workflow avoids both.
- Node dependencies must be installed before preview. In a monorepo with a shared components package that is one install at the root, done by the user's workflow before Sluiceway runs.
- tsx: supported through `runtime.options.nodeargs` ("`--import tsx` when using tsx"). This is project config, Sluiceway does not need to know. Source: https://www.pulumi.com/docs/iac/languages-sdks/javascript/

### 8. CLI versus Automation API

**What the Automation API is.** "Automation API drives the Pulumi CLI under the hood, so the CLI must be available to your program at runtime."
Source: https://www.pulumi.com/docs/iac/automation-api/

**What it adds:** typed workspace and stack objects, inline programs, programmatic CLI install, config and stack management helpers, typed `up` results, and an `onEvent` callback that tails the CLI's `--event-log` file.

**What it does not add for Sluiceway:** `preview()` returns only this:

```ts
export interface PreviewResult { stdout: string; stderr: string; changeSummary: OpMap; }
```

Per-resource ops and changed keys are only available by collecting `ResourcePreEvent`s through `onEvent`, which is the same engine event stream the CLI can emit directly. Drift uses the same flag underneath (`args.push("--preview-only")`), and plans map to the same experimental flags.
Source: https://github.com/pulumi/pulumi/blob/v3.263.0/sdk/nodejs/automation/stack.ts

**What it pulls in.** `@pulumi/pulumi` 3.263.0 depends on `@grpc/grpc-js`, `google-protobuf`, ten `@opentelemetry/*` packages, `@npmcli/arborist`, `execa`, `js-yaml`, `semver`, `source-map-support` and more, with `typescript` and `ts-node` as peers.
Source: https://github.com/pulumi/pulumi/blob/v3.263.0/sdk/nodejs/package.json

**Bundling, observed** with Bun 1.3.14, `bun build --target=node`, `@pulumi/pulumi` 3.248.0:

| Entry | Modules | Bundle size |
| --- | --- | --- |
| `import { LocalWorkspace } from "@pulumi/pulumi/automation"` plus a `preview()` call | 873 | 13.88 MB |
| `execFile("pulumi", ["preview", "--json", ...])` plus `JSON.parse` | 1 | 234 bytes |

The Automation API bundle built without errors and ran a real preview under Node 20 once loaded as ESM, returning `{"create":4}`. The bundle contains `@grpc/grpc-js`, `google-protobuf`, OpenTelemetry and the TypeScript compiler. So the brief's "painful to bundle" did not reproduce as a build failure with current Bun. The cost is a 13.9 MB committed `dist/`, a large dependency surface for Renovate and audits, and no typed steps in return. Pulumi's own tracker has an open issue on bundling the Node SDK, which says bundling is "not currently done" and that in experiments "bundling all dependencies is not beneficial, especially the large \"typescript\" and \"tsnode\" dependencies". Source: https://github.com/pulumi/pulumi/issues/10210

## Consequences for the design

**Nothing blocks the CLI-driver approach.** Option A in the brief stands. Every adapter method maps to one CLI call that was verified to work on a self-managed backend without Pulumi Cloud:

| Adapter method | Command |
| --- | --- |
| `preview` | `pulumi preview --json --non-interactive --color never --stack <s> --cwd <dir>` |
| `detectDrift` | `pulumi refresh --preview-only --json --non-interactive --color never --stack <s> --cwd <dir>` |
| `apply` | `pulumi up --yes --skip-preview --non-interactive --color never --stack <s> --cwd <dir>` |
| `discover` | file scan, optionally checked with `pulumi stack ls --json --cwd <dir>` |

Points the design should take on:

1. **Discovery must not assume `.yaml`.** Match `Pulumi.{yaml,yml,json}`, then look for `Pulumi.<stack>` with the **same extension** as the project file, in `stackConfigDir` if set. Files with the other extension are ignored by Pulumi and should be ignored or warned about. The brief's "find `Pulumi.yaml` files, then `Pulumi.<stack>.yaml`" would find zero stacks in the homelab repo.
2. **Changed keys need a fallback chain.** Use `detailedDiff` keys when present, else `replaceReasons` plus `diffReasons`. Decide once whether `changedKeys` holds property paths (`environment.TOKEN`) or top-level names, since the two sources differ, and apply it before hashing. For creates and deletes there are no changed keys; `op` plus URN is the whole signal.
3. **Filter and sort before hashing.** Drop `same` and `refresh` steps and the root stack resource when it is `same`. Sort steps by URN and keys alphabetically. Never hash raw output.
4. **Read keys only.** `[secret]` masking covers marked secrets only. Parse `oldState` and `newState` for nothing, or strip them right after parsing, so that an unmarked sensitive value cannot reach the issue body or job summary. This also argues for rendering `rendered` from keys instead of copying `pulumi preview --diff` text, which prints unmarked values.
5. **Exit codes are not a contract on older CLIs.** Treat non-zero as failure, take the reason from `diagnostics` and stderr, strip ANSI escapes, and do not assume stdout is valid JSON on failure. Exit codes 6 and 7 can refine messages when the CLI is v3.226.1 or later.
6. **Set a minimum CLI version.** v3.229.0 is a sensible floor: lock-free `refresh --preview-only` on DIY backends (otherwise a scheduled drift scan can fail against a running apply, or block one), and the exit code taxonomy from v3.226.1. `--preview-only` itself needs v3.105.0. Check `pulumi version` at startup and fail with a clear message.
7. **Validate the JSON with Zod and keep recorded fixtures.** The digest has no schema version, and issue #22754 proposes changing what `--json` means for `preview`. A loose schema over `steps[].{op, urn, diffReasons, replaceReasons, detailedDiff}` and `changeSummary` gives an early, clear failure if the shape moves. The engine event stream (`PULUMI_ENABLE_STREAMING_JSON_PREVIEW`) is the fallback if that change ships.
8. **Guard against the config-file side effect.** Preview can create `Pulumi.<stack>.yaml` with a new `encryptionsalt` when the file is missing. Only preview stacks whose config file exists, and never commit from the scan job.
9. **Use `--skip-preview` on apply.** The apply job's own hash-check preview already ran, and `up --yes` without it runs the program a second time.
10. **Bound concurrency and warm the plugin cache.** Previews of different stacks are safe in parallel and take no lock. Document caching `~/.pulumi/plugins` and passing `GITHUB_TOKEN` for plugin lookups.
11. **Do not build on update plans.** Still experimental, format may change, known gaps with unknown values.

**Where this contradicts or sharpens the brief:**

- Discovery rule (`.yaml` only) is wrong for `.yml` projects. See point 1.
- "Changed property keys via detailedDiff" is incomplete: `detailedDiff` was null on replace steps. See point 2.
- "gRPC/protobuf is painful to bundle" did not reproduce as a failure. The real argument against the Automation API is that it returns less than the CLI's `--json` and costs 13.9 MB.
- `rendered: human-readable diff, secrets masked` cannot come from the same preview run as the JSON. See point 4.
- `--expect-no-changes` on `up` and `refresh` checks after applying, so it is not a guard.

**Not verified here:** an `update`-type drift step (no credential-free provider with a real Read that reports changed properties was at hand; behavior is taken from source), timing against a real S3 or MinIO backend, and behavior on a legacy global-namespace DIY backend. All three are cheap to check in the `examples/pulumi-basic` e2e setup with a MinIO service container.
