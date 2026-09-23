# The tick is always a gate, and GitHub Environments make it a stronger one

> Amended by 0093: an environment with required reviewers on the job that deploys is what decides who may deploy, and the tick rule decides who may ask. The docs present setup 3 so, with the shape, what each gate can and cannot do, and the open record while the deploy waits for a reviewer.

The brief says GitHub Environments are the real approval gate and the checkbox is only the trigger. That is false for many users. Required reviewers exist on public repos and on private repos with an Enterprise plan. Private repos on smaller paid plans get environments and environment secrets without reviewers, and private repos on the Free plan get no environments at all. For all of those, the tick and its permission check are the whole gate, and a security story that points at a feature they do not have is worse than none. The line is replaced by: the tick is always a gate, and GitHub Environments make it a stronger one where your plan has them.

The docs also state a limit that no Sluiceway setting can lift. Anyone with write access to a repo can push a branch with a workflow of their own that reads the repo's secrets. So a tick rule protects against the wrong person ticking. On its own it does not protect against a collaborator who means harm. The security page describes three setups and says plainly what each one gives.

1. **Every repo: the tick is the gate.** It is a real one. GitHub limits who can edit the dashboard, Sluiceway checks the ticker's live permission (0018), every deploy starts from a tick (0019), and the hash check deploys only what the row showed (0008). It is exactly as strong as write access to the repo. Tick rules here are guard rails against mistakes. This fits a single owner or a small team that trusts its members.
2. **Where environments exist: lock the credentials in.** The credentials that can change things are stored as secrets of an environment that is limited to the default branch, and the default branch is protected so that changes need review. A workflow on a side branch can no longer reach the credentials, and nobody can change `tickers` or the workflow alone. Now the tick rules can be relied on. This is the setup 0014 already recommends.
3. **Where required reviewers exist: a second person approves.** The ticker asks, and a reviewer approves in GitHub's own interface. Sluiceway adds nothing and waits. An open deployment stays open for as long as that takes (0003).

Sluiceway does not build its own second approval, a second person who also has to tick, for users whose plan has no reviewers. It would need half-approvals stored somewhere, a second identity check and a new row state, to rebuild what GitHub sells. And by the limit above it would not be real protection on exactly the repos that lack reviewers, because the credentials would still be within reach of anyone with write access.

## Consequences

- The README and the security page never call the tick "only a trigger" and never promise more than write-level protection without setup 2.
- Which plan offers what changes over time. The docs describe the three setups by what they need (environments, branch limits, required reviewers) and link to GitHub's own page for the plans, instead of copying a plan table that will go stale.
- The job-level `environment:` key stays optional, as 0003 decided. Setups 2 and 3 are the reason to use it. Setup 1 works without it, and the deployment record does not depend on the feature.
- Setup 2 has a second effect worth saying in the docs: with a protected default branch, a change to `tickers` is itself a reviewed change.
- The first real user, a private repo on a personal account, is setup 1. The acceptance test proves the gate that every user has, not the strongest one.
- A built-in second approval is out of scope. If it ever comes back, it comes back as its own effort and has to answer the limit above first.

Research: https://github.com/sluiceway/sluiceway/blob/research/github-actions-behaviors/docs/research/github-actions-behaviors.md
