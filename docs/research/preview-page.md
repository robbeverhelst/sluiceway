# Can a pending row's `preview` link open a page that shows exactly that stack's preview?

Research for the first real user's question: "Why isn't the preview there when I click the link and go directly to it?" Checked on 2026-09-22 against docs.github.com, the GitHub changelog, the source of `dorny/test-reporter`, and a probe in the private lab repo `sluiceway/behavior-lab` (branch `probe/check-run-preview`, pull requests #53 to #57). Every claim is marked **measured** (lab or a public repo, with the address), **docs** (with the source), or **not measured**. A logged-in view was never scripted. What only a logged-in person can see is listed as not measured.

## Answer

1. **Does it work with the workflow token? Yes, with `checks: write`.** With only `contents: read` and `issues: write` the create call answers 403 "Resource not accessible by integration". With `checks: write` added it answers 201. One request per stack creates a finished check run with its output (`status: completed`, `conclusion`, `output` in one POST). Finding the stack's check run on the commit and updating it in place costs one list call per 100 stacks plus one PATCH per stack. At most 50 annotations go in one request.
2. **The address is `https://github.com/<owner>/<repo>/runs/<check_run_id>`, and it is stable.** That is the check run's `html_url`. GitHub ignores the `details_url` the token sends and sets it to that same `html_url`, so there is no "Details" link to point at the dashboard. The address belongs to one check run id and does not change when the workflow is re-run. In a public repo it opens logged out with a 200 and no redirect, directly on the rendered output. In a private repo every form of the address gives a logged-out person a 404.
3. **It renders Markdown, but one field holds about 64 KB.** `output.summary` and `output.text` each take at most 65,535 characters, and a larger value is refused with 422. `summary` is also refused over 65,535 UTF-8 bytes. `text` over 65,535 bytes is **cut without an error** at a character boundary. Of a 3,000 line diff only 967 lines fit, and the closing fence was cut. A PATCH replaces the whole output: leaving out `text` removes it.
4. **It is noisy in ways Sluiceway cannot control.** The check run does not join the run that made it. It joins the oldest GitHub Actions check suite on the commit, which can be another workflow's run, or a run from days ago. The jobs API of that other run then lists the check run as one of its jobs. In the pull request and commit rollup, `neutral`, `skipped` and `success` all count as success, and `action_required` turns the rollup into a failure. A check suite made by a `workflow_dispatch` run is left out of the rollup entirely. The docs describe no notification for a check run.
5. **It lives as long as the logs, but it can vanish with another run.** Today checks are kept 400 days. From 2026-10-01 they follow the repo's Actions retention setting, the same one as logs (default 90 days). There is no DELETE endpoint. A PATCH can blank the output. Deleting the workflow run whose suite holds the check run deletes the check run too, including check runs that other workflows made.
6. **A scan of an unchanged commit piles up check runs unless it updates them.** Two dispatches in a row on the same commit made two check runs per stack, and `filter=latest` showed only the newest. Updating by name kept one. On the default branch's head, the check runs joined a `workflow_dispatch` suite from the day before. That commit's rollup stayed empty, so no status icon comes from them.
7. **Every alternative fails at least one test.** A check run is the only surface that is one click, rendered, readable by exactly the people who can read the repo, needs no new credential, and sends no notification.

**Recommendation: use a check run as the page for a pending row's `preview` link, with conditions.** It is the only way to get one click to one stack's rendered preview with the workflow token and no backend. The link a row uses is the check run's `html_url`, `https://github.com/<owner>/<repo>/runs/<check_run_id>`. The conditions:

- Name the check run `sluiceway / <stack id>`, set `conclusion: neutral`, and update it in place instead of creating a new one on every scan.
- Its text is Sluiceway's own diff of the stack by default, which is what the summary shows today (0021).
- The tool's own diff with values goes on the page only if a separate decision amends 0021 and 0048. The runner's masks do not apply there (measured). The record would also have to accept that the page's lifetime is tied to a workflow run Sluiceway did not start.
- Anything over 64 KB points to the job log, which stays the complete version (0037).

## Why not a gist

- **The workflow token cannot create a gist.** Measured: `POST /gists` with the workflow token answered 403 "Resource not accessible by integration" (dispatch run 35663876126). Docs: the `permissions:` keys of a workflow have no `gists` entry ([workflow syntax, `permissions`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)). "Create a gist" lists only "GitHub App user access tokens, Fine-grained personal access tokens" with the "Gists" user permission, and says "To read or write gists on a user's behalf, you need the gist OAuth scope and a token" ([Create a gist](https://docs.github.com/en/rest/gists/gists#create-a-gist)). The workflow token is an installation token and is not on that list.
- **A gist belongs to a user, so it needs a stored personal token.** That breaks promise 1 of 0014 (no credential inputs) and 0017 (the bot is always the workflow token). The gist would also be owned by, and editable by, whoever's token it was.
- **A secret gist is only unlisted.** "Secret gists aren't private. If you send the URL of a secret gist to a friend, they'll be able to see it. However, if someone you don't know discovers the URL, they'll also be able to see your gist." ([Creating gists](https://docs.github.com/en/get-started/writing-on-github/editing-and-sharing-content-with-gists/creating-gists)). Access would stop following the repo. Anyone with the link, including a link pasted in a chat or kept in browser history, could read property values. That is the wrong place for them.

## Evidence

The probe is `.github/probe/checkrun.mjs` with the workflows `checkrun.yml`, `suite-a.yml`, `suite-b.yml` and `artifact-page.yml` on branch `probe/check-run-preview` of `sluiceway/behavior-lab`. Every result line is printed as `RESULT {json}` in the job log. No workflow on the lab's default branch triggers on `push`, so the probe workflows were the only ones on the probe commits.

| Commit | What ran there |
|---|---|
| `ae562c5` | first push: `checkrun` 35661761779, `suite-a` 35661761909, `suite-b` 35661761798, `artifact-page` 35661761784 |
| `e9269c1` | second push: `checkrun` 35661928345, `artifact-page` 35661928321, `suite-a` 35661928615, `suite-b` 35661928380. Later: the scan dispatches 35663154699 (with a re-run, attempt 2), 35663181082, 35663209230 and 35663233239 |
| `618c1c9` (the lab's `main`) | scan dispatches 35663258389 and 35663295823, run from the probe branch with `sha` set to `main`'s head |
| `796bafd`, `d66b0a8`, `259a77f`, `d5e0b07` | heads of PRs #54 (neutral), #55 (skipped), #56 (success) and #57 (mixed). Fifteen check runs each, from dispatches 35663071731, 35663073968, 35663076788 and 35663079868 |
| `32d7a51`, `041deee` | tamper probe 35663649505, the deleted run 35663575559, gist probe 35663876126 |

### 1. Workflow token and permissions

- **Measured.** Job `scan-permissions-only` (`contents: read`, `issues: write`) → `POST /repos/{o}/{r}/check-runs` answered `403 {"message":"Resource not accessible by integration"}` (runs 35661761779 and 35661928345). Job `with-checks-write` (the same plus `checks: write`) → 201.
- **Measured, requests per stack.**
  - One POST with `status: completed`, `conclusion`, `output.title`, `output.summary` and `output.text` creates the finished page (check run 106538952701).
  - Creating it `in_progress` and then PATCHing to `completed` costs two (106538955455). That is dorny/test-reporter's pattern: it calls `checks.create` with `status: 'in_progress'` and then one `checks.update` with the conclusion, output and annotations ([src/main.ts](https://github.com/dorny/test-reporter/blob/main/src/main.ts)).
  - Update in place: `GET /commits/{sha}/check-runs?check_name=…&filter=latest` plus a PATCH is two per stack. One unfiltered list of up to 100 check runs per page plus one PATCH per stack is 1 + N.
  - The whole `full` probe made 46 to 47 requests.
- **Measured, annotations.** 50 in one POST → 201. 51 → `422 "No more than 50 items are allowed; 51 were supplied."`. A PATCH with 50 more gave `annotations_count: 100`, so annotations are appended (106539001478). Docs: "limits the number of annotations to a maximum of 50 per API request… annotations are appended" ([check runs](https://docs.github.com/en/rest/checks/runs)).
- **Docs.** "`checks: write` permits an action to create a check run" ([workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)). The token's budget is 1,000 requests per hour per repo. Separately, "no more than 80 content-generating requests per minute and no more than 500 content-generating requests per hour" ([REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)). **Not measured:** whether a check run create or update counts as content-generating. About 40 creates in one minute raised no error.

### 2. The page's address

| Field | Sent | Returned |
|---|---|---|
| `html_url` | | `https://github.com/sluiceway/behavior-lab/runs/106538952701` |
| `details_url` | `https://github.com/sluiceway/behavior-lab/issues/52` | `https://github.com/sluiceway/behavior-lab/runs/106538952701` |
| `details_url` of an `action_required` run | the issue URL | its own `html_url` (106542644915) |

- **Measured.** For check runs made with the workflow token, `details_url` is always overwritten with `html_url`. A job's own check run has `html_url` `/actions/runs/<run>/job/<id>`. A token-made one has `/runs/<id>`.
- **Measured, stability.** The address is the check run id. A re-run (35663154699, attempt 2) created a new check run with a new id. The old ids still answered GET 200, because nothing deletes them.
- **Measured, public repo, logged out** (headless Chromium, fresh context, no cookies). `https://github.com/hazelcast/hazelcast-csharp-client/runs/78236004329` is a check run made by `dorny/test-reporter` with the workflow token. It answered 200 with no redirect. The page showed the commit's check suites on the left. On the right it showed "GitHub Actions / Test Results", "succeeded on May 28", then the rendered summary: headings, a table, badges and links. A "Sign in for the full log view" button was in the header. The rendered output is the page's main content.
- **Measured, private repo, logged out.** `curl` and headless Chromium both got 404, with no redirect, for:
  - `/runs/106538952701`
  - `/commit/e9269c1…/checks/106538952701`
  - `/commit/e9269c1…/checks`
  - `/actions/runs/35661928321/artifacts/10667243078`
- **Docs.** Checks carry "Detailed output, annotations, and messages" and show in a pull request's Checks tab ([status checks](https://docs.github.com/en/pull-requests/reference/status-checks)).
- **Not measured:**
  - the logged-in view of a private repo's check run page;
  - whether `/runs/<id>` and `/commit/<sha>/checks/<id>` show the same page;
  - how the long `text` renders.

### 3. Rendering and limits

Limits, each case as its own check run (run 35661761779):

| Field | Content | UTF-8 bytes | Response | Stored (GET) |
|---|---|---|---|---|
| summary | 65,535 × `a` | 65,535 | 201 | 65,535 chars |
| summary | 65,536 × `a` | 65,536 | 422 "Only 65535 characters are allowed; 65536 were supplied." | |
| summary | 70,000 × `a` | 70,000 | 422, the same message | |
| summary | 32,767 × `é` | 65,534 | 201 | whole |
| summary | 32,768 × `é` | 65,536 | 422 "summary exceeds a maximum bytesize of 65535" | |
| summary | 32,767 × 😀 | 131,068 | 422, bytesize | |
| text | 65,535 × `a` | 65,535 | 201 | whole |
| text | 65,536 × `a` | 65,536 | 422, characters | |
| text | 32,768 × `é` | 65,536 | **201** | **32,767 chars, 65,534 bytes** |
| text | 65,535 × `é` | 131,070 | **201** | **32,767 chars, 65,534 bytes** |
| text | 32,767 × 😀 | 131,068 | **201** | **16,383 chars, 65,532 bytes** |
| text | 65,536 × `é` | 131,072 | 422, characters | |

- **Measured.** Both fields refuse more than 65,535 UTF-16 code units. `summary` also refuses more than 65,535 bytes. `text` keeps its first 65,535 bytes and drops the rest without telling the caller. The OpenAPI description says "Maximum length: 65535 characters" for both. dorny/test-reporter's README says "Maximum report size is 65535 bytes" ([README](https://github.com/dorny/test-reporter)).
- **Measured, a large diff.** A fenced ```` ```diff ```` block of 3,000 lines of about 70 characters (207,843 characters) was cut to 65,535 before sending. 967 lines fit, and the closing fence was lost (106538952701). A real stack's diff has to be cut by Sluiceway on a line boundary, with the fence closed and a pointer to the job log.
- **Measured, stored as sent.** `summary` with a Markdown table, a link to the dashboard issue, a link to the run's attempt and a Markdown image came back unchanged (489 characters).
- **Measured, images.** `output.images` with `alt`, `image_url` and `caption` was accepted (106539017446). GET does not return an `images` field.
- **Measured, annotations.** A level `error`, which the docs do not list (they list `notice`, `warning`, `failure`), was accepted and stored as `error` (106538479875).
- **Measured, PATCH replaces the whole output.** A PATCH with `title` and `summary` but no `text` left `text: null`. `summary: ""` and `text: ""` were accepted.
- **Not measured:** how an annotation outside the diff of a pull request is shown. How the Markdown, the image and a cut fence render logged in. See the checklist in the reply.

### 4. Where it shows, and noise

**Which suite it joins (measured, twice).**

| Commit | Suites (run that made each) | Where every token-made check run landed |
|---|---|---|
| `ae562c5` | 96554195876 (`checkrun`), 96554195906 (`artifact-page`), 96554195951 (`suite-b`), 96554196253 (`suite-a`) | 96554195876, including the ones `suite-a` and `suite-b` made |
| `e9269c1` | 96554645184 (`artifact-page`), 96554645228 (`checkrun`), 96554645313 (`suite-b`), 96554645885 (`suite-a`), and one per later dispatch | 96554645184, the `artifact-page` run, for every probe and every later dispatch |
| `618c1c9` (`main`) | 96524379974, the `joblink` run 35650741639 from 2026-09-21 (`workflow_dispatch`) | 96524379974 |

The rule seen every time: the check run joins the oldest check suite of the GitHub Actions app on that commit, whichever workflow made it. The docs only say "GitHub automatically adds new check runs to the correct check suite based on the check run's repository and SHA" ([checks guide](https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-checks)). dorny/test-reporter's README warns about the same thing: "It's not possible to specify under which workflow test report should belong if more workflows are running for the same SHA… your test report will appear in an unexpected place in GitHub UI" ([README](https://github.com/dorny/test-reporter), issue [#67](https://github.com/dorny/test-reporter/issues/67), still open).

**It is listed as a job of that run (measured).**

- `GET /actions/runs/35661761779/jobs` listed 21 jobs: the run's two real jobs and every token-made check run on the commit, each with `steps: []` and `runner_name: null`.
- The `joblink` run 35650741639 on `main` has two jobs of its own. Its jobs list now also holds `sluiceway: network:dev`, `sluiceway: network:prod` and `sluiceway: db:prod`, made by scans that ran a day later.
- **Not measured:** whether the run's page draws them as extra jobs.

**Pull request rollup (measured, GraphQL `statusCheckRollup` of the PR's head):**

| PR | Check runs on the head | Rollup state | `mergeStateStatus` |
|---|---|---|---|
| #54 | 15 `neutral` | SUCCESS | CLEAN |
| #55 | 15 `skipped` | SUCCESS | CLEAN |
| #56 | 15 `success` | SUCCESS | CLEAN |
| #57 | 4 neutral, 4 skipped, 4 success, 3 `action_required` | FAILURE | UNSTABLE |
| #53 (at `e9269c1`, before the dispatches) | 25: 20 neutral (token-made), 5 success (jobs) | SUCCESS | CLEAN |

- **Measured.** On #54 to #57 no workflow ran on the head. The check runs made a suite of their own, with no workflow run and `head_branch` set to the PR's branch.
- **Measured.** The legacy combined status (`GET /commits/{sha}/status`) stays `pending` with `total_count: 0`. Check runs are not commit statuses.
- **Measured, rollup and `workflow_dispatch`.** The rollup of #53 held only check runs from `push` suites. The ten dispatch runs on the same commit each have a job check run of their own (`with-checks-write`), and none of those was in the rollup. On `main`'s head `618c1c9`, whose only suite is a `workflow_dispatch` suite, `statusCheckRollup` is `null` even though five check runs are listed there. So a scan's check runs count in a commit's status when they land in a `push` suite, and not when they land in a `workflow_dispatch` suite. **Not measured:** the same for a `schedule` suite.
- **Docs.** `neutral` and `skipped` are each "treated as a success for dependent checks in GitHub Actions". "A job that is skipped will report its status as 'Success'. It will not prevent a pull request from merging, even if it is a required check" ([status checks](https://docs.github.com/en/pull-requests/reference/status-checks)). "Required status checks must have a successful, skipped, or neutral status" ([protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)).
- **Not measured:** whether the merge box collapses skipped checks. **No doc found** that says it does.

**Required checks.**

- **Docs.** A required check must have "completed successfully in the chosen repository during the past seven days" ([troubleshooting required status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks)). The expected source is "an app that has recently set this check" ([protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)).
- Every `sluiceway / <stack>` name that completed in the last week becomes a candidate in that search, with GitHub Actions as its source, the same source as every CI job. **Not measured:** the settings page's list itself. See the checklist.

**What `checks: write` also allows (measured, run 35663649505 and run 35663876126).**

- A PATCH of another workflow's job check run (`upload`, 106538927031) that changes its conclusion was refused: 403 "Check run status and conclusions can only be updated internally by GitHub Actions", with a link to the [2025-02-12 changelog](https://github.blog/changelog/2025-02-12-notice-of-upcoming-deprecations-and-breaking-changes-for-github-actions/#changes-to-check-run-status-modification).
- A PATCH of **only its output** was accepted. That job's page now reads "output changed by another workflow".
- A new check run named `upload`, `conclusion: success`, from the same GitHub Actions app, was created (106544444166). **Not measured:** whether it would satisfy a required check named `upload`.

**Same name, update in place (measured, run 35661928345).**

- Two creates named `sluiceway: same-name` → `filter=latest` returned only the second (106539020966), and `filter=all` returned both.
- A PATCH of the older one (106539019443) changed its output, but `filter=latest` still showed the newer one. So update the one `filter=latest` returns.
- **Docs.** "In a check suite, GitHub limits the number of check runs with the same name to 1000… GitHub will start to automatically delete older check runs" ([check runs](https://docs.github.com/en/rest/checks/runs)).

**Notifications.**

- **Docs.** Actions notifications are about "workflow run updates", with an option for failed runs only ([Actions notifications](https://docs.github.com/en/subscriptions-and-notifications/how-tos/managing-github-actions-notifications)). The notification docs list "CI activity, such as the status of workflows" ([about notifications](https://docs.github.com/en/subscriptions-and-notifications/concepts/about-notifications)). No setting or statement about check runs made by an app or a token was found.
- **Not measured:** whether any inbox entry or email came from the probe.

### 5. Lifetime and deletion

- **Docs, today.** "GitHub retains checks data for 400 days. After 400 days, the data is archived. 10 days after archival, the data is permanently deleted." ([checks guide](https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-checks)).
- **Docs, from 2026-10-01.** "Checks, workflow runs, and statuses will be governed by the same Actions retention setting that already controls how long artifacts and logs are kept, with a default of 90 days… This applies to checks and statuses created by Actions as well as third-party applications… For public repositories, the maximum retention for checks, workflow runs, and statuses is 90 days." ([changelog 2026-07-17](https://github.blog/changelog/2026-07-17-actions-retention-will-cover-checks-workflow-runs-and-statuses/), editor's note of 2026-09-15). The setting ranges from 1 to 90 days for public repos and from 1 to 400 for private ones ([retention settings](https://docs.github.com/en/organizations/managing-organization-settings/configuring-the-retention-period-for-github-actions-artifacts-and-logs-in-your-organization)).
- **Measured, no DELETE.** `DELETE /check-runs/{id}` → 404. Docs list only create, get, update, list annotations, rerequest and the two lists for check runs, and create, preferences, get, rerequest and list for suites ([runs](https://docs.github.com/en/rest/checks/runs), [suites](https://docs.github.com/en/rest/checks/suites)).
- **Measured, blanking.** A PATCH set `summary` to `""` and `text` to null, and GET returned them blank (106538491682 on the first commit).
- **Measured, deleted with the host run.** Deleting workflow run 35663575559 on `32d7a51` (204) made three check runs in its suite answer 404: its own job and the check runs that `suite-a` and `suite-b` had made. Anyone who deletes an old run, or its retention ending, can remove Sluiceway's pages with it. The `actions: write` that the bot already has (0017) allows that delete.
- **Not measured:** whether retention removes a check run by its own age or with the run whose suite it sits in.

### 6. Repeated scans of one commit

- **Measured on `e9269c1`**, scans with three stacks, in order:

| Run | Strategy | `sluiceway: network:dev` on the commit afterwards |
|---|---|---|
| 35663154699, attempt 1 | create | a new one |
| 35663181082 | create | a new one |
| 35663209230 | update the latest by name | the same one, updated |
| 35663233239 | update the latest by name | the same one, updated |
| 35663154699, attempt 2 (re-run) | create | a new one |

  After these runs, `filter=all` holds 4 for `network:dev` (one from the `full` probe) and `filter=latest` holds 1. Every one of them sits in the suite of the `artifact-page` push run, not in the dispatch's own suite.
- **Measured on `main` (`618c1c9`).** Two create dispatches left two per stack, in the suite of the previous day's `joblink` run. The rollup of that commit is `null`, so these check runs give the commit no status and give the branch list no icon (API view). **Not measured:** the commit page and the branch list logged in.
- A scheduled scan of an unchanged default branch keeps landing on the same commit. It must update in place, or it adds one check run per stack per scan until the 1,000 per name limit starts deleting old ones.

### 7. Alternatives

| Surface | One click | Rendered | Access follows the repo | No new credential | No notifications | Notes |
|---|---|---|---|---|---|---|
| **Check run** | yes | yes | yes | yes, `checks: write` | yes (docs, see 4) | measured above |
| Job summary per matrix job | no | yes | yes | yes | yes | 0044 measured that a job's page shows no summary, and a fragment on the run page is dropped. It also needs one job per stack, but a scan is one job (0012) |
| Discussion per stack | yes | yes | yes | yes, `discussions: write` | **no** | watchers can choose to be notified of discussions ([configuring notifications](https://docs.github.com/en/subscriptions-and-notifications/get-started/configuring-notifications)). `discussions: write` also "permits an action to close or delete a discussion" (workflow syntax). Discussions must be enabled |
| Wiki page | yes | yes | yes | not documented | yes | no primary source says the workflow token can push to `<repo>.wiki.git`. Community reports disagree ([discussion 25929](https://github.com/orgs/community/discussions/25929)). A wiki needs a paid plan for private repos and was off in the lab. Not measured |
| Artifact, `archive: false` | **no** | HTML only | yes, but see notes | yes | yes | measured, see below |
| Commit comment | yes | yes | yes | yes, `contents: write` | **no** | a thread on the commit, watched like any conversation. `contents: write` is far more power than a scan has |
| Comment on the dashboard | yes | yes | yes | yes | **no** | notifies every subscriber and keeps edit history, the reach 0021 rejects |
| GitHub Pages | yes | yes | **no** | yes, `pages: write` | yes | "publicly available on the internet, even if the repository for the site is private" unless Enterprise Cloud private pages ([what is Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [visibility](https://docs.github.com/en/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site)) |
| Gist | yes | yes | **no** | **no** | yes | see Why not a gist |

**Artifact, measured (run 35661928321, `actions/upload-artifact@v7`):**

- `archive: false` is new in v7.0.0 (2026-02-26), for "uploading single files directly (unzipped)" ([release](https://github.com/actions/upload-artifact/releases/tag/v7.0.0)). The changelog says a browser can view such a file natively: "great for simple HTML files… images, or markdown" ([changelog 2026-02-26](https://github.blog/changelog/2026-02-26-github-actions-now-supports-uploading-and-downloading-non-zipped-artifacts/)).
- The artifact takes the file's name (`network-dev.html` 10667243078, `network-dev.md` 10666683208). `GET /actions/artifacts/{id}/zip` redirects (302) to a signed Azure blob URL.
  - For the HTML file: `Content-Type: text/html`, `Content-Disposition: inline`. Headless Chromium rendered it.
  - For the Markdown file: `text/markdown`, inline. It showed as raw text, not rendered.
  - The zipped control (10666563149): `application/zip`, `attachment`.
- The signed URL was valid for 10 minutes (`st` to `se`) and opened for anyone holding it, with no login.
- The web address of the artifact, `/actions/runs/<run>/artifacts/<id>`, gives a logged-out person 404 in a private repo.

So a row could link to that web address, and a logged-in person would presumably be redirected to a rendered HTML page. But the page would be Sluiceway's own HTML on a blob host. For its signed lifetime, access no longer follows the repo. Record 0014 (promise 3) keeps artifacts empty. **Not measured:** the logged-in click on the web address.

## Consequences for the design

**What the page would be, next to the job log.**

| | Job log (0022, 0048) | Check run page |
|---|---|---|
| Who can read it | anyone who can read the repo. Anyone at all in a public repo | the same people in the web UI. Also any token or app with checks read on the repo, through the API, as plain JSON |
| Registered masks (`::add-mask::`) | applied by the runner | **not applied.** The canary `sluiceway-canary-7f3a`, registered with `::add-mask::` in an earlier step, was stored and returned in plain text by GET (106538952701). Docs: masking "prevents a string or variable from being printed in the log… redacted on the runner" ([workflow commands](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands)). An API payload never passes through the log |
| Lifetime | the repo's log retention | 400 days until 2026-10-01, then the same retention setting as logs. Also deleted with whichever workflow run's suite it joined, which Sluiceway does not choose |
| Can it be removed | delete the run | no DELETE. A PATCH can blank it. Deleting the host run removes it |
| Size | no limit that matters (0037) | 65,535 characters per field, and `text` is cut silently at 65,535 bytes |
| Emailed or indexed | no | no notification found in the docs. Public repos: the page opens logged out |

**If a repo opts in to values on that page, 0021 and 0048 would have to say:**

- A value may reach a second place: `output.text` of the stack's check run, and only under its own setting. That setting would be separate from `scan.logDiff`, because the safety of the job log rests partly on the runner's masks, and the check run does not have them.
- Only the tool's own marking (`[secret]`) masks anything there. A secret loaded by the workflow and registered with `::add-mask::` is printed in plain text if the tool prints it unmarked.
- Its lifetime is the repo's Actions retention (from 2026-10-01). It can end early when someone deletes the unrelated run whose suite the page joined. It can only be blanked, never deleted. Turning the setting off does not clear pages already written. A scan would have to blank them.
- The text is a cut of the tool's diff, and the page says so and links to the job log's group for the rest.
- Workflow commands are not a risk on this surface. `::stop-commands::` (0048) is only needed for the log.

**What is safe on the page always, without any opt-in.** This is the content of the summary today (0021, 0037, 0046):

- the stack id as the check run's name and title;
- the counts by op;
- addresses by type and name, with their ops and tracking changes;
- property paths;
- the `ignore` hint (0022);
- links to the dashboard and to the attempt that previewed it.

Nothing on it would come from the tool's text. The check run's name also shows in the commit's check list, the jobs list of the host run and, for `push` suites, the rollup. So the stack id becomes visible there too. It already is on the dashboard.

**The permission the consumer workflow gains.** The scan job adds `checks: write`. `resolve` and `settle` need nothing new. With it, the token can:

- create a check run on any commit of the repo, under any name, including the name of a CI job that branch protection requires, from the same GitHub Actions source (measured: a `success` check run named `upload` was created);
- rewrite the output of any check run of the GitHub Actions app, including other workflows' job pages (measured);
- ask for a check suite to be re-run (the rerequest endpoints; not measured).

It cannot change the status or conclusion of a job that Actions runs (measured, 403). The scan job also runs the tool with the repo's cloud credentials (0013). So the docs have to say that this job can now also forge a passing check. A team that requires checks should require them from a job that does not have `checks: write`, or accept that.

**Other things the build would have to settle:**

- **Name:** `sluiceway / <stack id>`, stable, so a scan can find it again.
- **Conclusion:** `neutral`. It adds no failure to the rollup. `action_required` makes the commit's rollup a failure (measured). `skipped` reads wrong on a pending preview.
- **Find and update:** list the commit's check runs once (`filter=latest`, 100 per page) and PATCH the stack's one, or create it when it is missing. The cost is one list call per 100 stacks plus one write per pending stack. A scan with 100 pending stacks goes from 5 requests (0017) to about 106. It may also meet the content creation limit (80 a minute), which is not measured.
- **Stacks no longer pending:** a stack that is in sync or deployed should get its page blanked or marked as no longer pending on the next scan of that commit. Otherwise an old preview stays one search away.
- **Where the link lives:** the row's link (0044, 0048) becomes the check run's `html_url` for a pending row. The summary and the job log keep their roles. A failed create falls back to today's link, and the scan goes on.
- **Wrong place in the UI:** the page appears as a job of whichever workflow run has the oldest suite on the commit (dorny/test-reporter #67). The docs should say so, because it will be reported as a bug.

## Sources

- GitHub Docs, REST check runs: https://docs.github.com/en/rest/checks/runs
- GitHub Docs, REST check suites: https://docs.github.com/en/rest/checks/suites
- GitHub Docs, Using the REST API to interact with checks: https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-checks
- GitHub Docs, Workflow syntax, `permissions`: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
- GitHub Docs, Workflow commands (masking, job summaries): https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands
- GitHub Docs, REST rate limits: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- GitHub Docs, Create a gist: https://docs.github.com/en/rest/gists/gists#create-a-gist
- GitHub Docs, Creating gists: https://docs.github.com/en/get-started/writing-on-github/editing-and-sharing-content-with-gists/creating-gists
- GitHub Docs, Status checks: https://docs.github.com/en/pull-requests/reference/status-checks
- GitHub Docs, About protected branches: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- GitHub Docs, Troubleshooting required status checks: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks
- GitHub Docs, Retention of artifacts and logs: https://docs.github.com/en/organizations/managing-organization-settings/configuring-the-retention-period-for-github-actions-artifacts-and-logs-in-your-organization
- GitHub Docs, Managing GitHub Actions notifications: https://docs.github.com/en/subscriptions-and-notifications/how-tos/managing-github-actions-notifications
- GitHub Docs, About notifications: https://docs.github.com/en/subscriptions-and-notifications/concepts/about-notifications
- GitHub Docs, Configuring notifications: https://docs.github.com/en/subscriptions-and-notifications/get-started/configuring-notifications
- GitHub Docs, What is GitHub Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
- GitHub Docs, Changing the visibility of a Pages site: https://docs.github.com/en/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site
- GitHub Changelog 2026-07-17, Actions retention will cover checks, workflow runs, and statuses: https://github.blog/changelog/2026-07-17-actions-retention-will-cover-checks-workflow-runs-and-statuses/
- GitHub Changelog 2026-02-26, non-zipped artifacts: https://github.blog/changelog/2026-02-26-github-actions-now-supports-uploading-and-downloading-non-zipped-artifacts/
- GitHub Changelog 2025-02-12, check run status modification: https://github.blog/changelog/2025-02-12-notice-of-upcoming-deprecations-and-breaking-changes-for-github-actions/#changes-to-check-run-status-modification
- actions/upload-artifact v7.0.0: https://github.com/actions/upload-artifact/releases/tag/v7.0.0
- dorny/test-reporter source and README: https://github.com/dorny/test-reporter/blob/main/src/main.ts, https://github.com/dorny/test-reporter
- dorny/test-reporter issue #67: https://github.com/dorny/test-reporter/issues/67
- GitHub Community discussion 25929 (wiki push, not primary): https://github.com/orgs/community/discussions/25929
- Lab: https://github.com/sluiceway/behavior-lab/tree/probe/check-run-preview and PRs #53 to #57 (private)
- Records 0012, 0013, 0014, 0017, 0021, 0022, 0037, 0044, 0046, 0048
