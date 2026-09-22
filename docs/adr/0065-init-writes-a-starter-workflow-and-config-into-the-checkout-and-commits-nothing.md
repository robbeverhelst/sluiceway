# Init writes a starter workflow and config into the checkout, and commits nothing

> Amended by 0077: `init` writes the one-step workflow, one job with one Sluiceway step and no `if:`.

A new user's first hour goes into two files: a workflow that is mostly not about Sluiceway (onboarding log, hurdle 2) and a `sluiceway.yaml` whose `scan.unrelated` block and `tool` entries they have to work out (hurdles 4 and 5). The check (0042, 0061) says what is wrong with both once they exist. The example workflows of slice 2.10 show what a finished one looks like for three setups. What was missing is the step between: a first version of both files, from the repo itself. Build plan slice 4.14 brings it in, agreed with the owner on 2026-09-22.

## Decision

- **A sixth mode, `init`.** It reads the files of the checkout, writes `.github/workflows/deploy-dashboard.yml` and, when there is none, `sluiceway.yaml` into it, and prints what it wrote and what it could not know. It never commits, never pushes and never opens a pull request: the person reads the files, changes them, runs the check and commits. It holds the promise of the check: no credential, no tool, no GitHub API, no network. A test walks its imports as 0042's does.
- **A person runs it on their own machine, from the action's bundle.** One command line clones the release tag into a temporary directory and starts `dist/index.js` with `INPUT_MODE=init` in the top directory of their clone. It is the bundle the workflow runs, so there is no second thing to release, name or install. The directory is `GITHUB_WORKSPACE` when set, the current directory otherwise, and it must hold `.git`, so files never land in a subdirectory. Outside a runner it prints plain lines, not workflow commands, and below Node 22 it stops with a sentence instead of a missing function. It writes no job summary.
- **It never overwrites a file, and writes nothing when it would have to.** A file at `.github/workflows/deploy-dashboard.yml`, or any workflow with a Sluiceway job other than `check` or `init`, stops it before any write, and the message points at the check. An invalid `sluiceway.yaml` stops it with a scan's message. A repo where it finds no stack stops it too: a workflow for nothing is not a start. Each of these ends red.
- **A `sluiceway.yaml` that is there is kept as it is.** The workflow is built from it: its stacks, `dashboard.label` in the `if:` of `resolve`, and, when `mergeAndDeploy.authors` is set, the workflow that `docs/workflow.md` gives for merge and deploy: `contents: write` on `resolve` alone, the scan's `matrix` output, an `apply-merged` job, `settle` waiting for both, and the `sluiceway-merged` dispatch input of 0064 for a narrowed scan after the merge (0054).
- **The workflow is the README's, filled in the way `examples/workflows` fills it.** All four jobs in one file, the permissions block, the concurrency groups, `timeout-minutes: 60` and the stack's environment on `apply`, `@v0`, and in `scan` and `apply` the steps the stacks need, in this order: Node and the packages, Pulumi with its plugin cache, OpenTofu, Helm with the diff plugin, kubectl. The pins and versions are those of the examples and of `docs/credentials.md`, and a test holds the OpenTofu, Helm and kubectl steps to that page word for word.
- **What it reads to fill it in:**
  - Pulumi stacks from discovery, and the `runtime` of each project file. For `nodejs`, the nearest lockfile at or above each project (npm, pnpm, yarn, bun), installed once per lockfile directory, with `.nvmrc` or `.node-version` for the version and `lts/*` without. Yarn with `.yarnrc.yml` gets `corepack enable` and `--immutable`. Any other runtime but `yaml` gets `pulumi install` in each project's directory, on the language the runner has.
  - The repositories that a local chart's dependencies name by `http(s)://`, added with `helm repo add` before a preview.
  - An env file of 1Password references (`op://`), loaded as the secret manager example does, with the script of `docs/credentials.md`, written to `.github/scripts/export-env.sh` unless that file is there. A file that names deploys goes to `apply`, one that names previews to the scan, and a single file serves both, which it says.
  - The default branch, from `.git/refs/remotes/origin/HEAD` of the clone. Without it the workflow says `main` and the list says so.
- **It never invents a credential step.** The only loading step it writes is the one for an env file of references it found. Otherwise the workflow holds the README's comment where the step goes, and the list sends the person to `docs/credentials.md`.
- **A new `sluiceway.yaml` declares what files alone cannot name, as a first reading for a person to correct.**
  - An OpenTofu root module is a directory of `.tf` or `.tofu` files that no other directory calls as a local module and that is not under a `modules` directory. One var file is passed to its stack. With more, each var file is a stack of its own, named after the file, in a workspace of the same name, because two stacks of one root module in one workspace would share a state. `terraform.tfvars` and `*.auto.tfvars` are left out: the tool loads them anyway.
  - A Helm stack is every `Chart.yaml` that is not a library chart or a subchart, at the chart's own directory with `chart: .`. Its release and its namespace are both the chart's name, made fit for Helm. The namespace must exist (0058), so a wrong guess fails its preview and deploys nothing, where `default` would exist and install a second release.
  - `scan.unrelated` holds the check's fixed globs that cover a file of the repo, counting the files `init` writes, and a comment names the directories whose files no stack claims, with the `inputs` entry that gives one to a stack. A file at the repo root is never hinted: those are the shared files a full scan is for (0010).
  - A Kubernetes manifests stack (0060) is never declared: a directory of YAML says nothing about its cluster, and many are bases never applied alone. When a `sluiceway.yaml` that is there declares one, the workflow installs kubectl and the list asks for a kubeconfig. Slice 4.9 landed while this slice was built.
  - Before it writes, it loads the config it built and runs discovery on it, the way a scan does, so a file it writes is one a scan reads.
- **What it cannot know is a list, not a guess left unsaid:** credentials, the runner (`ubuntu-latest`), the environments on `apply`, a guessed branch, Helm release names, namespaces and values files, OpenTofu workspaces, a Node program without a lockfile, a pnpm version, the version of another language.

## Considered

- **A pull request or a commit.** Rejected by the slice: it needs a token that can write, and the person has to read the files anyway.
- **A step in a workflow.** It would write into a runner's checkout, which is thrown away. The mode works there, and the docs do not offer it.
- **An npm package or a separate CLI.** A second artifact with its own name and release, for one command. Left for later.
- **Zero-config discovery for OpenTofu and Helm** stays out (0053, 0058, `docs/later.md`). `init` does not change what a scan finds: it writes `tool` entries into a file a person reads and commits, which is the declaration those records ask for. Its reading of the files can be wrong, which is why it is a first version and not discovery.

## Consequences

- The mode list grows to six. `init` needs `contents: read` where a workflow runs it, and the check treats it like itself.
- `docs/init.md` is the page for it. The onboarding log's hurdle 2 gets its generator.
- Every setup `init` writes for the example projects, alone and together, passes the check with no warning, and a test holds that.

This record amends 0042 (a second mode that reads files only).
