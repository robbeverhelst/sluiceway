# Can a secret manager load a large env file in CI within its limits?

Research for [issue 25](https://github.com/sluiceway/sluiceway/issues/25). All sources were read on 2026-09-21. Each claim is marked **documented** (stated by the vendor's docs), **source** (read in the vendor's own code), **tested** (run locally with fake values), or **inferred** (my reasoning, not stated anywhere). Context is records 0013 and 0014: a workflow step loads everything into the job environment before Sluiceway runs, and that step owns the masking.

## Summary

- Yes, it fits, but how you load matters more than which plan you have. The cost unit that 1Password documents is the `op` command, not the secret reference. One `op read` is 3 read requests (1 if you pass vault and item IDs). `op run` and `op inject` are not in the table of commands that make multiple requests, so their cost for many references is **not documented**.
- The official `1password/load-secrets-action` can load an env file through the `OP_ENV_FILE` variable (since v3.1.0, current v5.0.1). It masks every value and handles multi-line values. It has two drawbacks at this size: it runs one `op read` per reference, and it silently drops every line of the file that is not a whole `op://` reference, so the 20 literal values never reach the job environment.
- With the action, 160 references cost 480 documented reads per job by name, or 160 by ID. That does not fit an individual or families account, fits Teams only when references use IDs, and fits Business either way.
- With one `op run --env-file` per job, the cost is one command per job. A third party measured a flat 2 requests per `op inject` call for up to 24 references. If that holds at 160, then 20 jobs a day cost about 40 requests and fit every plan. **This must be measured once on the real file** with `op service-account ratelimit`. I could not verify it.
- The pattern "one step loads everything into the job env, masked" holds for Vault, Doppler, AWS Secrets Manager and Google Secret Manager. Each has an official action that exports to the environment and masks. The docs recipe can be generic.
- Nothing weakens "load once per job, never once per tool call". The findings make it stronger and add one rule: prefer one bulk call per job over one call per secret.

## 1. 1Password service account rate limits

### The limits (documented)

Source: [Service account rate limits](https://www.1password.dev/service-accounts/rate-limits) (the same page is served at `developer.1password.com/docs/service-accounts/rate-limits/`).

Hourly limits, per service account token. Reads and writes are counted apart. The 60 minute window starts at the first request.

| Account type | Read | Write |
| --- | --- | --- |
| 1Password Business | 10,000 per hour | 1,000 per hour |
| 1Password (individual), Families, Teams | 1,000 per hour | 100 per hour |

Daily limits, per 1Password account, reads and writes together, summed over **all** service accounts of that account, in a 24 hour window.

| Account type | Requests per 24 hours |
| --- | --- |
| 1Password Business | 50,000 |
| 1Password Teams | 5,000 |
| 1Password (individual) and Families | 1,000 |

The page lists four ways out when a limit is hit: wait, change account type, contact support, and (hourly limit only) create another service account. The last one does not help with the daily limit, because that one is per account.

`op service-account ratelimit` prints the current hourly and daily usage for the token in `OP_SERVICE_ACCOUNT_TOKEN`. Source: [service-account command reference](https://www.1password.dev/cli/reference/management-commands/service-account).

### What counts as one read (documented, with a gap)

The unit is an API **request**. The docs count requests per CLI **command**, not per secret reference, item or vault. Source: [Use service accounts with 1Password CLI, "Commands that make multiple requests"](https://www.1password.dev/service-accounts/use-with-1password-cli#commands-that-make-multiple-requests):

> 1Password CLI commands make one request unless otherwise noted.

| Command | Requests | How to reduce |
| --- | --- | --- |
| `op read` | 3 reads | 1 request when the reference uses the vault ID and item ID |
| `op item get` | 3 reads | 1 request with vault and item IDs |
| `op item list` | 1 + 1 per vault | 3 with `--vault`, 2 with the vault ID |

So a reference written with names (`op://vault-name/item-name/field`) costs three requests through `op read`, because the CLI first has to look up the vault and the item. A reference written with IDs costs one.

**The gap:** `op run` and `op inject` do not appear in that table. Read by the letter, "one request unless otherwise noted" would make `op run --env-file` with 160 references a single request. I do not trust that reading, since the CLI has to fetch every referenced item. The docs do not say whether the cost grows per reference, per distinct item, per vault, or stays flat. **Whether many references to the same item cost one read or many is not documented anywhere I could find.**

Evidence that is not first-party, so treat it as a lead and not as a fact: a pull request in another project ([NousResearch/hermes-agent #116616](https://github.com/NousResearch/hermes-agent/pull/116616)) reports measuring `op inject` on CLI 2.39.0 by sampling `op service-account ratelimit` before and after each run. It reports a flat 2 requests for templates of 1, 6, 12, 18 and 24 references over 1 to 10 distinct items, and 2 requests per single `op read`. That would mean the unit of cost is the invocation. It was not measured at 160 references, not for `op run`, and I could not reproduce it (no service account, and the rules for this research forbid touching real secrets).

One more documented factor: the CLI caches item and vault information in a daemon between commands, on by default on UNIX-like systems, "to maximize performance and reduce the number of API calls" ([CLI reference, "Cache item and vault information"](https://www.1password.dev/cli/reference#cache-item-and-vault-information)). This may lower the real cost of many `op read` calls in one step. By how much is not documented, so the numbers below use the documented cost as the upper bound.

### Does 160 references times 10 to 20 jobs a day fit?

Path A, one `op read` per reference. This is what the official action does (see question 2). Documented cost, no cache credit.

| | By name (3 reads) | By ID (1 read) |
| --- | --- | --- |
| Per job | 480 | 160 |
| Per day at 10 jobs | 4,800 | 1,600 |
| Per day at 20 jobs | 9,600 | 3,200 |

| Plan | By name | By ID |
| --- | --- | --- |
| Individual, Families (1,000 per hour, 1,000 per day) | No. The third job of the day fails. | No. The seventh job of the day fails. |
| Teams (1,000 per hour, 5,000 per day) | No. Two jobs per hour at most, and 10 jobs use 4,800 of the 5,000 daily requests with nothing else running. | Yes, with little room: 6 jobs per hour, 31 per day, shared with every other service account. |
| Business (10,000 per hour, 50,000 per day) | Yes. About 20 jobs per hour, 104 per day. | Yes. |

Path B, one `op run --env-file` per job. Cost per job is not documented. If the third-party measurement holds (about 2 requests per invocation), 20 jobs cost about 40 requests a day, which fits every plan, the individual plan included. If the real cost turned out to be one read per reference, path B would equal the "by ID" column at worst, or the "by name" column if the CLI also does the name lookups per reference.

**How to settle it (5 minutes, on the real file):**

```sh
op service-account ratelimit            # note the read usage
op run --env-file=ci.env -- true        # resolves everything, prints nothing
op service-account ratelimit            # the difference is the cost of one job
```

An anecdote, not verified: a [1Password Community thread from 2026-01-31](https://www.1password.community/developers-69/service-account-rate-limits-15-minutes-block-no-backoff-duration-shown-23967) reports a block after about 15 `op inject` runs in 10 minutes, with no wait time in the error message. It had no staff answer when I read it. It may simply be the daily limit of a small plan.

The documented way to have no limits at all is a self-hosted Connect server. The [Secrets Automation comparison](https://www.1password.dev/secrets-automation) says service accounts are "capped with strict rate limits" while Connect servers cache data and allow "unlimited re-requests", and its table lists rate limits and request quotas as "No" for Connect.

## 2. Can `1password/load-secrets-action` load an env file?

Yes. Sources: the [README on `main`](https://github.com/1Password/load-secrets-action/blob/main/README.md), [`action.yml`](https://github.com/1Password/load-secrets-action/blob/main/action.yml), [`src/index.ts`](https://github.com/1Password/load-secrets-action/blob/main/src/index.ts), [`src/utils.ts`](https://github.com/1Password/load-secrets-action/blob/main/src/utils.ts) and the [releases](https://github.com/1Password/load-secrets-action/releases).

- **Version.** Env file support arrived in v3.1.0 (2025-12-16, release note "Support loading secrets from env files #93"). The latest release is v5.0.1 (2026-08-18). The README uses `@v5`. The action runs on `node24`.
- **How.** It is not an input. Set the environment variable `OP_ENV_FILE` on the step to the file's path. It works next to references listed in the step's `env`. (documented in the README only. The [docs site page](https://www.1password.dev/ci-cd/github-actions) still shows `@v4` and does not mention `OP_ENV_FILE`. The README points at `tests/.env.tpl` as an example, but that file does not exist on `main`.)
- **Inputs** (documented, `action.yml`): `export-env` (default `false`: values become step outputs; `true`: values become job environment variables), `unset-previous` (default `false`), `version` (CLI version to install, default `latest`). Authentication comes from `OP_SERVICE_ACCOUNT_TOKEN`, or `OP_CONNECT_HOST` with `OP_CONNECT_TOKEN`, or the three Workload Identity variables (public preview).
- **Masking.** Yes (documented: "1Password automatically masks sensitive fields"; source: `core.setSecret(secretValue)` for every non-empty value).
- **Multi-line values.** Yes (source and inferred, not documented). `core.exportVariable` writes the delimiter form with a random `ghadelimiter_<uuid>` ([toolkit `file-command.ts`](https://github.com/actions/toolkit/blob/main/packages/core/src/file-command.ts)). `core.setSecret` sends one `add-mask` command with newlines escaped, and the runner then registers the whole value and also each line ([runner `ActionCommandManager.cs`, `AddMaskCommandExtension`](https://github.com/actions/runner/blob/main/src/Runner.Worker/ActionCommandManager.cs)).
- **It installs the CLI itself** when `op` is not on the runner (source: `validateCli().catch(install)`), so no separate install step is needed for the action.

Two things in the source decide whether it suits a large file:

1. **One `op read` per reference** (source). `loadSecrets` runs `op env ls`, then calls `read.parse(ref)` for each name, and [op-js](https://github.com/1Password/op-js/blob/main/src/index.ts) implements that as one `op read <reference>` process. For 160 references that is 160 CLI processes and the path A numbers above. Expect it to be slow as well (the third-party PR above measured about 1 second per `op read`).
2. **Literal values are dropped** (source and tested). The file is loaded with `dotenv.config` into the action's own process only. What gets exported is the list printed by `op env ls`, which its help text describes as "List environment variables that reference 1Password secrets". Tested on CLI 2.34.1 with fake values: a variable whose whole value is `op://...` is listed, a literal is not, and a value with a reference embedded in a longer string (`postgres://user:op://...@host`) is not listed either. So with this action the 20 literals need another home, such as the workflow's `env` block.

A third option exists in the same action: Workload Identity plus a 1Password Environment loads **all** variables of that Environment in one SDK call (`client.environments.getVariables`), exports and masks each. It is in public preview, it needs the secrets moved from an env file of references into a 1Password Environment, and how it counts against rate limits is not documented. Worth watching, not the recipe today.

## 3. The shortest safe way with the `op` CLI

`op run --env-file` resolves the whole file in one command and hands the result to a child process as environment variables ([`op run` reference](https://www.1password.dev/cli/reference/commands/run)). A small script inside that child masks and writes to `$GITHUB_ENV`. `op inject` would also work but needs a template and a parser for its output. `op read` in a loop is path A again.

Workflow steps:

```yaml
- uses: 1password/install-cli-action@v4 # skip when op is baked into the runner image
- name: Load environment
  env:
    OP_SERVICE_ACCOUNT_TOKEN: ${{ secrets.OP_SERVICE_ACCOUNT_TOKEN }}
  run: op run --env-file=ci.env --no-masking -- bash .github/scripts/export-env.sh ci.env
```

`.github/scripts/export-env.sh`:

```bash
#!/usr/bin/env bash
# Runs inside `op run`. Every name in the file is already resolved in this
# process's environment. Prints only ::add-mask:: commands.
set -euo pipefail
file="$1"

while IFS= read -r raw || [ -n "$raw" ]; do
  # Take NAME from lines like `NAME=...`, `NAME = ...` or `export NAME=...`.
  [[ "$raw" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*= ]] || continue
  name="${BASH_REMATCH[2]}"
  value="${!name-}"
  [ -n "$value" ] || continue

  # Mask first. Only names whose line holds a secret reference are secrets.
  if [[ "$raw" == *"op://"* ]]; then
    while IFS= read -r line || [ -n "$line" ]; do
      line="${line%$'\r'}"
      [ -n "$line" ] || continue
      line="${line//'%'/%25}"
      printf '::add-mask::%s\n' "$line"
    done <<<"$value"
  fi

  # Then write, always in the delimiter form so newlines survive.
  delim="ghadelimiter_$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
  if [[ "$value" == *"$delim"* ]]; then
    echo "value of $name contains the delimiter" >&2
    exit 1
  fi
  printf '%s<<%s\n%s\n%s\n' "$name" "$delim" "$value" "$delim" >>"$GITHUB_ENV"
done <"$file"
```

What was checked: the script was run locally with fake values in place of `op run` (single-line, multi-line with an empty line, values with `%`, `=`, `#` and quotes, two literals, one empty secret). The `GITHUB_ENV` file was parsed the way the runner does. All values came back identical, every line of every secret was masked, literals were not masked, the empty value was skipped. **Not checked:** a real `op run`, and a real runner.

Pitfalls:

- **`--no-masking` is required, and it is the dangerous part.** By default `op run` replaces secrets in the child's output with `<concealed by 1Password>` (documented). That would also rewrite the `::add-mask::` lines, so the runner would register the wrong string and the real values would stay unmasked. With `--no-masking`, anything the script prints is raw. The script must print nothing except `add-mask` commands. Never add `set -x` or an `echo` of a value. The runner does not echo `add-mask` lines to the log (source: `OmitEcho => true`).
- **Mask before writing.** GitHub's docs say to register the mask "before outputting it in the build logs or using it in any other workflow commands" ([workflow commands, "Masking a value in a log"](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#masking-a-value-in-a-log)). The script masks each value before it touches `$GITHUB_ENV`, so a failure halfway leaves nothing unmasked in the environment.
- **`add-mask` is one line.** A multi-line value has to be masked line by line (as here, and as the Vault and Google actions do), or sent as one command with `%0A` escapes. Line by line is what matters, because logs are matched per line. The side effect: very short lines of a multi-line secret also become masks and can turn unrelated log text into `***`. Google's action skips lines shorter than 4 characters for that reason (`min_mask_length`).
- **Escape `%`.** The runner unescapes `%25`, `%0A` and `%0D` in command data (source: [`ActionCommand.cs`](https://github.com/actions/runner/blob/main/src/Runner.Common/ActionCommand.cs)). A secret that contains `%0A` as text would otherwise be registered as a different string.
- **The delimiter form.** `NAME=value` breaks on the first newline. The docs' form is `{name}<<{delimiter}`, the value, then the delimiter on its own line, with the warning that the delimiter must not occur on a line of its own within the value ([workflow commands, "Multiline strings"](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#multiline-strings)). A fixed `EOF` is unsafe for arbitrary secrets. Use a random delimiter per value and check for it, which is what `@actions/core` does.
- **Literals are written but not masked.** Masking `true` or `eu-west-1` would replace those words all over the log. The script treats a name as secret only when its line in the file contains `op://`. A secret pasted into the file as a literal is therefore not masked. It should not be in the file.
- **The name parser is simple.** It reads names line by line. A quoted literal that spans lines and has a line that looks like `NAME=` would confuse it. Keep literals on one line.
- **Names the runner refuses.** `GITHUB_*` and `RUNNER_*` defaults cannot be overwritten, and `NODE_OPTIONS` cannot be set through `GITHUB_ENV` (documented).
- **Keep the token on the loading step.** `OP_SERVICE_ACCOUNT_TOKEN` is set in that step's `env` only, so it never reaches Sluiceway or the tool. The values written to `$GITHUB_ENV` are visible to every later step of the job, and not to the loading step itself (documented).
- **A failed reference.** `op run` should fail the step when a reference cannot be resolved, which is what CI wants. The PR cited above observed all-or-nothing behaviour for `op inject`. I did not verify it for `op run`.
- **Self-hosted runners.** [`1password/install-cli-action@v4`](https://github.com/1Password/install-cli-action) (v4.1.0, 2026-07-23) supports Linux, macOS and Windows runners and takes a `version` input (`latest`, `latest-beta`, or a fixed version such as `2.31.1`). It downloads the CLI, so the runner needs outbound access. Pin a version for repeatable jobs, or bake `op` into the runner image and drop the step. The script needs `bash`. CLI caching is not available on Windows (documented).

## 4. Does the pattern hold for other secret managers?

Yes for all four below. Each has a first-party action that exports to the job environment and masks.

**HashiCorp Vault: [`hashicorp/vault-action`](https://github.com/hashicorp/vault-action)** (v4.0.0, 2026-05-12; the README examples still show `@v2`). The `secrets` input takes many lines of `path key | ENV_NAME ;`, and a `*` key exports every key of a path, so one step can load everything. `exportEnv` is on by default, so values become environment variables as well as outputs. Masking: the README says "all variables will automatically be masked", and the source calls `core.setSecret` on **each non-empty line** of each value before `core.exportVariable`, so multi-line values are covered. Inferred, not read in a source: a self-run Vault has no vendor plan limit, only what its operator configures, and the cost is one request per path, not per key.

**Doppler: [`dopplerhq/secrets-fetch-action`](https://github.com/DopplerHQ/secrets-fetch-action)** (v2.0.0, 2026-03-19). It fetches a whole config in **one** API call (source: a single `fetch` in `src/index.js`), sets each secret as an output, and with `inject-env-vars: true` also as an environment variable. Masking: every value is masked except the three `DOPPLER_*` meta variables and secrets whose visibility is set to `unmasked` (documented and source). This matches "load everything" most directly, because a Doppler config already is the env file. Doppler's [platform limits](https://docs.doppler.com/docs/platform-limits) are per minute and per token (secrets reads: 120 per minute on Developer, 240 on Team, 480 on Enterprise), so 20 single-call jobs a day are nowhere near them.

**Cloud stores.** [`aws-actions/aws-secretsmanager-get-secrets`](https://github.com/aws-actions/aws-secretsmanager-get-secrets) (`@v3`) adds secrets "as masked Environment variables", and `parse-json-secrets: true` turns one JSON secret into one variable per key, which is the natural way to hold a whole env file in one secret and pay one API call. [`google-github-actions/get-secretmanager-secrets`](https://github.com/google-github-actions/get-secretmanager-secrets) (`@v3`) masks each line of each secret (lines under `min_mask_length`, default 4, are skipped) and exports to the environment only with `export_to_environment: true`. Its default is step outputs. Both authenticate through the cloud's OIDC action first, which matches the "cloud OIDC" recipe of record 0013.

The differences that the generic recipe has to name: export to the environment is on by default in Vault and AWS, opt-in in 1Password, Doppler and Google. None of the actions carries literal, non-secret values, except Doppler where literals simply live in the same config.

## 5. Does anything change "load once per job, never once per tool call"?

No. Everything found supports it, and some of it sharpens it.

- **Once per job is also the floor.** Environment variables do not cross jobs. GitHub's docs say that to pass a masked secret between jobs you "store the secret in a store and then retrieve it in the subsequent job". So each job that runs the tool loads for itself, and the number of such jobs per day is the number that drives cost. One scan job (not a matrix) and promise 4 of record 0014 (`resolve` and `settle` load nothing) keep that number low. A matrix of 30 scan jobs would multiply every figure in question 1 by 30.
- **Add a second rule: one bulk call per job, not one call per secret.** The official 1Password action loads once per job and still costs 480 documented reads, because inside the step it reads per reference. "Once per job" is necessary but not enough. The wrapper that record 0013 rejected would have been far worse: with 40 stacks, 160 references and `op read` by name, one scan would cost 19,200 reads, which is past the hourly limit of every plan.
- **The daily limit is per account, not per token.** Every other service account of the same 1Password account draws from the same 1,000, 5,000 or 50,000. A docs recipe should say that a second service account helps with the hourly limit only.
- **Bursts count.** The hourly window matters more than the daily average. A scan plus a few deploys in the same hour, plus re-runs of failed jobs, all land in one 60 minute window.
- **The escape hatches are outside Sluiceway.** Use IDs in references, move to one `op run`, change plan, or run a Connect server. None of them needs anything from Sluiceway.

## What this means for Sluiceway

1. **Record 0013 stands as written.** No finding argues for a command wrapper, hooks or a secrets input. The rate limit argument in 0013 is now backed by numbers.
2. **The credentials docs page can be generic.** The pattern is three lines: authenticate, one step loads everything into the job environment, that step masks. Then a table of official actions with two columns that differ per vendor: "exports to env by default?" and "masks multi-line values?". 1Password is the worked example.
3. **For the 1Password example, recommend `op run --env-file` with the export script**, not the official action, when the file is large or contains literal values. State the reason plainly: the action reads once per reference and drops literals. For a handful of secrets the official action is the simpler recipe and should be shown first.
4. **The first user should measure before choosing a plan.** Run the three-line `ratelimit` check on the real file. If one `op run` costs a few requests, any plan works. If it costs one read per reference, they need Teams with ID-based references at least, and Business for comfort. Until it is measured, the docs must not promise that a large file fits a small plan.
5. **The docs should carry the pitfalls that are not vendor specific:** mask before writing, mask multi-line values per line, write with a random delimiter, do not mask literals, keep the manager's token on the loading step only, never pass secrets between jobs.
6. **The example workflow's "load your credentials here" slot belongs in the `scan` and `apply` jobs only**, as promise 4 says. That is also a cost control, not only a security property.
7. **Sluiceway's own output rules stay a second net.** Multi-line secrets are masked per line by every loader looked at here, so a secret printed by the tool in a different shape (base64, JSON-escaped newlines) is not caught by any of them. That is a limit of GitHub's masking, and the docs can say so.

## Could not verify

- The request cost of `op run` and `op inject` for many references, and whether references to the same item share a read. Not documented. One third-party measurement says flat 2 per invocation up to 24 references.
- How much the CLI's daemon cache lowers the cost of repeated `op read` calls inside the official action on a runner.
- The snippet against a real `op run` and a real GitHub runner. Only the script's logic was tested, locally, with fake values.
- That `op run` fails the whole step when one reference cannot be resolved.
- How Workload Identity with 1Password Environments counts against rate limits.
