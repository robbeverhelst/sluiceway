# Security

What a tick protects, what it does not, and how to make it stronger with what your GitHub plan offers. To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## What a tick promises

A tick is a request to deploy one stack exactly as its row shows it. Before anything deploys, Sluiceway checks who ticked, previews the stack again, and deploys only when the fresh preview gives the same **diff hash** as the row that was ticked. The hash covers every change of the diff: the address of each resource, what happens to it (create, update, replace, delete, import and so on), and the names of the properties that change.

It does not cover **values**. Sluiceway never shows a value, so it never hashes one either: a tick approves what a person could see. That leaves one gap, and it is deliberate. Someone ticks a row that says `web: update, image`. Before the deploy starts, another merge changes the image from `v2` to `v3`. The same resource changes the same property, the hash is the same, and `v3` goes out.

So a tick means "change these properties on these resources, at whatever value the code has when the deploy runs". Two things bound it:

- **What went out is traceable.** The deployment record of every deploy names the commit that was deployed.
- **Anything else that moved stops the deploy.** A new resource, a delete, a replace or a different property gives a different hash. The deploy stops, nothing changes, and the row comes back with the fresh diff and a line that says the change moved since the tick.

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
- Give the stacks that environment in `sluiceway.yaml` and name it on the `apply` job, with `deployment: false` ([README](../README.md#with-github-environments)).
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

- **Never a value.** The dashboard shows resource types, resource names and the paths of changed properties (property names, list indexes and map keys), never what a property is set to, whether or not the tool marks it secret. The job summary and the job log's diff follow the same rule.
- **Never the tool's own words.** Error messages, warnings and anything else the tool prints stay in the job log. A failure row says why in a fixed phrase and links to the run.
- **Names, unless you redact.** Resource types, resource names and property paths, map keys included, are in the issue, which is emailed, sent to integrations and indexed on a public repo. `dashboard.redact: true` keeps them out of the issue and leaves the job summary full. It is about reach, not access: anyone who can read the repo can open the run and read the code ([configuration](configuration.md#dashboardredact)).
- **The job log is yours to protect.** The tool's own messages are printed there as they are, grouped per stack, and an error can quote a value. Sluiceway adds no mask of its own: GitHub masks what the step that loaded a secret registered, and nothing else. A secret the tool prints in another shape, base64 or with escaped newlines, is not caught by any mask. Logs are only readable by people who can read the repo, and they expire with the run.

## What Sluiceway sends

Nothing but calls to the GitHub API, and whatever your tool makes on its own. No telemetry, no notifications, no server. The header image is loaded by the reader's browser from this repository, at the exact tag or commit of the action that wrote it. `dashboard.personality: false` removes it.
