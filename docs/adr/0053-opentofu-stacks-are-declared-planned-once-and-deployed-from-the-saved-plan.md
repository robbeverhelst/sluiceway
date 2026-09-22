# OpenTofu stacks are declared in sluiceway.yaml, initialised one directory at a time, and deployed from the plan that was hashed

> Amended by 0058: a deploy may end as `moved` when the adapter finds, before its tool deploys, that what would go out is not what the fresh preview saw. Helm does, and its preparation is one dependency build per chart.

> Amended by 0068: `tool: terraform` runs the same commands with `terraform`, v1.14.0 or newer, and a Terraform plan must be complete. The named option `wrapper` puts Terragrunt or CDK for Terraform in front of the tool. The name of a CDK for Terraform entry picks the stack it deploys.

The build plan's slice 4.1 adds a second adapter, so that Sluiceway is an IaC dashboard and not a Pulumi dashboard. The adapter research (`docs/research/opentofu-adapter-fit.md`) showed the interface survives OpenTofu, and records 0006, 0007, 0015 and 0021 were already written with it in mind. This record settles what the research left open and what the build found with the real tool, v1.11.0 and v1.12.6, on 2026-09-22.

## Decision

**A stack is declared, never guessed.** A root module and a child module look the same on disk, and a workspace lives in the backend, so files alone cannot say what an OpenTofu stack is. A `stacks` entry with `tool: opentofu` declares one: the root module in `path`, an optional `name`, and the named options `workspace` and `varFiles`. Its stack id is `path`, or `path:name` (record 0006). The name is a label and selects nothing: two stacks of one directory in two workspaces name the workspace in their options. Pulumi keeps zero config. An entry without `tool` still only adds settings to stacks that discovery found.

**Core stays free of tool words** (record 0006). Core takes `tool` as text and `options` as a mapping, and refuses options on an entry without a tool. The adapters say which tools exist and check the options, in the same words as every other config problem, and the JSON schema gets both from the adapters. The tool travels in the stack's options bag, which only adapters read, and one adapter that sends each stack to its tool is what the modes use. A stack without a tool in its options is a Pulumi stack, so a Pulumi repo runs exactly the code it ran before.

**Discovery checks from the files.** The directory must exist and hold `*.tf`, `*.tofu`, `*.tf.json` or `*.tofu.json`, and every var file must be a file inside the repo, relative to the stack's directory. It never starts the tool, so `check`, `resolve` and `settle` still hold no credentials (record 0014). A directory of `.tf` files that no entry names is no stack, only files.

**The command lines**, all with `-input=false` and `-no-color`, each run in the stack's directory:

| Step | Command |
|---|---|
| Version | `tofu version -json`, in the repo root |
| Prepare | `tofu init`, once per directory |
| Preview | `tofu plan -refresh=false -json -out=<plan file> [-var-file=...]`, then `tofu show -json <plan file>` |
| Tool diff (record 0048) | `tofu plan -refresh=false [-var-file=...]` |
| Deploy | `tofu apply -json <plan file>` |

- `-refresh=false`, because a preview compares code with state and never reads every real object (record 0015). The research noted that a plain plan refreshes. Record 0015 keeps the preview and the drift check apart on purpose, and the plan file carries the choice to the deploy.
- `-json` on the plan and the deploy, because their human output prints values. Their JSON log gives the diagnostics and the progress messages for the job log (record 0022), and never the outputs or the code snippet of a diagnostic. The diff itself comes from `show -json` of the plan file, which the docs name as the one machine-readable form.
- Every command of a stack with a `workspace` gets `TF_WORKSPACE`. Init gets none, because it is shared by the stacks of its directory.

**Init runs one directory at a time, before any preview.** The first user's earlier dashboard ran inits side by side and they corrupted stacks. The adapter interface grows an optional `prepare(stacks)` that names the steps, one per directory in path order, and the modes run them one after the other before the pool, and before the fresh preview in `apply`. A failed init is a preview failure, "the tool exited with an error", of every stack of its directory, and those stacks are not previewed. Its words go to one group of the job log.

**The diff, settled from the recordings:**

| Plan `actions` | Becomes |
|---|---|
| `["no-op"]` | dropped |
| `["no-op"]` with `previous_address` | `none` with `move`, and `previousAddress` |
| `["no-op"]` with `importing` | `none` with `import` |
| `["read"]`, or anything of a data source | dropped: a data source changes no real object |
| `["create"]` | `create` |
| `["update"]` | `update`, with `move` or `import` when the change says so |
| `["delete","create"]`, `["create","delete"]` | `replace` |
| `["delete"]` | `delete` |
| `["forget"]` | `none` with `forget` |
| `["forget","create"]` | `create` with `forget` (record 0007). In the tool's source, in no recording |
| anything else | the preview fails, "the tool reported a step Sluiceway does not know" |

- The address is the plan's `address`, with ` deposed <key>` when a change is about a deposed object. What a person sees is the type and the address without its type, so a module and a `count` or `for_each` key stay in it: `local_file` `module.web.page["index"]`.
- Changed paths come from comparing `before` and `after` in memory (records 0021 and 0046). A leaf that differs is a changed path. A leaf `after_unknown` marks is a changed path with no value. A value marked sensitive on either side is compared whole and is a changed path at the place of the mark, never below it, so not even the keys of a sensitive map reach a row. `replace_paths` gives `replaceKeys`, cut at a sensitive mark the same way, and each is a changed key too. Paths are written the way the Pulumi adapter writes them, so a row reads one notation for both tools.
- `dashboard.showValues` (record 0052) reads the listed paths from the same comparison: scalars only, never a sensitive or unknown value.
- `resource_drift` and `relevant_attributes` are not read: drift is not in v1. `output_changes` is not read: a change to root outputs alone is in sync (record 0036), as the recording `outputs-only` shows.
- A plan whose `format_version` is not `1.x`, or that says `errored`, is output Sluiceway cannot read. It is never in sync.
- There is no "stack does not exist" reason for OpenTofu. The local backend plans a workspace it does not hold as all creates and exits 0, and other backends give the generic exit code 1. The row then shows every resource as a create, before anyone ticks.

**The deploy is the plan that was hashed.** `apply` asks its fresh preview to keep the plan file, checks the diff hash as before (record 0008), and hands the adapter that plan. `tofu apply <plan file>` applies what the file holds and nothing else, and refuses it as stale when the state changed since the plan (recording `stale-plan`). The OpenTofu adapter refuses a deploy without a plan. The plan file holds every value in plain text (record 0021), so it lives in a temporary directory of its own, which goes when the preview ends, or, for the plan `apply` keeps, on every way out of `apply`: deployed, moved, rehearsed or failed. It never travels between jobs and is never uploaded: a plan from a scan could be days old, and the research gave the reasons. Pulumi has no saved plan that can be relied on (`docs/later.md`), ignores the request, and keeps its behaviour byte for byte.

**The floor is v1.11.0**, the oldest OpenTofu line still patched on 2026-09-22: its releases page shows 1.12.6 and 1.11.14 released together, and 1.10's last patch in May 2026. The research fixed no number. Everything the adapter reads was recorded with v1.11.0 and v1.12.6. The version check runs `tofu version -json` once per job, and only when the stacks at hand include an OpenTofu stack, so a Pulumi repo never needs tofu.

**The environment passes through** (record 0013). Every `TF_*` variable of the job reaches the tool: `TF_VAR_*`, `TF_CLI_CONFIG_FILE`, `TF_ENCRYPTION`, `TF_PLUGIN_CACHE_DIR`. Sluiceway sets `TF_IN_AUTOMATION` and, from the options, `TF_WORKSPACE`, and nothing else. `TF_CLI_ARGS` is not removed either: the environment is the workflow's (record 0015 names it as the way to change behaviour that has no option). What it adds to a plan is in the plan file, so the deploy still applies exactly what was hashed. A `TF_DATA_DIR` shared by several directories would make their inits share one data directory. The docs say not to set one.

## Consequences

- Amends 0006: an entry with a tool declares its stack, and the tool rides in the options bag. Amends 0007: the table above is OpenTofu's, next to Pulumi's.
- The adapter interface: `discover` gets the config, `checkVersion` the stacks it covers, `prepare` is new and optional, a preview may save its plan, and `apply` may get it.
- The check lists OpenTofu stacks as it lists Pulumi stacks, and stops on a bad entry with the same messages a scan gives (record 0042).
- A var file outside the stack's directory is not claimed by the stack. `inputs` claims it, or a change to it gives a full scan (record 0010).
- The tool's own diff of OpenTofu can print a sensitive value: in the recording `log-diff-changed-secret`, `terraform_data` copies a sensitive input to its output unmarked, and tofu prints it there in plain text. That is the risk record 0048 describes, and it stays in the job log.
- Not in this version (`docs/later.md`): zero-config discovery for OpenTofu, a `backendConfig` option, the Terraform binary, drift from `resource_drift`, and a hint in the check for a directory of `.tf` files that no entry names.

Research: https://github.com/sluiceway/sluiceway/blob/research/opentofu-adapter-fit/docs/research/opentofu-adapter-fit.md
