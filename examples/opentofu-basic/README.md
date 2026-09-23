# opentofu-basic

A small OpenTofu repo that needs no cloud account. Sluiceway's tests record their OpenTofu fixtures from it, and the end to end workflow scans it next to `pulumi-basic`, as one repo with stacks of both tools.

It keeps its state in the local backend and uses providers that need no credentials: `random`, `local`, `null` and the built-in `terraform_data`.

| Directory | Stacks | What it shows |
|---|---|---|
| `network/` | `network:dev`, `network:prod` | One root module in two workspaces, each with its own var file, as named options in `sluiceway.yaml`. |
| `dns/` | `dns` | A root module written in `.tofu` files, in the default workspace, with no name. |

Neither root module has a backend block, because the example keeps its state locally, so discovery finds neither (the `check` says so) and `sluiceway.yaml` declares every stack with `tool: opentofu`. A root module with a backend block and a lock file or `.tofu` files needs no entry ([`discovery.rootModules`](../../docs/configuration.md#discoveryrootmodules)).

## Two strings that must never show up

Every root module sets one property to `CANARY-VALUE`, and `network/` has a variable marked sensitive with the value `CANARY-SECRET`. Sluiceway never shows a property value, marked sensitive or not. A test runs every recorded plan through Sluiceway and fails if either string comes out anywhere.

## Try it

You need OpenTofu v1.11.0 or newer.

```sh
cd network
tofu init
tofu workspace new dev
tofu plan -var-file=dev.tfvars
```

A deploy of `network/` writes one file under `network/out/`, which git ignores, and state files next to the module, which git ignores too.
