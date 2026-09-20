# Does the adapter interface survive OpenTofu?

Research for issue #5. Paper exercise only, no adapter code. Checked on 2026-09-20 against the OpenTofu docs and source on `main` (latest release at the time: v1.12.6). Terraform is covered where the formats are shared.

## Answer

**Verdict: yes, the interface survives.** The five-method shape (`discover`, `preview`, `detectDrift`, `apply`, plus `NormalizedDiff`) maps onto OpenTofu without a rewrite. `tofu show -json <planfile>` gives everything `NormalizedDiff` needs: a stable per-resource identity, an action list, before and after values to derive changed keys, and explicit sensitivity masks. Drift comes from a refresh-only plan, and apply is non-interactive. The hash design (identities + ops + changed keys, never values) works unchanged.

What does not survive is a set of Pulumi-shaped names and assumptions. These must change before a second adapter exists:

1. **`urn`** is a Pulumi term. OpenTofu has a resource instance address (`module.child.aws_instance.foo[0]`), plus an optional `deposed` key. Rename to a neutral `address` (or `resourceId`) and document that it is an opaque, adapter-defined, unique string.
2. **`stack` as a config field and as `<path>:<stack>`** assumes every unit has a named instance that lives in a file next to the project file. In OpenTofu the unit is a root module directory plus an optional workspace, optional var files, and optional backend config. The name part is optional and cannot always be discovered. Keep "stack" as the product word if wanted, but make the id `path` or `path:name`, and move tool-specific selection into an adapter options bag.
3. **Zero-config discovery of instances** is Pulumi-only. `Pulumi.<stack>.yaml` files enumerate stacks on disk. OpenTofu workspaces live in the backend, and var files follow no fixed convention. OpenTofu discovery can find root module directories, not their instances.
4. **`op` as exactly four values** is too narrow. OpenTofu also emits `no-op`, `read`, `forget`, `["forget","create"]`, and flags moves (`previous_address`) and imports (`importing`) separately from the action. Pulumi has the same concepts (`same`, `read`, `import`, `discard`). Add `forget` at minimum, and define how adapters fold the rest.
5. **`preview` means "code vs state"** only in Pulumi. A normal OpenTofu plan refreshes first, so it is "code vs reality", and the same plan JSON already carries `resource_drift`. Reword the comments, and let one tool run feed both results.
6. **`apply(stack)` with no plan argument** assumes the tool can only re-plan at apply time. OpenTofu can apply a saved plan file exactly. Add an optional "apply this exact plan" capability so the apply job can plan once, hash that plan, and apply that same plan. Keep the hash compare. Do not carry plan files from `scan` to `apply`.
7. **`id: "pulumi" | "opentofu"`** leaves no room for Terraform, which shares the format but is drifting (extra fields and actions). Make the id an open string, or add `"terraform"`.
8. **No prepare step.** OpenTofu needs `tofu init` (with backend config) and a workspace selection before any plan. This can stay inside the adapter, but the unit type must carry the inputs for it.
9. **Env pass-through list** in the brief is Pulumi-only (`PULUMI_*`). The principle is neutral, the names are not. OpenTofu uses `TF_*` variables (`TF_WORKSPACE`, `TF_VAR_*`, `TF_INPUT`, `TF_IN_AUTOMATION`, `TF_DATA_DIR`, `TF_ENCRYPTION`).

Nothing in `core/` (hash, graph, render, markers) needs a structural change. All of the above are renames, one widened union, one options bag, and one optional capability.

## Side-by-side mapping

| Brief concept | Pulumi | OpenTofu | Fit |
| --- | --- | --- | --- |
| Project | Directory with `Pulumi.yaml` | Root module: a directory of `.tf` / `.tofu` files that you run `tofu` in | Good. No manifest file to find, so discovery uses heuristics or config. |
| Stack (instance) | `Pulumi.<stack>.yaml` next to the project | CLI workspace (`default` always exists), or a var file, or a backend config, or a separate directory per environment | Partial. Often there is no named instance at all. |
| `stackId` `"infra/proxmox:prod"` | path + stack name | path, or path + workspace, or path + a name from config | Works if the name part is optional. |
| Discovery | Glob `Pulumi.yaml`, then `Pulumi.*.yaml` | Glob directories with a `backend` block or a committed `.terraform.lock.hcl`. Instances must come from `sluiceway.yaml`. | Partial. Zero config covers "one directory, default workspace" only. |
| Select instance | `--stack` | `TF_WORKSPACE` or `tofu workspace select`, `-var-file`, `init -backend-config` | Adapter detail, needs an options bag. |
| Prepare | install deps, login | `tofu init -input=false [-backend-config=...]` | Adapter detail. |
| `preview` | `pulumi preview --json` | `tofu plan -out=FILE -input=false` then `tofu show -json FILE` | Good. Two commands instead of one. |
| `urn` | URN | `address` (plus `deposed` when set) | Rename. |
| `type` | Pulumi type token | `type` (for example `aws_instance`) | Good. |
| `name` | Logical name | `name`, with `index` and `module_address` separate | Good. Render the address, since `name` alone is ambiguous under `count`, `for_each` and modules. |
| `op` | `create`, `update`, `replace`, `delete`, plus `same`, `read`, `import`, `discard` and replacement sub-steps | `actions` array, see table below | Widen the union. |
| `changedKeys` | From the detailed diff | Derived from `before`, `after`, `after_unknown`; `replace_paths` names the keys that force replacement | Good, adapter must derive. |
| Secret handling | Secrets marked by the engine | `before_sensitive` / `after_sensitive` masks. Raw values are in the JSON in plain text. | Good, but the JSON and the plan file are sensitive artifacts. |
| `rendered` | CLI diff output | `tofu show FILE` (human output, sensitive values redacted unless `-show-sensitive`) | Good. |
| `summary` | Count by op | Count by folded op. Machine UI `change_summary` only has add, change, remove. | Good, count in the adapter. |
| `detectDrift` | Refresh in preview-only mode | `tofu plan -refresh-only -out=FILE`, read `resource_drift` | Good. Does not write state unless applied. |
| "Has changes" | Parse JSON | `-detailed-exitcode`: 0 empty, 1 error, 2 changes | Good as a fast path. |
| `apply` | `pulumi up --yes` | `tofu apply -input=false -auto-approve`, or `tofu apply FILE` (no prompt) | Good, plus exact-plan option. |
| Stale approval guard | Re-preview and compare hash | Same, and the tool itself rejects a saved plan when the state serial changed | Better than the brief assumes. |
| Env pass-through | `PULUMI_ACCESS_TOKEN`, `PULUMI_BACKEND_URL`, `PULUMI_CONFIG_PASSPHRASE` | `TF_*`, backend credentials via env, `TF_ENCRYPTION` | Same principle, different names. |

### Action mapping

| OpenTofu `change.actions` | Other flags | Proposed neutral `op` | Notes |
| --- | --- | --- | --- |
| `["create"]` | | `create` | |
| `["update"]` | | `update` | |
| `["delete","create"]` | | `replace` | Destroy first. Downtime is likely. |
| `["create","delete"]` | | `replace` | `create_before_destroy`. Keep the order as detail, not as a separate op. |
| `["delete"]` | | `delete` | `action_reason` says why (no config, count index, and so on). |
| `["forget"]` | | `forget` | Removed from state, real object kept. Not a destroy. Must not trigger the delete warning. |
| `["forget","create"]` | | `replace` with a forget flag, or its own op | In the source, not in the docs list. Decide in the decision ticket. |
| `["no-op"]` | none | dropped | Every resource in config appears in `resource_changes`, so most entries are `no-op` and must be filtered out. |
| `["no-op"]` | `previous_address` set | `move` (or dropped from counts, shown in detail) | State-only change from a `moved` block. |
| `["no-op"]` or `["update"]` | `importing` set | `import` flag on the change | Import is orthogonal to the action. |
| `["read"]` | `mode: "data"` | dropped from counts and hash | A data source read deferred to apply. No infrastructure effect. |

## Detail

### 1. Plan JSON: the source for `NormalizedDiff`

The JSON plan is produced from a saved plan file, not from `plan` directly. The docs say the binary plan format "isn't suited for use with external tools (and likely never will be)", and that `tofu show -json <FILE>` is the supported machine-readable form. `tofu plan -json` is a different thing: a line-delimited UI log. Its `planned_change` messages carry an address and a single action word (`noop`, `create`, `read`, `update`, `replace`, `delete`, `move`) but explicitly "does not include details about the exact changes". So the adapter needs `plan -out` plus `show -json`. The streamed log is only useful for progress during apply.

- https://opentofu.org/docs/internals/json-format/
- https://opentofu.org/docs/internals/machine-readable-ui/
- https://opentofu.org/docs/cli/commands/show/

**Versioning.** The output has a `format_version`. Minor bumps are backward compatible ("Ignore any object properties with unrecognized names"), major bumps are not ("Reject any input which reports an unsupported major version"). The docs page shows `"1.0"`, but the source constant on `main` is `FormatVersion = "1.2"`, the same value Terraform uses. The adapter should accept any `1.x` and parse with a schema that strips unknown keys, which fits the brief's Zod plan.

- https://github.com/opentofu/opentofu/blob/main/internal/command/jsonplan/plan.go (`FormatVersion`)
- https://github.com/hashicorp/terraform/blob/main/internal/command/jsonplan/plan.go (`FormatVersion`)

**Identity (replaces `urn`).** Each entry in `resource_changes` has `address`, "the full absolute address of the resource instance", for example `module.child.aws_instance.foo[0]`. It also has `module_address`, `mode` (`managed` or `data`), `type`, `name`, `index`. When `deposed` is set, the change applies to a deposed object, and the docs state that "`address` and `deposed` together form a unique key across all change objects in a particular plan". So the neutral identity for OpenTofu is `address`, or `address` + `#` + `deposed` when present. The address grammar (`module.name[index].type.name[index]`, with numeric or string keys) is documented separately.

- https://opentofu.org/docs/internals/json-format/#plan-representation
- https://opentofu.org/docs/cli/state/resource-addressing/

**Actions.** The documented valid values of `change.actions` are `["no-op"]`, `["create"]`, `["read"]`, `["update"]`, `["delete","create"]`, `["create","delete"]`, `["delete"]`, `["forget"]`. The docs explain the two-element forms: replace is written this way "to allow callers to e.g. just scan the list for `delete` to recognize all three situations where the object will be deleted". The source also emits `["forget","create"]` (`ForgetThenCreate`), which the docs list does not mention yet. Anything unknown falls through as a single raw string, so the adapter needs a default branch that fails loudly or maps to a visible "unknown" state, never to "no change".

Three things sit outside `actions`:

- **Moved.** `previous_address` is "Included only if the address has changed, e.g. by handling a `moved` block". A pure move has `actions: ["no-op"]` with `previous_address` set. The machine UI calls this action `move`.
- **Import.** "If importing is present (ie. not null) then the change is an import operation in addition to anything mentioned in the actions field." So an import can be `no-op` or `update` underneath.
- **Reason.** `action_reason` gives display hints such as `replace_because_tainted`, `replace_because_cannot_update`, `replace_by_request`, `replace_by_triggers`, `delete_because_no_resource_config`, `read_because_config_unknown`. The docs warn that the set "may change over time" and unknown values must be treated as unspecified. Useful for `rendered`, not for the hash.

Also note: "All resources in the configuration are included in this list", so `no-op` entries dominate a real plan and must be filtered.

- https://opentofu.org/docs/internals/json-format/#change-representation
- https://github.com/opentofu/opentofu/blob/main/internal/command/jsonplan/plan.go (`actionString`)
- https://github.com/opentofu/opentofu/blob/main/internal/plans/action.go

Pulumi has the same extra concepts, which is why the widened union is neutral and not an OpenTofu leak. Its step ops include `same`, `read`, `import`, `discard`, `refresh`, and replacement sub-steps (`create-replacement`, `delete-replaced`).

- https://github.com/pulumi/pulumi/blob/master/pkg/resource/deploy/step.go (`StepOp` constants)

**Changed keys.** The change object has `before`, `after`, and `after_unknown`. For `create`, `before` is unset. For `delete` and `forget`, `after` is unset. `after` "will be incomplete if there are values within it that won't be known until after apply", and `after_unknown` has "all unknown leaf values replaced with `true`, and all known leaf values omitted". This gives the derivation rule:

1. Take the union of top-level keys in `before` and `after`.
2. A key is changed when its `before` and `after` values differ structurally.
3. A key present in `after_unknown` is changed (or at least "may change"), even though it is missing from `after`. Without this step an unknown value looks like a removed attribute. For updates, an unknown computed attribute (`id`, `arn`) that was known before counts as changed, which matches what the CLI shows as "(known after apply)".
4. For `create` and `delete`, either list all keys or list none. Pick one and keep it fixed, because it feeds the hash.
5. `replace_paths` lists the paths "which resulted in the action being replace". It is omitted when no path caused it (tainted, for example). Worth surfacing in `rendered`.

Depth is a decision for later: top-level attribute names are the simplest stable choice, dotted paths are more precise but noisier for nested blocks and sets. The hash only needs the choice to be deterministic.

Hash stability is good: the hash excludes values, so computed values, timestamps and unknowns do not move it. Key order in the JSON does not matter after sorting. `resource_changes` is already sorted by address in the source, but core should sort anyway.

**Sensitive values.** `before_sensitive` and `after_sensitive` have the same shape as `before` and `after` "with all sensitive leaf values replaced with true". The docs say they "should be combined with before and after to prevent accidental display of sensitive values". Important: the raw values are present in plain text in `before` and `after`. The `show` docs warn that with `-json` "any sensitive values in OpenTofu state will be returned in plain text", and the plan docs say a saved plan may hold sensitive data "in cleartext in the plan file unless plan encryption is enabled". Consequences:

- `changedKeys` (names only) is safe by construction, as the brief requires.
- The adapter must compare sensitive values in memory to detect a change, and must never log or write the JSON. Keep it in a temp dir and delete it.
- For `rendered`, use the human output of `tofu show FILE`, which redacts sensitive values unless `-show-sensitive` is passed. Masking only covers what providers and variables mark as sensitive, so the brief's `dashboard.redact` mode still matters.
- The plan file and the JSON are sensitive artifacts. Do not upload them as workflow artifacts. If the user has state and plan encryption on, the adapter needs `TF_ENCRYPTION` or the config block to read its own plan file, which works through env pass-through.

- https://opentofu.org/docs/cli/commands/show/
- https://opentofu.org/docs/cli/commands/plan/ (`-out`, `-show-sensitive`)
- https://opentofu.org/docs/language/state/encryption/

**Other top-level fields worth using.** `errored` ("An errored plan cannot be applied") maps to the brief's error row. `output_changes` holds root output changes, which have no `urn` equivalent. An outputs-only change makes a plan non-empty, so the adapter should either add pseudo-entries (address `output.<name>`) or accept that such a plan shows as in sync. Decide later, but the identity field must allow non-resource ids.

**Terraform.** Same structure and same `format_version`. Terraform's struct has extra top-level fields (`applyable`, `complete`, `deferred_changes`, `action_invocations`) and one more action pair (`["create","forget"]`). An adapter that ignores unknown keys and has a default branch for unknown actions can serve both binaries. That is a reason to keep `Adapter.id` open.

- https://developer.hashicorp.com/terraform/internals/json-format
- https://github.com/hashicorp/terraform/blob/main/internal/command/jsonplan/plan.go

### 2. Project and stack equivalents, and discovery

**Project.** The OpenTofu unit is a root module: the `.tf` or `.tofu` files in the directory where `tofu` runs. `tofu -chdir=DIR <subcommand>` runs against another directory. There is no manifest file like `Pulumi.yaml`, and child modules look the same as root modules on disk.

- https://opentofu.org/docs/language/modules/
- https://opentofu.org/docs/cli/commands/ (`-chdir`)

**Stack.** There are four common ways to get "the same code, several instances", and none is canonical:

1. **CLI workspaces.** "separate instances of state data inside the same OpenTofu working directory". Every directory starts with one workspace named `default`, which cannot be deleted. The selected workspace is stored locally in `.terraform`, or forced with `TF_WORKSPACE`, which the docs recommend "only for non-interactive usage". Workspaces share one backend and one set of credentials, and the docs say they "are not a suitable isolation mechanism" for deployments that need separate credentials. Only some backends support them.
2. **Var files.** `-var-file=FILENAME` per environment. `terraform.tfvars` and `*.auto.tfvars` load automatically. Any other name, such as `prod.tfvars`, is a team convention.
3. **Partial backend config.** `tofu init -backend-config=PATH` or `KEY=VALUE`, so one directory points at different state per environment. The merged result is stored in `.terraform`.
4. **Directory per environment.** `envs/prod`, `envs/staging`, each a root module calling shared modules. The docs recommend this as the alternative to workspaces. Here the path alone is the full identity.

- https://opentofu.org/docs/cli/workspaces/
- https://opentofu.org/docs/language/state/workspaces/
- https://opentofu.org/docs/cli/config/environment-variables/ (`TF_WORKSPACE`)
- https://opentofu.org/docs/language/values/variables/ (`.tfvars` loading and precedence)
- https://opentofu.org/docs/language/settings/backends/configuration/ (partial configuration)

**Discovery.** Pulumi stacks are visible on disk. OpenTofu instances mostly are not: workspaces live in the backend, so listing them needs `tofu init` plus backend credentials, and var file or backend config pairing is a convention. Realistic discovery:

- Find candidate root modules by a directory that has a `terraform { backend ... }` block, or a committed `.terraform.lock.hcl` (the docs recommend committing it, and it is only written for directories where `init` ran). `tofu show -json -module=DIR` can inspect a module's config without installing dependencies, which may help tell root from child modules. This heuristic needs validation in the adapter ticket.
- Zero config yields one unit per root module directory with workspace `default`. That covers layout 4 fully.
- Layouts 1 to 3 need explicit entries in `sluiceway.yaml` with `workspace`, `varFiles`, `backendConfig`.

So the brief's promise "Zero config should work for the common case" holds for directory-per-environment repos only, and the `Stack` type needs adapter-specific fields.

- https://opentofu.org/docs/language/files/dependency-lock/
- https://opentofu.org/docs/cli/commands/show/ (`-module=DIR`)

**Working directory collisions.** Workspace selection and backend config are both stored in `.terraform` inside the directory. When `scan` walks two units that share a directory (same path, different workspace or backend config) in one checkout, they overwrite each other. The adapter should set `TF_DATA_DIR` per unit, or use `TF_WORKSPACE` plus `init -reconfigure`. This is internal to the adapter but it is the reason the unit must carry a unique id that the adapter can turn into a directory name.

- https://opentofu.org/docs/cli/config/environment-variables/ (`TF_DATA_DIR`)
- https://opentofu.org/docs/cli/commands/init/ (`-reconfigure`, `-backend-config`)

### 3. Drift

`tofu plan -refresh-only` "creates a plan whose goal is only to update the OpenTofu state and any root module output values to match changes made to remote objects outside of OpenTofu". A plan does not write state. Only applying that plan does. So it satisfies the brief's "must not mutate". It cannot be combined with `-refresh=false`.

The result is in the top-level `resource_drift` array of the plan JSON, "the changes OpenTofu detected when it compared the most recent state to the prior saved state", using "the same object structure as `resource_changes`". So the same parser yields a `NormalizedDiff`. Drift actions are `update` and `delete` (a resource cannot be created by drift). In refresh-only mode the array also includes move-only entries, which the source filters out in normal mode.

Two differences from Pulumi matter for the interface:

- **A normal plan already refreshes.** By default a plan "Reads the current state of any already-existing remote objects" first, and the normal plan JSON includes `resource_drift` too, with `relevant_attributes` to tell which drift affected the plan. So OpenTofu's `preview` is "code vs reality", and one plan can serve both `preview` and `detectDrift`. The interface should allow an adapter to return both from one run, to halve the API calls on scheduled scans.
- **Drift semantics differ in the direction of the diff.** `resource_drift` reads "state, then reality" (what changed outside). The normal plan then shows what apply would do about it, usually reverting it. The dashboard's drift section should show `resource_drift`, and ticking the row runs a normal apply. That matches the brief's model.

`-detailed-exitcode` gives 0 for an empty diff, 1 for error, 2 for changes. In the source, exit code 2 follows `plan.CanApply()`, and a refresh-only plan counts as applyable when drift was found. In normal mode, drift alone does not make the plan non-empty. The adapter should read the JSON anyway, and use the exit code only to tell "error" from "success".

- https://opentofu.org/docs/cli/commands/plan/ (planning modes, `-refresh=false`, `-detailed-exitcode`)
- https://opentofu.org/docs/internals/json-format/#plan-representation (`resource_drift`, `relevant_attributes`)
- https://github.com/opentofu/opentofu/blob/main/internal/command/jsonplan/plan.go (`Marshal`, drift filtering)
- https://github.com/opentofu/opentofu/blob/main/internal/plans/plan.go (`CanApply`)
- https://github.com/opentofu/opentofu/blob/main/internal/command/plan.go (exit code)

### 4. Non-interactive apply

Two modes:

- **Automatic plan mode.** `tofu apply -input=false -auto-approve`. Note that `-input=false` alone also blocks the approval prompt, so the apply fails instead of hanging. `-json` requires `-auto-approve` or a saved plan.
- **Saved plan mode.** `tofu apply FILE`. OpenTofu "takes the actions in the saved plan without prompting you for confirmation", and `-auto-approve` is ignored because passing the file is the approval. No planning options are allowed, since "the plan file contains the final results of those decisions". One exception: ephemeral variables are not stored in the plan, so they must be passed again at apply.

Supporting env: `TF_INPUT=0` behaves like `-input=false`. `TF_IN_AUTOMATION` only changes human output. `-lock-timeout` helps on shared state. `tofu init -input=false` must run first in every fresh checkout.

- https://opentofu.org/docs/cli/commands/apply/
- https://opentofu.org/docs/cli/config/environment-variables/
- https://opentofu.org/docs/cli/commands/init/

### 5. Exact plan apply versus re-preview and hash

This is the one structural difference. The brief's apply job does: preview, hash, compare with `expectedHash`, then apply, where apply plans again internally. Between the hash check and the tool's own internal plan there is a small window where state or reality can move, and what gets applied was never hashed. With Pulumi that window is accepted because saved update plans are not to be relied on (the brief says so).

OpenTofu closes that window:

1. `tofu plan -out=FILE`
2. `tofu show -json FILE`, normalize, hash
3. Compare with `expectedHash`. Abort on mismatch, as in the brief.
4. `tofu apply FILE`. This applies exactly what was hashed.

The tool adds its own guard. When applying a saved plan, the local backend compares the plan's prior state with current state and fails with "Saved plan is stale" ("the state was changed by another operation after the plan was created") when the serial differs, or "Saved plan does not match the given state" when the lineage differs.

- https://github.com/opentofu/opentofu/blob/main/internal/backend/local/backend_local.go

**Should plan files travel from `scan` to `apply`?** No. Reasons:

- A plan goes stale as soon as any other apply touches the state, and the dashboard can sit for days. The stale check is on state serial, not on reality, so an old plan can also apply against drifted reality.
- The plan file holds the full configuration, all variable values, and possibly secrets in clear text. Storing it as a workflow artifact breaks "never hold credentials" in spirit, and artifacts expire.
- It would make the issue marker point at stored state, which breaks "The issue is a rendered view, never the source of truth".
- Pulumi cannot do it, so core would need two flows.

**Recommendation.** Keep the stateless hash flow as the only cross-job contract. Add an optional, adapter-local "exact plan" handle that lives only inside one `apply` job: the preview returns an opaque handle, and `apply` accepts it. Adapters without the capability ignore it and re-plan, which is the brief's current behavior. Core code stays the same for both: preview, hash, compare, apply(handle if any).

## Recommendation (proposal for a later decision ticket)

Everything below is a sketch to be decided in the follow-up ticket (#12 is blocked by this one). It is not a final design.

### Names

| Brief name | Proposed | Why |
| --- | --- | --- |
| `urn` | `address` | Used by OpenTofu and Terraform, understandable for Pulumi (a URN is an address). Documented as opaque and unique within one diff. |
| `Stack` (type) | `Stack` kept as the Sluiceway domain word, fields made neutral | The dashboard and config already say "stack". The word is fine as a product term as long as it means "one deployable unit with its own state", not "a Pulumi stack". Judgment call, alternative is `Unit`. |
| `stackId` | `stackId`, format `path` or `path:name` | The name part becomes optional. |
| config `stack: prod` | `name: prod` (optional) plus adapter options | For Pulumi, `name` defaults to the Pulumi stack name. For OpenTofu it is a label. |
| `op` four values | add `forget`, define folding rules | See the action table. |
| `preview` comment "code vs state" | "pending changes if applied now" | True for both tools. |
| `detectDrift` comment "state vs reality" | unchanged | Already neutral. |
| `id: "pulumi" \| "opentofu"` | `id: string` with known values `"pulumi"`, `"opentofu"`, `"terraform"` | Terraform shares the adapter with a different binary name. |

### Interface sketch

```ts
// PROPOSAL ONLY. To be decided in a later ticket.

type AdapterId = "pulumi" | "opentofu" | "terraform" | (string & {});

interface Stack {
  id: string;                 // "infra/proxmox:prod" or "infra/network"
  adapter: AdapterId;
  path: string;               // Pulumi project dir, or OpenTofu root module dir
  name?: string;              // Pulumi stack name, or a label for OpenTofu
  environment?: string;       // GitHub Environment
  dependsOn: string[];
  options: AdapterOptions;    // validated by the adapter, opaque to core
}

type AdapterOptions =
  | { kind: "pulumi"; stack: string }
  | {
      kind: "opentofu";
      workspace?: string;       // default: "default"
      varFiles?: string[];      // passed as -var-file, in order
      backendConfig?: string[]; // passed to init as -backend-config
      binary?: "tofu" | "terraform";
    };

type Op = "create" | "update" | "replace" | "delete" | "forget";

interface ResourceChange {
  address: string;            // was `urn`. Opaque, unique within the diff.
  previousAddress?: string;   // set when the resource was moved or renamed
  type: string;
  name: string;
  op: Op;
  imported?: boolean;         // adoption of an existing object
  changedKeys: string[];      // property names only, never values
  replaceKeys?: string[];     // keys that forced a replace, when known
}

interface NormalizedDiff {
  stackId: string;
  changes: ResourceChange[];
  summary: Record<Op, number>;
  rendered: string;           // human-readable diff, secrets masked
}

// Opaque token for "apply exactly what was previewed".
// Valid only inside the process or job that created it. Never serialized
// into the issue, never uploaded.
interface PlanHandle {
  readonly adapter: AdapterId;
  readonly stackId: string;
}

interface PreviewResult {
  diff: NormalizedDiff;
  drift?: NormalizedDiff;     // filled when the tool reports drift in the same run
  plan?: PlanHandle;          // filled when capabilities.exactPlanApply and savePlan
}

interface Adapter {
  id: AdapterId;
  capabilities: {
    exactPlanApply: boolean;  // OpenTofu: true. Pulumi: false.
    driftInPreview: boolean;  // OpenTofu: true. Pulumi: false.
  };
  discover(root: string, config: Config): Promise<Stack[]>;
  preview(stack: Stack, opts?: { savePlan?: boolean }): Promise<PreviewResult>;
  detectDrift(stack: Stack): Promise<NormalizedDiff>;   // must not mutate
  apply(stack: Stack, opts?: { plan?: PlanHandle }): Promise<ApplyResult>;
  dispose?(plan: PlanHandle): Promise<void>;            // delete plan file and JSON
}
```

### Core rules that follow

- **Hash input** becomes `address` + `op` + sorted `changedKeys`, sorted by `address`. Same algorithm as the brief, new field name. `previousAddress`, `imported` and `replaceKeys` should be included so that a move or an import cannot hide behind an unchanged hash.
- **Apply flow in core** is one code path: `preview(stack, { savePlan: adapter.capabilities.exactPlanApply })`, hash, compare, `apply(stack, { plan })`, `dispose`. With Pulumi, `plan` is undefined and behavior equals the brief.
- **Warnings.** `> [!WARNING]` applies to `replace` and `delete`. `forget` gets a softer note, since the real object survives.
- **Folding rules belong to the adapter**: drop `no-op` and data source `read`, fold both replace orders into `replace`, surface moves and imports through the optional fields. Unknown actions must raise an error row, never count as "in sync".
- **Config schema** (`sluiceway.yaml`): replace the required `stack:` key with optional `name:` plus an optional per-adapter block. Pulumi zero config is unchanged.
- **`core/` stays free of tool words.** No `urn`, `workspace`, `tfvars` or `Pulumi.yaml` outside `adapters/`.

### Open points for the decision ticket

1. `Stack` versus a fully neutral word such as `Unit`.
2. Depth of `changedKeys` (top-level names versus paths), and whether `create` and `delete` list keys at all.
3. How to represent output-only changes, which make an OpenTofu plan non-empty but have no resource address.
4. Whether `["forget","create"]` is `replace` with a flag or its own op.
5. Whether `detectDrift` stays a separate method once `preview` can return `drift`, or becomes optional.
6. The root module discovery heuristic, to be validated with real repos in the adapter ticket.

## Sources

OpenTofu docs (checked 2026-09-20):

- https://opentofu.org/docs/internals/json-format/
- https://opentofu.org/docs/internals/machine-readable-ui/
- https://opentofu.org/docs/cli/commands/plan/
- https://opentofu.org/docs/cli/commands/apply/
- https://opentofu.org/docs/cli/commands/show/
- https://opentofu.org/docs/cli/commands/init/
- https://opentofu.org/docs/cli/commands/
- https://opentofu.org/docs/cli/workspaces/
- https://opentofu.org/docs/language/state/workspaces/
- https://opentofu.org/docs/language/settings/backends/configuration/
- https://opentofu.org/docs/language/values/variables/
- https://opentofu.org/docs/language/state/encryption/
- https://opentofu.org/docs/language/files/dependency-lock/
- https://opentofu.org/docs/language/modules/
- https://opentofu.org/docs/cli/state/resource-addressing/
- https://opentofu.org/docs/cli/config/environment-variables/

OpenTofu source (`main`, latest release v1.12.6):

- https://github.com/opentofu/opentofu/blob/main/internal/command/jsonplan/plan.go
- https://github.com/opentofu/opentofu/blob/main/internal/plans/action.go
- https://github.com/opentofu/opentofu/blob/main/internal/plans/plan.go
- https://github.com/opentofu/opentofu/blob/main/internal/command/plan.go
- https://github.com/opentofu/opentofu/blob/main/internal/backend/local/backend_local.go

Terraform and Pulumi, for comparison:

- https://developer.hashicorp.com/terraform/internals/json-format
- https://github.com/hashicorp/terraform/blob/main/internal/command/jsonplan/plan.go
- https://github.com/pulumi/pulumi/blob/master/pkg/resource/deploy/step.go
