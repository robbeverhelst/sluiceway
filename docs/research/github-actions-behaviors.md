# Which GitHub Actions behaviors does the design rest on?

Research for issue #2. Checked on 2026-09-20 against docs.github.com, the GitHub changelog and the official GitHub OpenAPI description (`github/rest-api-description`). Every claim links to its source. Where the docs are silent, that is said explicitly, with a way to test it.

## Answer

- **`runs.using` Node version: holds, with a deadline.** Use `node24`. `node20` is still listed but Node 20 is removed from runners on 2026-09-23.
- **`GITHUB_TOKEN` edits do not trigger workflows: holds.** Issue edits made with `GITHUB_TOKEN` create no run, so re-rendering cannot loop. New exception to know: `pull_request` `opened`/`synchronize`/`reopened` now create approval-gated runs. Not relevant to issues.
- **`GITHUB_TOKEN` may trigger `workflow_dispatch`: holds, but needs a permission the brief lacks.** The dispatch endpoint requires `actions: write`. The brief's `permissions:` block does not grant it.
- **`issues.edited` payload: holds for `changes.body.from`, unclear for `sender`.** `changes.body.from` is "the previous version of the body" and is only present when the body changed. `sender` is documented as the user who triggered the event, but GitHub warns it can be the `ghost` user and must not be trusted blindly. Docs do not describe the checkbox-tick case specifically. Needs an empirical test.
- **`pinIssue` with `GITHUB_TOKEN`: unclear.** The mutation exists, pinning needs write access, the limit is three pinned issues per repository. No doc says whether the Actions installation token may call it. Treat pinning as best effort and test it.
- **Deployments API: holds, but collides with `environment:`.** `deployments: write` to create, `deployments: read` to list. Filter by `environment`, `ref`, `sha`, `task`. A job with `environment:` already creates its own deployment, so the brief's design would record two. Old statuses are deleted after 90 days.
- **Actor permission lookup: holds. Team membership: does not hold with `GITHUB_TOKEN`.** `GET /repos/{owner}/{repo}/collaborators/{username}/permission` needs only Metadata read and already includes team and org grants. Team membership endpoints need the organization permission "Members", which `GITHUB_TOKEN` cannot be given.
- **Job summary size: holds.** 1 MiB per step, at most 20 step summaries shown per job. Over the limit the upload fails with an error annotation but the step does not fail.
- **Issue body limit of 65,536 characters: unclear.** Not documented anywhere in the REST, GraphQL or OpenAPI sources. Known only from the API's validation error. Test it and make the budget a constant.
- **`merge_group` and concurrency: holds, with one trap.** `merge_group` only matters for required checks, the scan still runs on the `push` that the queue produces. The trap is concurrency: by default a group keeps only one pending job and cancels the older one. Use the new `queue: max` option.

## Detail

### 1. `runs.using` Node version

The metadata syntax reference lists exactly two values for JavaScript actions: "Use `node20` for Node.js v20" and "Use `node24` for Node.js v24". All examples on the page use `node24`.
Source: https://docs.github.com/en/actions/reference/workflows-and-actions/metadata-syntax#runsusing-for-javascript-actions

The changelog post "Deprecation of Node 20 on GitHub Actions runners" (2025-09-19, last editor's note 2026-08-25) says:

- Runner v2.328.0 and later supports both Node 20 and Node 24.
- Since 2026-06-16 runners use Node 24 by default, also for actions that declare `node20`.
- Node 20 is removed from the runner on 2026-09-23. Until then `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION=true` opts back in.
- Node 24 does not run on macOS 13.4 or lower, and has no official ARM32 build, so ARM32 self-hosted runners are no longer supported.

Source: https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/

Verdict: `node24`. There is no newer value documented today.

### 2. Events created with `GITHUB_TOKEN` and workflow triggers

Current wording: "events triggered by the `GITHUB_TOKEN` will not create a new workflow run, with the following exceptions":

- "`workflow_dispatch` and `repository_dispatch` events always create workflow runs."
- "`pull_request` events with the `opened`, `synchronize`, or `reopened` activity types" create runs in an approval-required state. Other `pull_request` activity types create no runs.

"For all other events, this behavior prevents you from accidentally creating recursive workflow runs." The docs give a directly comparable example: adding a label to an issue with `GITHUB_TOKEN` "will not trigger any workflows that run when a label is added".

Sources:
- https://docs.github.com/en/actions/concepts/security/github_token#when-github_token-triggers-workflow-runs
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow

Consequence: an `issues.edited` event caused by Sluiceway's own re-render with `GITHUB_TOKEN` creates no run. The loop guard holds. It stops holding the moment a user configures Sluiceway with a PAT or a GitHub App token, because those do trigger workflows (same source). The explicit sender check in the brief is therefore required, not optional.

### 3. `GITHUB_TOKEN` and `workflow_dispatch`

Allowed, per the exception above. Requirements:

- Endpoint `POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches` needs repository permission "Actions: write". Source: https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps#repository-permissions-for-actions
- For `GITHUB_TOKEN` that is `permissions: actions: write`. Any permission not listed in a `permissions:` block is set to `none`. Source: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions
- "This event will only trigger a workflow run if the workflow file exists on the default branch." Source: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch
- Body: `ref` (required), `inputs` (max 25 properties), and `return_run_details` to get the run ID and URLs back in a 200 response instead of a bare 204. Source: OpenAPI description, https://github.com/github/rest-api-description (path `/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches`), rendered at https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event

`return_run_details` is useful: the dashboard can link straight to the rescan run.

### 4. The `issues.edited` payload

Schema `webhook-issues-edited` in the official OpenAPI description:

- Required top-level keys: `action`, `changes`, `issue`, `repository`, `sender`.
- `changes.body.from`: string, "The previous version of the body." `changes.title.from`: same for the title.
- `changes.body` and `changes.title` are both optional inside `changes`. A title-only edit has no `changes.body`.
- `sender` is a `simple-user`.

Source: https://github.com/github/rest-api-description/blob/main/descriptions/api.github.com/api.github.com.json (component `webhook-issues-edited`), rendered at https://docs.github.com/en/webhooks/webhook-events-and-payloads?actionType=edited#issues

Is `from` the full body? The schema says "previous version of the body" with no mention of truncation. The only documented size cap is on the payload as a whole: "Payloads are capped at 25 MB", and over that the event is not delivered at all. An issue body is far below that. So the docs support "full previous body" but do not say it in so many words.
Source: https://docs.github.com/en/webhooks/webhook-events-and-payloads#payload-cap

Who is `sender`? The docs say: "Most webhook payloads include a `sender` property identifying the user who triggered the event." They then warn that when GitHub cannot resolve a user, "`sender` is populated with the `ghost` user" and "Don't assume `sender` always identifies the person who caused an event, and account for the `ghost` user in any security or business logic that relies on it."
Source: https://docs.github.com/en/webhooks/webhook-events-and-payloads#the-sender-property

The docs do not describe the specific case of ticking a task-list checkbox in the web UI. A tick is a body edit performed by the logged-in user, so `sender` should be that user, but this is inference, not documentation.

A related documented behavior that the brief does not account for: "If a task references another issue and someone closes that issue, the task's checkbox will automatically be marked as complete."
Source: https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/about-tasklists#about-issue-tasklists

The brief's row format puts `from #123` on the checkbox line. `#123` is a merged (closed) PR at render time, so there may be no later transition, and the docs say "issue", not "pull request". But the docs do not say who `sender` is for such an automatic tick, or whether it fires `issues.edited` at all. This is a way for a box to become ticked without a human ticking it.

Also relevant: `github.actor` is "the user that triggered the initial workflow run", and re-runs keep the original event payload and the privileges of `github.actor`, while `github.triggering_actor` is whoever pressed re-run. A re-run of an old `resolve` run replays the old payload with the old `sender`.
Source: https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#github-context

How to test (one throwaway repo, 10 minutes):
1. Workflow on `issues: [edited]` that dumps `${{ toJson(github.event) }}` with `sender`, `changes`, `github.actor`.
2. Tick a box in the UI as user A on an issue authored by user B. Record `sender.login`, whether `changes.body.from` equals the full old body byte for byte (check line endings, `\r\n` versus `\n`, which the docs do not specify), and its length on a body near the size limit.
3. Add a task line that references an open issue, close that issue, and record whether `issues.edited` fires, who `sender` is, and what the body diff looks like.
4. Edit the issue with `GITHUB_TOKEN` from a workflow and confirm no run is created.

### 5. Pinning through GraphQL `pinIssue`

- The mutation exists: `pinIssue(input: PinIssueInput!)` with `issueId`, returning `issue`. `unpinIssue` exists too. `Issue.isPinned` and `Repository.pinnedIssues` can be read back. Source: https://docs.github.com/en/graphql/reference/issues#mutation-pinissue
- Limit: "You can pin up to three important issues above the issues list in your repository." Source: https://docs.github.com/en/issues/tracking-your-work-with-issues/administering-issues/pinning-an-issue-to-your-repository
- Who: "People with write access to a repository can pin issue in the repository." Same source.

What the docs do not say: whether the Actions installation token with `issues: write` counts as write access for this mutation, and what error a fourth pin returns. The GraphQL reference lists no permission requirements per mutation. Unclear.

How to test: in a workflow with `permissions: issues: write`, run `gh api graphql -f query='mutation($id:ID!){pinIssue(input:{issueId:$id}){issue{isPinned}}}' -f id=<node id>` with `GH_TOKEN: ${{ github.token }}`. Repeat with three issues already pinned and record the error shape.

### 6. Deployments API

Permissions (repository permission "Deployments"):
- write: `POST /repos/{owner}/{repo}/deployments`, `POST .../deployments/{id}/statuses`, `DELETE .../deployments/{id}`.
- read: `GET .../deployments`, `GET .../deployments/{id}`, `GET .../deployments/{id}/statuses`, `GET .../statuses/{status_id}`.

Source: https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps#repository-permissions-for-deployments
`GITHUB_TOKEN` supports a `deployments` permission: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions

Creating. Two defaults bite:
- `auto_merge` defaults to `true`: GitHub tries to merge the default branch into the ref and may answer 202 "Merged branch response" instead of creating a deployment. Pass `auto_merge: false`.
- `required_contexts` defaults to all commit status contexts, and the call fails with 409 if any is not green. "To bypass checking entirely, pass an empty array." Pass `required_contexts: []`.
- Free fields that survive and can be read back: `task` (default `deploy`), `payload` (JSON), `description`, `environment` (default `production`), `production_environment`, `transient_environment`.

Source: https://docs.github.com/en/rest/deployments/deployments#create-a-deployment

Querying back:
- REST list filters: `sha`, `ref`, `task`, `environment`, plus pagination (max 100 per page). No filter on status state and no filter on payload content. Source: https://docs.github.com/en/rest/deployments/deployments#list-deployments
- Statuses are a separate call per deployment in REST. States: `error`, `failure`, `inactive`, `in_progress`, `queued`, `pending`, `success`. A status carries `log_url`, `environment_url`, `description`. Source: https://docs.github.com/en/rest/deployments/statuses
- GraphQL does it in one query: `repository.deployments(environments: [...], orderBy: ...)` with `commitOid`, `ref`, `task`, `payload`, `creator`, `createdAt`, `state`, `latestStatus` and `statuses`. There is no `task` or `ref` argument on the connection, only `environments`. Sources: https://docs.github.com/en/graphql/reference/repos#object-repository and https://docs.github.com/en/graphql/reference/deployments#object-deployment
- Retention: "GitHub retains records of previous deployment statuses for 90 days." The current status stays on the deployment. Source: https://docs.github.com/en/rest/deployments/statuses#data-retention
- `auto_inactive` (default true) marks prior successful deployments in the same environment as `inactive`, but only for "non-transient, non-production" environments. Source: https://docs.github.com/en/rest/deployments/deployments#inactive-deployments

The collision. "When a workflow job that references an environment runs, it creates a deployment object with the `environment` property set to the name of your environment", followed by status objects that track the job.
Source: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments#how-environments-relate-to-deployments

The brief's `apply` job has `environment: ${{ matrix.environment }}` and also asks Sluiceway to record a Deployment. That yields two deployments per apply. Worse, several stacks share one environment (`homelab-prod` in the brief's config), so the automatic deployment cannot say which stack it was, and "last successful deployment of stack X" cannot be answered from environment alone.

There is now an opt-out: `environment: { name: ..., deployment: false }`. With it, secrets, wait timers and required reviewers still apply, no deployment object is created, and custom deployment protection rules make the job fail.
Sources:
- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#example-using-an-environment-without-creating-a-deployment
- https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments#using-environments-without-deployments

### 7. Actor repo permission and team membership

Repo permission: `GET /repos/{owner}/{repo}/collaborators/{username}/permission`.
- Returns `permission` (legacy: `admin`, `write`, `read`, `none`; "the maintain role is mapped to write and the triage role is mapped to read") and `role_name` (real role, including custom roles), plus `user.permissions` booleans.
- "The calculated permissions are the highest role assigned to the collaborator after considering all sources of grants, including: repo, teams, organization, and enterprise."
- Requires repository permission "Metadata: read" and accepts installation tokens.

Sources:
- https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user
- https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps#repository-permissions-for-metadata

Not stated on the current `GITHUB_TOKEN` pages: that the token always carries Metadata read even when `permissions:` lists other scopes only. This is how GitHub Apps work in general and how existing actions rely on it, but confirm it in the e2e test by calling the endpoint under the brief's minimal `permissions:` block.

Team membership: `GET /orgs/{org}/teams/{team_slug}/memberships/{username}` (and the list-members endpoint) sit under organization permission "Members: read". "To get a user's membership with a team, the team must be visible to the authenticated user."
Sources:
- https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps#organization-permissions-for-members
- https://docs.github.com/en/rest/teams/members#get-team-membership-for-a-user

The `permissions:` key for `GITHUB_TOKEN` offers only repository-level scopes (`actions`, `artifact-metadata`, `attestations`, `checks`, `code-quality`, `contents`, `deployments`, `discussions`, `id-token`, `issues`, `packages`, `pages`, `pull-requests`, `security-events`, `statuses`, `vulnerability-alerts`). There is no organization or members scope. The docs' own advice for this situation: "If you need a token that requires permissions that aren't available in the `GITHUB_TOKEN`, create a GitHub App and generate an installation access token within your workflow."
Sources:
- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions
- https://docs.github.com/en/actions/tutorials/authenticate-with-github_token#granting-additional-permissions

`GET /repos/{owner}/{repo}/teams` is not a way around it: it needs Administration read, which `GITHUB_TOKEN` also lacks. Source: https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps

So: `approvers: write | admin | [users]` works with `GITHUB_TOKEN`. `approvers: [teams]` needs a user-supplied token (GitHub App with Members read, or a PAT with `read:org`).

### 8. Job summary limits

"Job summaries are isolated between steps and each step is restricted to a maximum size of 1MiB. [...] If more than 1MiB of content is added for a step, then the upload for the step will fail and an error annotation will be created. Upload failures for job summaries do not affect the overall status of a step or a job. A maximum of 20 job summaries from steps are displayed per job."

Also: "Summaries automatically mask any secrets", and a summary can only be removed afterwards by deleting the whole run.
Source: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#adding-a-job-summary

The failure mode matters: an oversized summary is dropped entirely and silently as far as the job result goes. The scan writes all stacks' full diffs from one step, so a 100-stack scan can exceed 1 MiB.

### 9. Issue body size limit

The brief says 65,536 characters. No primary source documents this. The REST reference for create and update issue describes `body` only as "The contents of the issue.", the OpenAPI schema has no `maxLength`, the GraphQL reference has none, and the Actions limits page does not cover it.
Sources checked:
- https://docs.github.com/en/rest/issues/issues#update-an-issue
- https://github.com/github/rest-api-description
- https://docs.github.com/en/graphql/reference/issues
- https://docs.github.com/en/actions/reference/limits

The number comes from the API's own 422 validation error ("body is too long (maximum is 65536 characters)") as widely reported, not from documentation. Unclear whether "characters" means code points, UTF-16 units or bytes.

How to test: in a throwaway repo, `PATCH` an issue with a body of 65,536 ASCII characters (expect 200), then 65,537 (expect 422), then 65,536 characters made of multi-byte code points such as emoji (tells characters from bytes). Record the exact error JSON.

### 10. `merge_group` and concurrency

`merge_group`:
- Its only activity type is `checks_requested`. It exists so required checks run on the temporary `gh-readonly-queue/{base_branch}/...` branch. "The `merge_group` event is separate from the `pull_request` and `push` events." Without it, required Actions checks never report and the merge fails.
- Sources: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#merge_group and https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue

The Sluiceway consumer workflow is not a required PR check, so it does not need a `merge_group` trigger. A merge queue still ends in an update of the default branch, which raises the normal `push` event that `scan` listens to. One thing the docs do not spell out: whether a queue merging several PRs at once produces one `push` or several. The scan recomputes from HEAD, so either is fine. The README note for M4 should say: do not add `merge_group` to the Sluiceway workflow, and if Sluiceway's workflow file also holds required checks, split them out.

Concurrency:
- "There can be at most one running job or workflow in a concurrency group at any time. [...] By default, any existing `pending` job or workflow in the same concurrency group will be canceled and the new queued job or workflow will take its place."
- New `queue` property: `single` (default, the behavior above) or `max` ("Up to 100 jobs or workflow runs can be `pending`"). `queue: max` with `cancel-in-progress: true` is a validation error.
- Group names are case insensitive. Ordering is FIFO by the time each started waiting, "ordering is not guaranteed".
- "`concurrency` and `environment` are not connected."

Sources:
- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idconcurrency
- https://docs.github.com/en/actions/reference/limits
- https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments

Effect on the brief's `concurrency: sluiceway-${{ matrix.stack }}`: with the default, if apply A runs and apply B is pending, a third apply C cancels B without a trace on the dashboard. The "deploying" re-render makes this unlikely for one stack, but the scan job has no concurrency at all, so two scans (push plus schedule, or two quick merges) can race on the issue body and the older one can write last.

Other limits worth knowing: a matrix generates at most 256 jobs per run, self-hosted jobs are cancelled after 24 hours in the queue, and `GITHUB_TOKEN` gets 1,000 REST requests per hour per repository (15,000 on Enterprise Cloud).
Sources: https://docs.github.com/en/actions/reference/limits and https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#primary-rate-limit-for-github_token-in-github-actions

## Consequences for the design

1. **`action.yml`: `runs.using: node24`.** Bundle with a Node 24 target. Document a minimum self-hosted runner version of v2.328.0 and that ARM32 runners are not supported. This matters for the owner's homelab runners.
2. **Add `actions: write` to the example workflow's `permissions:`** for the rescan checkbox and for the M3 re-trigger of `resolve`. Without it the dispatch call returns 403. Use `return_run_details` to link the dispatched run on the dashboard.
3. **Keep the sender check, and make it strict.** In `resolve`: ignore events where `sender.type` is `Bot`, where `sender.login` is `ghost` or the bot identity, and where `changes.body` is absent (title-only edits). The loop protection from `GITHUB_TOKEN` disappears if a user swaps in a PAT or App token, so the sender check is the real guard.
4. **Do not put issue or PR references on the checkbox line.** Move `from #123 by @user` out of the task-list item text (for example onto the next line, or inside the `<details>`), because GitHub auto-completes tasks that reference an issue that gets closed. Until the test in section 4 is run, assume an automatic tick can happen and that its `sender` is not a trustworthy human.
5. **Handle re-runs.** A re-run of a `resolve` run replays the old payload. The hash check already makes this safe (a stale hash aborts), but `resolve` should also compare the payload's current body with the live issue body and exit if they differ.
6. **Normalize before diffing bodies.** Compare `changes.body.from` and `issue.body` after normalizing line endings, and diff on the hidden row markers, not on raw text. The byte-for-byte shape of `from` is not documented.
7. **Pinning is best effort.** Wrap `pinIssue` in a try/catch, log a warning on failure (no permission, or three issues already pinned), never fail the scan. Check `isPinned` first to skip the call. Run the test in section 5 before promising the feature in the README.
8. **Pick one owner for deployments.** Recommended: set `environment: { name: ${{ matrix.environment }}, deployment: false }` on the apply job and let Sluiceway create the deployment itself, with `auto_merge: false`, `required_contexts: []`, and the stack id in `task` (for example `sluiceway:infra/proxmox:prod`) or in `payload`. `task` is filterable in REST list calls, `payload` is not. Note in the docs that `deployment: false` breaks custom deployment protection rules, so users of those must keep the default and accept two deployment records. Required reviewers and wait timers keep working.
9. **"Last successful deployment of stack X"** (scan step 4 in the brief): query `GET /deployments?environment=E&task=sluiceway:<stack>` or the GraphQL connection filtered by environment, then read `latestStatus`. Do not rely on status history older than 90 days. Only the latest status survives.
10. **Approvers config: drop teams from the zero-config path.** `write`, `admin` and explicit user lists work with `GITHUB_TOKEN`. Team names need an extra token input (GitHub App with organization Members read, or a PAT with `read:org`). Validate at config load: if `approvers` contains a team and no such token is provided, fail closed with a clear message. Note that the permission endpoint already folds team grants into the result, so most users do not need team lists at all.
11. **Job summary budget.** Add a size budget for summaries as well as for the issue body: stay under 1 MiB per step, truncate per-stack diffs with a note, and consider uploading the full diffs as an artifact. An oversized summary is dropped without failing the job, so the dashboard's "full diff" link would point at nothing.
12. **Issue body budget is an assumption, not a documented limit.** Keep 65,536 as a named constant with headroom (for example budget to 60,000), run the test in section 9, and handle a 422 from the update call by falling back to summary-only rendering.
13. **Concurrency.** Use `concurrency: { group: sluiceway-${{ matrix.stack }}, queue: max }` on apply so pending applies are not silently cancelled, and never set `cancel-in-progress` on apply. Add a concurrency group to the scan job (for example `sluiceway-scan`, default `queue: single`, which is the right behavior there: only the newest pending scan matters).
14. **Merge queue note for M4:** no `merge_group` trigger on the Sluiceway workflow. The scan runs on the `push` that follows the queue's merge.
15. **Rate limit.** `GITHUB_TOKEN` has 1,000 requests per hour per repository. A 100-stack scan that lists deployments and commits per stack can approach that. Prefer one GraphQL query for deployments over per-stack REST calls.

## Open empirical tests

One throwaway repository covers all of them:

1. `sender`, `changes.body.from` fidelity and line endings on a UI checkbox tick (section 4).
2. Auto-completion of a task that references an issue: does it fire `issues.edited`, and with which `sender` (section 4).
3. `pinIssue` with `GITHUB_TOKEN` and `issues: write`, plus the fourth-pin error (section 5).
4. Collaborator permission endpoint under the minimal `permissions:` block (section 7).
5. Exact issue body limit and its unit (section 9).
