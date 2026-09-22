# An update may be previewed on its branch, claimed by several stacks, and merged with presets from other repos

Records 0054 and 0064 built merge and deploy, parts 1 and 2. They left four things in `docs/later.md` that build plan slice 5.4 brings in, so the Renovate flow is complete: a preview of the pull request's branch on its row, a pull request that two stacks claim, more than 30 updates waiting to merge, and Renovate presets that live outside the repo.

## Decision

### A branch preview, opt-in

- **`mergeAndDeploy.preview: true`** turns it on. It is off by default, because it costs one run of the tool per stack of each listed update on every scan that lists them.
- **It previews the merge, not the branch alone.** The scan copies its checkout, without `.git`, into the runner's temporary directory, and writes into the copy each file the pull request changes as it is at the head commit that the row names, read through the GitHub API (`GET /repos/{owner}/{repo}/contents/{path}?ref=<head>`, raw). A file that is not there at the head commit is deleted in the copy. Then it runs the preparation and the preview of each of the pull request's stacks in the copy, and removes the copy. A branch checked out as it is would undo every change the default branch got since the branch was cut. The copy with the pull request's files on top is what the merge gives, as long as the default branch did not touch those same files, and then GitHub reports a conflict and the pull request is not listed.
- **A path that leads out of the copy through a link is never written**, and the preview of that update fails.
- **Only the oldest 30 updates are previewed.** They are the ones every dashboard lists. A preview for more would be a run of the tool per update on every scan.
- **A pull request whose branch lives in a fork is never previewed.** The preview runs the pull request's code in the scan job, with its credentials. The authors on the list are trusted with that by the person who wrote the list, the way the scan after the merge runs the merged code. A fork's code is the classic way to reach a workflow's secrets, whoever the author is.
- **The row shows counts, and nothing else.** After the pull request and its author: `preview after the merge: 1 update, **1 replace**`, `no changes`, or `failed, the job log says why`, and for several stacks the counts per stack id. No paths and no values: the row stays one line, and a note under it keeps its meaning (0064). The job log has a line per preview and the tool's own words when it failed. No value is ever asked for, whatever `dashboard.showValues` says.
- **The preview approves nothing.** The tick still merges the head commit the row showed (0054), and what deploys is the diff that the scan after the merge previews and `apply` checks by its hash (0008). A hash of the branch preview on the marker, checked after the merge, was considered and left out: the default branch moves between the two previews all the time, so it would refuse most merges for a change that has nothing to do with the update, and it would need a new payload key.
- A preview that fails never fails the scan and never counts toward "every preview failed" (0012).

### A pull request that several stacks claim qualifies

- **It qualifies with every stack that claims its files**, in code unit order. Record 0054 refused it: one tick would approve a stack nobody looked at. The owner's plan for slice 5.4 brings it in, and three things keep it narrow: the row names every stack in bold, the ticker needs the tick rule of every one of them, and with the branch preview the row shows the counts of each.
- **The marker lists the stacks** in its `stack` key, as `depends-on` lists ids (0059): `stack="apps/odoo:prod,apps/api:prod"`, each id escaped for the comma and the percent sign. One stack is written as before, byte for byte. A parser of 0.14.0 reads the list as one id that no stack has, so an older `resolve` leaves the tick alone and merges nothing.
- **The tick is judged once per stack**, by that stack's rule, with one permission lookup for the ticker. It merges only when every stack allows it. A refusal names the stack whose rule refused.
- **Nothing is merged while any of its stacks has an open deployment**, or depends on a stack with a change waiting or deploying (0054, 0056).
- **A pull request whose stacks depend on each other does not qualify**, directly or through stacks in between. The merged change deploys outside the layers of 0056, so one tick would deploy a stack and the stack it waits on side by side. The scan judges it by the `dependsOn` and `phases` of `sluiceway.yaml`, and `resolve` again with the stacks the rows read from stack references (0059) too.
- **A merge opens one merge record per stack** on the merge commit, each with the ticker and the pull request (0054). The scan after the merge hands each one on by itself, as it already does per stack.

### More than 30 updates waiting to merge

- **Every update that qualifies is listed**, from the open pull requests the scan reads (the oldest 1,000, 0064), oldest first, folded after the first 10.
- **The oldest 30 are always listed.** Past those, the size budget decides: the newer updates are the first thing it drops, newest first, before a spinner goes and before any row of a stack is shortened (0028, 0063). They only offer a merge, and they come back as the older ones merge. The job log counts the updates the body had no room for.
- A writer that only swaps rows carries the lines as they are and aims at the hard limit (0028), as before.

### Renovate presets outside the repo

- **A preset of another GitHub repo is read through the GitHub API**: `github>owner/repo`, `local>owner/repo` and a bare `owner/repo`, with `:name`, `:file/preset` or `//path/name`, as record 0064 reads them in this repo. So is one at a tag (`#v1`), this repo's too, at that tag. Without a tag, another repo's preset is read from its default branch. `default` is `default.json` with Renovate's fall back to `renovate.json`, as before.
- **The workflow token reads this repo and public repos.** A private preset repo answers "not found" to it, as to any stranger, and the preset is named in the job log as not read. A preset that is not there is named the same way. No second token is asked for (0014).
- **Presets inside those presets are followed** the same way, up to 10 deep, and a loop is read once. A later preset still wins over an earlier one, and the file's own key wins over all of them.
- **Still not read**: a preset from npm or a web address, and one from another platform (`gitlab>`, `bitbucket>`), because each would be a network call that is not GitHub's (build plan, "Ask the owner before"); a preset with parameters, which needs Renovate's templating; a relative one; and `packageRules`.

## Consequences

- The port gets one call, `readRepositoryFile`, for a file of a GitHub repo at a ref. `resolve` uses it for presets outside the checkout, and the scan for the files of an update it previews. The fake GitHub serves files seeded per repo and ref, one request each.
- An open pull request carries `fromFork`, from GraphQL's `isCrossRepository`, in the same query.
- The scan job needs no new permission: `contents: read` reads the files, and the preview uses the credentials the scan already has.
- The branch preview uses disk for one copy of the checkout at a time, `node_modules` included. It is removed after each update.
- A file is written into the copy as text. A binary file that a pull request changes is not previewed correctly. Renovate's updates change text files.
- Still on `docs/later.md`: a branch preview for updates past the oldest 30, one carried over by a narrowed scan, presets from npm or a web address, and reading past the oldest 1,000 open pull requests.
- This amends 0054 (two stacks, the one-line row now may show a preview, presets of other repos) and 0064 (the 30 updates, the presets that are read).
