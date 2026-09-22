# Build plan for v1

This is the document to build Sluiceway from. It turns the decision records into an order of work: milestones cut into slices the size of one pull request, what each slice proves, and how it is tested.

## 1. How to read this

Read in this order, and stop reading the brief for instructions.

1. This file, for what to build next and how to prove it.
2. [CONTEXT.md](../CONTEXT.md), for the words. Use them in code, tests, logs and docs exactly as defined. Do not use the words listed under "Avoid".
3. [docs/adr](adr), for every rule. Each slice below names the records it implements. Read those records in full before you start the slice. Where a record carries an "Amended by" or "Superseded by" note, the newer record wins.
4. [docs/later.md](later.md), for what is not in v1. If something you are about to build is on that list, stop.

[docs/brief.md](brief.md) is history. It was the starting point on 2026-09-20 and about half of its detail has been corrected since. Every outdated section in it is marked. Section 4 of this file lists each correction. Never copy code, config, a workflow or a row format from the brief.

When two sources disagree, the order is: real GitHub or tool behavior, then the newest record, then this plan, then the brief. When real behavior disagrees with a record, do what is real, say so in the pull request description and amend the record in the same pull request.

### Rules of work

- One pull request per slice, in the order given. Small commits, conventional commit messages. A slice is done when its "done when" holds and CI is green.
- Every pull request rebuilds `dist/` and says in its description what was verified and how.
- Write for a general product. No file in this repo names a user's setup, except [docs/acceptance.md](acceptance.md).
- No em-dashes in docs, comments or strings. Plain, direct wording. The voice exists in two fixed lines and nowhere else (0032).
- New glossary terms go in `CONTEXT.md` in the same pull request. A decision that is hard to reverse gets a record in `docs/adr/`, numbered after the highest one there. Anything left out of v1 gets a line in `docs/later.md` in the same change.
- Third-party actions in this repo's workflows are pinned by commit SHA with a version comment.

### Ask the owner before

- Changing the license.
- Adding a runtime dependency that is not on the approved list in section 5, or letting `dist/index.js` grow past 3 MB.
- Adding any network call that is not the GitHub API or the tool's own.
- Building anything that `docs/later.md` lists, or that no record covers.

Everything else is yours to decide. Decide, write down why in the pull request, and carry on.

## 2. What v1 is

The core loop and nothing else: a scan previews stacks and writes the dashboard, a person ticks a box, exactly that stack deploys, and the row returns to in sync or shows why it failed.

Not in v1: drift detection, stack dependencies, a second adapter, teams in the tick rule, property values. (Drift part 1 came after them too, in slice 4.3 and record 0055. The second adapter, OpenTofu, came after the first releases, in slice 4.1 and record 0053.) `docs/later.md` has the full list. The marker format, the row states and the diff shape already leave room for them, so nothing in v1 needs a placeholder for them. Do not add empty drift or dependency code.

The brief's milestone numbers change with that. M0 is merged. M1 is the scan, M2 is the tick and the deploy, M3 is proof and the first release. The brief's M3 (drift and dependencies) and M4 (launch) are not part of this plan.

## 3. Names fixed for v1

Collected here so nobody has to search the records. The record in the last column is the authority.

### Action inputs and outputs

| Name | Kind | Modes | Default | Meaning | Record |
|---|---|---|---|---|---|
| `mode` | input | all | required | `scan`, `resolve`, `apply`, `settle` or `check` | 0003, 0042 |
| `concurrency` | input | `scan` | `4` | Size of the preview pool | 0012 |
| `preview-timeout` | input | `scan`, `apply` | `10` | Time limit for one preview, whole minutes | 0012, 0035 |
| `github-token` | input | all | the workflow token | Always the workflow's own `GITHUB_TOKEN` | 0017, 0035 |
| `deployment-id` | input | `apply` | required there | The deployment record to deploy | 0035 |
| `dry-run` | input | `apply` | `false` | A rehearsal: everything up to the hash check, then no deploy. The record ends as `inactive`, "rehearsed, nothing was deployed" | 0051 |
| `job-id` | input | `scan`, `apply` | `${{ job.check_run_id }}` | The id of the running job, for links to its log. Never set by hand | 0044 |
| `matrix` | output | `resolve`, `scan` | `[]` | `[{ stack, environment, deployment }]`. A scan sets one entry only after a merge from the dashboard | 0035, 0054 |
| `dashboard-url` | output | `scan`, `apply`, `settle` | none | Web address of the dashboard issue | 0041 |
| `pending` | output | `scan` | `0` | Number of pending stacks after this scan | 0041 |
| `preview-failed` | output | `scan` | `0` | Number of stacks whose preview failed | 0041 |
| `in-sync` | output | `scan` | `0` | Number of stacks in sync | 0041 |
| `dashboard-changed` | output | `scan` | `false` | `true` when this scan wrote a different body, so a notify step can stay quiet otherwise | 0041 |
| `outcome` | output | `apply` | none | `deployed`, `in-sync` (nothing to deploy), `rehearsed` (`dry-run`), `refused` (the change moved, the record was not open, or `deploys: false`) or `failed` | 0041, 0051 |
| `stack` | output | `apply` | none | The stack id this job handled | 0041 |
| `result-file` | output | `scan`, `apply` | none | Path under `RUNNER_TEMP` of a JSON file with what the summary holds: no values, none of the tool's words | 0041 |

### `sluiceway.yaml`

The file is optional and sits at the repo root. Unknown keys are an error, because a typo in `tickers` would change who can deploy.

| Key | Default | Meaning | Record |
|---|---|---|---|
| `dashboard.title` | `Sluiceway dashboard` | Issue title | brief |
| `dashboard.label` | `sluiceway` | Label the dashboard is found by | 0009, 0017 |
| `dashboard.pin` | `true` | Pin the issue, best effort | Actions research |
| `dashboard.redact` | `false` | Keep names out of the issue | 0023 |
| `dashboard.personality` | `true` | Header image and the voice | 0034 |
| `dashboard.readOnly` | `false` | No boxes: pending rows have none, there is no rescan box, and the line under the Pending heading says so. For a workflow that only scans (onboarding log, hurdle 16) | 0045 |
| `dashboard.showValues` | `[]` | Property paths whose old and new value may appear, as `old → new` after the path. Exact paths, `*` for part of one name. Never a value the tool marks secret, none with `redact` on. The hash covers a shown value (0008) | 0052 |
| `tickers` | `write` | Default tick rule: `write`, `maintain`, `admin` or a list of usernames | 0018 |
| `deploys` | `true` | `false` stops every deploy: `resolve` clears every ticked box with a note, `apply` ends before the tool runs | 0051 |
| `ignore` | `[]` | Globs matched against the stack id. An entry is a glob, or `{ glob, reason }`, and a stack left out with a reason is listed with it under In sync | 0010, 0051 |
| `scan.unrelated` | `[]` | Globs for files that claim nothing and force nothing | 0010 |
| `scan.logDiff` | `false` | Print the tool's own diff of every pending stack, values included, in that stack's group of the job log and nowhere else | 0048 |
| `drift.enabled` | `false` | Check every stack for drift in each scan that a schedule starts or a person starts with Run workflow, and in a push's scan only for the stacks whose row showed drift. There is no `drift.schedule`: the loader says the cron goes in the workflow | 0055 |
| `stacks[].path` | required per entry | Directory of the stack, relative to the repo root | 0006 |
| `stacks[].name` | none | Name of the stack. Without it the entry covers every stack in `path` | 0006 |
| `stacks[].tool` | none | `opentofu`: the entry declares a stack of that tool at `path`, because files alone cannot name one | 0053 |
| `stacks[].environment` | `sluiceway` | Label on the deployment record, and the GitHub Environment where one is used | 0003 |
| `stacks[].tickers` | the top level value | Tick rule for this stack | 0018 |
| `stacks[].inputs` | `[]` | Extra globs this stack claims | 0010 |
| `stacks[].previewTimeout` | the input | Time limit for this stack, whole minutes | 0012, 0035 |
| `stacks[].dependsOn` | none | Stack ids this stack depends on. A tick waits while one of them is pending and not ticked, ticks in one chain deploy one layer per run (slice 4.4) | 0056 |
| `stacks[].options` | `{}` | Named adapter options, only with `tool`. OpenTofu: `workspace` and `varFiles` | 0006, 0015, 0053 |
| `mergeAndDeploy.authors` | `[]` | Logins whose green pull requests that one stack claims are listed to merge and deploy with one tick. Empty turns it off | 0054 |

Rules for config loading:

- A `stacks[]` entry adds settings to stacks that discovery found. It never creates a stack, except an entry with `tool`, which declares one (0053). An entry that matches no discovered stack is a config error.
- A `tickers` entry with a slash fails with the message that teams are not supported yet (0018).
- `stacks[].drift` fails with a message that says it is not in this version yet. It is never ignored. (`dependsOn` did too until slice 4.4, 0056, and a top level `drift` until slice 4.3, 0055.)
- The JSON schema is generated from the Zod schema into `schema/sluiceway.schema.json`, committed, and checked in CI the way `dist/` is.

### Fixed strings and numbers

| What | Value | Record |
|---|---|---|
| Bot | `github-actions[bot]`, type `Bot` | 0017 |
| Deployment `task` | `sluiceway:<stack id>` | 0003 |
| Deployment payload | `{ "v": 1, "hash", "ticker", "run" }`, plus `"drift": true` when the approved hash covers drift | 0003, 0055 |
| Default environment label | `sluiceway` | 0003 |
| Concurrency groups | `sluiceway-scan`, `sluiceway-resolve`, `sluiceway-apply-<stack id>` | 0004, 0025, 0035 |
| Marker version | `1` | 0009 |
| Row states | `pending`, `deploying`, `in-sync`, `preview-failed`, `queued` since slice 4.4, and `drift` since slice 4.3, with the marker key `drift="true"` on a row whose hash covers drift | 0009, 0055, 0056 |
| Diff hash | SHA-256 of the canonical document, first 16 hex characters | 0008 |
| Body target, hard limits | 58,000 characters, 65,536 characters, 262,144 bytes | 0028 |
| Summary budget | 1,000,000 bytes | 0037 |
| Preview page | A check run named `sluiceway / <stack id>`, `completed`, `neutral`, its text cut on a line at 65,535 bytes. Needs `checks: write` | 0050 |
| Write loop | at most 3 tries | 0004 |
| Lookback, names on a row, recently deployed | 100 commits, 5, 10 | 0026, 0029 |
| Minimum Pulumi CLI | v3.229.0 | 0001 |
| Minimum OpenTofu CLI | v1.11.0 | 0053 |
| Minimum self-hosted runner | v2.328.0, no ARM32 | Actions research |
| API budget | 1,000 requests per hour per repo | 0017 |

### The action's own version and the image URLs

The header images are served from the exact release tag of the running action, or its commit SHA, never from a moving tag (0033). There are sixty-four of them, 880 by 160 (0039, 0043, 0047, 0055). The glue works the ref out once per job and hands it to the renderer as data:

1. If `GITHUB_ACTION_REF` is a full commit SHA or an exact version tag (`v1.2.3`), use it.
2. Otherwise read `version` from the `package.json` next to the action and use `v<version>`. The action finds that file from the address of its own entry point (`import.meta.url` of `dist/index.js`, one directory below `package.json`). Not from `GITHUB_ACTION_PATH`: GitHub sets it for composite actions only, so a JavaScript action never gets it, which broke every run of 0.1.0 on `v0` (hotfix 0.1.1, seen in the lab).
3. For `uses: ./` there is no action ref. Use `GITHUB_SHA`.

The version is read at run time and is not compiled into `dist/`. release-please changes `package.json` in its release pull request and cannot rebuild `dist/`, so a compiled-in version would turn every release pull request red. The footer's version line uses the same value.

## 4. Corrections to the brief

Each line is something in `docs/brief.md` that must not be built as written.

| Brief | What is true now | Record |
|---|---|---|
| Principle 3, "never hold credentials, only passes env through" | Five promises that can be checked | 0014 |
| Principle 5 and section 3, "adapter interface" | `urn` is an opaque `address`, the stack name is optional, five ops plus tracking changes, `changedKeys` and `replaceKeys`, no `summary`, no `rendered`. `detectDrift` is not in v1 | 0006, 0007, 0002 |
| Section 2, "moving major tag (`v1`)" | First release is 0.1.0 and the first moving tag is `v0`. `v1` appears with a deliberate 1.0.0 | PR 35 |
| Section 2, Zod "or Valibot" | Zod | section 5 |
| Section 3, Pulumi driver spike | Done: the CLI with `--json`, minimum v3.229.0 | 0001 |
| Section 3, "Sluiceway passes env through (`PULUMI_ACCESS_TOKEN`, ...)" | The whole job environment minus `INPUT_*`. No name is ever read | 0013, 0014 |
| Section 3, discovery of `Pulumi.yaml` and `Pulumi.<stack>.yaml` | `Pulumi.yaml`, `Pulumi.yml` or `Pulumi.json`, and stack files with the same extension | Pulumi research |
| Section 3, `docs/decisions/` | `docs/adr/` | PR 33 |
| Section 4, "the three modes" | Four. `settle` was added | 0003 |
| `scan` step 2, drift | Not in v1 | later.md |
| `scan` step 2, every stack on every push | A push gives a narrowed scan. Schedule, dispatch and rescan are full | 0010, 0011 |
| `scan` step 3, hash of URNs, ops and keys | A canonical document of the whole diff | 0008 |
| `scan` step 4, attribution by commits that touched the path | Pull requests the stack claims, the rest counted | 0026 |
| `scan` step 5, "full untruncated diffs" in the summary | The summary has a budget. The job log holds the full list | 0037 |
| `scan`, "error row" | A preview failure row with a failure reason from a fixed list. The job stays green | 0012, 0022 |
| `resolve` step 2, diff `changes.body.from` against the body | The event is only a wake-up. `resolve` acts on every ticked row in the live body | 0025 |
| `resolve` step 3, `sender` is checked | The ticker comes from the issue's edit history | 0025 |
| `resolve` step 3, `approvers`, users or teams | `tickers`: a level or usernames. It narrows and never widens. No teams | 0018 |
| `resolve` step 5, matrix of `{ stack, environment, expectedHash }` | `{ stack, environment, deployment }`. The hash is on the deployment record | 0003, 0035 |
| `resolve` step 6, re-render as deploying | Yes, and before that `resolve` creates the deployment record as `queued` | 0003 |
| `apply` inputs `stack` and `expected-hash` | One input, `deployment-id`. `apply` runs only on an open record | 0019, 0035 |
| `apply` step 3, records a deployment | `resolve` creates it, `apply` moves it on | 0003 |
| `apply` step 3, "comment on the dashboard only on failure" | No comment. A failure is a failure line on the row. Sluiceway writes a comment for a refused tick, and for a change that moved since the tick | 0004, 0018, 0051 |
| The example consumer workflow | Replaced. The one in the README is the only valid example | README, 0035 |
| "Environments are the real approval gate. The checkbox is the trigger" | The tick is always a gate, and Environments make it a stronger one | 0020 |
| Section 5, config keys `stack`, `approvers`, `dependsOn`, `drift` | `name`, `tickers`. `dependsOn` and `drift` are not in v1. New keys: `inputs`, `scan.unrelated`, `previewTimeout`, `dashboard.redact`, `dashboard.personality` | section 3 |
| Section 6, the sections and the header line | Pending, Deploying, Preview failed, In sync, Recently deployed. No Drift section in v1. Failed is a line on a row, not a section | 0029 |
| Section 6, the row format with `+2 ~1 -0`, `from #123 by @robbe` and a marker on the second line | Word counts, the marker at the end of the first line, a closing marker, attribution on its own line with plain logins | 0009, 0026, 0027 |
| Section 6, alert blocks on rows with a replace or delete | They do not render inside a list. Delete and replace lines sit open under the row | 0027 |
| Section 6, "never render values the tool marks as secret" | No value is ever shown, marked or not | 0021 |
| Section 6, truncate per stack diffs first | Biggest rows first, destroys cut last and all or none, small rows get their details back | 0024, 0028 |
| Section 6, root marker `<!-- sluiceway:dashboard v1 -->` | `key="value"` pairs, with the scan facts on it | 0009 |
| Section 7, `dashboard.redact` as "summary counts only" | Names leave the issue, the summary stays full, the hash still covers everything | 0023 |
| Section 7, "mask anything that looks like a token" | Dropped. The tool's own words never leave the job log | 0022 |
| Section 8, M3 and M4 | Not part of v1 | later.md |
| Section 9, e2e against the example | Yes, and it runs against a fake GitHub API so the whole loop can be tested without a person | section 6 |
| Section 11, homelab details | Only in `docs/acceptance.md` | map |

## 5. How the code is laid out

The bootstrap made the directories. This is what goes in them. File names are a starting point, the boundaries are not.

| Path | Holds | Pure |
|---|---|---|
| `src/core/` | Types (`Stack`, `Change`, `Diff`), config, the diff hash, the claim rule, the tick rule, the walk through the edit history, attribution, the scan plan (which stacks to preview) | Yes |
| `src/adapters/adapter.ts` | The interface: `discover`, `preview`, `apply`, and a version check | Yes |
| `src/adapters/pulumi/` | Discovery, the command lines, the process runner, the schema that parses tool output, folding steps into changes | Yes |
| `src/adapters/opentofu/` | The same for OpenTofu, plus init and the saved plan (0053). `src/adapters/tools.ts` sends each stack to its tool | Yes |
| `src/render/` | Markers, rows, the body, the header state, the voice strings, the size budget, the summary, the log text of a diff | Yes |
| `src/github/` | The port (one interface with every GitHub call Sluiceway makes), its Octokit implementation, the write loop, reading the event, the action ref, inputs and outputs, annotations | No |
| `src/modes/` | One file per mode. A mode wires core, adapter, render and the port together and holds no rules of its own | No |
| `test/fake-github/` | An in-memory implementation of the port, and a small HTTP server around it for the e2e workflow | |

"Pure" means: no import of `@actions/*`, `@octokit/*`, `src/github/**` or `src/modes/**`, and no reading of a GitHub event. The first slice adds `src/render/` to the boundary rule in `biome.json` and to `test/boundary.test.ts`, because record 0002 makes rendering the core's job and a hosted version would reuse it.

Four seams keep everything testable without a network or a tool:

- **The GitHub port.** Modes only talk to GitHub through it. Tests use the fake.
- **The process runner.** The adapter starts the tool through one function that takes a command, a working directory, an environment and a time limit. Tests replay recorded output through it.
- **The clock.** Every time on the dashboard comes from one injected function, so output is byte-identical in tests (0029).
- **The environment.** Read once in the glue and passed down as data. Nothing in `core/`, `adapters/` or `render/` reads `process.env`, with one exception: the adapter passes the whole environment to the tool minus `INPUT_*` (0013).

### Approved runtime dependencies

`@actions/core` (already there), `@actions/github`, `zod`, `yaml`, and one small glob matcher such as `picomatch`. The bootstrap measured 0.72 MB for `@actions/core` alone, so the brief's line of 1 MB is passed by design. The new line is 3 MB for `dist/index.js`. CI fails above it.

## 6. How it is tested

| Layer | What | Where |
|---|---|---|
| Unit | Hash, config, claim rule, tick rule, history walk, attribution, header state, budget steps, marker encode and decode | next to the code's area under `test/` |
| Snapshot | Every kind of row, the body in every header state, redact on and off, personality on and off, a 58 stack body, a 100 stack body over budget, the summary | `test/render/` |
| Adapter | The schema and the folding, against recorded tool output only | `test/adapters/pulumi/`, `test/adapters/opentofu/` |
| Mode | Each mode against the fake GitHub and a replayed tool | `test/modes/` |
| E2E | The committed bundle on a real runner, with the real CLI, the example project and the fake GitHub server. `scripts/e2e.ts` starts the bundle itself, with the inputs and the `GITHUB_*` variables a runner would build from `action.yml`, because a runner lets no step replace `GITHUB_API_URL`. The smoke job of `ci.yml` keeps a real `uses:` step, which stops at a config error before it reaches GitHub | `.github/workflows/e2e.yml`, `bun run e2e` |
| Live | A short manual pass in a scratch repo on real GitHub before a release | `docs/acceptance.md`, part 1 |

### The example project

`examples/pulumi-basic/` needs no cloud account. It uses a local file backend and the providers `random`, `command` and `local`.

- `network/`: YAML runtime, `Pulumi.yaml`, two stacks (`dev` and `prod`). Proves two stacks in one directory and `path:name` ids.
- `app/`: YAML runtime, `Pulumi.yml` with `Pulumi.prod.yml`. Proves the second spelling, plus a stray `Pulumi.dev.yaml` that must be ignored. The YAML runtime reads a program only from `Pulumi.yaml` or `Main.yaml`, so the project file sets `main: program` and the program is `app/program/Main.yaml`. It reads a file in `shared/`, which is what `inputs` is for.
- `site/`: TypeScript, one stack. Proves a program with an install step. The research saw step order change between identical runs only with TypeScript.
- `playground/`: YAML runtime, one stack. It exists so that `ignore` has a stack to leave out.
- A `sluiceway.yaml` that uses `inputs`, a per stack `tickers` and `ignore`.
- Every program holds at least one property whose value is the string `CANARY-VALUE` and one secret config value. See the canary test below.

### Recorded fixtures

`scripts/record-fixtures.ts` drives the example project through a list of scenarios against a fresh file backend and saves what the tool printed: stdout, stderr and the exit code, one directory per scenario under `test/fixtures/pulumi/<cli version>/`. Fixtures are never written by hand (0001). The script records with the minimum CLI version and with the newest one, and CI replays both sets. The tool prints absolute paths, so the sets in the repo are the ones a CI run recorded (CONTRIBUTING.md says how).

Scenarios: a new stack (all creates), no changes, an update, a replace with replace reasons, a delete, a mix of all ops, a change that touches only outputs (0036), an import, a resource that is dropped from state but kept, a resource renamed with an alias, a changed secret, a program error, a missing stack, a missing config value, the same preview twice (step order), `pulumi version`, and a generated stack of several hundred resources.

The build agent settles the table from Pulumi's step ops to `op` and `tracking` from these recordings. A step op that the table does not hold fails that stack's preview (0007).

### The canary test

One test runs every fixture through the adapter, the renderers and the log text, and fails if the string `CANARY-VALUE` or the secret shows up anywhere in the result. This is the proof of record 0021. It stays in the suite forever.

### The fake GitHub

The fake implements the port in memory and copies the real behavior that the lab tests found, because those are the things a naive fake gets wrong:

- A body over 65,536 characters is refused on create. On update a body over the limit answers success and stores nothing (issue 17).
- An edit by the bot starts no event. An edit by a person does.
- A workflow dispatch is the one thing the workflow token may start, and without `actions: write` it answers 403.
- The edit history keeps the original body and the newest 99 edits, each with its editor, time and full body. An entry's body can be deleted (0025). An issue that was never edited has no entries at all, and the history names the bot as `github-actions`, without `[bot]`.
- An `issues.edited` payload carries the newest body, not the body of its own edit (issue 28).
- Deployments: with the default `auto_inactive`, a later success flips every earlier success in the same environment to `inactive`, whatever its `task`, and a moment later, not at once (issue 27). Only the list filters that GitHub has.
- The fake counts requests, so a test can hold a scan of 100 stacks to the API budget.

Because the fake can add a history entry by a person, the whole loop (scan, tick, `resolve`, `apply`, `settle`) runs in CI with no human and no stored token. The risk is a fake that drifts from GitHub. The live pass before a release is the check on that.

## 7. Milestones and slices

### M1: the scan, read only

Done when: a push to a repo with the example project gives a correct dashboard, in CI against the fake and once by hand on real GitHub. Nothing can be deployed yet.

| # | Slice | Records | Proves | Tests |
|---|---|---|---|---|
| 1.1 | Core types and the diff hash. Add `render/` to the boundary | 0006, 0007, 0008 | The same diff always gives the same hash | Key order, duplicate keys, absent optional fields, code unit sorting, and fixed vectors: known documents with their known hashes, so a change of algorithm cannot go unnoticed |
| 1.2 | Config loading and the JSON schema | 0006, 0010, 0018, 0023, 0034, section 3 | Zero config works and a bad file fails loudly | Defaults, every error message, username case, the reserved keys, schema freshness check in CI |
| 1.3 | The example project and the fixture recorder | 0001, section 6 | The fixtures are real | The recorder runs in CI with the real CLI and its output parses as JSON where expected |
| 1.4 | Pulumi discovery | 0006, 0010, Pulumi research | Stacks are found from files alone, with no backend call | Both spellings, mismatched extension ignored, `stackConfigDir`, `ignore` on the stack id, two stacks with one id is an error, nested directories |
| 1.5 | Pulumi preview: version check, command line, process runner with the time limit, schema, folding, failure reasons | 0001, 0007, 0012, 0013, 0021, 0022, 0036 | Tool output becomes a `Diff` with no value in it | Every fixture, the canary test, `INPUT_*` removed from the child, a timeout kills the process group, nothing is written to disk so there is no temp directory to remove, parse errors name a path and never a value |
| 1.6 | Markers and rows | 0009, 0023, 0024, 0027 | One row renderer for every writer, and a tick is one regex on one line | Snapshots of every row kind, HTML escaping, percent-encoding round trips, unknown kinds, keys and states carried through byte for byte |
| 1.7 | The body: header state, picture, counts, scan line, sections, footer, voice, personality off. CI check that each image is at most 10 KB | 0029, 0030 to 0034 | The body is a pure function of the root facts, the row blocks and the deployment records | Snapshots per header state, precedence table, same input gives the same bytes, the action ref rule of section 3 |
| 1.7b | The wide header in the body renderer. Only `src/render/body.ts`, a new `src/render/pending-level.ts` and their tests change. (1) `pendingLevel(rows)`: 1 for 1 or 2 known rows of state `pending`, 2 for 3 to 9, 3 for 10 or more. (2) `picture()`: the file is `pending-<level>-<theme>.svg` when the header state is `pending` and `<state>-<theme>.svg` otherwise, `width="880"`, and the four lines are wrapped in `<p align="center">` and `</p>`. The alt texts do not change. (3) When `personality` is true, the counts line and the scan line go inside one `<div align="center">`: the opening tag, a blank line, the counts line, a blank line, the scan line, a blank line, the closing tag. (4) In that block, and only when the header state is not `plain`, each of the four state counts and the failed deploys count gets a count dot and `&nbsp;` in front: 🟡 pending, 🔵 deploying, 🔴 preview failed, 🟢 in sync, 🔴 failed deploys, and ⚪ in place of the colour when the count is 0. The bold stays around `<n> pending` only, after the dot. The destroy warning gets no dot. (5) With `personality` false nothing changes: no picture, no centering, no dots. The shortened-rows note stays outside the centered block. This slice must land before the first release, because until it does the renderer still asks for `pending-<theme>.svg`, which no longer exists | 0038, 0039, 0040 | The header, the pending level and the dots are a pure function of the row markers and the personality switch | The level at 0, 1, 2, 3, 9, 10 and 58 pending rows, rows of an unknown state do not count, a snapshot per picture, the plain body has centering and no dots, the personality off body is byte for byte what it was, a count of 0 gets the white dot, every image URL in the snapshots names a file that exists in `assets/mascot/`, same input gives the same bytes |
| 1.7c | The destroy sign in the body renderer, and the end of the plain state. Only `src/render/header-state.ts`, `src/render/body.ts`, a new `src/render/destroy-sign.ts`, their tests and snapshots, and the two marked exceptions in `test/assets/mascot.test.ts` and `test/render/body.test.ts` change. (1) `HEADER_STATES` loses `plain` and `headerState(rows)` loses its destroy rule. The five other states and their order do not change, so a body with a destroy now gets the state it would have had without it. (2) `destroySign(rows)`: true when any known row of state `pending` or `deploying` has `destroys` above 0. This is the rule `headerState` had for `plain`, moved. A row of an unknown state does not count. (3) `picture()`: the picture name is `pending-<level>` or the state, as now, and gets `-destroys` behind it when the sign is on and the header state is `pending` or `deploying`: `pending-2-destroys-<theme>.svg`, `deploying-destroys-<theme>.svg`. `failing`, `first-run` and `in-sync` never get it. `pendingLevel` does not change. (4) `ALT` loses `plain`. With the sign the alt text is `Sluiceway: changes are pending, some delete or replace resources` or `Sluiceway: deploying, some changes delete or replace resources`. Without it the alt texts are what they were. (5) The count dots are shown whenever `personality` is true. The test on the header state in `renderBody` goes away. The destroy warning still gets no dot. (6) `pendingLine()` and `voice.ts` do not change. A body that was plain with nothing pending was `Nothing to deploy.` and still is, because its state is now `deploying` or `failing`. (7) In `test/assets/mascot.test.ts` take out the filter on `plain`. In `test/render/body.test.ts` take out the line that lets a `plain-` URL pass and the two filters in the test that every picture is shown in the snapshots, and expect twenty-two there. (8) Comments in `src/` that name the plain header follow, and cite 0043. With `personality` false nothing changes. This slice must land before the first release, because until it does the renderer still asks for `plain-<theme>.svg`, which no longer exists | 0043, 0031, 0039, 0040 | The header always shows the real state, and the sign, like the state and the level, is a pure function of the row markers and the personality switch | The precedence table with five states. A destroy on a pending row and on a deploying row each turn the sign on, a row of an unknown state with `destroys` does not, an in sync or preview failed row with `destroys` does not. A pending header with a destroy at 1, 3 and 10 pending rows gives `pending-1-destroys`, `pending-2-destroys` and `pending-3-destroys`. A deploying header gets the sign from a deploying row and from a pending row. A failing header with a destroy is `failing` with its usual alt text. Both new alt texts. The body with the sign has dots, the white dot at a count of 0, and no dot on the destroy warning. The pending line with a destroy, with and without pending rows. The personality off body is byte for byte what it was. No `plain` is left in `HEADER_STATES` or as a header state in `src/`. Every image URL in the snapshots names a file that exists in `assets/mascot/`, and the snapshots show all twenty-two. Same input gives the same bytes |
| 1.8 | The size budget | 0024, 0028 | A body is never over the limit and destroys are cut last | The 58 and 100 stack fixtures, ties broken by stack id, give-back, all-or-none destroys, the scan fails cleanly when nothing fits |
| 1.9 | The summary and the log text | 0021, 0026, 0037 | A shortened row always has a full version to point at | Snapshot, the budget, the note at the top, the canary test again |
| 1.10 | The GitHub port, the Octokit implementation, the fake, finding or creating the dashboard, the write loop | 0004, 0009, 0017 | A write is verified, a lost write is retried, a duplicate dashboard is closed | The fake's silent drop, three tries then a red job, skip when identical, reopen the newest closed match, pin is best effort |
| 1.11 | The full scan: the pool, job result, annotations, wiring | 0011, 0012 | One broken stack never stops the others, and the job is green unless the scan itself failed | Pool order and size, all previews failing turns the job red after the write, a failed summary does not stop the scan |
| 1.12 | The narrowed scan: claim rule, compare call, fall back to full, row swap, the one row per stack rule | 0010, 0011 | A push previews only what it has to, and never loses a row | Every fall back case, a renamed file, nested stack directories, a row deleted by hand comes back, `full-scan-*` keys carried through |
| 1.13 | E2E workflow, and the README's warning updated | section 6 | The committed bundle works on a real runner with the real CLI | The smoke job's expectation changes here, as the bootstrap said it would |

After M1 the owner runs the read-only trial on real repos at a pinned commit (acceptance, part 2). It gives the first real preview timings, which confirm or change the defaults of `concurrency` and `preview-timeout` before anything is released. The scan logs how long each preview took and the total, so the numbers can be read from the job log.

### M2: the tick and the deploy

Done when: ticking a box deploys exactly that stack and the dashboard returns to in sync, in CI against the fake, with every refusal path covered.

| # | Slice | Records | Proves | Tests |
|---|---|---|---|---|
| 2.1 | Deployment records: create, statuses, bounded reads, `inactive`. The scan shows deploying rows, failure lines and recently deployed, defers at its late read, and ends an open record whose run is over | 0003, 0004, 0027, 0029 | Deploy facts live in GitHub and nowhere else | Payload version, one GraphQL page plus the REST fall back, another stack's success does not flip this one, a record of a finished run becomes `error` |
| 2.2 | The edit history walk | 0025 | The ticker is the person whose edit made the tick | The recorded race from issue 28, bot entries inside the stretch, an entry without a body, the 100 entry cap, paging stops early |
| 2.3 | The tick rule and the refused tick | 0018, 0020 | One live rule that only narrows | Levels from the three booleans, a list that does not widen, a bot or `ghost`, one comment for several refusals, fail closed when the lookup fails |
| 2.4 | `resolve`: the cheap payload check, body and history in one read, records created as `queued`, the row swap with `destroys` copied, the `matrix` output, the rescan box, a body of another version | 0009, 0014, 0017, 0025, 0031, 0035 | The job that an issue edit starts holds no tool credentials and never runs the tool | No API call for an ordinary issue, a second tick on a deploying stack is dropped, output set before the body write, 256 cap, dispatch needs `actions: write` |
| 2.5 | The adapter's `apply`, and `apply` mode: record first, fresh preview, hash check, deploy, status, row swap, the apply summary | 0008, 0015, 0019, 0021, 0035 | Only what the row showed goes out, and a re-run deploys nothing | A moved change ends as `error` and a fresh row, a closed record costs one API call and no tool call, the job is green only on success, outputs never in the summary |
| 2.6 | `settle` | 0003, 0035 | A cancelled or rejected deploy never stays "deploying" | Finds the records of its own run, leaves others alone, a run with nothing open does nothing |
| 2.7 | The orphan tick sweep in every scan | 0025 | A scan clears a tick that nothing picked up and never deploys it | A waiting `resolve` run means hands off, the note on the row |
| 2.8 | Attribution | 0026 | A row says which merges made it pending, and never blocks | The walk with merge commits, squash and rebase merges, direct pushes, `and earlier changes`, a failed lookup leaves the line out, budget level 1 |
| 2.9 | E2E of the whole loop on the fake: scan, tick, `resolve`, `apply` with the real tool, `settle`. Plus a refused tick, a moved change and a re-run | all of M2 | The loop closes with the committed bundle | The example stack really deploys to the file backend and the next scan shows it in sync |
| 2.10 | Docs: the README without its warning, the config reference, `docs/security.md` (the three setups of 0020), `docs/credentials.md` (the pattern of 0013, then recipes, and running next to your own tooling), what a tick promises (0008), the outputs limit (0036), and a line that says not to add `merge_group` to this workflow | 0013, 0014, 0016, 0020 | A stranger can set it up from the README alone | The README's workflow is parsed in a test and checked against `action.yml`: every input it uses exists |
| 2.11 | Outputs and the result file for `scan` and `apply`, and `docs/notifications.md`: GitHub's Slack and Teams apps on deployments, recipes for a Slack step, a Telegram step, a generic webhook and a Pushgateway push, each quiet unless something is pending or failed | 0041, 0021, 0022 | A workflow can tell people and chart numbers without Sluiceway sending anything | Each output per mode, the JSON schema of the result file as a snapshot, the canary test extended to the result file, outputs on a failed scan |
| 2.12 | `check` mode | 0042, 0006, 0010 | A setup can be validated in a pull request with no credentials and no tool | Every message of the config loader through the mode, discovery errors, a glob that matches nothing, the path-but-not-id hint, the unclaimed files list against a fixture repo, the ready-to-paste block, no network call and no child process (the process runner and the port are never constructed), the summary snapshot |
| 2.13 | First-scan polish from the onboarding log: a failure reason of its own for a stack that does not exist in the backend, with the `ignore` glob that takes it off in the summary; the full scan line for a changed config file says that `sluiceway.yaml` changed instead of "no stack claims sluiceway.yaml" | 0022 (amended), 0010, onboarding log hurdles 9 and 14 | The first dashboard of a new user explains itself | The recorded `missing-stack` fixture on both tool versions maps to the new reason, any other non-zero exit stays "the tool exited with an error", the reason is a constant string, the log line for a config change, snapshots |
| 2.14 | The `preview` and `run` links on a row land on that stack's detail, as close as GitHub allows | 0027, 0037, onboarding log hurdle 15 | A click on a row's link shows that stack, not the whole run | What GitHub can address, written down with evidence from a real run; the chosen link form in every row kind; the summary has an index and one addressable section per stack in dashboard order; the scan-only workflow's permissions still suffice, or the README says what to add and the link falls back without it; links stay valid for a re-run |
| 2.15 | Nested property paths. `changedKeys` and `replaceKeys` of a change hold property paths as the tool reports them (Pulumi: the keys of `detailedDiff`, with the fallback to `diffReasons` and `replaceReasons` where it is null), not top-level names. Rows, the summary, the result file and the diff hash use them. A new record amends 0007 and 0008 and says what a path may contain (names, list indexes, map keys, never a value), how a path is shown and shortened, and that every pending row gets a new hash once | 0007, 0008, 0021, 0024, 0028, onboarding log hurdle 18 | A row says what changes inside a property, without ever showing a value | Every recorded fixture on both tool versions, a Helm release whose `values` change in one nested key, list indexes and quoted map keys, a path that is long, many paths on one change against the size budget, the canary test (a value never becomes part of a path), hash vectors updated on purpose with the reason in the record, a tick on a row written before the change is refused as moved and the row shows the new hash |
| 2.16 | The full diff in the job log, opt-in. A setting (name it in section 3, for example `scan.logDiff`) makes the scan run the tool's human-readable preview for every pending stack and print it, values included, in that stack's group of the job log. Never in the issue, the summary, the result file, an annotation or a deployment record. `apply` prints it for its fresh preview too. A new record amends 0021 and 0022: what is allowed in the job log and only there, why it is off by default, what masks a secret there (the runner's registered masks and the tool's own secret marking, nothing Sluiceway guesses), the warning for public repos, the cost of one more tool run per pending stack | 0021, 0022, 0012, 0015, onboarding log hurdle 18 | A person can read exactly what a tick will deploy before ticking | Off by default and then no second tool run at all; on: one run per pending stack through the same pool and time limit, none for in sync stacks; the canary test proves the value reaches the log group and nothing else; a failed second run never changes the row; the row's link leads to where the diff is; the README and `docs/security.md` say who can read job logs |
| 2.17 | Pre-release polish: the doubled period in three log lines (slice 2.9), the orphan note that says "tick again" in a workflow without `resolve` (onboarding log hurdle 16: a read-only setting that renders pending rows without boxes and says so), a `branding` block in `action.yml` (icon and colour, needed for the Marketplace) | onboarding log hurdle 16, 0025 | The first release has no known wart | The three log lines, the read-only body snapshot, the README's read-only trial uses the setting, action metadata test |
| 2.18 | A check run per pending stack is the page a row's `preview` link lands on. The scan creates or updates in place one check run per pending stack on the scanned commit, named `sluiceway / <stack id>`, conclusion `neutral`, with Sluiceway's own diff of that stack as its output (resources, ops, nested paths, no values), a link to the dashboard and to the job log, and a note that the tool's own diff is in the job log when `scan.logDiff` is on. The row's `preview` link is the check run's `html_url`. Needs `checks: write`; without it the link falls back to record 0044's target and the log says which permission to add. Output over 64 KB is cut with a pointer to the summary and the log. Values never go on the page: a separate decision would be needed (research). Record 0050 supersedes 0044's link target for pending rows and amends 0021 on where names may appear | 0044, 0048, 0021, 0037, research `docs/research/preview-page.md`, onboarding log hurdle 18 | One click from a row lands on that stack's rendered preview | Create then update by name on the fake (one list per 100 stacks, one PATCH per stack), a re-scan of the same commit makes no duplicate, the 65,535 limits at and past the limit, no `checks: write` falls back and says so, the canary test extended to the check run output, the e2e checks one check run per pending stack and none for in sync stacks, request budget of record 0017 still holds at 100 pending stacks |
| 2.19 | `dashboard.showValues`: a list of property paths (globs against the path as record 0046 writes it) whose old and new value may appear on the dashboard, as `old → new` after the path, shortened past 40 characters, and never for a value the tool marks secret even when the path is listed. Default: empty, so nothing changes for anyone who does not set it. The docs ship a copy-in list of paths that are nearly always safe (`version`, `chart.version`, `values.image.tag`, `image`). Values flow through the adapter for listed paths only: the schema reads the values of those paths from the step's old and new state (`detailedDiff` holds none) and drops the rest at the door. The hash covers a shown value, as 0008 says (owner, 2026-09-22). Record 0052 amends 0007, 0008, 0021, 0023 and 0050, and says why an allowlist and not a pattern guess (0022) | 0007, 0021, 0022, 0046, onboarding log hurdle 22 | A person sees that a change is a version bump from 17.0.3 to 17.0.4 without opening anything | Nothing shown with an empty list, a listed path shows `old → new`, an unlisted path on the same change shows nothing, a listed path marked secret shows nothing, the canary test with the canary value on an unlisted path and on a listed one (only the listed one may appear, and it is hashed), shortening, the summary, the result file and the check run page (2.18) follow the same list, redact turns it off |
| 2.20 | Lessons from the first user's earlier internal dashboard (`~/Downloads` comparison, private). (1) An `ignore` entry may be an object with `reason`; ignored stacks with a reason are listed with it in a fold under In sync, so an exclusion never rots invisibly. (2) `deploys: false` in `sluiceway.yaml`: `resolve` clears every ticked box with a note and `apply` refuses before its fresh preview; one reviewed line stops every deploy. (3) An empty fresh preview in `apply` ends the record as `success` with the reason "nothing to deploy, already in sync", a trail line, no failure line and a green job; it is the outside deploy that 0016 calls legal, not a moved change. (4) When `apply` ends as moved, one comment on the dashboard names the ticker, as 0018 does for a refused tick, because a red job and a failure line do not reach the person. (5) Rehearsal: `dry-run: true` on `apply` runs the whole path to the hash check and stops; the record ends with a distinct result, the trail says "rehearsed", nothing is deployed. Record 0051 | 0010, 0018, 0019, 0016, 0035, 0029, onboarding log hurdle 23 | A team can stop, rehearse and explain, and a benign empty preview is not a failure | Config: an ignore entry as a string and as an object, a missing reason on an object is an error; the ignored fold snapshot; `deploys: false` in `resolve` (boxes cleared, note, no record) and in `apply` (refused before the tool runs); an empty fresh preview against the recorded no-changes fixture; the moved comment mentions the ticker once and never a value; dry-run ends with its own status and deploys nothing, on the fake and in the e2e |
| 2.21 | Two checks the comparison raised, in the lab and in the adapter: (a) does a UI checkbox tick always deliver `issues.edited` (the earlier dashboard added a 5-minute sweep after seeing none; its own `if` filtered on `changes.body.from`); (b) Pulumi puts diagnostics in the stdout JSON on a failed preview; the adapter must carry those into the log group on a non-zero exit, not only stderr | 0025, 0022 | Two known traps are proven absent | The lab observation written down in the onboarding log; a recorded failing preview whose diagnostics sit in stdout shows them in the log group |
| 2.22 | Small polish from real use. (a) Hurdle 21: a stack that is pending again right after a successful deployment record of the same diff hash gets a line on its row, "pending again right after a deploy of this same change, a value in the program may differ on every run", with a pointer to the tool's own diff when `scan.logDiff` is on. (b) Hurdle 5: a scan that fell back to a full scan because of unclaimed files prints a ready-to-paste `scan.unrelated` block in the job summary, the same block the `check` mode prints. (c) The notification recipes in `docs/notifications.md` send only when `outcome` is `failed`, `refused` or `moved`, not for `in-sync` or `rehearsed` (slice 2.20 noted the noise) | 0003, 0008, 0010, 0042, 0041, onboarding log hurdles 5 and 21 | Two things the first user saw every day explain themselves | The pending-again line on the fake with a record of the same hash, and not with a different hash; the block in the summary of a fallen-back scan and not in a narrowed one; the recipes' condition |
| 4.1 | The OpenTofu adapter: `discover` from configured root modules (no zero-config discovery for OpenTofu, record 0006 and the adapter research), `preview` through `tofu plan -out` and `tofu show -json`, the normalized diff from `resource_changes` (actions folded to ops as the research maps them, `after_unknown` and `before_sensitive`/`after_sensitive` respected, `resource_drift` ignored in v1), `apply` of the exact saved plan the gate hashed (the research and the earlier internal dashboard both ask for it), sequential `tofu init` before the pool, workspaces and var files as named adapter options, `TF_*` env passthrough. Version check against a minimum the research fixes. Recorded fixtures from a credential-free example (`local_file`, `random`, `null_resource`) on two tofu versions, the canary test extended, the e2e running both adapters | 0001, 0006, 0007, 0015, adapter research `docs/research/opentofu-adapter-fit.md`, record 0053 | Sluiceway is an IaC dashboard, not a Pulumi dashboard | Every op mapping on recorded fixtures, sensitive values never leave the adapter, a saved plan applied exactly and refused when the hash moved, init ordering, a repo that holds both Pulumi and OpenTofu stacks, the check mode listing configured OpenTofu roots |
| 4.2 | Merge and deploy, part 1 (issue 102): `mergeAndDeploy.authors` in `sluiceway.yaml` (off by default); the scan lists open pull requests that qualify (author on the list, every changed file claimed by exactly one stack, checks green) in a section "Updates waiting to merge" above Pending, one row per pull request with the bump from its title and a box; a tick on such a row merges the pull request through the merge API with the repo's allowed method that Renovate would use, and carries "deploy after merge" on the deployment record it opens for the stack; the narrowed scan that the merge push starts finds the record and hands the fresh diff to `apply`. Needs `pull-requests: write`. Record 0054 (the trust decision: the ticker's write access is the same right GitHub asks for a merge, off by default, explicit authors) | 0010, 0018, 0025, 0026, 0035, issue 102 | One tick on the dashboard merges a routine bump and deploys it | Qualification rules on the fake (author, single stack, red checks, two stacks never qualify), the merge call and its refusal by branch protection, the row section snapshot, the handoff to `apply` in the e2e with a real merge on the fake, the moved case after the merge ends `refused` with a comment to the ticker |
| 4.3 | Drift, part 1: a scheduled or dispatched scan may run `detectDrift` (Pulumi: `refresh --preview-only`, the lock caveat of record 0001), a row whose state matches code but not reality gets the state `drift` and its own section "Drifted" below Pending, the marker gains the key record 0009 reserved, the header gets the drift state and picture (the water seeping through the closed gate, `docs/later.md`), the hash of a drift row includes the drift so `apply` re-checks it (0008, 0009). A tick on a drift row deploys, which repairs the drift. `drift.enabled` in `sluiceway.yaml`, off by default; `drift.schedule` is the workflow's cron, not Sluiceway's. Record 0055 | 0009, 0008, 0015, 0029, 0031, brief M3 | Reality changed outside of code, and the dashboard shows it | Recorded refresh fixtures with real drift on both tool versions (a resource changed behind Pulumi's back in the example), the drift row and section snapshots, the header state, a tick on a drift row on the fake, no lock held by a preview-only refresh on the minimum version |
| 4.4 | Stack dependencies, part 1: `dependsOn` in `sluiceway.yaml` (stack ids), a tick on a stack whose upstream is pending is refused with a note that names the upstream (the earlier internal dashboard's lesson: only refuse on things that can hold state, and never stay green and silent), two ticked stacks in one dependency chain deploy in topological order, one layer at a time, the rest shown as "queued behind X" with the marker state record 0009 reserved, and `settle` starts the next layer. Record 0056 | 0009, 0019, 0035, brief M3 | A dependent stack never deploys before its upstream | Cycles refused at config load, the refusal note, the order on the fake and in the e2e with three stacks in a chain, queued rows survive a scan |
| 4.6 | The Helm adapter (issue 100): a release in a namespace is the stack (configured entries, like OpenTofu: chart path or reference, release name, namespace, values files as options), `discover` from configured entries, `preview` through `helm diff upgrade --install --output json` (the helm-diff plugin, its output format verified against its source; if the JSON output is not stable, the dry-run manifest diff as the fallback), the normalized diff from the manifest changes (resource kind and name as the address, changed keys as paths, values never), `apply` through `helm upgrade --install --atomic` of the same chart version and values the preview saw (hash the rendered manifest set so a moved change is refused), `helm` version check, kubeconfig and registry logins from the environment as everything else. Fixtures from a credential-free example: a local chart rendered with `helm template` against a kind cluster in CI, or the `--dry-run=server` path if a cluster is needed; record what works. The canary test extended; the e2e runs three adapters. Record 0058 | 0006, 0007, 0015, 0053, issue 100 | Every Kubernetes team that runs Helm can use the dashboard | Every op mapping on recorded fixtures, secrets in values never leave the adapter, a moved change refused, a repo with Pulumi, OpenTofu and Helm stacks |
| 4.7 | Dependencies part 2 and drift part 2. Dependencies: the check mode lists `dependsOn`, an upstream that is excluded refuses with the reason, a dependency read from Pulumi stack references as an opt-in (`dependsOn: auto`). Drift: `stacks[].drift` per stack, the drifted row's changes listed like a pending row's, `drift` counted in the header's counts line with a dot, a drift picture with the exact crate count is NOT needed (one picture), and the trail line for a drift repair says so. Record 0059 | 0055, 0056 | Both features are complete enough for daily use | The listed tests of 4.3 and 4.4 extended; the auto dependency read on the example project's stack reference |
| 4.8 | Housekeeping before 1.0: the onboarding log renumbered (two hurdles are numbered 21) with every citation updated; `docs/later.md` pruned of lines that slices 4.1 to 4.7 delivered; the README's mode table, inputs and outputs tables checked against `action.yml` by a test; the build plan's section 2 rewritten to say what v1 is now (it still lists things as not in v1 that shipped); a `docs/roadmap.md` that says in plain words what comes before 1.0 and what after, generated from `docs/later.md`'s deferred table. No record | the whole plan | The docs do not contradict the product | The action.yml consistency test, a link check over docs/ |
| 4.9 | The Kubernetes manifests adapter (issue 100): a directory of manifests or a kustomization as the stack (configured entries, like OpenTofu), `preview` through `kubectl diff` (server-side dry run, exit code 1 means differences), the normalized diff from the diff output (kind and name as the address, changed keys as paths, values never), `apply` through `kubectl apply --server-side` of the same rendered set the preview saw, hash the rendered manifest set, `kubectl` version check, kubeconfig from the environment. Fixtures against a kind cluster in CI. Record 0060 | 0006, 0007, 0053, 0058, issue 100 | Plain YAML and kustomize repos get the dashboard | Every op on recorded fixtures, secrets never leave the adapter, a moved change refused, the e2e with four adapters |
| 4.10 | The result file's JSON schema committed next to `schema/sluiceway.schema.json`, attribution and timings in the result file, and a `sluiceway check` that also reads the workflow file (the triggers, the permissions each mode needs, a pinned SHA versus `v0`) and says what is missing. Record 0061 | 0041, 0042 | The check catches a wrong workflow before the first run, and the outputs are documented by a schema | Schema snapshot, the workflow checks on the example workflows and on broken ones |
| 4.11 | Failed deploys in the recently deployed list, a configurable length for it, the real time of a superseded deploy, and one alert block above the pending list that names the stacks with a delete or replace (all from `docs/later.md`). Record 0062 | 0029, 0024, 0003 | The trail is complete and destroys are impossible to miss | Snapshots, the length setting, the alert block only when a destroy is pending |

### M3: proof and the first release

| # | Slice | Proves |
|---|---|---|
| 3.1 | The 100 stack run: body size, API calls counted against the budget, time of a scan with a replayed tool | The numbers in the records hold in code |
| 3.2 | The live pass in a scratch repo (acceptance, part 1), with fixes | The fake did not lie about GitHub |
| 3.3 | Release 0.1.0 (section 8) | The tag, `v0` and the image URLs work |
| 3.4 | Acceptance against the first real user (acceptance, parts 3 and 4), with fixes | The destination of the map |

## 8. The first release

- The first release is `0.1.0` (`initial-version` in the release-please config, PR 35). The first moving tag is `v0`. Examples say `sluiceway/sluiceway@v0` until a deliberate 1.0.0.
- Nothing is released after M1. A dashboard with boxes that do nothing is not a version. The read-only trial runs at a pinned commit SHA, which the image rule of 0033 allows.
- 0.1.0 is cut when M2 is merged and the live pass is done. Passing the acceptance test is the gate for telling anyone, not for tagging.
- The owner has to turn on "Allow GitHub Actions to create and approve pull requests" before release-please can open its pull request. It is still off. Pull requests it opens start no CI run. Closing and reopening the release pull request starts one.
- After the tag exists, check by hand that one image URL at the exact tag loads, and that the e2e body names that tag.
- **Done: 0.1.0 was cut on 2026-09-21** ([release](https://github.com/sluiceway/sluiceway/releases/tag/v0.1.0), release pull request 85). The organization still does not let GitHub Actions create pull requests, so the release pull request was opened with the owner's own token. Until that setting changes, every release is cut the same way.
- **0.1.1 was cut the same evening** ([release](https://github.com/sluiceway/sluiceway/releases/tag/v0.1.1)) for the moving tag bug: started from `v0`, 0.1.0 could not find its own version, so every scan on `sluiceway/sluiceway@v0` failed (pull request 87, onboarding log hurdle 20). `v0` now points at 0.1.1. On 2026-09-22 the header pictures at `v0.1.1` (`pending-4-destroys-light.svg`, `pending-4-destroys-dark.svg`, `in-sync-light.svg`) loaded as `image/svg+xml`. The first real user's repo runs `sluiceway/sluiceway@v0` on 0.1.1, with its pictures served from `v0.1.1`.
- After the release, the README and the user docs say beta, released as 0.1.1, and recommend `@v0`, and keep "Pin a commit" for a full commit SHA. The README's example dashboard is generated by the renderer, points at `v0.1.1`, and is held to the renderer by `test/docs/example-dashboard.test.ts`.
- Still open for the owner, and needed before anything is announced: there is no Marketplace listing yet, and the `sluiceway` npm name and the `sluiceway.dev` domain are not reserved.
