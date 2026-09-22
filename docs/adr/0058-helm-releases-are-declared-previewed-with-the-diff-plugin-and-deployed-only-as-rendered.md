# Helm releases are declared in sluiceway.yaml, previewed with the diff plugin, and deployed only as the fresh preview rendered them

The build plan's slice 4.6 adds a third adapter, so that a Kubernetes team that runs Helm can use the dashboard (issue 100). Record 0053 set the pattern for a tool whose stacks files cannot name: declared entries, a preparation before the pool, a saved plan. This record settles how Helm fits it, from what helm v3.18.0 and v4.3.0 and the diff plugin v3.15.11 and v3.15.13 printed against a kind cluster on 2026-09-22, and from the plugin's source.

## Decision

**A release in a namespace is the stack, and it is declared.** A chart can be installed as any number of releases in any namespace, so files alone cannot say what a Helm stack is. A `stacks` entry with `tool: helm` declares one, with four named options: `release`, `namespace`, `chart` and `valuesFiles`, and `version` for a chart reference. `path` is the directory the chart and the values files are relative to, where every command runs, and what the stack claims. The stack id is `path` or `path:name` (record 0006), and two releases of one directory are told apart by `name`. Pulumi keeps its zero config, and an entry without `tool` still only adds settings.

- **The chart** is local when it starts with `./` or `../`, and must then hold a `Chart.yaml` inside the repo. Anything else is a chart reference, `repo/name` or `oci://registry/name`, and needs `version`: an exact version, never a range, so the deploy installs the chart the preview saw. A local chart takes no version, because the repo holds it.
- **The names** follow helm's and Kubernetes' own rules: a release is lower case letters, digits, `-` and `.`, at most 53 characters, and a namespace is a DNS label. The rules also keep a name from reading as a flag. Every value a repo writes reaches the command line in the `--name=value` form for the same reason.
- **Discovery checks from the files.** The directory must exist, a local chart must hold a `Chart.yaml`, and every values file must be a file inside the repo. It reads a local `Chart.yaml` for one thing, whether it lists dependencies. It never starts helm and never reaches a cluster, so `check`, `resolve` and `settle` still hold no credentials (record 0014).

**The command lines**, each run in the stack's directory:

| Step | Command |
|---|---|
| Version | `helm version --template={{.Version}}` and `helm diff version`, in the repo root |
| Prepare | `helm dependency build .`, in the directory of a local chart with dependencies, once per chart |
| Preview | `helm diff upgrade <release> <chart> --namespace=<ns> [--version=<v>] --install --reset-values --dry-run=server --output=structured --no-color [--values=<file>...]` |
| Render the deploy is held to | `helm template <release> <chart> --namespace=<ns> [--version=<v>] --dry-run=server [--values=<file>...]`, only in `apply` |
| Tool diff (record 0048) | the preview with `--output=diff` |
| Deploy | `helm upgrade <release> <chart> --namespace=<ns> [--version=<v>] --install --reset-values --atomic --hide-notes [--values=<file>...]` |

- `--reset-values` on the diff and the deploy: the release gets the chart's values and the values files and nothing else. Without it, an upgrade with no values file reuses the values of the last release, which the repo does not show.
- `--dry-run=server` on the diff and the render: templates render as a deploy renders them, with `lookup` answered by the cluster. Without it the plugin renders with `helm template` and no cluster answers, so a chart that keeps a generated secret through `lookup` would show a change on every scan.
- `--atomic` rolls a failed upgrade back and waits for the objects to be ready. Helm 4 renamed it `--rollback-on-failure` and keeps `--atomic` as a deprecated name for the same flag, which prints one warning line. One command line serves both major versions.
- `--hide-notes`, because a chart's `NOTES.txt` may print a value, and the deploy's words go to the job log.
- **Not** `--take-ownership`, `--force`, `--three-way-merge` or `--show-secrets`. None is a named option.

**The preview is the plugin's structured output.** The build plan named `--output json`. In the plugin's source (`diff/report.go`) that output is its default template: one entry per object with its kind, name and change type, and no path. `--output structured` (`diff/structured.go`, since v3.15.0) is JSON too, and gives every changed field as `path` and `field` with its old and new value. It is what the plan's "changed keys as paths" needs, so the manifest diff that the plan named as a fallback was not needed.

| Change type | Becomes |
|---|---|
| `ADD` | `create` |
| `MODIFY` | `update`, with a path for every changed field. A `MODIFY` without paths is output Sluiceway cannot read |
| `REMOVE` | `delete` |
| anything else | the preview fails, "the tool reported a step Sluiceway does not know". `OWNERSHIP` comes only with `--take-ownership`, `MODIFY_SUPPRESSED` only with a suppress flag, and Sluiceway passes neither |

- There is no `replace` and no tracking change: helm replaces an object only with `--force`, and adopts one only with `--take-ownership`.
- **The address** is `<type>/<namespace>/<name>`, where the type is the kind with its API group behind it the way kubectl writes it (`Deployment.apps`, `ConfigMap` for the core group). The plugin keys an object by namespace, name, kind and group, never by API version, and so does the address. A row reads the type and the name, and the namespace in front of the name only when it is not the release's.
- **A path** is written the way the other adapters write one (record 0046): the plugin gives the parent path with dots and the last name or index on its own, as it is, so a label such as `metadata.labels["app.kubernetes.io/version"]` or a key such as `data["app.properties"]` stays whole. A dot inside a name above the last one cannot be told from the plugin's own dots and reads as two names. That shows a wrong path, never a value.
- **Values.** The plugin puts a stand-in in place of a Secret's data (`-------- # (13 bytes)`), and the stand-in still tells the length. Nothing of a Secret ever shows, listed in `dashboard.showValues` or not. Any other listed path shows a scalar of one line, as record 0052 says.
- The plugin leaves out helm test hooks and keeps every other hook, so a hook the chart changes is a change of the release.

**The deploy goes out only as the fresh preview rendered it.** Helm saves no plan. The plan asked for the rendered manifest set to be hashed so that a moved change is refused, and record 0008 rejects a digest of values on the dashboard. So the digest never leaves the `apply` job: the fresh preview of `apply` renders the chart with `helm template`, keeps a SHA-256 of the output in memory as its saved plan, and the deploy renders again right before `helm upgrade`, with the same command line. When the two differ, nothing is deployed and the deploy ends as a moved change: the record ends as `error`, the row stays pending with its box, and the ticker gets the comment of record 0051. The adapter interface lets a deploy say `moved` for this, which only Helm does. A chart that renders differently every time, such as one with `randAlphaNum` and no `lookup`, can therefore never be deployed from the dashboard (recording `unstable-render`). Such a chart shows a change on every scan anyway, because the plugin renders it anew each time, so its row was never a stable thing to approve. The diff hash is unchanged: it covers what the row shows, and a tick still approves the change as shown (record 0008).

**Dependencies are built one chart at a time, before any preview.** A local chart that lists dependencies needs them in its `charts/` directory, and `helm dependency build` writes there, so two stacks of one chart must not build side by side. It is a preparation (record 0053): one per chart directory, in path order, before the pool and before the fresh preview of `apply`. A failed build is a preview failure of every stack of that chart. A chart without dependencies and a chart reference need none. A repository a dependency comes from is the workflow's to add with `helm repo add`.

**The floors are helm v3.18.0 and the diff plugin v3.15.11.** The plugin's README names helm 3.18 as the oldest it installs into, and 3.15.11 is the first plugin release that reads a change inside a list of scalars, such as a container's `args`, instead of leaving it out (plugin pull request 1026). Helm 3 still gets releases next to Helm 4: v3.22.0 and v4.3.0 came out within the same hour in September 2026. The version check runs `helm version` and `helm diff version` once per job, only when the stacks at hand include a Helm stack.

**The environment passes through** (record 0013). `KUBECONFIG`, the cloud credentials a kubeconfig's exec plugin reads, `HELM_*` such as the registry config a `helm registry login` wrote, and the plugin's own `HELM_DIFF_*` settings reach helm as they are. Sluiceway sets nothing, because every flag it needs is on the command line. The release's namespace must exist: Sluiceway does not create it.

**The fixtures come from a kind cluster.** A diff needs a release to compare with, and a release lives in a cluster, so `helm template` alone could not record a preview. The recorder drives `examples/helm-basic` (ConfigMaps, a Secret and a Service, which need no image) against a kind cluster made for the job, with both helm versions, in the `fixtures-helm` job of CI. The mixed e2e runs Pulumi, OpenTofu and Helm stacks in one repo against a kind cluster too.

## Consequences

- Amends 0006: an entry with `tool: helm` declares a release, and the chart's directory and whether it has dependencies ride in the options bag. Amends 0007: the table above is Helm's, next to Pulumi's and OpenTofu's. Amends 0053: `ApplyResult` may say `moved`, and a preparation may be per chart.
- The tool's own diff of a Helm stack prints every value of every changed object except a Secret's data, including a token a chart writes into a ConfigMap. That is the risk record 0048 describes, and it stays in the job log.
- The JSON schema describes the options of both tools in one object, each with the tool that takes it. The loader says when an option does not belong to the entry's tool.
- A chart or a values file outside the directory of the stack is not claimed by it. `inputs` claims it, or a change to it gives a full scan (record 0010).
- Not in this version (`docs/later.md`): a drift check for Helm stacks, a `createNamespace` option, a `kubeContext` option, zero-config discovery from `Chart.yaml`, `--take-ownership` for objects that exist outside the release, and `--rollback-on-failure` in place of `--atomic` once Helm 3 is no longer supported.

Research: issue 100, the plugin's source at https://github.com/databus23/helm-diff/tree/v3.15.13 (`cmd/upgrade.go`, `diff/diff.go`, `diff/report.go`, `diff/structured.go`), and helm's `pkg/cmd/upgrade.go` at v4.3.0 and `cmd/helm/upgrade.go` at v3.18.0.
