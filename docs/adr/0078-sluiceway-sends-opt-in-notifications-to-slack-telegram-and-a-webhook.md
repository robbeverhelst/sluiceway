# Sluiceway sends opt-in notifications to Slack, Telegram and a webhook

Record 0041 decided that Sluiceway sends nothing: it hands the workflow step outputs and a result file, and `docs/notifications.md` shipped recipes for a Slack step, a Telegram step and a generic webhook. The owner, 2026-09-22, on those recipes: "idk about telegram slack being a custom step, cant we build it in? and why wouldnt we?" Every team that wanted a message copied the same 15 lines of shell, with a condition that had to be right for each mode, and got it wrong in ways slices 2.22 and 4.5 had to fix in the docs. So the messages are built in, opt-in, each channel from the repo's own secret.

This supersedes 0041 on "Sluiceway sends nothing", and amends 0014 (promises 1 and 3) and the build plan's list of what to ask the owner before.

## Decision

### Channels are inputs, from secrets

- **Four inputs, on the `scan`, `resolve` and `apply` steps**: `slack-webhook-url`, `telegram-bot-token` with `telegram-chat-id`, and `webhook-url`. Each is set from a secret, `${{ secrets.X }}`. Empty by default, and a step with no channel sends nothing and makes no call.
- **Never a key of `sluiceway.yaml`.** An address or a token there would be a secret in the repo. A channel written under `notify` is an error that says it is an input.
- **Every value is masked** with the runner's `setSecret` before anything else, a wrong one too. The tool never sees them: the adapter already drops every `INPUT_*` variable from the tool's environment (0013).
- **A channel set up wrong is a warning, never an error.** A Slack address that is not `https://`, a webhook address that is not `http://` or `https://`, a Telegram token without a chat id or the other way round, or a token or chat id that could change the address, gets the warning "Notification channel not used" in Sluiceway's own words, and that channel sends nothing. A notification is never a reason for a scan or a deploy to stop.
- **`settle`, `check` and `init` send nothing.** A channel on their step is a warning that names it.

### Five events, picked in `sluiceway.yaml`

- **`notify.events`** lists them: `pending`, `drift`, `deployed`, `failed`, `refused`. The default is every event but `deployed`: the person who ticked is watching that one, and a message for every deploy is the noise slice 2.20 took out of the recipes. An empty list sends nothing, so a team can turn messages off with one reviewed line and leave the secrets in place.
- **`pending` and `drift` come from a scan**, and only for news: the stacks whose row is pending (or drift) in the body the scan wrote and was not in the body it started from, the first late read of its write, `""` for a new dashboard. A push that adds a commit to a stack that already waits sends nothing. A stack that deployed and is pending again is news again. It is sent before the scan can turn red, so a red scan that wrote the dashboard still tells.
- **`deployed`, `failed` and `refused` come from `apply`**, from its `outcome` (0041), on every way out, as the outputs are. `in-sync` and `rehearsed` send nothing. A job that failed before it learned its stack sends `failed` with no stack.
- **`refused` also comes from `resolve`**: one message for the ticks its comment on the dashboard is about (0018, 0054), the same list. A `resolve` that clears ticks because of `deploys: false` writes a note on the row, not a comment, and sends nothing.

### What a message says

- **One line**: the dot of the result (0040), `Sluiceway in <owner>/<repo>:`, a plain sentence with the stack ids, and the links: the dashboard for a scan's news, the run and the dashboard for a deploy's. At most ten ids, and the rest is a count. The words are fixed strings, and the voice has no place here (0032).
- **Never a value, a resource, a failure reason or any of the tool's words.** A notification is built from stack ids, the repo name and links alone, so nothing `dashboard.showValues` lets the dashboard show can reach it. The canary test runs the example project through a scan with every channel and checks every byte sent.
- **Stack ids are named under `dashboard.redact` too**, as the dashboard names them (0023).
- **Slack** gets `{ text }` with `<`, `>` and `&` escaped and its own link form, and no unfurling. **Telegram** gets plain text to `sendMessage`, with no `parse_mode` and no link preview. **The webhook** gets `{ version: 1, event, repository, stacks, dashboard, run, text }`, every stack id and `null` for a link the job does not know. `version` goes up only when the shape breaks a reader.

### A failed send changes nothing

- Every channel of one message is posted at once, each with 10 seconds to answer. An answer that is not a success is the warning "Notification not sent" with the status. No answer, or an error, is the same warning with the kind of error only (`TimeoutError`, `TypeError`), because an error's own text can hold the address and a Telegram address holds the token. The job, the dashboard, the deployment record and the outputs are what they would be without it.

## Consequences

- 0014, promise 1, now reads: no input and no config key ever carries a cloud, backend or secret manager credential. The notification channels are credentials of the user's messaging, not of their infrastructure, and are opt-in. Promise 3, "the only network calls are to the GitHub API and the tool's own", gains "and the channels a step names".
- The build plan's "Ask the owner before" line on network calls names these channels as allowed. Any other call still needs the owner.
- The sender lives in `src/notify/`, which is glue: it calls the network. `core/`, `adapters/` and `render/` may not import it, and the boundary rule says so. What to send is `core/notify.ts`, the words are `render/notification.ts`, both pure, so a hosted version can reuse them.
- `docs/notifications.md` leads with the built-in way. The outputs and the result file stay as they were, with steps of one's own for what the built-in messages do not cover: a scan that failed before it wrote the dashboard, the whole result file, and a Pushgateway push.
- A built-in message for a failed preview, a scan that failed before the dashboard, and a deploy that `settle` ended is left out (`docs/later.md`).

## Rejected

- **Ticking from Slack**, a button in the message. It needs an app that Slack can call back, and a GitHub Action is not running when someone clicks. It fits a hosted version.
- **Channels in `sluiceway.yaml`.** A secret in the repo, readable by everyone who can read the code.
- **A GitHub Environment or a repository variable as the channel**, read by Sluiceway by name. It breaks promise 2 of 0014: Sluiceway never reads a variable by name.
- **A message for every push that changes a pending stack.** The row already asks for a tick, and a busy repo would send one per push.
- **Failing the job on a failed send.** A deploy that went out is green, and a message that did not arrive does not change that.
