# Policies

A repo can name policies, and every scan tests the preview of each pending stack against them, right after the preview, in the same job. A policy that fails takes the box off the row until the change or the policy changes, and stops a deploy on merge. The policies are Rego, and the runner is [Conftest](https://www.conftest.dev), which your workflow installs and Sluiceway runs ([record 0106](adr/0106-policies-run-against-the-preview-and-a-hard-failure-takes-the-box-off-the-row.md)).

## Set it up

1. Put your policies in a directory of the repo, and name it in `sluiceway.yaml` with [`policies`](configuration.md#policies). An entry can add paths for its own stacks with [`stacks[].policies`](configuration.md#stackspolicies).

   ```yaml
   policies:
     - policies
   ```

2. Install `conftest` 0.50.0 or newer in the job that scans, in a step before Sluiceway, the way the job installs the tool. Sluiceway never installs it and never wraps it.

   ```yaml
   - name: Install conftest
     run: |
       curl -fsSL https://github.com/open-policy-agent/conftest/releases/download/v0.70.1/conftest_0.70.1_Linux_x86_64.tar.gz \
         | tar -xz -C /usr/local/bin conftest
   ```

3. Push. The next scan runs every namespace of every policy file in the paths against each pending stack. The job log says which version of conftest ran, and per stack what came of it.

## What a policy reads

The input is the tool's own preview document of the stack, which is what a tick approves:

| Tool | `input` |
|---|---|
| Pulumi | The preview as `pulumi preview --json` prints it: `input.steps[_]` with `op`, `urn`, `oldState` and `newState` |
| OpenTofu and Terraform, Terragrunt and CDK for Terraform too | The plan as `tofu show -json` or `terraform show -json` prints it: `input.resource_changes[_]` with `change.actions`, `change.before` and `change.after` |
| Helm | The manifests the chart renders, as a YAML stream: one object per document, `input.kind`, `input.metadata`, `input.spec` |
| Kubernetes manifests | The rendered set, the same way |

A YAML stream is judged object by object, so a rule about a `Deployment` sees each one alone. The program's files are not an input.

## Write one

Conftest 0.70 runs OPA 1.0, whose Rego needs `if` and `contains`. Add `import rego.v1` so that 0.50.0 reads the same file:

```rego
package main

import rego.v1

# OpenTofu and Terraform: no bucket may be public.
deny contains msg if {
  some change in input.resource_changes
  change.type == "aws_s3_bucket_acl"
  change.change.after.acl == "public-read"
  msg := sprintf("%s must not be public", [change.address])
}

# Pulumi: nothing in prod is deleted by a tick.
deny contains msg if {
  some step in input.steps
  step.op == "delete"
  msg := sprintf("%s must not be deleted", [step.urn])
}

# A warning changes nothing on the row.
warn contains msg if {
  some step in input.steps
  step.op == "replace"
  msg := sprintf("%s is replaced", [step.urn])
}
```

A `deny` that gives a message fails the policy. A `warn` is listed on the preview page and in the summary and leaves the box. Every package runs, whatever its name, so keep policies for other tools in another directory.

**Name what is wrong, not what it is set to.** The message goes on the dashboard, which everyone who can read the repo can read, and on a public repo everyone. Sluiceway escapes it as text, so it can never be markup, and cuts it on the row at 200 characters, but it does not read it: a message that prints a value prints it to the issue, the way [`dashboard.showValues`](configuration.md#dashboardshowvalues) does on purpose.

## What you see

- **On the row**, when a policy fails: no box, and under the attribution line `:no_entry: **1 policy failed**, so this change has no box until it passes:` with one line per failure, `main · <the message>`, at most five. A redacted or shortened row keeps the count and points at the preview page. The row comes back with its box on the first scan whose preview passes.
- **On the preview page and in the summary**: every failure whole, first, then every warning, then the changes. A pass says how many rules ran and in which namespaces.
- **When the policies could not run**: the row keeps its box and says `:warning: the policies did not run: <why>`, and the run carries a warning. conftest missing or too old is said once for the job, with what to install. A policy that does not parse, a path that is not in the repo, a report that could not be read or a run out of time is said per stack, and conftest's own words are in the stack's group of the job log. A policy that fails to run is not a policy that failed: nothing was checked, and the docs say so rather than a red job.
- **A stack set to [`deploy: on-merge`](configuration.md#stacksdeploy)** whose change fails a policy does not go out, and the job log says so. A stack that depends on it waits, as on any change waiting for a tick.
- **A tick that a policy stopped** is refused: the row has no box, and an edit of the body that adds one is cleared with a note. The bulk box counts no such row.

## What it does not do yet

The soft failure that asks for a second person to tick, Checkov as a second runner, the program's files as an input, policies on the pull request preview, and a check that says a workflow with policies installs no conftest are in [later](later.md).
