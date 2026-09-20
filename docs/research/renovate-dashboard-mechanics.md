# How Renovate's Dependency Dashboard handles checkboxes, markers and races

Research for issue #6. Researched on 2026-09-20.

All Renovate source references are pinned to commit `bdb9f2efb6131495b65cbd52e0e0ee36fec28974` (main on 2026-09-20). Short names used below:

- `R/` = `https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/`
- `GD/` = `https://github.com/github/docs/blob/27965d1687907bf5f365166999eea249ac88c088/`
- `CE/` = `https://github.com/mend/renovate-ce-ee/blob/e7f885ec4724a43b74bfe52ac11b4cbdf1b7b1e5/`

Every link in the text is written out in full so it can be clicked.

## Answer

Renovate treats the dashboard issue as a level-triggered input that it reads once per run, not as an event stream. At the start of a run it finds the open issue by exact title (among issues authored by the bot), and parses the body with plain regexes that look for ` - [x] <!-- <type>-branch=<branchName> -->`. The hidden HTML comment directly after the checkbox is the whole marker format: an action type plus a branch name, nothing else. The result is a `branchName -> action` map that the branch workers consult.

Renovate never unticks a box. At the end of the run it regenerates the entire body from current state with every box unchecked and PATCHes it over the old one. A tick is "cleared" by that re-render, and "not acting twice" comes from the actions being idempotent plus the row moving to another section once the action has happened. There is no lock and no compare-and-swap. The one race guard (added in 2021, PR #10457) is: just before writing, fetch the issue again, parse it again, and carry over any box that is ticked now but was not in the set read at the start. A small window between that fetch and the PATCH remains, and GitHub offers no conditional PATCH to close it.

Hand edits to the body are simply overwritten on the next run that produces a different body. The only supported customisation is the `dependencyDashboardHeader` and `dependencyDashboardFooter` config. Renaming the issue makes Renovate lose it and create a new one. Closing it makes Renovate reopen it. Duplicate open issues with the same title get closed.

The "Check this box to trigger a request for Renovate to run again" checkbox is not in the open source code at all. The Mend hosted app injects it through the footer (marker `<!-- manual job -->`) and its closed source webhook listener enqueues a job when it sees the `issues` webhook. A self-hosted CLI run on cron has no webhook, so ticks only take effect at the next scheduled run.

Size: Renovate budgets 58,000 characters on GitHub (real limit is 65,536 characters and 262,144 bytes). It fits the lowest value section (detected dependencies) into whatever budget remains by dropping entries from the end and adding a "truncated" note, then runs a blunt hard cut as a last safety net.

What transfers to Sluiceway: marker next to checkbox, regenerate the whole body and never patch in place, clear ticks by re-rendering, re-fetch and carry over fresh ticks right before every write, skip the write when the body is unchanged, budget the body below the limit and truncate the least important section first, find by more than the title. What does not transfer: Renovate can afford to lose or delay a tick because the next poll picks it up again. Sluiceway only wakes on `issues.edited`, so it should use the event as a wake-up signal and then read the current body from the API (level-triggered, like Renovate), rather than trusting only the diff in the payload. It also needs real serialisation (Actions `concurrency`) because several event-driven runs can overlap, which a single polling bot never has to deal with.

## Detail

### 1. Marker format and checkbox parsing

All of this lives in one file: `lib/workers/repository/dependency-dashboard.ts`.

- A marker is an HTML comment built by `getMarkdownComment(comment)`, which returns `<!-- ${comment} -->`. A checkbox line is built by `getCheckbox(type, checked)`, which returns ` - [ ] <!-- type -->` or ` - [x] <!-- type -->`. Note the leading space and that the marker follows the checkbox on the same line, before the visible text. Source: https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/workers/repository/dependency-dashboard.ts#L66-L80
- Per-branch rows use the marker `<type>-branch=<branchName>`, for example `<!-- approve-branch=renovate/react-19.x -->`. The row is built in `getListItem`: checkbox, then PR link or title, then package names. Source: https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/workers/repository/dependency-dashboard.ts#L227-L246
- Types in use, one per dashboard section: `approve`, `approveGroup`, `unschedule`, `unlimit`, `retry`, `approvePr` (default), `rebase`, `unpend`, `other`, `recreate`. Source: https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/workers/repository/dependency-dashboard.ts#L498-L622
- Bulk checkboxes use fixed markers with no payload: `approve-all-pending-prs`, `create-all-rate-limited-prs`, `create-all-awaiting-schedule-prs`, `rebase-all-open-prs`, `create-config-migration-pr`. There is also a non-checkbox marker, `config-migration-pr-info`, used purely as a state flag in the body. Source: https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/workers/repository/dependency-dashboard.ts#L59-L64
- The parsing regexes:

  ```ts
  const markedBranchesRe = regEx(
    ` - \\[x\\] ${getMarkdownComment('([a-zA-Z]+)-branch=([^\\s]+)')}`, 'g');
  const pendingApprovalRe = regEx(
    ` - \\[ \\] ${getMarkdownComment('approve-branch=([^\\s]+)')}`, 'g');
  ```

  `markedBranchesRe` collects every ticked per-branch row into `dependencyDashboardChecks[branchName] = type`. The `[ ]` variants (`rateLimitedRe`, `pendingApprovalRe`, `awaitingScheduleRe`) are only used to expand a ticked bulk checkbox into all unticked rows of that section. Source: https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/workers/repository/dependency-dashboard.ts#L39-L57 and https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/workers/repository/dependency-dashboard.ts#L116-L158
- Bulk boxes and the config migration box are detected with a plain `issueBody.includes(getCheckbox(type, true))`, no regex. Source: https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/workers/repository/dependency-dashboard.ts#L70-L114
- Things the parser does not do: it only matches lowercase `[x]` (GitHub's UI writes lowercase, a hand typed `[X]` is ignored), it does not validate that the branch name in a marker is one Renovate knows about at parse time (unknown names are just never looked up), and markers carry no hash, version or signature. The visible text of a row is never parsed.
- PR bodies use the same idea with a fixed marker: `- [ ] <!-- rebase-check -->`, parsed by `/- (?<checkbox>\[[\sx]]) <!-- rebase-check -->/`. Source: https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/modules/platform/pr-body.ts#L17-L43

### 2. How a tick is acted on, and how it is cleared

- The body is read once, early in the run. `readDashboardBody(config)` is called from the extract phase (https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/workers/repository/process/index.ts#L148). It calls `platform.findIssue(title)`, parses the body and copies the result onto the run config: `dependencyDashboardChecks`, `dependencyDashboardRebaseAllOpen`, `dependencyDashboardAllPending`, and so on. Source: https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/workers/repository/dependency-dashboard.ts#L179-L221
- Each branch worker looks itself up: `config.dependencyDashboardChecks?.[config.branchName]`. A non-empty value bypasses approval, schedule, rate limit and "PR was closed" gates, and `rebase` forces a rebase. Source: https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/workers/repository/update/branch/index.ts#L143-L148 and https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/workers/repository/update/branch/index.ts#L561-L566
- The same map can be fed without any issue at all: the self-hosted option `checkedBranches` injects branch names "as if you selected their checkboxes in the Dependency Dashboard issue". So the issue is one input source for a selection, not the selection itself. Source: https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/docs/usage/self-hosted-configuration.md (section `checkedBranches`) and https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/workers/repository/dependency-dashboard.ts#L204-L218
- The dashboard is written once, at the end of the run, after branches have been processed: `ensureDependencyDashboard` is called after `updateRepo` in https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/workers/repository/index.ts#L139-L177
- Clearing: `ensureDependencyDashboard` builds a completely new body from the branch results of this run. Every row is rendered with `getCheckbox(...)` and the default `checked = false`. Nothing in the code edits a `[x]` back to `[ ]`. The tick disappears because the old body is replaced. Source: https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/workers/repository/dependency-dashboard.ts#L455-L638

### 3. How it avoids acting twice

There is no dedupe key, lock or "in progress" marker. Three things do the job:

1. State moves. After an approved branch is created, the next render lists it under "Open" (type `rebase`) instead of "Pending Approval" (type `approve`). The old marker no longer exists in the body.
2. Actions are idempotent. Creating a branch that exists, or rebasing a branch that is up to date, does nothing harmful. If the final issue write fails, the tick stays and the same action is requested again on the next run, which is fine.
3. One writer. A repository is normally processed by one Renovate run at a time, so there is no second bot racing the first.

The original issue describing the design problem (ticks made after the run started got lost when the run reset the checkboxes) floated "Edit the issue to show work in progress once a run starts" as one idea and "parse the issue again at the end" as the other. Renovate implemented only the second. Source: https://github.com/renovatebot/renovate/issues/4355

### 4. What happens when the issue is edited during a run

Renovate rewrites the whole body with a plain `PATCH /repos/{repo}/issues/{number}` carrying `{ body, state: 'open', title, labels }`. No ETag, no `If-Match`, no version check. Source: https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/modules/platform/github/index.ts#L1528-L1543

GitHub would not honour one anyway: "Conditional requests for unsafe methods, such as POST, PUT, PATCH, and DELETE are not supported unless otherwise noted in the documentation for a specific endpoint." Source: https://github.com/github/docs/blob/27965d1687907bf5f365166999eea249ac88c088/content/rest/using-the-rest-api/best-practices-for-using-the-rest-api.md#L115 (rendered: https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests-if-appropriate)

The mitigation, added by PR #10457 "fix(dashboard): handle checkbox race condition" (https://github.com/renovatebot/renovate/pull/10457, closes https://github.com/renovatebot/renovate/issues/4355):

```ts
// Skip cache when getting the issue to ensure we get the latest body,
// including any updates the user made after we started the run
const updatedIssue = await platform.getIssue?.(config.dependencyDashboardIssue, false);
if (updatedIssue) {
  const { dependencyDashboardChecks } = parseDashboardIssue(updatedIssue.body);
  for (const branchName of Object.keys(config.dependencyDashboardChecks!)) {
    delete dependencyDashboardChecks[branchName];      // already handled this run
  }
  for (const branchName of Object.keys(dependencyDashboardChecks)) {
    const checkText = getCheckbox(`${dependencyDashboardChecks[branchName]}-branch=${branchName}`);
    issueBody = issueBody.replace(checkText, checkText.replace('[ ]', '[x]'));
  }
}
```

Source: https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/workers/repository/dependency-dashboard.ts#L640-L674

In words: ticks seen at the start are considered handled and get cleared. Ticks that appeared during the run are re-applied to the freshly rendered body so that the next run sees them. Details worth knowing:

- The carry-over only works if the new body still contains the exact same unchecked row (same type and branch). If the row changed section during the run, the `replace` finds nothing and the late tick is silently dropped.
- Only per-branch ticks are carried over. Late ticks on bulk checkboxes, the config migration checkbox and the footer rescan checkbox are not.
- The window between the second GET and the PATCH is still open. It is small (milliseconds to a second) but it is last-write-wins inside it.
- Before doing the second GET, Renovate compares its new body with the body it read at the start and returns early if they are equal, saving both calls (PR #26794, https://github.com/renovatebot/renovate/pull/26794). `ensureIssue` does a second equality check against a fresh GET and skips the PATCH when nothing changed. Source: https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/modules/platform/github/index.ts#L1512-L1527

### 5. Finding and recreating the issue, and hand edits

- Lookup is by exact title, open state, within the bot's own issues. `findIssue(title)` filters the issue list on `i.state === 'open' && i.title === title`. The list itself comes from a GraphQL query with `filterBy: { createdBy: $user }`, where `$user` is the bot's username unless `ignorePrAuthor` is set. Default title is `Dependency Dashboard`, configurable with `dependencyDashboardTitle`. There is no label based lookup and no hidden root marker. Sources: https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/modules/platform/github/index.ts#L1374-L1442 and https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/modules/platform/github/graphql.ts#L42-L71
- `ensureIssue` (https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/modules/platform/github/index.ts#L1467-L1571):
  - matches on `title`, falling back to a legacy `reuseTitle` so a renamed default does not orphan old issues,
  - if only closed matches exist, reopens one (`state: 'open'` in the PATCH) instead of creating a new issue,
  - closes any other open issue with the same title ("Closing duplicate issue"),
  - creates a new issue when nothing matches,
  - reapplies `labels` on every write. The docs say "It is pointless to edit the labels, as Renovate restores the labels on each run" (https://docs.renovatebot.com/configuration-options/#dependencydashboardlabels).
- Consequences for users who edit by hand:
  - Any body edit survives only until the next run that renders a different body. There is no merge of user text. The supported way to add text is `dependencyDashboardHeader` and `dependencyDashboardFooter` (https://docs.renovatebot.com/configuration-options/#dependencydashboardheader).
  - Renaming the issue makes `findIssue` miss it. Renovate then creates a fresh dashboard and the renamed one is orphaned.
  - Closing the issue is undone on the next run unless `dependencyDashboardAutoclose` applies.
  - An issue with the right title created by a human is ignored because of the author filter, so a user cannot spoof a dashboard (unless `ignorePrAuthor` is on).
- When the dashboard feature is off, Renovate actively closes the issue (`ensureIssueClosing`). Source: https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/workers/repository/dependency-dashboard.ts#L367-L388

### 6. The rescan checkbox

- The string "Check this box to trigger a request for Renovate to run again on this repository" does not exist anywhere in `renovatebot/renovate`. The open source renderer only emits a footer if `dependencyDashboardFooter` is configured. Source: https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/workers/repository/dependency-dashboard.ts#L758-L765
- On repositories using the Mend hosted app the dashboard ends with `- [ ] <!-- manual job -->Check this box to trigger a request for Renovate to run again on this repository`. Live example (body fetched 2026-09-20, authored by `renovate[bot]`): https://github.com/jenkinsci/bom/issues/2500. The marker is `manual job`, with a space, and no payload. The hosted app injects it through the footer option.
- Reaction on the hosted app: "It also listens to webhooks and enqueues a Renovate job when relevant changes occur in a repo, or when actions are triggered from the Renovate PRs or Dashboard issue." Source: https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/docs/usage/mend-hosted/overview.md#L14-L15. The self-hosted Mend server (Community and Enterprise editions) documents the same design: the GitHub App must subscribe to the `Issues` webhook event (https://github.com/mend/renovate-ce-ee/blob/e7f885ec4724a43b74bfe52ac11b4cbdf1b7b1e5/docs/setup-for-github.md#L25-L34) and "Renovate can also respond to checkbox activities in PRs and the Dependency Dashboard" (https://github.com/mend/renovate-ce-ee/blob/e7f885ec4724a43b74bfe52ac11b4cbdf1b7b1e5/docs/setup-for-gitlab.md).
- Important: the webhook only enqueues a normal job. The job does not use the webhook payload to decide what to do. It reads the issue body at the start like any other run (section 2). The webhook handler is closed source, so how it debounces or how it checks the sender is not verifiable.
- Because the footer is re-rendered unchecked on every write, the rescan tick clears itself at the end of the triggered run. It is not covered by the late tick carry-over.
- A plain self-hosted `renovate` CLI on cron or in a CI schedule has no listener. Ticks (including a hand-added rescan footer) do nothing until the next scheduled run reads the body. That is why the box is absent from the open source default.

### 7. Body size limits and truncation

- GitHub platform budget: `const GitHubMaxPrBodyLen = 58000;` with the comment "GitHub's max is 60k but in the hosted app we've observed that content-length is ~1k longer". `maxBodyLength()` returns it and it is used for issues as well as PRs. Source: https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/modules/platform/github/index.ts#L131-L132 and https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/modules/platform/github/index.ts#L2365-L2367
- The real GitHub limit, per GitHub staff in the community forum: bodies are stored in a MySQL mediumblob "with a maximum value length of 262,144. This equals a limit of 65,536 4-byte unicode characters." So there are two ceilings: 65,536 characters and 262,144 bytes. Source: https://github.com/orgs/community/discussions/27190. This is a forum answer and not reference documentation. GitHub's REST reference does not state the number.
- Truncation strategy is two layers:
  1. Priority based fitting. All actionable sections (the checkbox lists, warnings, vulnerabilities) are rendered first at full size. The least important section, "Detected dependencies", is rendered last into the remaining budget: `PackageFiles.getDashboardMarkdown(platform.maxBodyLength() - issueBody.length - footer.length)`. That function renders, measures, and if too long pops one entry from the end (a dep, then a package file, then a manager, then a base branch) and renders again in a loop, then prepends a note "Detected dependencies section has been truncated". The footer length is reserved up front so the footer (and the rescan checkbox in it) always survives. Sources: https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/workers/repository/dependency-dashboard.ts#L632-L638 and https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/workers/repository/package-files.ts#L35-L75 and https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/workers/repository/package-files.ts#L157-L187
  2. Hard cut safety net. `massageMarkdown` ends with `smartTruncate(body, maxBodyLength())`. For an issue body (no "Release Notes" heading) this is a blunt `substring(0, len - notice.length)` plus a notice. It can cut through the middle of a `<details>` block or a marker. Source: https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/modules/platform/utils/pr-body.ts#L10-L35
- This area has broken more than once: "fix(core/dashboard): fix truncated issue body" (#16527, 2022) and "fix(dependency-dashboard): fix truncated issue body" (#30081, 2024). Source: https://github.com/renovatebot/renovate/commits/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/workers/repository/dependency-dashboard.ts
- Note the fitting is measured before `massageMarkdown` rewrites links (`github.com` to `redirect.github.com`), which makes the body longer after it was measured. The 58,000 budget versus the 65,536 limit is the slack that absorbs this. Source: https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/modules/platform/github/index.ts#L2338-L2363

### 8. Polling versus `issues.edited`: what changes for Sluiceway

Renovate, in every deployment mode, is level-triggered: a run starts (from cron or from a webhook that merely enqueues a job), and the run reads the complete current checkbox state. The edit event, if any, carries no meaning beyond "run soon". Sluiceway's brief instead describes an edge-triggered `resolve`: diff `changes.body.from` against the current body and act on boxes that flipped.

Facts that matter for that choice:

- The `issues` `edited` payload does include `changes.body.from` and a required `sender`. Source: https://github.com/octokit/webhooks/blob/7dd7fa56498a827a08b71919fae89428f5e8e283/payload-schemas/api.github.com/issues/edited.schema.json and https://docs.github.com/en/webhooks/webhook-events-and-payloads?actionType=edited#issues
- Edits made with `GITHUB_TOKEN` do not start new workflow runs. "events triggered by the GITHUB_TOKEN will not create a new workflow run", with `workflow_dispatch` and `repository_dispatch` as the exceptions (plus approval-gated `pull_request` runs, not relevant here). So Sluiceway's own re-renders will not loop, and the brief's plan to trigger a rescan via `workflow_dispatch` is allowed. Source: https://github.com/github/docs/blob/27965d1687907bf5f365166999eea249ac88c088/data/reusables/actions/actions-do-not-trigger-workflows.md (rendered: https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- Actions concurrency groups by default keep one running and one pending run. The docs say "by default only one run can be pending in a concurrency group" and that "any additional pending runs cancel the previous one", then add: "If you need runs to execute sequentially without being canceled, you can opt in to queuing". Source: https://github.com/github/docs/blob/27965d1687907bf5f365166999eea249ac88c088/content/actions/concepts/workflows-and-actions/concurrency.md#L19 (rendered: https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency). The queuing opt-in syntax was not verified in this research.

Consequence: if `resolve` is serialised with a default concurrency group and is purely edge-triggered, three quick ticks can produce three runs of which the middle one is cancelled while pending, and its tick is never acted on even though the box stays ticked. A level-triggered `resolve` (read the live body, act on every ticked row) does not have this problem, because the last pending run sees all ticks. That is exactly why Renovate's model is robust to missed or coalesced triggers.

Patterns that transfer directly:

- Marker on the checkbox line, parsed by regex, visible text ignored.
- Whole body regeneration from recomputed truth. Clearing a tick is a side effect of re-rendering.
- Re-fetch, re-parse and carry over unhandled ticks right before every write. In Sluiceway this matters more than in Renovate, because `scan`, `resolve` and `apply` re-renders all write the same issue and can overlap with a human ticking.
- Skip the write when the body is byte-identical (Renovate does this twice).
- Size budget well under the hard limit, least important content fitted last, footer reserved first.
- Author filter on lookup, close duplicates, reopen instead of recreate.
- Selection is a plain data structure that can come from somewhere other than the issue (`checkedBranches`). Sluiceway's `workflow_dispatch` inputs can feed the same `Selection` type, which also makes `resolve` testable without an issue.

Patterns that do not transfer:

- "Lost ticks are fine, the next poll fixes it." Sluiceway has no next poll for ticks. If a tick survives a re-render but its event was dropped or cancelled, nothing acts on it until another edit or a scheduled scan. Sluiceway's scheduled `scan` should therefore also check for ticked rows and hand them to `resolve`, or at least untick them with a note.
- "One writer." Renovate has a single long run per repo. Sluiceway has many short runs. It needs `concurrency` on everything that writes the issue, plus the carry-over step.
- "No work in progress state." Renovate can skip it because its actions are idempotent and cheap. A deploy is neither, so the brief's "re-render as deploying with no checkbox" step is the right addition. It is the idea from https://github.com/renovatebot/renovate/issues/4355 that Renovate chose not to build.
- "Markers without integrity." Renovate's marker only names a branch that Renovate itself will recompute. Sluiceway's marker carries a hash that gates a deploy, so it must be validated against discovery and a fresh preview, as the brief already says.
- Title based lookup. It breaks on rename. Sluiceway's label plus root marker plus author lookup is stronger. Keep the author check: it is what stops a human created look-alike issue from being treated as the dashboard.

### 9. Other tools that use issues, PRs or comments as a control surface

| Tool | Control surface | Trigger | Authorization | Source |
| --- | --- | --- | --- | --- |
| Renovate PRs | Checkbox `<!-- rebase-check -->` in the PR body, also a `rebase` label and a `rebase!` title prefix | Next run, or webhook on the hosted app | Whoever can edit the PR body or labels | https://github.com/renovatebot/renovate/blob/bdb9f2efb6131495b65cbd52e0e0ee36fec28974/lib/workers/repository/update/branch/index.ts#L74-L104 |
| Dependabot | Comment commands such as `@dependabot rebase`, `@dependabot recreate`, `@dependabot ignore this major version` | `issue_comment` webhook to the GitHub side service | Handled by GitHub, not documented on that page | https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-pull-request-comment-commands |
| Atlantis | PR comments `atlantis plan`, `atlantis apply` | Webhook to a self-hosted server | Docs warn: "Because anyone can comment on public pull requests, even with all the security mitigations available, it's still dangerous to run Atlantis on public repos". Directory and workspace locks are held from plan until merge. | https://github.com/runatlantis/atlantis/blob/0aaebed22caeee126cdbe58a6ab4d3fd5bae3cfa/runatlantis.io/docs/security.md#L23-L34 and https://github.com/runatlantis/atlantis/blob/0aaebed22caeee126cdbe58a6ab4d3fd5bae3cfa/runatlantis.io/docs/locking.md |
| Terrateam | PR comments `terrateam plan`, `terrateam apply` | GitHub App webhook, work runs in Actions | `access_control` rules by repo role, team or user. "User must have apply permissions". Access control is off by default in the open source edition. | https://github.com/terrateamio/terrateam/blob/82d620ec5033d38daf94ba0560424083871fa827/docs/src/content/docs/reference/commands/apply.mdx and https://github.com/terrateamio/terrateam/blob/82d620ec5033d38daf94ba0560424083871fa827/docs/src/content/docs/reference/configuration/access-control.mdx |
| Digger | PR comments `digger plan`, `digger apply`, `digger lock`, `digger unlock` | Webhook to orchestrator, runs in the user's CI | PR level project locks | https://github.com/diggerhq/digger/blob/7d732cbd616a4c399f017b666f0b5cc3f0335abc/docs/ce/features/commentops.mdx |
| release-please | The release PR itself. Merging it is the command. State lives in labels: `autorelease: pending`, `autorelease: tagged`. A `release-please:force-run` label forces a rerun. | Push to the default branch | Whoever can merge or label | https://github.com/googleapis/release-please/blob/edce3d805ef3ac964d1ba2b29b0f42905f2fa412/README.md#L35-L41 |
| GitHub IssueOps | One issue per request. Issue forms for input, comment commands such as `.submit` and `.approve`, labels as state. Modelled as a finite state machine. | `issues` and `issue_comment` workflow events | Workflow checks the actor. Docs stress minimal `permissions:` per job. | https://github.blog/engineering/issueops-automate-ci-cd-and-more-with-github-issues-and-actions/ and https://issue-ops.github.io/docs/introduction/workflow-security |

Observations:

- Every IaC tool in this list uses comments, not checkboxes. A comment is append-only, has a clear author, produces exactly one event, and cannot be lost to a concurrent body rewrite. Checkboxes in a shared body have none of those properties. Renovate is the only mature tool found that uses body checkboxes as commands, and it gets away with it because of polling plus idempotent actions.
- None of the tools surveyed keep a single long-lived issue as a queue of pending deploys. This matches the positioning claim in the brief.
- The IssueOps material recommends labels for state. For Sluiceway a label is useful for lookup, but state per stack does not fit labels. Hidden markers are the right tool.

### 10. Pitfalls of task list checkboxes as triggers

- **Who can tick.** Ticking a task list box is an edit of the issue body. On GitHub, editing someone else's issue or comment needs the Write role: "Edit and delete anyone's comments on commits, pull requests, and issues: write, maintain, admin". Read and Triage cannot. The author of an issue can always edit their own body. Source: https://github.com/github/docs/blob/27965d1687907bf5f365166999eea249ac88c088/data/tables/repository-roles.yml#L92-L93 (rendered: https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization). For a dashboard authored by `github-actions[bot]` this means only Write and above can tick, even on a public repo. Caveats: the roles table says "comments" and does not name the issue body explicitly, so this is an inference that matches observed GitHub behaviour and should be confirmed with one manual test from a read-only account. Also, if the dashboard is ever created with a human's PAT, that human keeps edit rights as author regardless of role. This supports the brief's "authored by the bot identity" check and its explicit permission check on `sender`.
- **Last write wins on the body.** There is no conditional PATCH (section 4). Any two writers can clobber each other. GitHub's web UI toggles a checkbox without a full edit session, but the API offers nothing similar. The bot always sends the whole body.
- **Every body edit fires `edited`.** Title edits, typo fixes by a maintainer, and task list drag and drop reordering (https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/about-tasklists) all produce the same event. `resolve` must treat "no actionable tick" as the common case and exit cheaply.
- **GitHub mutates task lists on its own.** "If a task references another issue and someone closes that issue, the task's checkbox will automatically be marked as complete." Source: https://github.com/github/docs/blob/27965d1687907bf5f365166999eea249ac88c088/content/get-started/writing-on-github/working-with-advanced-formatting/about-tasklists.md#L40. A Sluiceway row that starts with an issue or PR reference such as `#123` could be auto-ticked when that PR closes. Renovate's rows avoid this because the marker and a relative link (`../pull/123`) come first, not a bare `#123` reference.
- **Unticks are events too.** A user who ticks then unticks produces two runs. With level-triggered reading the second run sees nothing to do. With edge-triggered diffing the first run has already started a deploy. Sluiceway should say clearly that a tick is a commit, not a toggle.
- **Payload staleness.** Between the event and the runner picking up the job (self-hosted runners can queue for minutes) the body may have changed again. Read the body from the API at the start of `resolve`. Use the payload only for `sender` and as a hint.
- **Attribution under coalescing.** With level-triggered reading, a run may find ticks made by someone other than the event's `sender` (from a cancelled earlier run). The permission check on `sender` then covers the wrong person. Since only Write and above can edit the body at all, the exposure is limited to per-stack rules stricter than Write (`admin`, named users). For those stacks, require that the tick is visible in this event's own diff (`changes.body.from` unticked, current ticked), and otherwise untick and ask for a fresh tick.
- **Hard truncation can eat markers.** A blunt substring cut can split a marker or drop the rescan row. Reserve the footer first and truncate by whole rows (section 7).

## Patterns worth copying

1. **Checkbox, then marker, then text, on one line.** ` - [ ] <!-- sluiceway:row ... -->` with the marker directly after the box. Parse with one anchored regex. Never parse the human-readable part. Keep bare `#123` references away from the start of the row.
2. **Regenerate, never patch.** Build the body from recomputed truth every time. Ticks are cleared as a side effect. Deterministic output lets you skip the PATCH when nothing changed (Renovate checks equality before and after the fresh GET).
3. **Re-fetch and carry over right before writing.** Parse the live body again, subtract the ticks this run handled, re-apply the rest to the new body. Do this in `scan`, `resolve` and `apply`, since all three write.
4. **Read state, do not trust the event.** Use `issues.edited` as a wake-up. Fetch the body from the API at the start of `resolve` and act on what is ticked now. Keep the payload diff for attribution and for strict-approver stacks.
5. **Selection as data.** Like `checkedBranches`, let `workflow_dispatch` inputs produce the same `Selection` the issue parser does.
6. **Lookup with an author filter, close duplicates, reopen rather than recreate.** Add the label and root marker on top, so a rename does not orphan the dashboard.
7. **Budget below the limit and fit the least important section last.** Reserve header, checkbox rows and footer first, then spend what is left on diffs, dropping whole entries from the end with a visible "truncated" note. Budget in characters and in bytes (65,536 and 262,144) and leave slack for any post-processing.
8. **A self-clearing rescan checkbox in the footer** with a payload-free marker. In Sluiceway it can start `scan` in the same workflow run (a job that `needs: resolve`) or via `workflow_dispatch`, which `GITHUB_TOKEN` is allowed to trigger.
9. **Header and footer as the only supported customisation**, and say in the docs that hand edits are overwritten.

## Traps to avoid

1. **Assuming a missed tick will be retried.** Renovate's safety net is the next poll. Sluiceway has none unless the scheduled `scan` also looks for stale ticks. Add that, or untick with an explanation.
2. **Pure edge-triggered `resolve` behind a default concurrency group.** Pending runs get cancelled and their ticks are lost. Go level-triggered, or verify and use the concurrency queuing opt-in, or both.
3. **Believing there is a compare-and-swap.** There is none for issue bodies. Serialise writers with `concurrency`, keep the fetch-to-PATCH window tiny, and design every action so a clobbered write is recoverable by the next render.
4. **Relying on idempotency like Renovate does.** Deploys are not idempotent enough. Keep the "deploying" row without a checkbox, the per-stack concurrency group, and the expected-hash check before apply.
5. **Carry-over by exact string match.** Renovate drops a late tick when the row changed section or type during the run. Match carry-over on stack id from the marker, and only carry a tick over if the hash in the marker is still the current hash. Otherwise drop it and say so on the row.
6. **Title as identity.** Renames orphan the issue and create a second dashboard.
7. **Blunt substring truncation** as anything other than a last resort. It can cut markers and `<details>` blocks in half. Renovate needed two bug fix rounds here.
8. **Bulk "select all" checkboxes.** Renovate has them, but for deploys they widen the blast radius, are not covered by the race carry-over, and complicate authorization. Leave them out of v1.
9. **Treating the checkbox as the security boundary.** GitHub's Write requirement for editing a bot-authored body is helpful but is inferred from the roles table, not a documented guarantee about task lists. Keep the explicit `sender` permission check and GitHub Environments as the real gate. Atlantis's warning about public repos exists because comment triggers are open to everyone. Body checkboxes are narrower, but verify with a read-only account before launch.
10. **Depending on closed source behaviour.** How the Mend app debounces or authorizes the rescan tick is not public. Do not assume it does anything clever.

## Open points that need a hands-on test

- Confirm with a read-only and a triage account that ticking a box in an issue authored by `github-actions[bot]` is rejected, on a public repo.
- Confirm the syntax and semantics of the Actions concurrency queuing opt-in mentioned in the concept docs.
- Measure typical delay between a tick and `resolve` start on the self-hosted runners, to size the staleness window.
