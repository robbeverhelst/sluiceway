# kubernetes-basic

A small Kubernetes repo that needs no cloud account. Sluiceway's tests record their Kubernetes manifests fixtures from it against a kind cluster, and the end to end workflow scans it next to `pulumi-basic` and `opentofu-basic`, as one repo with stacks of three tools.

Nothing in it pulls an image that has to run: the Deployments use `registry.k8s.io/pause`.

| Directory | Stack | What it shows |
|---|---|---|
| `web/` | `web` | A directory of plain manifests: a ConfigMap, a Secret and a Deployment in YAML, and a Service in JSON. The namespace comes from the `namespace` option in `sluiceway.yaml`. |
| `cache/` | `cache` | A kustomization with a Deployment and a Service. It sets the namespace and the labels itself. |

Kubernetes manifests have no zero config: `sluiceway.yaml` declares every stack with `tool: kubectl`.

## Two strings that must never show up

The ConfigMap of `web/` and the container arguments of `cache/` hold `CANARY-VALUE`, and the Secret of `web/` holds `CANARY-SECRET`. Sluiceway never shows a property value, and never anything of a Secret. A test runs every recorded diff through Sluiceway and fails if either string, the Secret's base64 form or kubectl's mask comes out anywhere.

## Try it

You need kubectl v1.34.0 or newer and a cluster made for trying things, such as one from `kind create cluster`.

```sh
kubectl create namespace sluiceway-example
kubectl diff --server-side --namespace=sluiceway-example -f web
kubectl diff --server-side -k cache
```

Sluiceway runs the same diff over one file that holds the whole directory, and deploys that file with `kubectl apply --server-side`.
