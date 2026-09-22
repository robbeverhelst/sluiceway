# Kubernetes manifests stacks prune from an inventory of their own and read drift from the managed fields

The build plan's slice 5.3 asks for part 2 of the Kubernetes manifests adapter of record 0060: pruning (an object taken out of the manifests is deleted by the deploy and shown as a delete on the row), a drift check, manifests in subdirectories (`-R`), and the options `forceConflicts` and `fieldManager`. This record fixes how, from kubectl's source at v1.34.0 and v1.37.0 (`pkg/cmd/diff/diff.go` and `prune.go`, `pkg/cmd/apply/apply.go`, `pkg/cmd/util/helpers.go`, and cli-runtime's `pkg/resource/visitor.go`) and from what kubectl v1.34.0 and v1.37.0 printed against kind clusters of 1.34 and 1.37 on 2026-09-22.

Amends 0055 and 0060.

## What real behavior changed

Record 0060 said `--prune` is "still alpha". The source says more, and it rules kubectl's pruning out altogether for this adapter:

- `kubectl apply --prune` without an ApplySet refuses a server-side apply: "--prune is in alpha and doesn't currently work on objects created by server-side apply" (`apply.go`, v1.37.0).
- `kubectl diff --prune` only lists objects that carry the annotation `kubectl.kubernetes.io/last-applied-configuration` (`diff/prune.go`). A server-side apply never writes it, so the diff could never show a prune of this adapter's objects.
- The ApplySet (KEP 3659) works with a server-side apply, but it is still behind `KUBECTL_APPLYSET=true` and marked alpha in v1.37.0, `kubectl diff` does not take `--applyset`, and the deploy adds a label to every object that the preview would not show.

So the preview could not show a delete that kubectl makes, and Sluiceway prunes itself.

## Decision

**Four new options of a `tool: kubectl` entry**, each off by default, so a stack that sets none behaves exactly as record 0060 says, with the same command lines, the same rendered set and the same hashes.

| Option | What it does |
|---|---|
| `recursive: true` | The manifests of every subdirectory too |
| `prune: true` | An object taken out of the manifests is a delete on the row, and the deploy deletes it |
| `forceConflicts: true` | `--force-conflicts` on the preview, the drift check and the deploy |
| `fieldManager: <name>` | `--field-manager=<name>` on the same three |

**`recursive` reads what `kubectl apply -R -f <dir>` reads**, in the order it reads it: cli-runtime walks the directory with Go's `filepath.Walk`, so the names of one directory in byte order, a subdirectory where its name falls (`a/x.yaml` before `a.yaml`), no link followed, and every `*.yaml`, `*.yml` and `*.json` file. The bundle keeps that order. A kustomization lists its own files, so `recursive` on one is a config problem, and so is a kustomization in a subdirectory, which `kubectl -R` would read as a manifest. The default stays one level: a subdirectory of an existing stack can hold a kustomize base that nobody applies alone, and turning it on for everyone would deploy it.

**`forceConflicts` and `fieldManager` go on every command that applies**, the preview's `kubectl diff`, the drift check's diff and the deploy's `kubectl apply`, so the preview still meets exactly the conflicts the deploy meets (record 0060). A field manager is letters, digits, `.`, `_` and `-`, at most 128 characters, starting with a letter or a digit: the API server takes at most 128 printable characters, and this set never reads as a flag.

**Pruning keeps an inventory in the cluster.** A stack with `prune` has one ConfigMap of its own:

- Its name is `sluiceway-` and the first 16 hex characters of the SHA-256 of the repository (`GITHUB_REPOSITORY`) and the stack id, so two repos with a stack of the same id in one namespace never share one. It is labelled `app.kubernetes.io/managed-by: sluiceway` and annotated `sluiceway.dev/stack` with the stack id, for a person reading the cluster.
- It names no namespace, so it goes where the stack's objects without one go: the `namespace` option, or the context's.
- Its `data.objects` lists each object of the stack, one JSON line each, with its API version, kind, the namespace as the manifest writes it (none when it writes none) and name, sorted. Never a value: these are what a row may show (record 0021).
- It is the last document of the rendered set, so the preview diffs it and the deploy applies it with the rest, under the same field manager. It is Sluiceway's object and never a change: the fold leaves it out, and a stack whose only difference is its inventory is in sync.

**The preview of a stack with `prune`** reads the live inventory (`kubectl get configmap <name> --ignore-not-found --output=json`), takes the objects it lists that the manifests no longer hold (the same API group, kind, namespace as written and name: a new API version is the same object), and when there are any, reads them live (`kubectl get --ignore-not-found --show-managed-fields --output=json -f <prune file>`). An object that is still there and that the stack's own field manager applied (an `Apply` entry of that manager in its managed fields) is a `delete` on the row, with the address the cluster gives it. One that is gone needs no delete, and one that another field manager took over is not the stack's to delete. Both reads print objects on stdout, which stay in the adapter; only stderr reaches the job log.

**The deploy applies the set first, then deletes** the objects of the prune file (`kubectl delete --ignore-not-found -f <prune file>`), so an object that moves to a new name is never missing in between. The prune file names each object by the API version, kind, namespace and name the cluster gave it, nothing else, every word quoted. It sits next to the set, the set's digest covers it (record 0060), and a set or prune file that changed after the preview is refused. The inventory in the set keeps listing an object until a preview no longer finds it, so a delete that fails is tried again by the next deploy. A failed delete is a failed deploy, like a failed apply, and like the apply it has no time limit.

**The drift check (record 0055) runs only for a stack with `prune` or `forceConflicts`.** `kubectl diff` compares with the live objects, so every change made outside the code is already on a kubectl stack's row: a create for an object someone deleted, an update for a field someone changed with the stack's own field manager, and a failed preview for a field another field manager took, because a server-side apply refuses to take it without `--force-conflicts` (recording `drift-conflict`: `kubectl scale` alone gives that conflict). The check says which of them came from outside the code, from two things the cluster keeps. It renders the set as the preview does and runs the same diff with `--show-managed-fields`:

- `delete`: an object the live inventory lists, that the manifests still hold and the cluster does not (recording `drift-deleted`). The row's create puts it back.
- `update`: the paths the preview changes on an object that another entry of its managed fields holds and the stack's own `Apply` does not (recording `drift-changed`: `kubectl scale` is an `Update` by the manager `kubectl` on the `scale` subresource, `kubectl patch` one by `kubectl-patch`). Those are reached only with `forceConflicts`: without it the same change fails the preview, and a stack whose preview failed is not checked (record 0055). A path cut short, such as a Secret's `data`, counts when a field below it is held, and no key below it leaves the adapter.

A stack with neither option answers "cannot check", because nothing the check could find would not already be a change or a failure on the row, and it would cost one more diff per stack on every drift scan. A change made with the stack's own field manager is never drift: nothing in the cluster tells it from the code. The managed fields are read as the property paths of record 0046, `f:` a field, `k:` the list item with those keys, `v:` the item with that value, `i:` an index, `.` the node itself, and only ever compared with the paths of a change.

**A tick that repairs drift deploys the same set with the same flags.** The set recreates what someone deleted, and a field someone else took is taken back by `--force-conflicts`, which the preview already ran with. `repairDrift` changes nothing for kubectl, unlike Pulumi's `--refresh` (record 0055).

**The fixtures come from kind**, as record 0060's do: six new scenarios on both kubectl versions, `prune-first`, `prune` (the preview, the deploy with its delete, and the preview after), `drift-deleted`, `drift-changed` (with a field manager of its own and `forceConflicts`), `drift-conflict` and `recursive`. The recorder gained a prune file with its own placeholder, `{prune}`, and a bundle step that recurses and appends the inventory the way the adapter does.

## Rejected

- **kubectl's `--prune` with a label selector or `--all`.** It refuses a server-side apply, and `--all` would delete every object of the allowed kinds in the namespace that is not in the set.
- **The ApplySet.** Alpha behind an environment variable in v1.37.0, no support in `kubectl diff`, and a label on every object that the deploy adds and the preview never shows, so every row after the first deploy would show the label going away.
- **Keeping the inventory in GitHub**, on the deployment record's payload. A deploy outside the dashboard, or one that failed half way, would leave it wrong, and the cluster is where the objects are.
- **Recording the deployed values, or digests of them, to find drift in fields the code does not set.** A server-side apply never removes a field another manager set, so a tick could not repair such drift, and the row would stay drifted forever. Digests of Secret values next to the objects are a guess target for anyone who can read ConfigMaps and not Secrets.
- **`--force-conflicts` on the deploy only when the approved hash covers drift**, like Pulumi's `--refresh`. The fresh preview of `apply` runs without it and fails on the same conflict first, and a preview and a deploy with different flags break the promise of record 0060.
- **Pruning by default.** It writes an object of its own into the cluster and needs rights to delete every kind the stack deploys.

## Consequences

- Amends 0060: the options table grows by four, the rendered set of a stack with `prune` ends with its inventory and has a prune file next to it, the deploy may delete, and `recursive` reads subdirectories. Amends 0055: a kubectl stack has a drift check, with `prune` or `forceConflicts`, and its repair needs no flag of its own.
- The kubeconfig of a stack with `prune` needs to get and patch ConfigMaps in the stack's namespace (a server-side apply creates and changes one with a patch), and to get and delete every kind the stack deploys.
- The first deploy with `prune` writes the first inventory. An object taken out of the manifests before then is never pruned.
- Changing a stack's `namespace`, its stack id or the repository's name starts a new inventory, and what the old one listed is never pruned. Changing its `fieldManager` leaves the old manager holding every field it set, so a later change of such a field meets a conflict until `forceConflicts` takes it over, and pruning deletes only what the new manager applied.
- The tool's own diff of a stack with `prune` (record 0048) shows the inventory, with the names it lists.
- `docs/later.md` loses four lines: pruning, the drift check, subdirectories, and the two options. Zero-config discovery of kustomizations stays there.

Research: kubectl's source on the `v1.34.0` and `v1.37.0` tags of kubernetes/kubernetes, `staging/src/k8s.io/kubectl/pkg/cmd/diff/diff.go` and `diff/prune.go` (`--prune` only sees `last-applied-configuration`), `pkg/cmd/apply/apply.go` (the refusal for a server-side apply, `--applyset`), `pkg/cmd/util/helpers.go` (`KUBECTL_APPLYSET`), and `staging/src/k8s.io/cli-runtime/pkg/resource/visitor.go` (`ExpandPathsToFileVisitors`, the walk of `-R`); https://kubernetes.io/docs/reference/using-api/server-side-apply/ (managers, conflicts, `Update` taking a field over), read 2026-09-22.
