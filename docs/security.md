# Security

What a tick protects, what it does not, and how to make it stronger with what your GitHub plan offers. To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## What a tick promises

A tick is a request to deploy one stack exactly as its row shows it. Before anything deploys, Sluiceway checks who ticked, previews the stack again, and deploys only when the fresh preview gives the same **diff hash** as the row that was ticked. The hash covers every change of the diff: the address of each resource, what happens to it (create, update, replace, delete, import and so on), and the names of the properties that change.

It does not show **values**, except the ones a row lists through [`dashboard.showValues`](configuration.md#dashboardshowvalues), and it covers them anyway. Next to the diff hash, every pending and drifted row carries a **value fingerprint**: a hash of the values of the change that the row does not show, taken inside the adapter from the tool's own output, sixteen hex characters that name nothing ([record 0102](adr/0102-a-tick-covers-the-values-it-does-not-show-through-a-value-fingerprint.md)). `apply` compares it after the hash. Someone ticks a row that says `web: update, image`. Before the deploy starts, another merge changes the image from `v2` to `v3`. The same resource changes the same property and the hash is the same, but the fingerprint is not: nothing deploys, the record ends with `a value changed since the tick`, the row comes back with the change as it is now, and one comment asks the ticker to look at it and tick again. No value, no path and no side is named anywhere.

So a tick means: if anything about the change differs from what you ticked, nothing deploys. What the fingerprint covers, and what it does not:

- **A value the tool marks secret never reaches it in the clear.** Pulumi prints `[secret]` in place of such a value, OpenTofu and Terraform mark the attribute sensitive, a Kubernetes `Secret` is marked at its `data`, and so is every field of a `Secret` the Helm plugin lists. Such a value enters the fingerprint as its mark, so a secret that changed after the tick is not caught by it. Its path is in the diff hash.
- **A value that differs on every run refuses every tick.** A program that mints a token or a timestamp at each preview gives another fingerprint each time. When the dashboard's last scan was of the same commit, the refusal says so, a scan says so on the row, and both name the switch: [`valueFingerprint: false`](configuration.md#valuefingerprint) on the stack's entry, or at the top level for the repo.
- **Its cost, stated.** Sixteen hex characters sit in an issue that may be public. Someone who can read the dashboard, knows the rest of the diff from the row and can guess a value that is neither shown nor marked secret can confirm the guess against them. What bounds that: a value worth guessing is one the tool should hold as secret, and then only its mark is hashed; a value nobody marked is already in the state that anyone with the backend's credentials can read; and every hidden value of a change is hashed together, so a guess has to be right about all of them at once. A repo that keeps unmarked secrets in its code and a public dashboard turns the check off.
- **An object the Helm plugin adds, and Helm and kubectl drift, carry none.** The plugin prints no manifest for an object it adds, and those drift checks read no values. Those stay approved at whatever value the code has when the deploy runs.

The rest of the promise:

- **What went out is traceable.** The deployment record of every deploy names the commit that was deployed.
- **The cost line is not in the hash.** With [`cost.enabled`](configuration.md#costenabled) a row of an OpenTofu or Terraform stack says what the change does to the monthly bill. That number is derived from the plan and the hash already covers what changes, so a tick approves the change and not the amount, and a price that moved since the tick stops nothing ([record 0105](adr/0105-a-row-shows-what-a-change-costs-and-a-threshold-turns-a-merge-back-to-a-tick.md)).
- **Anything else that moved stops the deploy.** A new resource, a delete, a replace or a different property gives a different hash. The deploy stops, nothing changes, and the row comes back with the fresh diff and a line that says the change moved since the tick.
- **A push after the tick stops the deploy too.** `apply` previews the commit its run checked out, so a push that lands while it waits for a runner or a reviewer cannot reach that preview. Before it previews, `apply` compares that commit with the head of the branch. When a newer commit changes a file the stack claims, or a file no stack claims, nothing deploys and the tool does not run. `apply` starts a full scan, which brings the row back with the change as it is now and the failure line, and one comment tells the person who ticked. A push that changes only other stacks deploys the tick as before ([record 0111](adr/0111-apply-refuses-as-moved-when-the-branch-moved-under-the-stack-after-its-checkout.md)).
- **For OpenTofu, the deploy is the plan that was checked.** `apply` saves the plan of its fresh preview, checks that plan's hash, and deploys that plan file and nothing else. Nothing can slip in between the check and the deploy, and the tool itself refuses the plan when the state changed since (record 0053). The gap above, between the tick and that fresh preview, stays.
- **For Helm, the deploy is what the fresh preview rendered.** Helm saves no plan, so `apply` renders the chart in its fresh preview and once more right before `helm upgrade`, and deploys only when both are the same. The digest of the render stays in memory in the `apply` job and is never written anywhere (record 0058). A render that moved ends like any moved change: nothing goes out.
- **For Kubernetes manifests, the deploy is the rendered set that was checked.** `apply` renders the stack once, diffs that set, checks its hash, and applies that same file, after checking that it still holds the bytes that were diffed (record 0060). The digest of the set stays inside the job. The gap between the tick and the fresh preview stays here too.
- **Drift is covered as shown too.** On a row that shows drift, the hash covers the drift as well: which resources changed outside the code or are gone, and the property paths the tool names. `apply` checks the drift again before it compares, and deploys with the tool's refresh so the drift is put back. Drift that moved after the tick stops the deploy like a moved change ([record 0055](adr/0055-drift-is-checked-by-a-scheduled-scan-shown-on-the-stacks-row-and-repaired-by-a-tick.md)). On Helm 4 the repair of a release applied server-side forces conflicts, so the deploy takes back a field another field manager changed. Without drift on the approved row it never does ([record 0069](adr/0069-helm-drift-is-the-three-way-diff-beyond-the-plain-one-and-the-deploy-flags-follow-helm.md)).

Record 0008 first rejected a digest of values, for the guess above, and hashing the commit, because on a busy repo every merge would void every tick. The value fingerprint is that digest, chosen on purpose in record 0102 with its cost stated and a switch per repo and per stack. The commit still stays out.

The diff hash is not a secret and not a signature. Someone who edits it by hand can only approve what a fresh preview shows anyway.

## What deploys without a tick

Nothing deploys unless a person asks, or unless the repo's own `sluiceway.yaml` says a stack goes out on merge. [`deploy: on-merge`](configuration.md#stacksdeploy) is set per stack, and the default is a tick, so a repo that never writes it deploys only on a tick ([record 0095](adr/0095-a-stack-may-deploy-on-merge-and-the-default-stays-a-tick.md)).

For a stack set to on-merge, the merge is the ask:

- **Only the scan of a push to the default branch deploys it**, and only a change that scan found. It opens a deployment record with the diff hash it previewed, attributed to whoever pushed, and the deploy then takes exactly the path of a tick: `apply` previews again and deploys only on the same hash, so what goes out is what the scan of the merge showed, and a change that moved since stops it. A scheduled scan, "Run workflow" and the rescan box never deploy on merge.
- **A destroy always waits for a tick.** A change that deletes or replaces a resource is never deployed by a merge, whatever the setting says: a replace takes the old object away too, with its data, its address or its identity. The row says why it waits, and the destroy alert names it as for any pending stack.
- **Drift always waits for a tick.** A row that shows drift means the real infrastructure moved, not only the code, and a deploy would put back what someone changed by hand, perhaps on purpose during an incident. A person decides that.
- **A cost threshold turns it back to a tick.** With [`cost.threshold`](configuration.md#costthreshold) a change that costs more a month than the threshold waits for a tick, and so does one whose cost could not be estimated while a threshold is set: the gate fails closed, and the row says which ([record 0105](adr/0105-a-row-shows-what-a-change-costs-and-a-threshold-turns-a-merge-back-to-a-tick.md)).
- **Dependencies still decide the order.** A stack that depends on one with a change waiting for a tick waits too, and says for which.
- **`deploys: false` stops it**, and so does a read-only dashboard.
- **The tick rule does not judge the merge.** `tickers` still decides who may tick the stack, for every change that waits. Who may merge is decided by GitHub: write access, and the branch protection and required reviews of the default branch. So setting a stack to on-merge lets the rules of the default branch decide who may deploy it, which is why it is set in a reviewed file and never on the dashboard.
- **An environment with required reviewers still holds it.** The deploy runs in the job that deploys a tick, so the environment on that job holds a deploy on merge until a reviewer approves, as it holds a tick. So who may deploy such a stack is the reviewers, where there is an environment, and whoever may merge, where there is not.

Every deploy on merge is traceable like a tick: its deployment record names the commit and the person, the row says `merged by`, and so does Recently deployed.

A [deploy window](configuration.md#deploywindowsdays) changes when, never whether. A tick or a merge outside the window opens the record now, with what was approved, and the run inside the window deploys exactly that through the fresh preview and the hash check, or nothing. The window is read from `sluiceway.yaml` on the default branch, so widening it is a reviewed change, and a destroy on a stack set to on-merge waits for a tick whatever the window says ([record 0104](adr/0104-a-tick-outside-the-deploy-window-waits-for-it-instead-of-going-out.md)).

## Who can tick

Two checks, against GitHub's live answer, at every tick:

1. **The ticker has write access to the repo.** Always, whatever the rule.
2. **The ticker meets the stack's tick rule**, the `tickers` key of [`sluiceway.yaml`](configuration.md#tickers): a level (`write`, `maintain`, `admin`) or a list of usernames. A rule narrows who may tick and never widens it.

The ticker is the person whose edit ticked the box, as the issue's edit history names them. Only a person can tick: a tick by a bot, an app or a deleted account deploys nothing and the next scan clears it. When the history cannot name the person, for example because an entry was deleted, nothing deploys and the box is cleared. When GitHub gives no answer about a person's access, nothing deploys and the job goes red. Nothing is cached: a person whose access was removed is refused at their next tick.

### A tick asks, an environment decides

A tick rule decides who may **ask** for a deploy. A GitHub Environment with required reviewers, on the job that deploys, decides who may **deploy**. Without such an environment, nothing stands between a tick and the deploy, so the tick rule decides both.

A tick rule narrows within write access and never goes beyond it. So on its own, its ceiling is the people who may edit the dashboard issue. For a team with separation of duties that is usually the wrong set: the people who may deploy to production are fewer, decided somewhere other than a file in the repo, and audited. GitHub already decides that with an environment's required reviewers, and Sluiceway is built to wait for them.

| | Tick rule | Environment with required reviewers |
|---|---|---|
| Whose | Sluiceway's | GitHub's |
| Where it lives | `tickers` in `sluiceway.yaml`, a file in the repo. A change to it is a commit | The repo's settings, changed by a repo admin |
| What it decides | Who may ask for a deploy of a stack | Whether the job that deploys may start at all |
| Whom it can name | People with write access: a level, or a list of logins | People, and teams, which a tick rule cannot name |
| Where the decision is recorded | The ticker on the deployment record, the trail on the dashboard, and a comment for a refused tick | GitHub records who approved or rejected, and when, on the run. The deploy shows in the repo's deployment history under that environment |
| What it cannot do | Go beyond write access, name a team, or stop someone who skips the dashboard and uses the credentials directly | Show the reviewer what the row showed: a reviewer approves a job, not a diff. Exist on every plan |

The shape, with the tick rule left at its default. It needs the [split workflow](split-workflow.md), because the one-step workflow would make every scan wait for a reviewer too. In `sluiceway.yaml`, give the stacks that need a reviewer their environment, and leave `tickers` out:

```yaml
stacks:
  - path: infra/prod
    environment: production
```

In the split workflow, the `apply` job names the environment of the stack it deploys:

```yaml
  apply:
    environment:
      name: ${{ matrix.environment }}
      deployment: false # Sluiceway already records the deploy
```

And in the repo's settings, the environment `production` has the people who may deploy as its required reviewers, only the default branch as its deployment branch, and the credentials that change production as its secrets ([setup 2](#2-where-environments-exist-lock-the-credentials-in) says why they belong there). Anyone with write access may now tick a production stack, and only a reviewer can let it go out.

GitHub can also stop a person from approving a run they started themselves. That is not the same as stopping a ticker from approving their own tick: the run that deploys is started by whoever edited the dashboard last, or by Sluiceway itself after a deploy that others wait for, and that is not always the ticker. Where it matters, keep the tick rule and the reviewers apart by who is on each.

What happens in between. A tick is judged by the tick rule first. Once it passes, `resolve` creates the deployment record, with the ticker and the diff hash, and the row says deploying. Only then does the `apply` job wait for a reviewer. So for as long as the approval takes, a deployment record is already open for a deploy that has not happened, and the repo's deployment history shows it. When a reviewer rejects the job, or nobody approves it before GitHub gives up waiting, `settle` ends the record and the row gets a failure line. Nothing went out. When a reviewer approves, `apply` previews the stack again and deploys only when the fresh preview gives the same diff hash as the ticked row. So what goes out is still only what the ticked row showed, however long the approval took, and a change that moved while the job waited stops the deploy like any other. A reviewer who wants to see what they approve reads the row or its preview page: GitHub's approval screen shows the job, not the diff.

The [check](workflow.md#check-your-setup) says, for each job in your workflows that deploys, which of the two decides: the tick rule alone when the job names no environment, or the environment's reviewers if it has them. It reads files only, so whether an environment has required reviewers is a setting of the repo it cannot see, and it says that too.

## The limit that no setting lifts

Anyone with write access to a repo can push a branch with a workflow of their own, and that workflow can read the repo's secrets. So on its own, a tick rule protects against the wrong person ticking by mistake. It does not protect against a collaborator who means harm: they can skip the dashboard and use the credentials directly. No setting of Sluiceway changes that.

What closes that gap is where the credentials live. The three setups below go from what every repo has to what larger plans add. Which plan offers what changes over time, so they are described by the features they need. GitHub's page on [plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans) and its page on [environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) say which plan has which.

### 1. Every repo: the tick decides

Needs nothing. GitHub limits who can edit the dashboard, Sluiceway checks the ticker's live permission, every deploy starts from a tick, or from a merge for a stack you [set to deploy on merge](#what-deploys-without-a-tick), and the hash check deploys only what the row or the scan of the merge showed. A tick is as strong a check as write access to the repo. Tick rules here are guard rails against mistakes.

It fits a single owner, or a small team that trusts its members. The credentials that change things are ordinary repository secrets.

### 2. Where environments exist: lock the credentials in

Needs GitHub Environments with a branch limit, and a protected default branch.

- Store the credentials that change things as secrets of an environment that only the default branch may use. With OIDC, trust the role for that environment only.
- Name it on the job, with `deployment: false` ([with GitHub Environments](workflow.md#with-github-environments)). In the [split workflow](split-workflow.md#with-github-environments), give the stacks that environment in `sluiceway.yaml` and name it on the `apply` job.
- Protect the default branch so that changes need a review.
- In the split workflow, give `scan` credentials that can only read.

A workflow on a side branch can no longer reach the credentials that change things, and nobody can change the workflow, `sluiceway.yaml` or its `tickers` alone, because each of those is a reviewed change on the default branch. Now the tick rules can be relied on.

### 3. Where required reviewers exist: a second person approves

Needs required reviewers on the environment, and the [split workflow](split-workflow.md): in one job, every run would wait for a reviewer, a scan and an edit of any issue too.

Add required reviewers to the environment of setup 2. The ticker asks, and a reviewer approves the waiting `apply` job in GitHub's own interface. This is the answer to "who may deploy" for a team with separation of duties, and the tick rule can stay at its default ([a tick asks, an environment decides](#a-tick-asks-an-environment-decides) has the shape). Sluiceway adds nothing and waits: the row says deploying and the deployment record stays open for as long as the approval takes. A rejected job is ended by `settle`, and the row gets a failure line.

Sluiceway has no second approval of its own, a second person who also ticks, for plans without reviewers. By the limit above it would not be real protection on exactly those repos, because the credentials would still be within reach of anyone with write access.

## The run an issue edit starts

GitHub cannot start a workflow for one issue only, so anyone who can edit an issue of the repo starts a run of [the workflow](workflow.md#the-workflow). On a public repo that is anyone who opens an issue. It is built to be harmless:

- **It runs only code of the default branch.** An `issues` event always runs the workflow and the checkout of the default branch. Nothing from the issue reaches a step, unless a step of yours puts `${{ github.event.issue.* }}` into a script, which no Sluiceway example does.
- **It loads your credentials and uses them for nothing but a tick.** The job loads them before Sluiceway reads the event. When the edited issue is not the dashboard, Sluiceway ends the run with a notice before it reads the dashboard, and the tool never runs. The cost is the runner minute and one load from wherever your credentials live, per edit.
- **It acts as the workflow's own token**, with the permissions of the workflow's block and nothing else. Edits by that token start no workflow, so Sluiceway cannot start itself.
- **Every deploy it starts is a deployment record it created after it checked the ticker.** A deploy runs only on a record that is still open, from its own run. A re-run deploys nothing.

The [split workflow](split-workflow.md) keeps this run smaller: its `resolve` job holds no infrastructure credentials and never runs the tool, and an edit of an ordinary issue starts no runner at all, because of the label check in the job's `if:`. Use it where issue edits are many or come from people you do not know.

## What reaches the issue

- **No value, unless you list its path.** The dashboard shows resource types, resource names and the paths of changed properties (property names, list indexes and map keys), never what a property is set to, whether or not the tool marks it secret. The job summary, the preview pages and the job log's diff follow the same rule.
- **`dashboard.showValues` is the one exception.** A value at a path you list shows as `old → new`, on the dashboard and everywhere the path does. Sluiceway matches only the paths you wrote, never guesses that a value is safe, and never shows a value the tool marks secret. A value you forgot to mark is shown if you list its path, and an issue keeps every value that reached it in its edit history ([configuration](configuration.md#dashboardshowvalues)).
- **A fingerprint of the other values, not the values.** A pending or drifted row carries the value fingerprint of its diff, sixteen hex characters, and so does its deployment record. It names nothing, and [what a tick promises](#what-a-tick-promises) says what it costs and how to turn it off.
- **A cost, when you ask for one.** With [`cost.enabled`](configuration.md#costenabled) a pending row says about how much more or less a month the change costs, an amount and a currency and nothing else: no resource, no price of one, no bill ([record 0105](adr/0105-a-row-shows-what-a-change-costs-and-a-threshold-turns-a-merge-back-to-a-tick.md)).
- **Never the tool's own words.** Error messages, warnings and anything else the tool prints stay in the job log. A failure row says why in a fixed phrase and links to the run.
- **Names, unless you redact.** Resource types, resource names and property paths, map keys included, are in the issue, which is emailed, sent to integrations and indexed on a public repo. `dashboard.redact: true` keeps them out of the issue and leaves the job summary and the preview pages full. It is about reach, not access: anyone who can read the repo can open the run and read the code ([configuration](configuration.md#dashboardredact)).
- **No value in the job log either, unless you ask for one.** `scan.logDiff: true` prints the tool's own diff of every pending stack, values included, in that stack's group of the job log and nowhere else. See [The tool's own diff in the job log](#the-tools-own-diff-in-the-job-log).
- **The job log is yours to protect.** The tool's own messages are printed there as they are, grouped per stack, and an error can quote a value. Sluiceway masks every value of the files the `env-file` input and `stacks[].envFile` name, before anything else, and nothing else: in the job environment it cannot tell a secret from a setting, so GitHub masks what the step that loaded a secret registered ([credentials](credentials.md#an-env-file)). A secret the tool prints in another shape, base64 or with escaped newlines, is not caught by any mask. Logs are only readable by people who can read the repo, and they expire with the run.

## The tool's own diff in the job log

Off by default. With `scan.logDiff: true` in `sluiceway.yaml`, a scan runs the tool a second time for every pending stack and prints what the tool displays, values included, in that stack's group of the job log. `apply` does the same for its fresh preview. Nothing of it reaches the issue, a comment, the summary, the result file, an output, an annotation or a deployment record, and a test holds that ([record 0048](adr/0048-the-tools-own-diff-may-reach-the-job-log-when-a-repo-asks.md)).

Who can read it:

- **In a public repository, anyone.** Job logs of a public repository are public. The scan puts a warning on the run when the setting is on in a public repository. Leave it off there unless every value your programs set may be public.
- **In a private or internal repository, everyone with read access**, people and integrations alike, through the web and the API, until the run's logs expire under the repository's retention setting (90 days unless you changed it).

What masks a secret there is what masks it anywhere in the log: the tool's own `[secret]` for a value it holds as secret, the masks the step that loaded your secrets registered, and the masks Sluiceway registered for the values of the env files. Nothing else. A value nobody marked as secret, such as a password written into a config map or a token a provider returns unmarked, is printed as it is. Sluiceway prints the tool's text with workflow commands stopped, so a value can never turn into an annotation on the run's page.

What the tool prints comes from a second run of the program, next to the one that was hashed. It shows what a tick is about to deploy, and a tick still approves the diff hash, not the text.

## The preview pages

A scan writes one preview page per pending stack: a check run on the scanned commit, named `sluiceway / <stack id>`, with what the summary shows of that stack. Resource types, resource names and property paths, a value only at a path that `dashboard.showValues` lists, and never the tool's own words ([record 0050](adr/0050-a-pending-row-links-to-a-preview-page-a-check-run-with-the-stacks-diff.md)). That rule has one more reason here: the masks your workflow registers only apply to the job log, and a check run never passes through it. So even with `scan.logDiff` on, the tool's diff stays in the job log and the page only says where it is.

Who can read a page: everyone who can read the repository, in the web interface and through the API. In a public repository, anyone, logged in or not. Its name shows in the commit's list of checks and, when the page joined a check suite of a `push`, in a pull request's checks. A page lives as long as the repository's retention setting keeps checks, and goes away earlier when someone deletes the workflow run whose check suite it joined. GitHub has no way to delete a check run on its own.

### What `checks: write` allows

The preview pages need `checks: write` in the workflow's permissions. With it, the token of every job of that workflow can:

- create a check run on any commit of the repository, under any name and with any result, `success` included, from the same source as your CI jobs;
- rewrite the output of any check run that GitHub Actions made, other workflows' jobs included.

It cannot change the result of a job that Actions runs. Sluiceway only ever writes `neutral` check runs named `sluiceway / <stack id>`. But the job that scans also runs your programs, so if your branch protection requires checks, anything that runs in this workflow could write a passing check under a required name. Require checks from a workflow that does not have `checks: write`, or accept that. Without `checks: write` Sluiceway works as before and `preview` opens the run's summary.

## The policies

With [`policies`](configuration.md#policies) in `sluiceway.yaml`, a scan runs conftest over the tool's own preview document of every pending stack ([policies](policies.md)). What that means for what leaves where:

- **The preview document is written to a file only while conftest runs**, in a directory of its own, readable by nobody else, and removed after. It holds every value the tool printed, as the saved plan and the rendered set do. Nothing else of Sluiceway takes it.
- **A policy's message is the one text from outside Sluiceway's code that reaches the issue.** It is your own text, from a `.rego` file on the default branch, reviewed like `dashboard.showValues`. Sluiceway escapes it as text, so it is never markup, and cuts it on the row, but it does not read it: a message that prints a value prints it to the issue. Name what is wrong, not what it is set to.
- **A policy that fails to run does not fail the change.** A runner without conftest, or with one older than 0.50.0, keeps every box and gets a warning on every scan. Install conftest in the job that scans, and read the run's warnings.
- **A tick cannot get around a failed policy.** The row has no box, the marker says why, and `resolve` refuses a tick on such a row whatever the body says. Changing the policy is a change to the default branch, with whatever protection it has.

## Previewing a pull request

Opt in, with `pull-request-preview: true` on the check step ([preview a pull request](workflow.md#preview-a-pull-request-for-its-reviewer)). The check then previews the stacks the pull request claims, as they would be after the merge, with the credentials of its job, and writes a check run per stack on the head commit. It never deploys, never opens a deployment record and leaves no row: the deploy happens after the merge, from a fresh preview, and is refused when the change moved since ([record 0101](adr/0101-a-pull-request-is-previewed-for-its-reviewer-and-never-deployed-from.md)).

- **A pull request from a fork is refused outright, and Sluiceway never relies on GitHub withholding secrets from a fork's run.** The refusal is decided from the event before any request is made.
- **`pull_request_target` is never used, because it hands the secrets of the base branch to code that is not merged.**
- **Give the job credentials that can read, not ones that can change things.** A preview runs the repo's own program, which for Pulumi and CDK for Terraform is arbitrary code from the branch, with whatever the job loaded. Read access to the state backend and the cloud is what a preview needs.
- **What reaches the page** is what a scan's preview page holds: names and paths, a value only at a listed path, never the tool's own words ([the preview pages](#the-preview-pages)). The tool's words go to the job log, which on a public repository is public.
- **`checks: write`** on this workflow allows what it [allows](#what-checks-write-allows) on the workflow that deploys.

## What Sluiceway sends

Calls to the GitHub API, and whatever your tool makes on its own. No telemetry and no server. With [`cost.enabled`](configuration.md#costenabled) the Infracost CLI, which your workflow installs, sends the resource types, regions and quantities of each pending change of an OpenTofu or Terraform stack to its pricing API to price them, never a value or a credential, and reports the counts of its own run there; Sluiceway turns its upload to Infracost Cloud off, and nothing is sent unless the key is on ([record 0105](adr/0105-a-row-shows-what-a-change-costs-and-a-threshold-turns-a-merge-back-to-a-tick.md)). When a step names a notification channel, Sluiceway also posts a short message there: to the Slack webhook, the Telegram bot API or the webhook address the step gives, from your own secrets, and nowhere else. The message holds stack ids and links, never a value ([notifications](notifications.md)). The header image is loaded by the reader's browser from this repository, at the exact tag or commit of the action that wrote it. `dashboard.personality: false` removes it.
