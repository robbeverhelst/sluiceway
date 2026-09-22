# cdktf-basic

A small CDK for Terraform app that needs no cloud account. Sluiceway's tests record their CDK for Terraform fixtures from it, and the end to end workflow scans it next to the other examples.

`main.js` defines two stacks, `dev` and `prod`, in plain JavaScript so it runs without a build step. They use only `terraform_data`, which is built into OpenTofu and Terraform, so `cdktf get` has nothing to generate. Each stack keeps its state in the local backend, in `terraform.<stack>.tfstate` next to `cdktf.json`.

| Stack | What it shows |
|---|---|
| `dev`, `prod` | Two stacks of one app, each declared with `wrapper: cdktf` and a `name` in `sluiceway.yaml`. |

HashiCorp archived CDK for Terraform in December 2025. Its last release, v0.21.0, still synthesizes, and Sluiceway reads what it writes with the tool it names.

## Two strings that must never show up

Each stack sets one property to `CANARY-VALUE`, and has a variable marked sensitive with the value `CANARY-SECRET`. A test runs every recorded plan through Sluiceway and fails if either string comes out anywhere.

## Try it

You need Node.js, cdktf-cli v0.21.0 and OpenTofu v1.11.0 or newer.

```sh
npm ci
cdktf synth
cd cdktf.out/stacks/dev
tofu init
tofu plan
```
