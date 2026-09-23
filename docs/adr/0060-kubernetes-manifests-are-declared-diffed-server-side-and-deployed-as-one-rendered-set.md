# Kubernetes manifests are declared in sluiceway.yaml, diffed server-side, and deployed as the one rendered set the preview saw

> Amended by 0090: a recorded diff that raced a controller's write, with two versions of one object on its two sides, is run again, and no committed fixture holds one.

> Amended by 0070: four more options, `recursive`, `prune`, `forceConflicts` and `fieldManager`. With `prune` the rendered set ends with the stack's inventory, a prune file sits next to it, and the deploy deletes what the row showed as deletes. kubectl's own `--prune` does not work for a server-side apply, which is more than "still alpha".

The build plan's slice 4.9 adds an adapter for plain Kubernetes manifests and kustomizations (issue 100), so that a repo that deploys with `kubectl apply` gets the dashboard. Record 0053 set the pattern for a tool whose stacks files cannot name, and record 0058 fitted Helm to it. This record settles the same questions for kubectl, from kubectl's reference on kubernetes.io, its source (`staging/src/k8s.io/kubectl/pkg/cmd/diff/diff.go` and `apply/apply.go`), and what kubectl v1.34.0 and v1.37.0 printed against kind clusters of 1.34 and 1.37 on 2026-09-22.

## Decision

**A directory is the stack, and it is declared.** A directory of YAML says nothing about which cluster it goes to, and many directories are kustomize bases that are never applied alone, so files alone cannot say what a stack is. A `stacks` entry with `tool: kubectl` declares one, with two named options: `context`, the kubeconfig context, and `namespace`, for objects that name none. A namespace is a DNS label, the rule record 0058 holds a Helm namespace to, so the JSON schema has one `namespace` for both tools and a value never reads as a flag. Both reach the command line in the `--name=value` form. Its stack id is `path`, or `path:name` (record 0006), so one directory for two clusters is two stacks with two contexts. Pulumi keeps its zero config, and an entry without `tool` still only adds settings.

**Discovery checks from the files.** The directory must exist and hold a kustomization (`kustomization.yaml`, `kustomization.yml` or `Kustomization`, the names kustomize reads) or at least one manifest: a `*.yaml`, `*.yml` or `*.json` file one level deep, the files `kubectl apply -f <dir>` reads without `--recursive`. It never starts kubectl and never reaches a cluster, so `check`, `resolve` and `settle` still hold no credentials (record 0014).

**The rendered set.** A stack is rendered into one YAML stream in a directory of its own: the manifests of the directory byte for byte, in code unit order with a document separator between two files, or what `kubectl kustomize .` prints for a kustomization. What the directory holds when the preview runs decides which, not what it held at discovery. The set holds every value of the manifests, a Secret's data too (record 0021), so it is written with mode 0600 and removed when the preview ends. It is this adapter's saved plan (record 0053): `apply` asks its fresh preview to keep it, and the deploy applies exactly that file.

**The command lines**, each run in the stack's directory:

| Step | Command |
|---|---|
| Version | `kubectl version --client --output=json`, in the repo root. It reaches no cluster |
| Render a kustomization | `kubectl kustomize .`. It reads files and reaches no cluster |
| Preview | `kubectl diff --server-side [--context=<c>] [--namespace=<n>] -f <set>`, with `KUBECTL_EXTERNAL_DIFF="diff -N -U1000000"` |
| Tool diff (record 0048) | the same command with the job's own diff program |
| Deploy | `kubectl apply --server-side [--context=<c>] [--namespace=<n>] -f <set>` |

- `--server-side` on both: the API server runs the apply as a dry run for the preview, with its admission, defaults and validation, and the deploy is that same apply. Both use kubectl's field manager for a server-side apply, `kubectl` (both commands take it from `GetApplyFieldManagerFlag` when `--server-side` is on), so the preview meets exactly the conflicts the deploy would meet, and a repo that ran `kubectl apply --server-side` by hand before keeps its field ownership.
- **No `--force-conflicts`.** A field that another manager owns, such as the replicas an autoscaler sets, fails the preview with the conflict (recording `conflict`), before anyone ticks. Forcing would take the field on every deploy.
- **No `--prune`.** It is still alpha in kubectl. An object taken out of the manifests stays in the cluster, and the diff shows nothing for it (recording `removed-object`).
- **Never `--show-secrets`.** kubectl masks the data of a Secret on both sides.
- The exit codes are kubectl's (reference, "kubectl diff"): 0 no differences, 1 differences, above 1 an error of kubectl or of the diff program. Above 1 is the reason "the tool exited with an error", and its words go to the job log.

**The diff program is set by the adapter.** kubectl writes each object to a file of its own in two directories, `LIVE` and `MERGED`, and runs the diff program on them. With the default `diff -u -N` a hunk holds three lines around a change, which cannot say where in an object the change is. `KUBECTL_EXTERNAL_DIFF="diff -N -U1000000"` makes the one hunk of every file hold the whole object on both sides, so the adapter reads both objects whole and compares them in memory, as the OpenTofu adapter compares `before` and `after`. kubectl passes an argument of the variable only when it is letters, digits, `-` and `=`, which these are. A million lines and not the largest number: Apple's diff repeats hunks when the context is 2^31 - 1, which was seen on a laptop. A file with a second hunk, or a hunk that does not start at the first line, is output the adapter cannot read, never in sync. The tool diff keeps the job's own diff program, because it is for a person.

**The diff, settled from the recordings:**

| Live side, merged side | Becomes |
|---|---|
| none, an object | `create`, with no keys |
| an object, an object | `update`, with every leaf path that differs. When only the fields the server keeps for itself differ, no change |
| an object, none | `delete`. kubectl prints this only with `--prune`, so no recording holds one |

- "None" is an empty file, or `null`: kubectl's masking of a Secret prints the missing side of a new Secret that way (recording `new-stack`).
- **The fields the server keeps for itself** are left out of the comparison: `status`, and `metadata.generation`, `resourceVersion`, `uid`, `creationTimestamp`, `managedFields` and `selfLink`. The dry run raises a Deployment's `generation` with every change of its spec (recording `update`), which would add a path to every update that nobody decides on.
- There is **no `replace`** and no tracking change. A change the API server cannot make in place, such as a Deployment's selector, fails the dry run (recording `immutable-field`). kubectl never deletes and recreates, and never adopts.
- **The address** is the kind with its API group behind it, the way kubectl writes it, then the namespace and the name: `Deployment.apps/shop/web`, `ConfigMap/shop/settings`, and `ClusterRole.rbac.authorization.k8s.io/reader` for an object without a namespace. The API version is not in it, so an object whose manifest moves from one version to another stays the same change. Kubernetes names hold no `/`, so it is unique. What a person sees is the kind as the type, and `namespace/name` as the name. It has the form of the address Helm's adapter gives (record 0058), so an object reads alike under both tools.
- **Paths** are written the way the other adapters write them (record 0046), with the same code as OpenTofu's: `spec.template.spec.containers[0].image`, `metadata.labels["app.kubernetes.io/name"]`.
- **A Secret** (`v1` `Secret`) is held as OpenTofu holds a sensitive map: its `data` and `stringData` are compared whole, and a change is the path `data`, never a key inside it. kubectl masks the values as `***`, `*** (before)` and `*** (after)` anyway. Nothing of a Secret shows, listed in `dashboard.showValues` or not. Any other listed path shows a scalar of one line (record 0052).

**The deploy is the set that was hashed.** The plan asks to "hash the rendered manifest set". Record 0008 rejects a digest of values in the issue, which may be public, so the digest never leaves the `apply` job, as in record 0058: the rendered set records a SHA-256 of its bytes when it is written, and the deploy checks the file still holds them right before `kubectl apply`. A set that changed is refused and nothing is deployed. The diff hash is unchanged: it covers what the row shows, and a tick approves the change as shown (record 0008). A change of the code after the tick gives the fresh preview another diff hash and ends as a moved change, as for every tool. Unlike Helm, kubectl renders nothing on the server side of the deploy that the preview did not see, so the set itself is what goes out, and the deploy needs no second render.

**The floor is kubectl v1.34.0**, the oldest Kubernetes release line still patched on 2026-09-22: the releases page on kubernetes.io lists 1.37, 1.36, 1.35 and 1.34, with 1.34 patched until 2026-10-27, and 1.33 ended in June 2026. Everything the adapter reads was recorded with v1.34.0 against a 1.34.11 node and v1.37.0 against a 1.37.0 node, because kubectl supports a server one minor version away and no single cluster fits both. The check reads the client version only, once per job, and only when the stacks at hand include a kubectl stack. A provider's build such as `v1.35.2-eks-1234567` counts as its version.

**The environment passes through** (record 0013). `KUBECONFIG`, the cloud credentials a kubeconfig's exec plugin reads, and `KUBECTL_*` reach kubectl as they are. Sluiceway sets `KUBECTL_EXTERNAL_DIFF` for the preview and nothing else. The diff program itself, `diff`, must be on the runner, which it is on GitHub's hosted runners.

**The fixtures come from a kind cluster**, as Helm's do (record 0058). A diff needs live objects, and they live in a cluster. The recorder drives `examples/kubernetes-basic` (a directory with a ConfigMap, a Secret, a Deployment and a Service in JSON, and a kustomization with a Deployment and a Service) against a kind cluster made for the job, and refuses to start unless the current context of `KUBECONFIG` is a kind cluster. Every scenario makes the example's namespace anew. The mixed e2e runs a kubectl stack next to the Pulumi, OpenTofu and Helm ones, against the same kind cluster.

## Consequences

- Amends 0006: an entry with `tool: kubectl` declares a directory, and the tool rides in the options bag. Amends 0007: the table above is kubectl's, next to Pulumi's, OpenTofu's and Helm's.
- `kubectl diff` compares with the live objects, so a change made in the cluster by hand shows as pending on the next scan, where a Pulumi or OpenTofu stack would need a drift check. The row cannot tell the two apart, and a tick puts the manifests back either way.
- The namespace of a stack must exist before its preview: the dry run cannot place an object in a namespace that is not there (recording `missing-namespace`). A `Namespace` belongs in a stack of its own that the others depend on (record 0056).
- A kustomization that reads files outside its directory, such as `../base`, claims only its own directory. `inputs` claims the rest, or a change there gives a full scan (record 0010).
- The tool's own diff of a kubectl stack prints every value of every changed object except a Secret's data, a ConfigMap's included. That is the risk record 0048 describes, and it stays in the job log.
- Not in this version (`docs/later.md`): pruning, a drift check, manifests in subdirectories, `forceConflicts` and `fieldManager` options, and zero-config discovery of kustomizations.

Research: issue 100; https://kubernetes.io/docs/reference/kubectl/generated/kubectl_diff/ and https://kubernetes.io/docs/reference/kubectl/generated/kubectl_apply/ (read 2026-09-22); https://kubernetes.io/releases/; kubectl's source on the master branch of kubernetes/kubernetes, `staging/src/k8s.io/kubectl/pkg/cmd/diff/diff.go` (the diff program, the masker, the field manager) and `pkg/cmd/apply/apply.go` (`GetApplyFieldManagerFlag`).
