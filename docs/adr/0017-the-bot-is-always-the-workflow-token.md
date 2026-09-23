# The bot is always the workflow's own token

> Amended by 0086: every scan also lists the queued runs of its own workflow, one request, so the worst case becomes 406 requests on the first try and 808 with three.
>
> Amended by 0025: `resolve` no longer uses `queue: max`. The first reason below still holds in a weaker form: with another token every re-render would start a `resolve` run that finds nothing to do.
>
> Amended by 0050: the scan job also needs `checks: write`, for one preview page per pending stack. It adds one list request per 100 check runs on the commit and one write per pending stack, once per scan, so the worst case below becomes 405 requests on the first try and 807 with three.
>
> Amended by 0054: with merge and deploy on, the bot also merges pull requests, and the `resolve` job then needs `contents: write`. The merge's push starts no run, so `resolve` dispatches a scan.
>
> Amended by 0077: auto mode runs the cheap check before any mode, and in the one-step workflow an edit of an ordinary issue starts a runner that ends with a notice.

Sluiceway acts on GitHub as one identity, the bot: `github-actions[bot]`, through the `GITHUB_TOKEN` of the workflow run. Every write goes through it: the dashboard, comments, deployment records, the rescan dispatch. There is no supported way to hand Sluiceway a GitHub App token or a personal access token for these writes in v1.

A `token` input that accepts any token is what most actions offer, and it was rejected for three reasons. First, edits made with `GITHUB_TOKEN` start no workflow run, which GitHub documents and the behavior test confirmed, while edits made with any other token do. With another token every re-render would fire `issues.edited`, start a `resolve` run, and take a place in the `queue: max` line in front of real ticks (0005). The loop guard would then be our own code instead of a property of the platform. Second, the dashboard is recognized partly by its author (0009). With the workflow token the author is a constant. An App installation token cannot ask GitHub who it is, so the identity would need a second input, and a dashboard created with a personal token stays editable by that person whatever their role, because an author can always edit their own issue. Third, the workflow token ends with the job and is scoped by the workflow's `permissions:` block. Nothing long-lived has to be stored, which is what promise 1 of 0014 expects.

## Consequences

- The author check of 0009 is a constant: login `github-actions[bot]`, type `Bot`. Nothing is configured and nothing is discovered.
- The bot's power is exactly the `permissions:` block of the example workflow: `contents: read`, `issues: write`, `deployments: write`, `actions: write`. `id-token: write` is added only by users whose credential loading needs OIDC, and only on the jobs that run the tool.
- The budget is 1,000 API requests per hour per repo. Reads stay bounded as in 0003, and any new feature is judged against this budget.
- Nothing Sluiceway writes can start another workflow. A team that wants a message on every deploy adds a step to its own apply job. It cannot hang a workflow on `deployment_status` or on the dashboard's edits.
- Team membership cannot be read with this token, which is one reason teams are left out of the tick rule (0018).
- `resolve` judges the edited issue from the event payload alone: open, carries the configured label, authored by the bot, root marker on the first line. If any of these fails it exits green and silent, without an API call. `issues.edited` fires for every issue in the repo, so this is the common case.
- The example workflow also filters at the job level (`if: contains(github.event.issue.labels.*.name, 'sluiceway')`), so an edit of an ordinary issue starts no runner and takes no place in the line. It is an optimization. The check inside the action is the real one, and a user who changes the label has to change the `if:` too.
- Only `scan` creates or repairs the dashboard, as Renovate does. When several open issues match, the lowest number is the dashboard and the others are closed with a comment that links to it. When no open issue matches but a closed one does, the newest closed match is reopened, which keeps the issue number, the pin and every link. Closing the dashboard is not an off switch. Disabling the workflow is.
- A duplicate can take a tick until the next scan closes it. That is accepted, because deploy safety rests on the deployment record and the hash check, never on which issue was ticked (0004).
- A supported App token can be added later as a new input without breaking anyone. It would bring the identity input and the loop guard with it, and those are the cost that is not paid now.

## Settled while building (slice 3.1)

- The scan logs how many requests it made, as its last line: `The scan made 6 requests to the GitHub API. GitHub allows the workflow token at least 1,000 an hour in a repo.` It is also printed on a red scan. The count is taken on the wire, by a hook on the Octokit client, so each page of a list, each GraphQL query and each refused request counts once, as GitHub counts them. The e2e run holds the logged count to the count of the fake GitHub server. The line says "at least" because GitHub Enterprise Cloud gives the token 15,000. Only the scan logs a count in v1, because the acceptance test asks it of the scan and the scan is the mode that runs on every push.
- Measured on the fake with 100 stacks (`test/modes/hundred-stacks.test.ts`). Previews cost no request, so the number of stacks alone changes nothing:

| Scan | Requests |
|---|---|
| The first scan, no dashboard yet | 7: find (two lists, open and closed), records, create, pin, read back, records again |
| Any later full scan, 3 stacks or 100, records on one page | 5: find, read, records, write, read back |
| 100 pending stacks, the page of the environment full, every change a direct push | 304: the 5 above, two requests for each of the 99 stacks off the page (0003), the walk and 100 commit files (0026) |
| The same, with a write that has to be tried again | 201 more for each try: the records and their fall back are read again (0004), the walk and the commit files are not |

- One environment name costs one page per try. A config that gives each of 100 stacks its own `environment` pays 100 pages per try instead of 1.
- The worst case is 706 requests for one scan: the last row of the table with three tries. It needs a full environment page, pending stacks that fell off it, a lookback of nothing but direct pushes, and another writer twice in the few seconds between a write and its read back. Every number in it is the one records 0003, 0004 and 0026 give. The ordinary scan costs 5. So the budget holds, with the note that a repo which deploys one stack very often in a shared environment pays for every other pending stack on each scan.

Research:
- https://github.com/sluiceway/sluiceway/blob/research/github-actions-behaviors/docs/research/github-actions-behaviors.md
- https://github.com/sluiceway/sluiceway/blob/research/renovate-dashboard-mechanics/docs/research/renovate-dashboard-mechanics.md
- Observed payloads: https://github.com/sluiceway/sluiceway/issues/17

## Settled while building (slice 5.9)

- Slice 5.9 adds three calls to the budget. A scan gives a dashboard that exists the title of `dashboard.title` when it has another, one request and only then, so a change of the key renames the dashboard and a title changed by hand is put back. With `dashboard.pin` on, a scan reads the pinned issues (one GraphQL query) and pins the dashboard when it is not among them, so a dashboard that exists costs one request per scan and a second only when it was unpinned. A person who wants it unpinned for good sets `dashboard.pin: false`: the key is the one place that decides, where slice 1.10 had let an unpin stand. A pin that fails on a dashboard that exists is a line of the log, not a warning on every run. When no open dashboard exists, the closed issues with the label are read as one page, the 100 that changed last, newest first, where slice 1.10 read every page: a closed dashboard is among them unless 100 other issues with its label changed after it was closed.
- Every dispatch asks GitHub for the run it started (`return_run_details: true`, GitHub's REST docs of 2026-03-10: 200 with `workflow_run_id`, `run_url` and `html_url`, where it answered 204). `resolve` logs the page of the scan that the rescan box, a merge or a body of another version started, and its job summary links to it. It stays off the dashboard, for the reason slice 2.4 gave: a line for a scan on its way would be a fact outside the row blocks, and the scan shows itself on the dashboard when it is done. A GitHub that still answers 204 gives no page, and the line says only that a scan was started.
