# Acceptance checklist

This is the owner's checklist. It proves v1 against the first real user: a correct, readable dashboard for every stack, then one ticked stack deploying and nothing else.

It is the only file in this repo that describes one user's setup. Everything else is written for a general product. The build order is in [build-plan.md](build-plan.md).

The first real user is the owner's homelab repo: 58 Pulumi stacks in 51 projects, `Pulumi.yml` naming, a MinIO (S3) state backend, self-hosted runners on the cluster (at most four, 1 CPU and 4 Gi each), secrets in 1Password, a wrapper script around every `pulumi` call, deploys in phases, and a shared components package. It is a private repo on a personal account, so it is setup 1 of record 0020: the tick is the whole gate.

## Part 1: live pass in a scratch repo

When: after M2, before the first release. Where: the private lab repo, with a copy of `examples/pulumi-basic` and the README's workflow pinned to the commit under test. No cloud account is needed. The state backend is a local directory that the workflow restores and saves with a cache step.

This pass exists because CI runs against a fake GitHub. Each line checks something the fake only imitates.

- [ ] A push gives a dashboard issue, authored by `github-actions[bot]`, labelled and pinned.
- [ ] The header image shows, moves, and follows the GitHub theme in light and dark.
- [ ] A second push that changes one stack's directory previews only that stack (read the job log) and leaves every other row as it was.
- [ ] Ticking a row in the browser starts a run. The row turns to `waiting to start`, then `deploying`, with `ticked by` and the right name.
- [ ] The deploy succeeds. The row is in sync, the stack is under Recently deployed, and the deployment record in the repo's Deployments list has the task `sluiceway:<stack id>`.
- [ ] The bot's own edits started no run (the Actions list shows one run per tick and none for the re-renders).
- [ ] Two people tick two rows within a few seconds. Each deploy names its own ticker.
- [ ] A second account with write access ticks a stack whose `tickers` is `admin`. Nothing deploys, the box is cleared, and one plain comment names the person and the rule.
- [ ] Tick a row, then merge a change to that stack before the `apply` job starts (pause the runner or use a waiting environment). Nothing deploys, the job is red, and the row shows the new diff with its failure line.
- [ ] Cancel a run while `apply` is running. Within a minute the row carries a failure line that says the run ended without a result.
- [ ] Press "Re-run failed jobs" on that run. Nothing deploys, and the summary says to tick again.
- [ ] Tick the rescan box. A full scan starts and the box is clear afterwards.
- [ ] Close the dashboard issue. The next scan reopens the same issue number.
- [ ] Set `dashboard.redact: true`. No resource type, resource name or property name is left in the issue, and the summary is still full.
- [ ] Set `dashboard.personality: false`. The image is gone and the dry line shows.
- [ ] A stack with a delete shows the plain header, the open `DELETE` line and bold counts.
- [ ] A resource named `#1 @octocat www.example.com *x*` shows as that plain text on its row: no link, no mention, no emphasis. Record 0112 says what `src/render/escape.ts` writes for it. If GitHub links any of it, that record no longer matches GitHub.
- [ ] Open the summary of a scan run. Key caps, folds, the warning sign and the links to pull requests render, and no list runs into the one before it. The job log holds one group per previewed stack, titled with the stack id, with the same changes in it.
- [ ] Click `preview` on a pending row. It opens that stack's preview page, `sluiceway / <stack id>`, with the counts, the warning when it destroys something, every change with its property paths, and links to the dashboard, the summary and the job log that land. Note which workflow run's jobs list shows the page, and whether a pull request's checks show it. Scan the same commit again from the rescan box: the commit still has one page per pending stack. Take `checks: write` out of the workflow and scan: the rows link to the summary and the job log says `No preview page was written` (record 0050).

## Part 2: what the owner prepares in the homelab repo

- [ ] Runners are version 2.328.0 or newer and none is ARM32. `node24` does not run on older runners or on ARM32.
- [ ] Pulumi CLI 3.229.0 or newer is installed by a workflow step. The local wrapper script is not used in the workflow.
- [ ] A 1Password service account that can read only the homelab vault. Its token is a repo secret for the `scan` job. For the `apply` job, the same token, or on a plan with environments a token stored as a secret of the deploy environment.
- [ ] One step per job loads the whole env file with a single `op run`, and registers every value with `::add-mask::`. Not the official load-secrets action: it reads once per reference and drops plain values (secret manager research).
- [ ] Measure once what that `op run` costs: run `op service-account ratelimit` before and after. Write the number here: `____` requests per load. With about 20 jobs a day this must stay far below the hourly and daily limits of the plan.
- [ ] The job environment gives the tool what the wrapper gave it: `PULUMI_BACKEND_URL` for MinIO, the S3 credentials, `PULUMI_CONFIG_PASSPHRASE` or its file, and whatever the programs read. The runner can reach MinIO and the cluster.
- [ ] The workflow installs dependencies once at the repo root, so the shared components package resolves, and caches `~/.pulumi/plugins`.
- [ ] `sluiceway.yaml` exists with at least: `inputs: ["workspaces/apps/*/dashboards/**"]` on the `workspaces/pi` stack, and `ignore` for anything that must not be on the dashboard.
- [ ] The wrapper previews with `--refresh`. Sluiceway does not (record 0015). Expect rows that differ from what the wrapper shows where reality has drifted. Note them, they are not bugs.
- [ ] Two programs write into their own directory during a preview. That is safe because a stack is never previewed twice at once (record 0012). Check that the scan leaves no changed files that matter: the workflow never commits.
- [ ] Pick the low-risk stack for part 4 now, and write its stack id here: `____`. Good candidates have no delete or replace pending, hold no data, and are easy to check by eye after the deploy.

## Part 3: a correct dashboard for every stack

Every hurdle met in parts 2 to 4 gets a line in [the onboarding log](onboarding-log.md) when it happens, workarounds included.

When: first after M1, read only, at a pinned commit SHA with only the `scan` job in the workflow. Again after the first release, with the whole workflow at `v0`.

- [ ] Trigger a full scan by hand. The job is green.
- [ ] The dashboard has exactly one row for every stack: 58, or the number that `ignore` leaves. No stack is missing and none is listed twice. Both stacks of a project with two stack files are there.
- [ ] Pick five pending rows. For each, run the wrapper's own preview without refresh. The resources, the ops and the changed property paths agree with the row.
- [ ] Pick five in sync rows and do the same. The preview is empty.
- [ ] No row, no summary, no preview page and none of Sluiceway's own log lines shows a property value. Search the issue body, the summary and three preview pages for a known secret and for a known plain value.
- [ ] Every preview failure row links to a run whose log explains it, and the failure reason on the row is one of the fixed ones.
- [ ] The body is under 58,000 characters with every row in full, or the shortened rows note is there and its links work.
- [ ] Read the timings from the job log and write them here. Total scan: `____`. Slowest preview: `____`. Median preview: `____`. Peak memory, if the runner reports it: `____`.
- [ ] The line `The pool is ...` in the job log names the number of cores the runner's CPU limit gives it, and says it came from this machine. Leave `concurrency` out unless the runner is shared with other jobs. Set `preview-timeout` to at least three times the slowest preview. Write the pool and the time limit here: `____`. If the pool that follows the cores is wrong for an ordinary hosted runner too, that is a change to record 0085.
- [ ] Merge a change to one app's directory. The scan that follows previews that one stack (and `workspaces/pi` when the change is under a `dashboards` folder) and no other.
- [ ] Merge a change to the shared components package. The scan that follows is a full scan.
- [ ] The API budget holds: a full scan stays far below 1,000 requests. The last line of the scan's job log prints the count (`The scan made N requests to the GitHub API.`). Write it here: `____`.
- [ ] Look at the dashboard on a phone, and in light and dark theme. It is readable without scrolling sideways.
- [ ] Leave the scheduled scan on for three days. Every morning the dashboard is true, and no run is red for a reason that is not a broken scan.

## Part 4: one ticked stack deploys, and nothing else

When: after the first release, with the whole workflow at `v0`.

- [ ] Before ticking, note the state serial or the last update time of three stacks: the chosen one and two others that are pending.
- [ ] Tick the chosen stack's box in the browser.
- [ ] Only one `apply` job starts, for that stack id. The `resolve` and `settle` jobs ran on a hosted runner or without the 1Password token, and their logs show no tool call.
- [ ] The row says `deploying`, with `ticked by` and the owner's login. Its box is gone.
- [ ] The deploy succeeds and the change is live. Check it by eye, the way the stack was chosen for.
- [ ] The row is in sync. The stack is first under Recently deployed with the right name, time and run link. The deployment record carries the deployed commit.
- [ ] The two other stacks were not touched: same state serial or update time, and their rows are still pending with their boxes clear.
- [ ] The next full scan changes nothing on the chosen stack's row.
- [ ] Deploy another pending stack from a laptop with the wrapper. Tick rescan. Its row becomes in sync and nothing about it appears under Recently deployed (record 0016).
- [ ] Make a second small change to the chosen stack and merge it. Its row is pending again and the attribution line names that pull request, by number and plain login.

## After it passes

- [ ] Write the measured numbers from parts 2 and 3 into the map's closing comment, so they are not lost in this file's history.
- [ ] Turn on "Allow GitHub Actions to create and approve pull requests" if it is still off, so release-please can work.
- [ ] Turn on private vulnerability reporting, which `SECURITY.md` points at.
- [ ] Install the Renovate app on the `sluiceway` org.
- [ ] Reserve the `sluiceway` npm name with a placeholder package, and register `sluiceway.dev`.
- [ ] Decide what comes next from [later.md](later.md). The homelab's deploy phases are the first thing that will ask for stack dependencies.
