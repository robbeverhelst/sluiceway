# Security

What a tick protects, what it does not, and how to make it stronger with what your GitHub plan offers. To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## What a tick promises

A tick is a request to deploy one stack exactly as its row shows it. Before anything deploys, Sluiceway checks who ticked, previews the stack again, and deploys only when the fresh preview gives the same **diff hash** as the row that was ticked. The hash covers every change of the diff: the address of each resource, what happens to it (create, update, replace, delete, import and so on), and the names of the properties that change.

It does not cover **values**, except the ones a row shows. Without [`dashboard.showValues`](configuration.md#dashboardshowvalues) Sluiceway never shows a value, so it never hashes one either: a tick approves what a person could see. A value at a listed path is shown and hashed, so a tick approves it, and a merge that moves it after the tick stops the deploy. That leaves one gap, and it is deliberate. Someone ticks a row that says `web: update, image`. Before the deploy starts, another merge changes the image from `v2` to `v3`. The same resource changes the same property, the hash is the same, and `v3` goes out.

So a tick means "change these properties on these resources, at whatever value the code has when the deploy runs", for every property whose value the row does not show. Two things bound it:

- **What went out is traceable.** The deployment record of every deploy names the commit that was deployed.
- **Anything else that moved stops the deploy.** A new resource, a delete, a replace or a different property gives a different hash. The deploy stops, nothing changes, and the row comes back with the fresh diff and a line that says the change moved since the tick.
- **For OpenTofu, the deploy is the plan that was checked.** `apply` saves the plan of its fresh preview, checks that plan's hash, and deploys that plan file and nothing else. Nothing can slip in between the check and the deploy, and the tool itself refuses the plan when the state changed since (record 0053). The gap above, between the tick and that fresh preview, stays.
- **For Helm, the deploy is what the fresh preview rendered.** Helm saves no plan, so `apply` renders the chart in its fresh preview and once more right before `helm upgrade`, and deploys only when both are the same. The digest of the render stays in memory in the `apply` job and is never written anywhere (record 0058). A render that moved ends like any moved change: nothing goes out.
- **For Kubernetes manifests, the deploy is the rendered set that was checked.** `apply` renders the stack once, diffs that set, checks its hash, and applies that same file, after checking that it still holds the bytes that were diffed (record 0060). The digest of the set stays inside the job. The gap between the tick and the fresh preview stays here too.
- **Drift is approved as shown too.** On a row that shows drift, the hash covers the drift as well: which resources changed outside the code or are gone, and the property paths the tool names. `apply` checks the drift again before it compares, and deploys with the tool's refresh so the drift is put back. Drift that moved after the tick stops the deploy like a moved change ([record 0055](adr/0055-drift-is-checked-by-a-scheduled-scan-shown-on-the-stacks-row-and-repaired-by-a-tick.md)). On Helm 4 the repair of a release applied server-side forces conflicts, so the deploy takes back a field another field manager changed. Without drift on the approved row it never does ([record 0069](adr/0069-helm-drift-is-the-three-way-diff-beyond-the-plain-one-and-the-deploy-flags-follow-helm.md)).

Hashing values or their digests was rejected: a digest would sit in an issue that may be public, where a short value that nobody marked secret can be guessed offline. Hashing the commit was rejected too: on a busy repo every merge would void every tick.

The diff hash is not a secret and not a signature. Someone who edits it by hand can only approve what a fresh preview shows anyway.

## Who can tick

Two checks, against GitHub's live answer, at every tick:

1. **The ticker has write access to the repo.** Always, whatever the rule.
2. **The ticker meets the stack's tick rule**, the `tickers` key of [`sluiceway.yaml`](configuration.md#tickers): a level (`write`, `maintain`, `admin`) or a list of usernames. A rule narrows who may tick and never widens it.

The ticker is the person whose edit ticked the box, as the issue's edit history names them. Only a person can tick: a tick by a bot, an app or a deleted account deploys nothing and the next scan clears it. When the history cannot name the person, for example because an entry was deleted, nothing deploys and the box is cleared. When GitHub gives no answer about a person's access, nothing deploys and the job goes red. Nothing is cached: a person whose access was removed is refused at their next tick.

## The limit that no setting lifts

Anyone with write access to a repo can push a branch with a workflow of their own, and that workflow can read the repo's secrets. So on its own, a tick rule protects against the wrong person ticking by mistake. It does not protect against a collaborator who means harm: they can skip the dashboard and use the credentials directly. That is true of every tool that deploys from GitHub Actions, and Sluiceway says it plainly rather than promise more.

What closes that gap is where the credentials live. The three setups below go from what every repo has to what larger plans add. Which plan offers what changes over time, so they are described by the features they need. GitHub's page on [plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans) and its page on [environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) say which plan has which.

### 1. Every repo: the tick is the gate

Needs nothing. GitHub limits who can edit the dashboard, Sluiceway checks the ticker's live permission, every deploy starts from a tick, and the hash check deploys only what the row showed. It is a real gate, exactly as strong as write access to the repo. Tick rules here are guard rails against mistakes.

It fits a single owner, or a small team that trusts its members. The credentials that change things are ordinary repository secrets.

### 2. Where environments exist: lock the credentials in

Needs GitHub Environments with a branch limit, and a protected default branch.

- Store the credentials that change things as secrets of an environment that only the default branch may use. With OIDC, trust the role for that environment only.
- Give the stacks that environment in `sluiceway.yaml` and name it on the `apply` job, with `deployment: false` ([with GitHub Environments](workflow.md#with-github-environments)).
- Protect the default branch so that changes need a review.
- Give `scan` credentials that can only read.

A workflow on a side branch can no longer reach the credentials that change things, and nobody can change the workflow, `sluiceway.yaml` or its `tickers` alone, because each of those is a reviewed change on the default branch. Now the tick rules can be relied on.

### 3. Where required reviewers exist: a second person approves

Needs required reviewers on the environment.

Add required reviewers to the environment of setup 2. The ticker asks, and a reviewer approves the waiting `apply` job in GitHub's own interface. Sluiceway adds nothing and waits: the row says deploying and the deployment record stays open for as long as the approval takes. A rejected job is ended by `settle`, and the row gets a failure line.

Sluiceway has no second approval of its own, a second person who also ticks, for plans without reviewers. By the limit above it would not be real protection on exactly those repos, because the credentials would still be within reach of anyone with write access.

## The job an issue edit starts

Anyone who can edit the dashboard can start the `resolve` job. It is built to be harmless:

- **It holds no infrastructure credentials and never runs the tool.** Only `scan` and `apply` load credentials ([credentials](credentials.md)).
- **It acts as the workflow's own token**, with the permissions of the workflow's block and nothing else. Edits by that token start no workflow, so Sluiceway cannot start itself.
- **Every deploy it hands on is a deployment record it created after it checked the ticker.** `apply` deploys only a record that is still open, from its own run. A re-run deploys nothing.
- **An edit of an ordinary issue does not start a runner**, because of the label check in the job's `if:`.

## What reaches the issue

- **No value, unless you list its path.** The dashboard shows resource types, resource names and the paths of changed properties (property names, list indexes and map keys), never what a property is set to, whether or not the tool marks it secret. The job summary, the preview pages and the job log's diff follow the same rule.
- **`dashboard.showValues` is the one exception.** A value at a path you list shows as `old → new`, on the dashboard and everywhere the path does. Sluiceway matches only the paths you wrote, never guesses that a value is safe, and never shows a value the tool marks secret. A value you forgot to mark is shown if you list its path, and an issue keeps every value that reached it in its edit history ([configuration](configuration.md#dashboardshowvalues)).
- **Never the tool's own words.** Error messages, warnings and anything else the tool prints stay in the job log. A failure row says why in a fixed phrase and links to the run.
- **Names, unless you redact.** Resource types, resource names and property paths, map keys included, are in the issue, which is emailed, sent to integrations and indexed on a public repo. `dashboard.redact: true` keeps them out of the issue and leaves the job summary and the preview pages full. It is about reach, not access: anyone who can read the repo can open the run and read the code ([configuration](configuration.md#dashboardredact)).
- **No value in the job log either, unless you ask for one.** `scan.logDiff: true` prints the tool's own diff of every pending stack, values included, in that stack's group of the job log and nowhere else. See [The tool's own diff in the job log](#the-tools-own-diff-in-the-job-log).
- **The job log is yours to protect.** The tool's own messages are printed there as they are, grouped per stack, and an error can quote a value. Sluiceway adds no mask of its own: GitHub masks what the step that loaded a secret registered, and nothing else. A secret the tool prints in another shape, base64 or with escaped newlines, is not caught by any mask. Logs are only readable by people who can read the repo, and they expire with the run.

## The tool's own diff in the job log

Off by default. With `scan.logDiff: true` in `sluiceway.yaml`, a scan runs the tool a second time for every pending stack and prints what the tool displays, values included, in that stack's group of the job log. `apply` does the same for its fresh preview. Nothing of it reaches the issue, a comment, the summary, the result file, an output, an annotation or a deployment record, and a test holds that ([record 0048](adr/0048-the-tools-own-diff-may-reach-the-job-log-when-a-repo-asks.md)).

Who can read it:

- **In a public repository, anyone.** Job logs of a public repository are public. The scan puts a warning on the run when the setting is on in a public repository. Leave it off there unless every value your programs set may be public.
- **In a private or internal repository, everyone with read access**, people and integrations alike, through the web and the API, until the run's logs expire under the repository's retention setting (90 days unless you changed it).

What masks a secret there is what masks it anywhere in the log: the tool's own `[secret]` for a value it holds as secret, and the masks the step that loaded your secrets registered. Nothing else. A value nobody marked as secret, such as a password written into a config map or a token a provider returns unmarked, is printed as it is. Sluiceway prints the tool's text with workflow commands stopped, so a value can never turn into an annotation on the run's page.

What the tool prints comes from a second run of the program, next to the one that was hashed. It shows what a tick is about to deploy, and a tick still approves the diff hash, not the text.

## The preview pages

A scan writes one preview page per pending stack: a check run on the scanned commit, named `sluiceway / <stack id>`, with what the summary shows of that stack. Resource types, resource names and property paths, a value only at a path that `dashboard.showValues` lists, and never the tool's own words ([record 0050](adr/0050-a-pending-row-links-to-a-preview-page-a-check-run-with-the-stacks-diff.md)). That rule has one more reason here: the masks your workflow registers only apply to the job log, and a check run never passes through it. So even with `scan.logDiff` on, the tool's diff stays in the job log and the page only says where it is.

Who can read a page: everyone who can read the repository, in the web interface and through the API. In a public repository, anyone, logged in or not. Its name shows in the commit's list of checks and, when the page joined a check suite of a `push`, in a pull request's checks. A page lives as long as the repository's retention setting keeps checks, and goes away earlier when someone deletes the workflow run whose check suite it joined. GitHub has no way to delete a check run on its own.

### What `checks: write` allows

The preview pages need `checks: write` in the workflow's permissions. With it, the token of every job of that workflow can:

- create a check run on any commit of the repository, under any name and with any result, `success` included, from the same source as your CI jobs;
- rewrite the output of any check run that GitHub Actions made, other workflows' jobs included.

It cannot change the result of a job that Actions runs. Sluiceway only ever writes `neutral` check runs named `sluiceway / <stack id>`. But the scan job also runs your programs, so if your branch protection requires checks, anything that runs in this workflow could write a passing check under a required name. Require checks from a workflow that does not have `checks: write`, or accept that. Without `checks: write` Sluiceway works as before and `preview` opens the run's summary.

## What Sluiceway sends

Nothing but calls to the GitHub API, and whatever your tool makes on its own. No telemetry, no notifications, no server. The header image is loaded by the reader's browser from this repository, at the exact tag or commit of the action that wrote it. `dashboard.personality: false` removes it.
