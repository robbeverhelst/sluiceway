# Credentials and your own tooling

Sluiceway runs your infrastructure tool, but it never loads a credential. Your workflow puts everything the tool needs into the job environment, in steps that run before Sluiceway, and Sluiceway passes that environment to the tool as it is. This page is the pattern, then recipes for the usual places credentials come from, then what to do when your programs fetch things or you deploy from somewhere else too.

## The pattern

1. **Authenticate** to wherever the credentials live: a GitHub secret, your cloud through OIDC, a secret manager.
2. **Load everything into the job environment in one step**, once per job. The tool's backend, the passphrase of its secrets, the cloud credentials, anything your programs read.
3. **That step masks every secret it loads.** Sluiceway never sees a secret as a secret, so it cannot mask one by its value. The step that knows it is a secret has to.

Then:

- **In [the workflow](workflow.md#the-workflow), the one job loads them on every run**, before Sluiceway reads the event. They preview and deploy, so they must be able to change things. The run an edit of any issue starts loads them too, runs only code of the default branch, and ends with a notice when the issue is not the dashboard.
- **The [split workflow](split-workflow.md) loads them only in the `scan` and `apply` jobs.** `resolve` and `settle` never run the tool, so the job an issue edit starts, the one thing anybody with issue access can cause, holds no infrastructure secrets. A preview never changes anything, so `scan` can get credentials that only read, and only `apply` the ones that change things. Use it where that matters more than one short file.
- **Load once per job, with one bulk call.** A scan previews every stack in one job, so one load serves them all. Sluiceway has no command wrapper and no hook per stack on purpose: resolving your secrets again for every preview is slow and, on a repo with many stacks, runs into the rate limits of a secret manager.
- **The GitHub token never reaches the tool.** GitHub hands an action its inputs as `INPUT_*` variables, the token among them. Sluiceway removes every one of them from the tool's environment, so a program or one of its dependencies cannot edit the dashboard.

The job environment is the whole interface. There is no allowlist and no environment per stack: a program may read any variable, so Sluiceway cannot know the names. A stack that needs a value of its own gets it through its own variable name or its stack config.

## What Sluiceway promises about them

Sluiceway never holds credentials. That is five promises you can check against the code:

1. **No credential inputs.** No input and no config key ever carries a cloud, backend or secret manager credential. The action takes the GitHub token, and, only when you want notifications, the addresses and the bot token of your notification channels, from your secrets ([notifications](notifications.md)).
2. **Never read by name.** No Sluiceway code reads a credential variable. The environment goes to the tool as one opaque block.
3. **Never stored, never sent.** Nothing from the environment reaches the issue, deployment records, job summaries, artifacts or caches. The only network calls are to the GitHub API, whatever the tool itself makes, and the notification channels a step names.
4. **Only the modes that run the tool need credentials.** `scan` and `apply` run the tool. `resolve` and `settle` never do. `check` does only when its step sets `backend: true`, to ask the backend which stacks it holds, and then only with the credentials you loaded before that step.
5. **A hosted version would keep all of this.** The tool always runs in your own runners.

The credentials are in the same job as Sluiceway's own process, so that process could read them. Its code, which you pin and can read, never does. The [security page](security.md) says what that protects against and what it does not.

## Recipes

Each recipe is the loading part of a job. [example-workflows.md](example-workflows.md) has them in complete workflows. The snippets use the action at `@v0`, which follows every release until 1.0.0. To review every update yourself, pin a full commit SHA instead, as [Pin a commit](workflow.md#pin-a-commit) says.

### GitHub secrets

Nothing to set up outside GitHub. Put the secrets on Sluiceway's step, not on the job, so that the other steps of the job, such as the install scripts of your package manager, never see them. GitHub masks the value of every secret it hands a step.

```yaml
      - uses: sluiceway/sluiceway@v0
        env:
          PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}
```

For the credentials that change things, use a secret of a GitHub Environment where your plan has them, and name the environment on the job ([with GitHub Environments](workflow.md#with-github-environments)). Only a job that names the environment, on a branch the environment allows, can read its secrets. The [security page](security.md) has the setups.

### A cloud through OIDC

No cloud key is stored anywhere: the job asks GitHub for a short-lived token and trades it for cloud credentials. The job needs `id-token: write`. A job's `permissions:` replace the workflow's, so repeat the whole block of the workflow and add the one line on the job (in the split workflow, on `scan` and `apply` only):

```yaml
    permissions:
      contents: read
      issues: write
      deployments: write
      actions: write
      pull-requests: read
      checks: write
      id-token: write
    steps:
      - uses: actions/checkout@v7
      - uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: ${{ vars.AWS_DEPLOY_ROLE }}
          aws-region: ${{ vars.AWS_REGION }}
```

Every large cloud has an official action that does this: `google-github-actions/auth` for Google Cloud, `azure/login` for Azure. Trust the role for the default branch of your repo only, or for the environment the job names (for AWS, a subject of the form `repo:<owner>/<repo>:environment:<name>`), so that no other branch can assume it. The split workflow gives the scan a role that can only read and `apply` the one that changes things.

### A secret manager

Most secret managers have an official action that loads secrets into the job environment and masks them: `hashicorp/vault-action`, `dopplerhq/secrets-fetch-action`, `aws-actions/aws-secretsmanager-get-secrets`, `google-github-actions/get-secretmanager-secrets`, `1password/load-secrets-action`. Check two things in its documentation: whether it exports to the environment by default or only to step outputs, and whether it masks each line of a multi-line value.

Prefer one bulk call per job over one call per secret. A secret manager counts requests, and an action that reads once per reference can make hundreds of them per job. Several official actions do exactly that for an env file of references.

#### An env file of secret references

Many repos keep one env file of secret references next to the code, which the team's own tooling resolves before it runs the tool. The same file can load a CI job. Run your secret manager's `run` command once, which resolves every reference in one go, and let a small script inside it mask the secrets and write every value to `$GITHUB_ENV`. With 1Password:

```yaml
      - uses: 1password/install-cli-action@v4
      - name: Load the environment
        env:
          OP_SERVICE_ACCOUNT_TOKEN: ${{ secrets.OP_SERVICE_ACCOUNT_TOKEN }}
        run: op run --env-file=ci/deploy.env --no-masking -- bash .github/scripts/export-env.sh ci/deploy.env
```

`.github/scripts/export-env.sh`, which is also in this repo as [examples/workflows/export-env.sh](../examples/workflows/export-env.sh) and is tested there with fake values:

```bash
#!/usr/bin/env bash
# Loads an env file of secret references into the job environment, masked.
# Run it inside your secret manager's `run` command, which resolves every
# reference of the file into this process's environment, for example:
#
#   op run --env-file=ci.env --no-masking -- bash export-env.sh ci.env
#
# It prints nothing but ::add-mask:: commands. Never add `set -x` or an echo.
set -euo pipefail
file="$1"
# A line whose value holds this is a secret. Every other line is a plain value.
reference="${SECRET_REFERENCE:-op://}"

while IFS= read -r raw || [ -n "$raw" ]; do
  raw="${raw%$'\r'}"
  # Take NAME from lines like `NAME=...`, `NAME = ...` or `export NAME=...`.
  [[ "$raw" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*= ]] || continue
  name="${BASH_REMATCH[2]}"
  # The secret manager's own token and settings stay on this step, and the
  # runner does not let a step set its own names.
  case "$name" in OP_* | GITHUB_* | RUNNER_*) continue ;; esac
  value="${!name-}"
  [ -n "$value" ] || continue

  # Mask first, every line on its own, because the log is matched line by line.
  if [[ "$raw" == *"$reference"* ]]; then
    while IFS= read -r line || [ -n "$line" ]; do
      line="${line%$'\r'}"
      [ -n "$line" ] || continue
      printf '::add-mask::%s\n' "${line//%/%25}"
    done <<<"$value"
  fi

  # Then write, in the delimiter form so that newlines survive.
  delimiter="ghadelimiter_$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
  if [[ "$value" == *"$delimiter"* ]]; then
    echo "The value of $name holds the delimiter. Run the step again." >&2
    exit 1
  fi
  printf '%s<<%s\n%s\n%s\n' "$name" "$delimiter" "$value" "$delimiter" >>"$GITHUB_ENV"
done <"$file"
```

What to know about it:

- **The script masks only the values that come from a secret reference.** A line whose value holds `op://` is a secret, and every line of its value is masked. Every other line is a plain value: it is written to the environment and not masked. Keep values that are not secret, such as a region, a username or an organization name, as plain values in the file. A masked ordinary word turns every place it appears in the log into `***`, links included. The other side of the same rule: a secret pasted into the file as a plain value is not masked, so never do that. For another manager, set `SECRET_REFERENCE` to the prefix its references start with.
- **`--no-masking` is needed, and it is why the script prints nothing else.** Without it `op run` rewrites the script's output, the mask commands included, and the runner would mask the wrong text. With it, anything the script prints is raw. The runner never echoes a mask command to the log.
- **It masks before it writes**, masks each line of a multi-line value on its own, and writes each value with a random delimiter so a value cannot end its own entry.
- **It skips `OP_*`, `GITHUB_*` and `RUNNER_*` names.** The manager's token and settings stay on the loading step, and the runner does not let a step set its own names.
- **The token of the secret manager sits on the loading step only.** It never reaches Sluiceway or the tool. The values written to `$GITHUB_ENV` reach every later step of the job.
- **So the loading step comes after every install step.** Any step after it sees the credentials, the install scripts of your package manager included. Run `npm ci`, a build and anything else that installs before the loading step, and put the loading step right before Sluiceway's. With GitHub secrets on Sluiceway's step this order does not matter, which is why that recipe puts them there.
- **Measure what one load costs once.** How a secret manager counts one `run` over many references is often not documented. With 1Password, run `op service-account ratelimit` before and after one `op run --env-file=ci.env -- true` and compare. A per-account daily limit is shared by every service account of the account.

### State backends

The tool's backend is configured the same way, in the environment: for Pulumi, `PULUMI_ACCESS_TOKEN` for Pulumi Cloud, or `PULUMI_BACKEND_URL` for a bucket or another self-managed backend, and `PULUMI_CONFIG_PASSPHRASE` when stack secrets use a passphrase. Sluiceway never sets or defaults any of them. When one is missing, the tool's own error becomes that stack's preview failure, and the job log shows it.

### OpenTofu

The same pattern holds for OpenTofu (record 0053). Install `tofu` v1.11.0 or newer in a step before Sluiceway, without a wrapper around the binary, because Sluiceway reads what `tofu` itself prints:

```yaml
- uses: opentofu/setup-opentofu@a1320f892987e89d278cc92dc5adc984fb93aca4 # v2.0.2
  with:
    tofu_version: 1.12.6
    tofu_wrapper: false
```

Then load the backend's and the providers' credentials into the environment as for any tool. Every `TF_*` variable of the job reaches `tofu`: `TF_VAR_*` for variables, `TF_CLI_CONFIG_FILE` or a credentials file for a private registry, `TF_ENCRYPTION` for state and plan encryption, `TF_PLUGIN_CACHE_DIR` to download providers once per job. Sluiceway sets `TF_IN_AUTOMATION`, and `TF_WORKSPACE` for a stack whose options name a workspace, and nothing else.

- **A root module that discovery found runs the tool its lock file names**: providers from `registry.terraform.io` mean `terraform`, from `registry.opentofu.org` `tofu`. Install that one ([`discovery.rootModules`](configuration.md#discoveryrootmodules)).
- **Do not set `TF_WORKSPACE`** for the job. A found root module is the default workspace, and a stack that needs another names it in its options.
- **Do not set `TF_DATA_DIR`** for the job. Sluiceway runs `tofu init` in every directory of the stacks it previews, one after the other, and one shared data directory would make those inits overwrite each other.
- **`TF_CLI_ARGS` reaches the tool too.** Whatever it adds to a plan is in the plan file, and a tick deploys exactly that file, so the deploy never differs from the row. Prefer the named options.
- **The plan file holds every value in plain text.** Sluiceway keeps it in a temporary directory of its own and removes it when the preview or the deploy ends. It is never uploaded.

### Terraform, Terragrunt and CDK for Terraform

The Terraform family runs through the same adapter (record 0068), so everything above holds for it. For `tool: terraform`, install `terraform` v1.14.0 or newer without its wrapper:

```yaml
- uses: hashicorp/setup-terraform@dfe3c3f87815947d99a8997f908cb6525fc44e9e # v4.0.1
  with:
    terraform_version: 1.16.3
    terraform_wrapper: false
```

For `wrapper: terragrunt`, install terragrunt v1.0.0 or newer next to the tool it runs. Every `TG_*` variable of the job reaches it, such as `TG_PROVIDER_CACHE` or `TG_NON_INTERACTIVE`, but the binary is the one the entry's `tool` names: Sluiceway passes `--tf-path`, which wins over `TG_TF_PATH`.

For `wrapper: cdktf`, install cdktf v0.21.0 and what the app needs to run, such as Node and `npm ci` in the app's directory. `cdktf synth` runs the app, so the app gets the same environment as the tool. Set `CHECKPOINT_DISABLE=1` for the job to turn off cdktf's update check and telemetry.

### Helm

For Helm releases (record 0058), install helm v3.18.0 or newer and the [helm-diff](https://github.com/databus23/helm-diff) plugin v3.15.11 or newer in steps before Sluiceway. Helm 4 checks a plugin's signature unless told not to, and Helm 3 knows no such flag:

```yaml
- uses: azure/setup-helm@9bc31f4ebc9c6b171d7bfbaa5d006ae7abdb4310 # v5.0.1
  with:
    version: v4.3.0
- name: Install the diff plugin
  run: helm plugin install https://github.com/databus23/helm-diff --version v3.15.13 --verify=false
```

Then give the job a kubeconfig for the cluster, the way your own CI does: a cloud's own login action writes one for EKS, GKE or AKS through OIDC, and `KUBECONFIG` can point at a file a step writes from a secret. Sluiceway hands helm the whole environment, `KUBECONFIG`, `HELM_*` and the plugin's `HELM_DIFF_*` included, and sets nothing. A chart reference needs its repository: add it with `helm repo add` in a step before Sluiceway, or log in to an OCI registry with `helm registry login` (see below).

- **The namespace of every release must exist**, unless the stack turns on [`createNamespace`](configuration.md#stacksoptionscreatenamespace). Then the deploy's credentials need to create namespaces too.
- **The credentials need what a deploy needs.** The preview reads the release and renders with `--dry-run=server`, which the cluster answers as it would a deploy. The job needs them for the preview and for the deploy. `check`, `resolve` and `settle` never reach the cluster.
- **The drift check sends a dry-run patch of every object** of the release, which changes nothing and needs `patch` on those objects ([record 0069](adr/0069-helm-drift-is-the-three-way-diff-beyond-the-plain-one-and-the-deploy-flags-follow-helm.md)). With read access only, the diff plugin v3.15.13 and newer merges locally instead and says so in the job log, and older plugins fail the check.
- **Rendered manifests hold every value in plain text.** Sluiceway keeps only a digest of the render in memory while `apply` runs, and never writes the manifests anywhere.
### Kubernetes manifests

For a stack with `tool: kubectl` (record 0060), install `kubectl` v1.34.0 or newer in a step before Sluiceway, and give it a kubeconfig. `kubectl` reads `KUBECONFIG`, or `~/.kube/config`, like on a laptop, and Sluiceway hands it the whole environment of the job, so a cloud's own login step is all it takes:

```yaml
- uses: azure/setup-kubectl@v5
  with:
    version: v1.37.0

# For example on AWS: a role for the job, then a kubeconfig that uses it.
- uses: aws-actions/configure-aws-credentials@v6
  with:
    role-to-assume: ${{ vars.AWS_DEPLOY_ROLE }}
    aws-region: ${{ vars.AWS_REGION }}
- run: aws eks update-kubeconfig --name prod
```

- **The kubeconfig's exec plugin runs as the tool does**, so what it needs, such as a cloud login or `kubelogin`, has to be on the runner and in the environment too.
- **One kubeconfig can serve several clusters.** Name the context of each stack with the `context` option ([configuration](configuration.md#stacksoptionscontext)).
- **A preview needs read access and a server-side dry run**, which is the `patch` permission on every kind the manifests hold: a dry run is checked like the real request. A deploy needs the same permissions and does the real apply.
- **`prune` needs a few more rights** (record 0070): to get and patch the stack's inventory ConfigMap in its namespace (a server-side apply creates and changes it with a patch), and to get and delete every kind the stack deploys.
- **`diff` has to be on the runner.** `kubectl diff` runs it, and it is on GitHub's hosted runners. Sluiceway sets `KUBECTL_EXTERNAL_DIFF` for the preview itself, so a value the workflow sets there only changes the tool diff of `scan.logDiff`.
- **The rendered set holds every value of the manifests**, a Secret's too. Sluiceway keeps it in a temporary directory of its own and removes it when the preview or the deploy ends. It is never uploaded.

## What your programs fetch, the runner has to fetch

> [!WARNING]
> A program that pulls from a private registry works on your laptop and fails on the runner. Log in to that registry in a step before Sluiceway.

A preview runs your programs, and your programs fetch things: packages, provider plugins, container images, Helm charts, modules. On a laptop that works because the person is logged in. On a runner nothing is logged in until a step does it. When one stack fails in CI and works on your machine, look here first.

The job has to be able to reach, and log in to:

- **The package registries of your programs**, public and private, for the install step.
- **The tool's plugins or providers.** Pulumi downloads the provider plugins your programs name, from their public source or from the plugin server you configured.
- **Private charts and images your programs pull while they run**, such as a Helm chart in a private OCI registry.
- **The state backend and the cloud APIs**, which the recipes above cover.
- **Private Git repos** that a program or a package manager clones.

Self-hosted runners behind a firewall need outbound access to all of them.

Log in in a step before Sluiceway, with the same care as any other credential. A registry login writes a credentials file under the home directory, so the tool picks it up without any variable. Two common cases:

```yaml
      # Private npm packages: the install step reads the token, nothing else does.
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          registry-url: https://npm.pkg.github.com
      - run: npm ci
        env:
          NODE_AUTH_TOKEN: ${{ secrets.PACKAGES_READ_TOKEN }}

      # A private OCI registry that holds Helm charts, for programs that install
      # them while they run.
      - name: Log in to the chart registry
        env:
          REGISTRY_TOKEN: ${{ secrets.CHARTS_READ_TOKEN }}
        run: echo "$REGISTRY_TOKEN" | helm registry login ghcr.io --username "${{ github.actor }}" --password-stdin
```

On a self-hosted runner that is not wiped between jobs, that credentials file stays behind for the next job. Log out at the end of the job (`helm registry logout`, `docker logout`) or use runners that start clean.

A preview failure row links to the scan's run. The job log group of that stack holds everything the tool printed, the name of the registry or package it could not fetch included.

## Next to your own tooling

Most repos already run the tool in their own way: a script, a task runner, a laptop, another pipeline. Keep it. Sluiceway only previews and deploys the stacks it finds. Destroying a stack, a refresh and repairing state stay with your own tooling, and Sluiceway writes no lock and puts no marker in the tool's state, so other ways to deploy keep working.

- **Your wrapper script is not needed in CI.** What a wrapper does around each run of the tool (load an env file, pick a backend, pass fixed flags) becomes the loading step of the job. Sluiceway runs the tool itself, so it can check the tool's version, stop a preview at its time limit, and read its output.
- **An outside deploy is allowed.** It has no deployment record. For a Pulumi stack the next full scan finds it in `pulumi stack history`, which needs the same backend access as a preview and no passphrase, and lists it under recently deployed. A row it left behind stays pending until the next full scan. Tick the rescan box on the dashboard, or wait for the scheduled scan. A tick on that row deploys nothing: the fresh preview finds a different diff and the row is written again.
- **Two deploys of one stack at the same moment** meet at the tool's own state lock. One of them fails cleanly, and if it was Sluiceway's, the row shows a failure line.
- **To make the dashboard the only way in**, take the credentials that change things away from every other place. That is access control in your secret manager and your cloud, not a Sluiceway setting.
