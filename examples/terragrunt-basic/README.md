# terragrunt-basic

A small Terragrunt repo that needs no cloud account. Sluiceway's tests record their Terragrunt fixtures from it, and the end to end workflow scans it next to the other examples.

Two units, `live/dev` and `live/prod`, use one module, `modules/notes`. `root.hcl` keeps the state of each unit in the local backend, next to its `terragrunt.hcl`. The providers need no credentials: `random` and the built-in `terraform_data`.

| Directory | Stack | What it shows |
|---|---|---|
| `live/dev/` | `live/dev` | One Terragrunt unit as one stack, with `wrapper: terragrunt` in `sluiceway.yaml`. |
| `live/prod/` | `live/prod` | A second unit of the same module. |

Sluiceway never runs `terragrunt run --all`. Each unit is its own stack, with its own row and its own box.

## Two strings that must never show up

The module sets one property to `CANARY-VALUE`, and has a variable marked sensitive with the value `CANARY-SECRET`. A test runs every recorded plan through Sluiceway and fails if either string comes out anywhere.

## Try it

You need Terragrunt v1.0.0 or newer and OpenTofu v1.11.0 or newer.

```sh
cd live/dev
terragrunt init
terragrunt plan
```
