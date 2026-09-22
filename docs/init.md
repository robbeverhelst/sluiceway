# Start with init

`init` writes a first version of the two files Sluiceway needs, from what it finds in your repo: the workflow `.github/workflows/deploy-dashboard.yml` and the settings file `sluiceway.yaml`. It writes them into your clone and commits nothing. You read them, change what it could not know, and commit them yourself.

## Run it

In the top directory of your clone, with Node 22 or newer and git:

```sh
dir="$(mktemp -d)" && git clone --quiet --depth 1 --branch v0 https://github.com/sluiceway/sluiceway "$dir" && INPUT_MODE=init node "$dir/dist/index.js"
```

That downloads the newest 0.x release of the action to a temporary directory and runs it in `init` mode where you stand. It is the same bundle your workflow runs. To run a release you reviewed, use its tag in place of `v0` ([Pin a commit](workflow.md#pin-a-commit)).

Like the [check](workflow.md#check-your-setup), `init` reads the files of your clone and nothing else: no credentials, no infrastructure tool, no GitHub API, no network. It reads untracked files too, so run it on a clean clone.

## What it looks at

- **The stacks.** Pulumi projects, found the way a scan finds them. OpenTofu root modules: directories of `.tf` or `.tofu` files that no other directory calls as a module and that are not under a `modules` directory. Helm charts: every `Chart.yaml` that is not a library chart or a subchart. Kubernetes manifests stacks only when a `sluiceway.yaml` that is there declares them: a directory of YAML says nothing about its cluster ([configuration](configuration.md#stacks-and-stack-ids)).
- **The programs' language and lockfile.** For Pulumi programs in JavaScript or TypeScript, the nearest `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` or `bun.lock`, and `.nvmrc` or `.node-version`. Programs in another language get their packages with `pulumi install`.
- **An env file of secret references.** A file named `.env`, `.env.<something>` or `<something>.env` with at least one 1Password reference (`op://`), loaded the way [the secret manager example](example-workflows.md#the-secret-manager) does it.
- **The workflows that are there.** A workflow that already runs Sluiceway's scan, resolve, apply or settle, or a file at `.github/workflows/deploy-dashboard.yml`, stops `init` before it writes anything. A check workflow does not.
- **A `sluiceway.yaml` that is there.** It is loaded as a scan loads it, kept as it is, and the workflow is built from it.

## What it writes

- **`.github/workflows/deploy-dashboard.yml`**, the [whole workflow](workflow.md#the-workflow) with all four jobs, and in `scan` and `apply` the steps that install what your stacks need: the language and your packages, Pulumi with its plugin cache, OpenTofu, Helm with the diff plugin, kubectl. The versions and pins are the ones of the [example workflows](example-workflows.md) and of [credentials](credentials.md).
- **`sluiceway.yaml`**, only when there is none. It declares every OpenTofu root module and Helm chart it found, because files alone cannot name those stacks ([configuration](configuration.md#stacks-and-stack-ids)). It lists under `scan.unrelated` the globs of the check's fixed list that cover a file of your repo, and names in a comment the directories whose files no stack claims, with how to give them to a stack as `inputs`.
- **`.github/scripts/export-env.sh`**, only when it loads an env file of secret references and that file is not there yet. It is the script [credentials](credentials.md#an-env-file-of-secret-references) explains.

It never overwrites a file.

## What it leaves to you

`init` ends with a list of what it could not know. What is on it depends on your repo:

- **Credentials.** Apart from an env file of references that it found, `init` writes no step that loads a credential. The workflow says in a comment where yours go. With an env file, it names the two secrets to create, `OP_PREVIEW_TOKEN` and `OP_DEPLOY_TOKEN`.
- **The runner.** Every job runs on `ubuntu-latest`.
- **The environments.** `apply` names the environment of each stack, as the examples do. Remove that block where your plan has no environments.
- **The default branch**, when your clone does not record it.
- **Helm releases.** Each chart becomes a release named after it, in a namespace of the same name, with no values files. Set all three to where the release runs. The namespace must exist, so a wrong guess fails its preview and deploys nothing.
- **OpenTofu workspaces.** A root module with more than one var file becomes one stack per var file, each in a workspace named after the file, so that no two stacks share a state. Rename the workspaces where yours differ.

Then run the check in a pull request, and merge the two files when it finds nothing missing.
