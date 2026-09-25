# The command line

`sluiceway` is a command you run on your own machine. It does two kinds of things:

- **`init` and `check`** read the files of your clone and nothing else: no credentials, no token, no network. [Start with init](init.md) explains them.
- **`login`, `status`, `stack`, `tick`, `rescan` and `settings`** talk to the Sluiceway app at `app.sluiceway.dev` with a personal token you make there. They let you, or a coding agent you give the token to, see your stacks, read a stack's preview, tick, ask for a scan and change settings from a terminal.

`scan`, `resolve`, `apply` and `settle` run only in the workflow: they need the run's identity and the workflow token, and the command line stops at them with a sentence.

## Install it

With Node 22 or newer, run it without installing:

```sh
npx sluiceway --help
```

Or `bunx sluiceway` with Bun. To keep it on your path:

```sh
npm i -g sluiceway
```

The npm package `sluiceway` is released with the action, from the same tag and with the same version. `npx sluiceway@<version>` runs the one of a release you reviewed.

### A binary, with no Node

Every release also carries the command line as one file per platform, with no Node needed:

| Platform | File |
|---|---|
| Linux, x64 | `sluiceway-linux-x64` |
| Linux, arm64 | `sluiceway-linux-arm64` |
| macOS, Intel | `sluiceway-darwin-x64` |
| macOS, Apple silicon | `sluiceway-darwin-arm64` |
| Windows, x64 | `sluiceway-windows-x64.exe` |

Download it from the [releases](https://github.com/sluiceway/sluiceway/releases), or from the newest one by its fixed address, and check it against `SHA256SUMS` from the same release:

```sh
curl -fsSLO https://github.com/sluiceway/sluiceway/releases/latest/download/sluiceway-linux-x64
curl -fsSLO https://github.com/sluiceway/sluiceway/releases/latest/download/SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
chmod +x sluiceway-linux-x64
sudo mv sluiceway-linux-x64 /usr/local/bin/sluiceway
```

On macOS, use `shasum -a 256 --check --ignore-missing SHA256SUMS`. The macOS binaries are not signed: a file downloaded with a browser is stopped by Gatekeeper until you run `xattr -d com.apple.quarantine sluiceway-darwin-arm64`. A file downloaded with `curl` is not.

## Sign in to the app

Make a token in the app on your own page, **Tokens** (`https://app.sluiceway.dev/settings/tokens`). A token is for one org and works for 30, 90 or 365 days, and the app shows it once. Then:

```sh
sluiceway login
```

It asks for the token and does not show what you type. A script pipes it in instead: `sluiceway login < token.txt`. The token is never read from an environment variable.

`login` checks the token with the app and keeps it only when it works. A token starts with `sluiceway_`; anything else, such as a GitHub token pasted by mistake, is refused before it is sent anywhere. It is kept in:

- **macOS**: the keychain, under the service `sluiceway`.
- **Linux**: the Secret Service keyring (GNOME Keyring, KWallet) through `secret-tool`, when there is one.
- **Otherwise, and on Windows**: `sluiceway/tokens.json` under your config directory (`$XDG_CONFIG_HOME` or `~/.config`, and `%APPDATA%` on Windows), readable by you alone.

`sluiceway logout` takes the token out of every place it is kept. It still works until it expires: revoke it on the Tokens page to stop it at once.

Everything you do with the token counts as you, by the same rules as the app's pages and the dashboard: a tick is judged by the repo's [tick rule](configuration.md#tickers), and the app's audit log says it came "via the command line".

## The commands

A repo is its name, `infra`, or `org/infra` when the org is the token's. A stack is its [stack id](configuration.md#stacks-and-stack-ids), such as `apps/api:prod`.

| Command | What it does |
|---|---|
| `sluiceway status` | The org's stacks by state, grouped as the app's org view groups them: Needs you (pending, drifted, preview failed), In flight (deploying and queued), In sync. |
| `sluiceway status <repo>` | The same for one repo, with its last scan and its dashboard. |
| `sluiceway stack <repo> <stack id>` | The stack's row: its state, the counts in the dashboard's words, what it deletes or replaces, drift, the preview page on GitHub, the run of a deploy and the last deploy. |
| `sluiceway tick <repo> <stack id>` | Ticks the stack, as you. A stack that deletes or replaces anything needs `--yes`. |
| `sluiceway rescan <repo>` | Asks GitHub for a full scan, as Rescan in the app does. |
| `sluiceway settings <repo>` | The keys of `sluiceway.yaml` a settings pull request may change, with the values the file gives them. |
| `sluiceway settings <repo> set <key>=<value> ...` | Opens a pull request that sets them, and prints its link. A person merges it. |

### What a tick does, and what it does not

`tick` reads the row first, and stops when the stack deletes or replaces anything unless you add `--yes`. Then it asks the app, which judges the tick by the same rule a tick on the dashboard gets and opens the deployment record. The command prints the app's answer, waits until the app shows the record, for at most a minute, and ends there:

```
The tick of network:prod is asked: the deployment record is open.
Deployment record 4242: waiting to start.
The workflow deploys it through a fresh preview and the hash check, and the dashboard says how it went: https://github.com/acme/infra/issues/7
```

It does not wait for the deploy, and it never says a deploy went out: your workflow deploys the stack on your own runner, and the dashboard row says how it ended. Follow it there, or with `sluiceway stack`.

### Setting a key

Each change is `key=value`. A value is read as JSON when it is JSON, and as text when it is not:

```sh
sluiceway settings infra set dashboard.redact=true tickers=admin
sluiceway settings infra set 'dashboard.sections=["pending","deploying"]'
sluiceway settings infra set 'stacks[apps/api:prod].deploy=on-merge'
sluiceway settings infra set drift.enabled=null   # back to the default
```

To set text that reads as JSON, such as the title `true`, quote it as JSON: `'dashboard.title="true"'`. The app says which keys a pull request may change, and refuses any other, or a value of the wrong kind, naming each one before anything is written.

## For agents and scripts

Every command that talks to the app takes `--json`. It prints one JSON document on stdout: the app's answer as it came, for a tick `{ "tick": ..., "deploy": ... }`, and on a failure `{ "error", "code", "exit" }`. The answers are the app's API, version 1, described at `https://app.sluiceway.dev/api/v1/openapi.json`.

The exit code says how it ended:

| Code | Meaning | What to do |
|---|---|---|
| 0 | Done | |
| 1 | Failed: the app could not be reached, a tick or pull request failed, a deployment record failed | Read the words, or the dashboard |
| 2 | Not understood: the command line, or a token that is not one | Fix the command |
| 3 | Not signed in, or the token does not work (revoked, expired, the person left the org, the app left it) | `sluiceway login` with a new token |
| 4 | Not found, or not in the token's org | Check the repo and the stack id |
| 5 | Refused: the tick rule, a tick that happens on GitHub, changes the app refused, a pull request already open, a destroy without `--yes` | Read the reason; do not retry as it is |
| 6 | Try again later: the rate limit (the message says in how many seconds), GitHub did not answer, the record not shown yet | Wait and run it again |

The app allows 120 reads and 10 writes a minute per token.

## Where it connects

`init` and `check` make no network call. The app's commands make HTTPS calls to the app alone, with the token you gave, and never to GitHub: the app does what GitHub needs, as you, by its own rules. The token goes nowhere else, and a redirect is refused. `--app <address>` names another app than `https://app.sluiceway.dev`, such as one for a test; it must be `https`, or `http` to this machine only. The one other process the command line starts is the keychain's own command, `security` or `secret-tool`, which gets the token on stdin.
