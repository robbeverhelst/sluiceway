# helm-basic

A small Helm repo that needs no cloud account and no container image. Sluiceway's tests record their Helm fixtures from it against a kind cluster, and the end to end workflow scans it next to `pulumi-basic` and `opentofu-basic`, as one repo with stacks of three tools.

The charts render only ConfigMaps, a Secret and a Service, which a cluster holds without pulling an image.

| Directory | Stack | What it shows |
|---|---|---|
| `web/` | `web` | The release `web` in the namespace `sluiceway-web`, of the local chart `charts/web`, with the values in `web/values.yaml`. |
| `worker/` | `worker` | The release `worker` in `sluiceway-worker`, of `charts/worker`, which depends on `charts/web`. Sluiceway runs `helm dependency build` for it before any preview. |

Helm has no zero config: `sluiceway.yaml` declares every release with `tool: helm`. The charts sit outside the stacks' directories, so each entry claims its chart with `inputs`.

## Two strings that must never show up

The chart writes `CANARY-VALUE` into a ConfigMap, and the values of both releases put `CANARY-SECRET` into a Secret. Sluiceway never shows a value, and nothing of a Secret, not even the diff plugin's stand-in for one. A test runs every recording through Sluiceway and fails if either string comes out anywhere.

## Try it

You need helm v3.18.0 or newer, the diff plugin v3.15.11 or newer, and a cluster that holds nothing else, such as one from `kind create cluster`.

```sh
kubectl create namespace sluiceway-web
cd web
helm diff upgrade web ../charts/web --namespace=sluiceway-web --install --reset-values --dry-run=server --output=structured --values=values.yaml
```
