# The check reads the workflow files, and the result file has a published schema

> Amended by 0074: the check also reads the concurrency groups, the status checks in the `if:` of `apply` and `settle`, the `needs` of `settle` and the second apply job of merge and deploy, each only where the text plainly lacks it. Still a warning, never a red job.
>
> Amended by 0077: a step with no mode is auto mode, and the check reads what it runs from the triggers of its file.

Record 0042 made the check a pass over the repo's files that says whether Sluiceway understands the setup: the config, the stacks, `ignore` and the files no stack claims. It left the workflow out, because GitHub validates a workflow. What GitHub does not validate is whether a workflow is the one Sluiceway needs: a missing `workflow_dispatch`, `actions: read` where a mode dispatches, a `resolve` job in a second file or a branch as the ref all run without an error and fail later, on the first tick or the first rescan. The workflow is a file in the checkout, so the check can read it with the same promise: no credentials, no tool, no GitHub API.

Record 0041 made the result file what the summary holds, and left attribution, the timings of an `apply` and a committed schema to later (slice 2.11). Build plan slice 4.10 brings them in.

## Decision

### The check reads the workflow files

- **It reads every `.yml` and `.yaml` file directly under `.github/workflows`**, the files GitHub reads, and looks only at jobs with a step that uses `sluiceway/sluiceway@<ref>`. A file that is not valid YAML is a warning only when it names Sluiceway. A workflow that does not run Sluiceway is not mentioned.
- **It lists every job that runs Sluiceway** with its mode and its ref, in the job log and in a Workflows section of the summary.
- **What it says is missing, one warning each:**
  - a trigger: `push`, `schedule` and `workflow_dispatch` in a file that scans, and `issues` with the type `edited` in a file with `resolve`;
  - a trigger that must not be there: `pull_request`, `pull_request_target` or `merge_group` in a file with any job but the check;
  - a job: a file with `resolve`, `apply` or `settle` needs all four, scan included, because the orphan sweep reads the runs of its own workflow and the rescan box and `settle` start that same file;
  - a file that scans with no `resolve` in it while `dashboard.readOnly` is off, because its boxes would do nothing (0045);
  - a permission a mode needs, from the job's own block or else the workflow's, since a job's block replaces the workflow's. `write-all` gives everything, `read-all` no write. No block at either level is a warning of its own, because the repo's default cannot be read from a file;
  - a step without a mode, or with one that does not exist;
  - a ref that is not a release: anything but a major tag (`v0`), an exact tag (`v0.8.0`) or a full commit SHA, such as a branch or `v0.8`;
  - two refs in one file, because a scan and the deploy it leads to would run different versions.
- **The permissions each mode needs**, from the calls each mode makes:

  | Mode | Needs |
  |---|---|
  | `scan` | `contents: read`, `issues: write`, `deployments: write`, `actions: read`, `pull-requests: read` |
  | `resolve` | `contents: read` (`write` with `mergeAndDeploy.authors`, 0054), `issues: write`, `deployments: write`, `actions: write`, `pull-requests: read` |
  | `apply` | `contents: read`, `issues: write`, `deployments: write`, `pull-requests: read` |
  | `settle` | `contents: read`, `issues: read`, `deployments: write`, `actions: write` |
  | `check` | `contents: read` |

  `checks: write` on a scan is a note, not a warning: without it there are no preview pages and the link falls back (0050).
- **A reusable workflow** (`on: workflow_call`) gets a note, and no trigger or permission warning: both come from its caller, which the check does not follow.
- **Nothing here turns the job red.** The job stays red only for a config or discovery error (0042). A workflow can differ on purpose, for a read-only trial or a self-hosted setup, and GitHub is the one that validates and runs it. The summary says that the check reads the files as text, and that the repo's default token permissions and an environment's rules do not show there.

### The result file

- **A scanned stack carries `attribution`**: the pull requests and direct pushes it claims since its last successful deploy (0026), newest first, as the summary lists them. A pull request has `number`, `title`, `url` and `author` when GitHub has one. A direct push has `commit`, the first line of its `message`, `url` and `author`. The key is missing when the lookup failed or the scan did not attribute the stack, and an empty list when nothing it claims changed. A title and a commit message are text a person wrote, which the summary already shows, so the file may hold them. They are never a property value.
- **An `apply` file carries `seconds`**, from the start of the job to the file, and **`deploySeconds`**, the tool's deploy, `null` when the tool was never asked to deploy. `apply` gets the clock seam the scan has.
- **The version stays 1.** Every field is added, none changes meaning, as 0055 did for drift.
- **The JSON schema is committed as `schema/result-file.schema.json`**, next to `schema/sluiceway.schema.json`, written by the same `bun run build:schema` and checked in CI the same way. It is generated from the strict schemas the renderer checks its own output against, so it cannot drift from what is written.

## Considered

- **One permission set for every job, the README's block.** Simpler, and what the docs tell people to write. Rejected, because the README's own read-only trial runs the scan with `actions: read`, which is right, and a check that warns about a correct workflow teaches people to ignore it.
- **Checking the concurrency groups, `!cancelled()` on `apply`, the label in the `if:` of `resolve` and the branch of `push`.** Left out (later.md). Each is an expression GitHub evaluates, and the docs tests already hold every shipped workflow to them.
- **A red job for a missing trigger or permission.** Rejected for the reason above: the job's red stays the verdict of 0042, "Sluiceway does not understand this setup".

## Consequences

- Record 0042 is amended: the check reads the workflow files too. The promise stays: files only, no credential, no tool, no GitHub call. The import walk of the check job allows the same packages as before.
- Record 0041 is amended: attribution and the timings of an `apply` join the file, and the schema is published.
- `docs/later.md` loses the three lines about the result file that this delivers and the line about the check reading workflows, and gains one for what the check leaves out of a workflow.
