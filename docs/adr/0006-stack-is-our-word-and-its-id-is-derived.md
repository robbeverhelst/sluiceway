# "Stack" is Sluiceway's own word, and a stack's id is derived, never chosen

> Amended by 0053: a `stacks` entry with `tool: opentofu` declares an OpenTofu stack, because files alone cannot name one. The tool rides in the options bag, which only adapters read.
>
> Amended by 0058: a `stacks` entry with `tool: helm` declares a Helm release in a namespace, the same way. The chart's directory and whether it has dependencies ride in the options bag.
>
> Amended by 0060: a `stacks` entry with `tool: kubectl` declares a directory of Kubernetes manifests or a kustomization, the same way.

The brief uses Pulumi's words, and the OpenTofu research asked whether the core needs a tool-neutral one such as "unit". We keep "stack" and define it ourselves: the smallest thing Sluiceway can preview and deploy on its own, with its own state, one row and one checkbox. A Pulumi stack is a stack. So is an OpenTofu root module with a chosen workspace and var files. A neutral word would have to be explained to every user, while "stack" already means this in Terragrunt, Spacelift, Terramate and Pulumi, and it is already in the config, the rows and the deployment record tag.

The risk was never the word. It is `core/` quietly assuming Pulumi semantics, so the rule is on the code: in `core/` a stack is a path, an optional name and an options bag that only its adapter reads. No tool words (`urn`, `workspace`, `tfvars`, `Pulumi.yaml`) appear outside `adapters/`.

## Consequences

- The stack id is `path`, or `path:name` when the stack has a name. The path is relative to the repo root, with forward slashes, no leading `./` and no trailing slash. For Pulumi the name is always present and is the Pulumi stack name, so ids look like `apps/grafana:prod`. A later OpenTofu directory per environment is just `envs/prod`. A stack that lives at the repo root has the path `.`, so its id is `.:prod`. The rule has no special case for it, `path: .` in config means the same thing, and an empty path would give ids such as `:prod` or a bare `prod` that reads like a directory.
- The id is always derived. There is no `id:` key in `sluiceway.yaml` in v1. An override was rejected for now because it is a second source of identity that has to be kept unique and validated, and nobody has needed it. It can be added later without breaking anything, since it would only be another way to set the same string.
- The id is fixed in four places once a stack has deployed: the row marker, the deployment record tag `sluiceway:<stackId>`, `dependsOn` in config, and the per-stack concurrency group. Moving a directory or renaming a Pulumi stack therefore makes a new stack with no deploy history. Its first row cannot attribute pending changes to merges. It still deploys. The old records stay in GitHub and nothing reads them.
- Core hands the adapter `path` and `name` as separate fields and never splits an id back apart. A `:` inside a path or a name is harmless. Discovery fails with a clear error when two stacks derive the same id.
- In the config, the brief's required `stack:` key becomes an optional `name:` plus an optional block of adapter options. Pulumi zero config is unchanged.

Research: https://github.com/sluiceway/sluiceway/blob/research/opentofu-adapter-fit/docs/research/opentofu-adapter-fit.md

## Settled while building (slice 5.9)

- `sluiceway.yml` is read as a second spelling of `sluiceway.yaml` (slice 1.2 had refused it). Both at once is still refused, not skipped, for the reason slice 1.2 gave: one of them would be dropped with its tick rule and no word. A problem in the file is reported under the name the repo uses, and a change to either name is the config file changing, a full scan with the words of hurdle 14. `init` still writes `sluiceway.yaml`, and counts a `sluiceway.yml` as a config that is there. This record is where the config file's entries are defined, so the note sits here.
