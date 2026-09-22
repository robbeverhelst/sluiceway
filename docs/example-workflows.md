# Example workflows

Most of a Sluiceway workflow is not about Sluiceway: checking out, installing a language and your dependencies, installing the tool, loading credentials. These are complete workflows for common setups, ready to copy. Each one is [the workflow](workflow.md#the-workflow) with those steps filled in, and each one is checked in this repo's tests against the action's inputs and the wiring Sluiceway needs.

| Setup | File | Credentials from |
|---|---|---|
| Pulumi programs in TypeScript in one repo, with one `package.json` and lockfile at the root | [node-monorepo.yml](../examples/workflows/node-monorepo.yml) | GitHub secrets |
| An env file of secret references, loaded with one call per job | [secret-manager.yml](../examples/workflows/secret-manager.yml) and [export-env.sh](../examples/workflows/export-env.sh) | A secret manager (1Password in the example) |
| A cloud account and a state bucket in that cloud | [cloud-oidc.yml](../examples/workflows/cloud-oidc.yml) | OIDC, no stored cloud key (AWS in the example) |

Copy the file to `.github/workflows/deploy-dashboard.yml` on your default branch. The name of the file is yours to choose. Keep it different from `sluiceway.yaml`, which is Sluiceway's own settings file at the repo root, so the two are never mixed up. Keep all four jobs in the one file: the scan looks for waiting ticks among the runs of its own workflow, and the rescan box and `settle` start a scan by starting that same workflow again.

## What to change

- **The version of the action.** The examples use `sluiceway/sluiceway@v0`, which follows every release from 0.1.0 until 1.0.0. To review every update yourself, pin a full commit SHA instead, as [Pin a commit](workflow.md#pin-a-commit) says.
- **The branch.** The examples scan after a push to `main`. Use your default branch.
- **The secret and variable names.** `PULUMI_READ_TOKEN`, `OP_PREVIEW_TOKEN`, `AWS_PREVIEW_ROLE` and the others are names the examples made up. Create them under the repo's settings, or rename them in the file.
- **The environments.** The `apply` job of every example names the stack's environment, so that the credentials that change things can be secrets of a GitHub Environment ([security](security.md)). The environment of a stack is `sluiceway` unless [`sluiceway.yaml`](configuration.md#stacksenvironment) gives it another. Where your plan has no environments, remove the `environment:` block and keep those credentials as repository secrets.
- **`timeout-minutes` on `apply`.** A deploy has no time limit of Sluiceway's unless the `deploy-timeout` input gives it one. Set one that fits your slowest stack.
- **The runner.** Change `runs-on` of `scan` and `apply` for self-hosted runners. They need runner version 2.328.0 or newer. `resolve` and `settle` hold no credentials and can stay on hosted runners.

## The monorepo

The dependencies are installed once, with one `npm ci` at the root, before the scan previews every stack. The plugin cache keeps the providers between runs: the first run fills it, which takes a while after a large first scan, and every later run gains from it. `apply` only restores it. Your programs may need more than npm: a build step, a code generator, another language. Put it before the Sluiceway step, once.

The credentials sit on the Sluiceway step only, so the install scripts of your dependencies never see them.

## The secret manager

The scan and the apply job each resolve one env file of references with one `op run`, and [export-env.sh](../examples/workflows/export-env.sh) masks the secrets and writes every value to the job environment. [credentials.md](credentials.md#an-env-file-of-secret-references) explains the script and what it does not do. Two service accounts: one that sees only the credentials that read, for the scan, and one for `apply`, whose token is a secret of the environment.

## The cloud

The scan assumes a role that can only read, and `apply` a role that can change things. The trust policy of the second one names the environment, so no other job can assume it. The state lives in a bucket (`PULUMI_BACKEND_URL`), and stack secrets use a passphrase from a repository secret. The jobs that run the tool ask for `id-token: write` in their own `permissions:` block, which replaces the workflow's, so it repeats the whole block.

## Before you merge one

Run the [check](workflow.md#check-your-setup) in a pull request first. It tells you whether Sluiceway finds your stacks and understands `sluiceway.yaml`, with no credentials and no tool. What it cannot tell you is whether a preview works: whether the runner can fetch what your programs fetch ([credentials](credentials.md#what-your-programs-fetch-the-runner-has-to-fetch)), and whether every stack exists in the backend. The first scan shows that, one row per stack.
