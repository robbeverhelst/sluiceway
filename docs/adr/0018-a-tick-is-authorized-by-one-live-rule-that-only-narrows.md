# A tick is authorized by one live rule that only narrows, and only a person can tick

> Amended by 0025: the ticker is no longer the `sender` of an event. It is the editor of the edit that made the tick, read from the issue's edit history. Where this record says sender, read that editor. What is checked does not change.
>
> Amended by 0051: `apply` also writes one comment that mentions the ticker, when a change moved since the tick.
>
> Amended by 0054: a tick on an update waiting to merge is judged by the tick rule of the stack its pull request belongs to. A refused or failed merge shares the one comment.

Record 0005 fixed who is checked: the ticker, the `sender` of the tick's own event. This record fixes what is checked. Every tick passes the same two-part test, at the moment `resolve` handles it, against GitHub's live answer: the ticker is a person with write access to the repo, and the ticker meets the stack's tick rule.

A tick rule is one of the levels `write`, `maintain` or `admin`, or a list of usernames. The default is `write`. In `sluiceway.yaml` the key is `tickers`, once at the top as the default for every stack and optionally on a stack's entry. The brief called it `approvers`. That word is avoided, because the ticker is not an approver, and where GitHub's required reviewers exist there is a real approver who is someone else (0020).

A list narrows and never widens. A person on a list still needs write access. Letting a list grant access on its own was rejected: a typo, or a collaborator who was removed from the repo but not from the file, would keep deploy rights that the repo no longer gives.

Only a person can tick. `resolve` ignores a tick whose sender is not of type `User`, or is GitHub's `ghost` placeholder, which GitHub's docs warn against trusting. Letting a bot tick, for unattended deploys of chosen stacks, was rejected for v1: nothing deploys without a named ticker (0005), and the same rule is the loop guard if a setup ever lets the bot's own edits start `resolve`. Unattended deploys, if they come, get a real entry point where GitHub records who or what started it, not a bot editing markdown.

Teams are not supported in v1. The workflow token cannot read team membership (0017). Supporting teams means a second, long-lived token with organization access, stored for the `resolve` job, which is the one job that an issue edit can start. That breaks promises 1 and 4 of 0014. Most of the need is met already: the permission lookup counts access granted through teams, so a team can be given the `maintain` or `admin` role on the repo and the stacks set to that level.

## Consequences

- The lookup is `GET /repos/{owner}/{repo}/collaborators/{username}/permission`, which the behavior test showed working under the minimal `permissions:` block. The levels are read from the `push`, `maintain` and `admin` booleans, so custom organization roles need no special handling. A repo on a personal account has only two levels: the owner is `admin` and every collaborator is `write`.
- Nothing is cached. A person whose access was removed fails at their next tick.
- The rule in force is the one in `sluiceway.yaml` on the default branch, because `issues` events always run the default branch's workflow and checkout.
- Usernames are compared without regard to case. A renamed account no longer matches its list entry and is refused, which is the safe side.
- A list entry that contains a slash (`org/team`) is reserved for teams. In v1 config loading fails with a message that says teams are not supported yet and to use a level or usernames. It is never ignored, because ignoring it would change who can deploy.
- No level below `write` exists. People with read or triage access cannot edit a bot-authored issue at all, so such a level would promise something it cannot do. That GitHub rule is inferred from its roles table and was not tested with a read-only account, which is why the write check is always made by Sluiceway itself and never left to GitHub.
- Authorization is judged on the stack id in the ticked row's marker. A hand-edited marker that points at another stack is judged by that stack's rule and deploys that stack, if the hash still matches a fresh preview.
- A refused tick creates no deployment record, because it never became a deploy attempt. The box is cleared through the normal row swap (0004) and the row is otherwise unchanged. The refusal is about a person, not about the stack.
- Sluiceway writes one comment on the dashboard that mentions the ticker, names the stack and states the rule, in plain words with no personality. A comment was chosen over a note on the row because the mention reaches the right person and the comment stays as a dated trace of who tried. A row note is gone at the next scan. The bot's comment starts no workflow (0017).
- The job stays green after a refused tick. Sluiceway did its work. This follows the rule of 0012: red means Sluiceway itself failed.
- When the lookup itself fails, Sluiceway fails closed: nothing deploys, the box is cleared, the comment says the permission could not be verified and asks for a fresh tick, and the job goes red. A clean answer that the person is not a collaborator is a refusal, not a failure.
- A tick from a bot or from `ghost` gets no comment and no row swap. The next scan clears it as an orphan tick with the usual note (0005).
- An edit through the API can tick several boxes at once. Each tick is judged on its own. The allowed ones deploy, and the refused ones share one comment.
- The rescan box needs only the first half of the test: a person with write access. A scan previews and changes nothing, so there is no rule to configure.
- Teams can be added later without a breaking change: the slash syntax is already reserved, and the token they need would be a new optional input.

## Settled while building (slice 2.3)

- The lookup was probed on real GitHub on 2026-09-21. An account that exists always gets a 200, collaborator or not: `permission` is `read` on a public repo and `none` on a private one, and `push`, `maintain` and `admin` are all false. That is the clean answer that is a refusal. An admin has all three booleans true, on an organization repo and on a personal one, so the level `maintain` is the `maintain` boolean alone. A login GitHub does not know gets a 404 with `<login> is not a user`.
- Every lookup that does not give the three booleans is a failed lookup and fails closed: an error status, the 404 for an unknown login, and an answer without `user.permissions`. The 404 can only mean an account that was renamed or deleted between the tick and the run. It gives a red job and a comment that asks for a fresh tick, which is the safe side.
- Write access is the `push` boolean, and it is checked first, whatever the rule. So a person on a list without write access is told that ticking needs write access, not that the list is wrong.
- A person is `type` `User` with a login that is not empty and is not `ghost` in any case of the letters. Every other type (`Bot`, `Organization`, `Mannequin`, `EnterpriseUserAccount`) is not a person. A tick by one of them costs no lookup.
- A person is looked up once per `resolve` run, however many boxes they ticked, and a failed lookup is not tried again in that run. "Nothing is cached" is about what lasts between runs, and nothing does.
- A run writes one comment for all of its ticks that started nothing, refused and unverified together, in the order of the rows. For one tick it is a sentence. For several it is a line that says nothing was started and one list item per tick. Each item mentions the ticker, names the stack in bold the way a row does, and states the rule: the level, or the people a list names, as plain logins that notify no one.
- A refused tick of the rescan box is a refused tick like any other: the box is cleared and the comment names the rescan box.
- The rule and the words are pure (`src/core/tick-rule.ts`, `src/render/refused-ticks.ts`). `src/github/ticks.ts` makes the lookups and writes the comment, and hands `resolve` one outcome per tick: `allowed`, `refused`, `unverified` or `not-a-person`. Clearing the boxes, creating records and the red job belong to `resolve` (slice 2.4).

## Settled while building (slice 2.4)

- The body write comes before the comment. The comment says the box is cleared, so it is written only once that is true. When the body write fails, no comment is written, the box stays ticked, and the next `resolve` run refuses the tick again and says so then. When the comment fails after the body write, the job goes red with GitHub's words and the person finds a cleared box. A fresh tick gets them the comment.
- An unverified tick turns the job red after everything else is done: the verified ticks of the same run are started, handed on and shown first (0035).
- A refused tick is cleared without a note on the row. The comment is the message, as this record says. The note that asks for a fresh tick is for the ticks nobody can be told about (0025) and for the ticks beyond the cap (0035).

Research:
- https://github.com/sluiceway/sluiceway/blob/research/github-actions-behaviors/docs/research/github-actions-behaviors.md
- Observed payloads: https://github.com/sluiceway/sluiceway/issues/17

## Settled while building (slice 5.9)

- A failed permission lookup is tried once more in the same `resolve` run, after a pause of one second, and only a second failure makes the tick unverified. A lookup fails rarely and mostly for a moment, and one retry keeps the job that an issue edit starts short. A person is still looked up once per run when the first try answers.
- GitHub answers the lookup of a login it has no account for with 404 and the words `<login> is not a user` (seen on 2026-09-21). That one answer is read, by its status and those words, as "no account by that name any more", as after a rename or a delete since the tick. The tick is refused, not unverified: the box is cleared, the comment says the account is gone and asks for a tick from the account the person uses now, and the job stays green. Any other 404 or failure is still a failed lookup. The port gives nothing for such a login, and the fake has `removeAccount` for it.
- A refusal comment names at most ten people of a list rule, then says how many more `sluiceway.yaml` names: `user1, ..., user10 and 2 more in sluiceway.yaml`. A list of ten or fewer is named in full as before.
