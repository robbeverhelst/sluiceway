# Deploys outside Sluiceway are legal and not detected

> Amended by 0073: a full scan reads the tool's own history where the tool keeps one (Pulumi) and lists deploys made outside the dashboard on the trail, with when and from which commit, never who. They stay legal, Sluiceway still writes no lock and no marker, and OpenTofu, Helm and kubectl stacks are not read.

A repo that adopts Sluiceway keeps its own way to run the tool: a laptop, a script, another pipeline. It has to, because Sluiceway only previews and deploys, and destroy, refresh and state repair happen elsewhere (0015). So for every stack Sluiceway is one of several ways to deploy. It never claims to be the only one. It writes no lock, puts no "managed by" marker in the tool's state and does not look for outside deploys.

This costs nothing in safety, because the design already recovers. The dashboard is a view and every deploy previews again first (0008). An outside deploy of a pending stack leaves a stale pending row, since no file changed and a narrowed scan has no reason to look (0010). The next full scan or the rescan box corrects it. A tick on the stale row previews, finds a different hash, deploys nothing and re-renders the row. A tick that runs at the same moment as an outside deploy loses or wins the tool's own state lock, and the loser fails cleanly, as a failure line if it was Sluiceway's.

Reading the tool's own history to find outside deploys (`pulumi stack history`) was rejected. It is one more backend call per stack per scan and a new adapter method, OpenTofu has nothing like it, and all it would improve is the list of commits on a row.

## Consequences

- An outside deploy has no deployment record, so it does not appear under recently deployed.
- Attribution of pending changes counts from the last successful Sluiceway deployment record, so after an outside deploy a later pending row can list commits that are already live. The list is too long but never misses the commit that matters. It explains a pending row and never decides that a row is pending. The preview does that. How attribution works is decided separately and takes this as given.
- A team that wants Sluiceway to be the only way in removes the credentials from every other place. That is access control in their secret manager and cloud, not a Sluiceway feature.
- The docs page of 0013 has a short part on running Sluiceway next to your own tooling: after a deploy from somewhere else, tick rescan or wait for the scheduled scan.

## Note, 2026-09-21

The rejection of reading the tool's history weighed only one benefit, shorter commit lists on a row. The owner has since asked for a second one: an audit log that also lists deploys made outside the dashboard. That is wanted after v1 and is listed in `docs/later.md` as deferred, not rejected. Everything else in this record stands: outside deploys stay legal, Sluiceway writes no lock and no marker, and v1 does not look for them.
