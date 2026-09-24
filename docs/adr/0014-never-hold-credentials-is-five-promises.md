# "Never hold credentials" is five promises that can be checked

> Amended by 0100: promise 2 now reads that no Sluiceway code reads a credential variable of the job environment, and that the one file Sluiceway reads is the one the `env-file` input names, every line of it the same way, for the tool, with every value masked first. Promise 1 gains that the input carries a path and never a value, promise 3 covers the file's values, and promise 4 gains that `resolve` and `settle` never open the file.
>
> Amended by 0078: promise 1 allows the opt-in notification channels (a Slack webhook address, a Telegram bot token and chat id, a webhook address) as inputs, from the repo's own secrets. They are credentials of the user's messaging, never of their infrastructure. Promise 3 gains the calls to those channels.
>
> Amended by 0077: in the one-step workflow one job previews and deploys, so the job an issue edit starts loads the credentials. Promise 4 still holds of the modes, and the gain named below holds of the split workflow only.

The brief says Sluiceway never holds credentials and only passes env through. With 0013 the secrets sit in the environment of the same job, so the action's process could read them. Read as "Sluiceway cannot see them", the principle is false, and a reader would trust a protection that is not there. It is restated as five promises that a reviewer can check against the code and the example workflow.

1. **No credential inputs.** The action takes one secret, the GitHub token. No input and no config key ever carries a cloud, backend or secret manager credential.
2. **Never read by name.** No Sluiceway code reads a credential variable. The environment goes to the tool as one opaque block (0013).
3. **Never stored, never sent.** Nothing from the environment reaches the issue body, the markers, deployment records, job summaries, artifacts or caches. The only network calls are to the GitHub API and whatever the tool itself makes.
4. **Only the modes that run the tool need credentials.** `scan` and `apply` run the tool. `resolve` and `settle` never do, so their jobs need no tool credentials and no loading step.
5. **A hosted version keeps all of this.** It would be a control plane only. The tool always runs in the user's own runners.

The alternative was to make the first reading true by keeping secrets out of the action's process, through the wrapper that 0013 rejects. That protects against Sluiceway's own code, which the user pins and can read, and costs everything listed there.

## Consequences

- Promise 4 is the real gain: the job that reacts to an issue edit, the one input anybody with issue access can cause, holds no infrastructure secrets. It can run on a hosted runner while `scan` and `apply` run on private ones.
- Promise 4 binds the design of `resolve` and `settle` for good. Discovery there reads files only and never asks the backend. A stack that exists in the backend but has no stack file does not exist for Sluiceway, which matches the derived stack id of 0006. Authorization and deployment records are GitHub API calls.
- Promise 1 means any later feature that seems to need a credential (a private registry, a remote config source) has to get it from the environment like everything else.
- The docs describe the stronger setup for teams: read-only credentials for the `scan` job, and the credentials that can change things stored as secrets of the GitHub Environment that the `apply` job names, behind its required reviewers. Sluiceway needs nothing for this. It is only where the loading step gets its token.
- The brief's principle 3 is replaced by these promises in the README and the security docs.
