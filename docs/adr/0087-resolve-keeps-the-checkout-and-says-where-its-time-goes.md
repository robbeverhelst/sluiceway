# Resolve keeps the checkout, and says where its time goes

> Built as slice 5.23. Changes nothing `resolve` decides or writes: one line in its job log, and this record of what was measured.

The owner asked whether the tick loop can feel faster. Measured on a real repo, a tick takes 15 to 25 s to show `waiting to start` on its row: about 3 to 10 s for GitHub to start the run, 5 s to get a runner, 3 to 5 s of checkout and starting Node, and about 5 s of Sluiceway. This record is about the part Sluiceway owns, in three steps, in this order: measure it, ask whether `resolve` could work without a checkout, then decide.

## Decision

- **`resolve` says in its job log where its own time went**, once per run that acted on the dashboard, as its last line: `Resolve took 3.3 s: reading the dashboard 0.4 s, reading the config 0.0 s, discovery 0.0 s, reading deployment records 0.3 s, judging ticks 0.3 s, opening records 0.7 s, writing the body 1.6 s. Starting the action took 0.1 s before that.` A part that did not run is left out, `the rest` names time between the parts when it shows (a comment, a merge, a dispatch), and the last sentence is the time from the start of the process to the start of `resolve`. It goes to the job log, not the job summary: it is about Sluiceway, not the dashboard. The clock is injected (build plan, section 5); the stopwatch is `src/core/stopwatch.ts` and the words are `src/render/timing.ts`.
- **`resolve` keeps reading the checkout.** It does not move to the GitHub API. The numbers below say it would not be faster where it matters, and in the recommended workflow it cannot be done at all.
- **The recommended workflow does not change.** Nothing here asks for it.

## What was measured

### Sluiceway's own part

Four ticks on the release test bed (`sluiceway/release-verify`, 24 files, three Pulumi and three OpenTofu stacks), the split workflow, `ubuntu-latest`, this slice's commit, 2026-09-23. From the timing line and the step times of the log:

| Tick | checkout step | whole Sluiceway step | resolve | dashboard | records | ticks | opening | body | rest |
|---|---|---|---|---|---|---|---|---|---|
| allowed | 0.59 s | 3.4 s | 3.3 s | 0.4 | 0.3 | 0.3 | 0.7 | 1.6 | |
| refused (not on the list) | 0.70 s | 3.4 s | 3.3 s | 0.5 | 0.2 | 0.3 | | 1.7 | 0.5 (the comment) |
| allowed | 0.58 s | 2.9 s | 2.8 s | 0.3 | 0.4 | 0.3 | 0.4 | 1.2 | |
| allowed | 0.85 s | 5.0 s | 4.9 s | 0.6 | 0.3 | 0.4 | 0.7 | 2.8 | |

Reading the config and discovery took 0.0 s in every run, and starting the action 0.1 s. The earlier runs of `sluiceway/examples` (129 files, on `v0` the day before, without the line) agree: from the log's timestamps the checkout step took 0.75 s and the Sluiceway step 4.0 s, of which 2.4 s came after the record was opened.

So of Sluiceway's 3 to 5 s, the checkout is not the part to win back: reading the files is free, and the checkout step is under a second. Writing the body is the largest part, 40 to 57 percent: the write loop's late read of the issue, the deployment records again for the trail, attribution, the write, and the read back (0004, 0062, 0026). That is left for later (below).

### The checkout against the GitHub API

`resolve` reads the working tree for four things: `sluiceway.yaml`, discovery, Renovate's config when a tick merges an update (0064) and the workflow file when a merge scan may be narrowed (0064). Without a checkout, one recursive git tree call (`GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1`) gives every path at the commit, and the contents of the files discovery reads would come in GraphQL queries of up to 100 blobs each.

What each adapter needs from the files:

- **Pulumi: the contents of every project file.** Discovery reads `stackConfigDir` (where the stack files are), the keys a `phase: { from }` names, and whether the file parses at all, since a broken project file is a discovery error. Paths alone are not enough: one read per Pulumi project.
- **Helm: the contents of each release's `Chart.yaml`**, and of every local chart its `file://` dependencies lead to, to find what needs `helm dependency build` (0069). One read per chart of the tree.
- **OpenTofu, Terraform, Terragrunt, CDK for Terraform and Kubernetes manifests: paths only**: that the directory holds `.tf` or `.tofu` files, that var files are files, which manifests and kustomizations are there.
- **Where the tree is not the working tree.** A symlink is a blob of its own in the tree, and `statSync` follows it on disk, so a chart, a var file or a `stackConfigDir` reached through a link needs another read to resolve. A submodule is a commit entry in the tree and an empty directory in a checkout without submodules. The tree is cut off past 100,000 entries or 7 MB and then needs a call per directory.

Measured on `ubuntu-latest`, three tries each, the same depth 1 fetch and checkout as `actions/checkout` (git only, without the step's own overhead of about 0.3 s) against the tree call and one GraphQL query for up to 100 Pulumi project files:

| Repo | files | Pulumi projects | checkout | tree call | 100 project files | calls the API route adds |
|---|---|---|---|---|---|---|
| sluiceway/release-verify | 24 | 2 | 0.32 to 0.33 s | 0.27 to 0.32 s | 0.33 to 0.45 s | 2 |
| sluiceway/examples | 129 | 10 | 0.36 to 0.45 s | 0.31 to 0.42 s | 0.55 to 0.64 s | 2 |
| pulumi/examples | 2,950 | 361 | 1.7 to 1.9 s | 0.45 to 0.59 s | 1.2 to 3.1 s | 5 |
| hashicorp/terraform-provider-aws | 20,956 | 0 | 8.2 to 8.5 s | 1.1 to 1.3 s | | 1 |
| kubernetes/kubernetes | 31,386 | 0 | 10.9 to 11.4 s | 1.3 to 1.9 s | | 1 |

"Calls the API route adds" counts the tree call, one query per 100 files to read (the config file rides in the first), and nothing for the checkout it replaces; a merge adds one more for Renovate's config and the workflow file. Against the budget of 1,000 requests an hour (0017) that is small either way.

- **Infrastructure repos of up to a few thousand files lose or break even.** A repo the size of the test beds saves nothing: the tree call alone costs what the checkout does, and the project files cost more. A repo of 361 Pulumi projects is slower by 3 to 11 s, because every project file must be read and GraphQL answers slowly for many blobs.
- **Only very large repos without Pulumi projects gain**: 7 to 9.5 s on 21,000 to 31,000 files, where the tree call replaces a checkout of the whole tree. That is not the repo Sluiceway is built for, and even there it would help only the split workflow.
- **The recommended workflow cannot drop the checkout.** In the one-step workflow (0077) the step that resolves a tick also deploys it, in the same job, and the tool needs the working tree. The checkout could only be skipped with an `if:` on the event, which is what 0077 took out of the workflow, and a change to the recommended shape is the owner's to make. So the gain is zero for everyone on the recommended workflow, and nothing, or less than nothing, for a split workflow on an ordinary repo.

## Rejected

- **`resolve` from the GitHub API, with the checkout path kept.** Two ways to read the same repo in four adapters, with the differences above (links, submodules, the cut-off tree), for a gain that is zero on the recommended workflow and negative on a repo with many Pulumi projects. The seconds are not there. It stays in `docs/later.md` for a split workflow on a very large repo.
- **A sparse checkout, or `filter: blob:none`, in the docs.** A repo of the size measured spends a third of a second on its checkout, and a Pulumi program needs its whole directory for `apply` in the same job.
- **Timing every mode.** The question was about the tick. A scan already says how long each preview took and the whole pool (0085), and `apply`'s result file holds its times (0061).
- **Speeding up the body write in this slice.** It is the largest part, and every read in it is there for a rule: the late read of the write loop (0004), the trail from the records (0062), attribution (0026). Changing their order or doing them at once touches what the body says in a race. It is a slice of its own, measured with this line, and listed in `docs/later.md`.
