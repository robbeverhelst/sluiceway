# Example workflows

Most of a Sluiceway workflow is not about Sluiceway: checking out, installing a language and your dependencies, installing the tool, loading credentials. These are complete workflows for common setups, ready to copy. Each one is [the workflow](workflow.md#the-workflow) with those steps filled in, and each one is checked in this repo's tests against the action's inputs and the wiring Sluiceway needs.

| Setup | File | Credentials from |
|---|---|---|
| Pulumi programs in TypeScript in one repo, with one `package.json` and lockfile at the root | [node-monorepo.yml](../examples/workflows/node-monorepo.yml) | GitHub secrets |
| An env file of secret references, loaded with one call per run | [secret-manager.yml](../examples/workflows/secret-manager.yml) and [export-env.sh](../examples/workflows/export-env.sh) | A secret manager (1Password in the example) |
| A cloud account and a state bucket in that cloud | [cloud-oidc.yml](../examples/workflows/cloud-oidc.yml) | OIDC, no stored cloud key (AWS in the example) |

Copy the file to `.github/workflows/deploy-dashboard.yml` on your default branch. The name of the file is yours to choose. Keep it different from `sluiceway.yaml`, which is Sluiceway's own settings file at the repo root, so the two are never mixed up. Each one is one job with one Sluiceway step and no `if:`: the step reads the event of the run and scans, deploys a tick, or ends with a notice. For credentials that only read in scans, or an environment per stack with reviewers, start from the [split workflow](split-workflow.md) instead.

## What to change

- **The version of the action.** The examples use `sluiceway/sluiceway@v0`, which follows every release from 0.1.0 until 1.0.0. To review every update yourself, pin a full commit SHA instead, as [Pin a commit](workflow.md#pin-a-commit) says.
- **The branch.** The examples scan after a push to `main`. Use your default branch.
- **The secret and variable names.** `PULUMI_ACCESS_TOKEN`, `OP_SERVICE_ACCOUNT_TOKEN`, `AWS_DEPLOY_ROLE` and the others are names the examples made up. Create them under the repo's settings, or rename them in the file.
- **The environment.** The secret manager and the cloud examples name an environment, `sluiceway`, so that the credentials can be secrets of a GitHub Environment that only the default branch may use ([with GitHub Environments](workflow.md#with-github-environments)). Where your plan has no environments, remove the `environment:` block and keep those credentials as repository secrets.
- **`timeout-minutes`.** One run may hold a scan and the deploys it starts. A deploy has no time limit of Sluiceway's unless the `deploy-timeout` input gives it one. Set one that fits your slowest scan and deploys.
- **The runner.** Change `runs-on` for a self-hosted runner. It needs runner version 2.328.0 or newer.

## The monorepo

The dependencies are installed once, with one `npm ci` at the root, before the scan previews every stack. The plugin cache keeps the providers between runs: the first run fills it, which takes a while after a large first scan, and later runs reuse it. Your programs may need more than npm: a build step, a code generator, another language. Put it before the Sluiceway step, once.

The credentials sit on the Sluiceway step only, so the install scripts of your dependencies never see them.

A push previews only the stacks that claim a changed file, and a stack claims the files in its own directory. Two things in a monorepo lie outside every stack:

- **A shared package**, such as `packages/ui`, that several programs import. A push that changes only the package gives a full scan, because no stack claims it. List it under the [`inputs`](configuration.md#stacksinputs) of the stacks that use it, and such a push previews only those:

  ```yaml
  stacks:
    - path: apps/web
      inputs:
        - packages/ui/**
        - config/web.json
  ```

- **The root lockfile and `package.json`.** No stack claims them, so every push that changes a dependency previews every stack. That is on purpose: a new version of a package can change any program, and Sluiceway cannot tell which. Keep them off [`scan.unrelated`](configuration.md#scanunrelated). The check, and the summary of a push that fell back to a full scan, list them among the files that no stack claims and say to keep them off that list.

## The secret manager

The job resolves one env file of references with one `op run`, and [export-env.sh](../examples/workflows/export-env.sh) masks the secrets and writes every value to the job environment. [credentials.md](credentials.md#an-env-file-of-secret-references) explains the script and what it does not do. The service account's token is a secret of the environment, and the account sees only the vault with the credentials the stacks need.

Every step after the loading step sees the credentials, because they are in the job environment from then on. Put every install step before it: `npm ci`, a build, anything that runs the install scripts of your dependencies. When you combine this example with the monorepo one, the order is checkout, the installs, the tool, then the loading step, then Sluiceway. The example has no install step, so it loads right before Sluiceway.

## The cloud

The job assumes a role that can change things. Its trust policy names the environment, so no other branch can assume it. The state lives in a bucket (`PULUMI_BACKEND_URL`), and stack secrets use a passphrase from a repository secret. The workflow's block adds `id-token: write`, which the role needs.

## Before you merge one

Run the [check](workflow.md#check-your-setup) in a pull request first. It tells you whether Sluiceway finds your stacks and understands `sluiceway.yaml`, with no credentials and no tool. What it cannot tell you is whether a preview works: whether the runner can fetch what your programs fetch ([credentials](credentials.md#what-your-programs-fetch-the-runner-has-to-fetch)), and whether every stack exists in the backend. The first scan shows that, one row per stack.
