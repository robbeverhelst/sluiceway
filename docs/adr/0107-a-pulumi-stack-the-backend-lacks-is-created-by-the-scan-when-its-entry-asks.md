# A Pulumi stack that its files name and the backend lacks is created by the scan, when its entry asks

> Amends 0022 (a stack the backend lacks stays a preview failure, unless the stack's entry sets `createInBackend: true`, and then the scan makes it before the preview) and 0074 (the check with `backend: true` names each such stack with the line that the first scan creates it, and keeps it out of the `ignore` block). Built as slice 5.42, for issue 248.

A new Pulumi project was added to a real repo on 2026-09-24, for a service the dashboard should deploy. The stack file existed, the backend did not hold the stack, and the row was a preview failure until the owner ran a preview by hand on a laptop to create it. With `strict` on, that one row would have turned every scan red until then, so the stack was ignored with a reason, and the owner's checklist grew by a local step and a config edit. Nothing in Sluiceway could create the stack, on purpose: record 0022 makes a stack the backend lacks a preview failure, and the check offers an `ignore` block for it (0074).

OpenTofu already has the other answer. Its init makes a missing workspace, so a root module's first scan previews it as all creates (0053, 0074). Pulumi gets the same, opt in.

## Decision

- **`stacks[].createInBackend: true`**, a key per entry and not a top level switch. The person then names exactly which stacks a scan may create, and a stray stack file anywhere else still creates nothing. The key follows the shape of `envFile`, `drift.enabled` and `valueFingerprint`: an entry without a name covers every stack in its path, an entry with a name wins key by key. Off by default, because a typo in a stack file must never create junk in a backend. An entry with `tool` refuses it, in the words discovery uses for `dependsOn: auto`: only a Pulumi stack has a stack to create.
- **One preparation per such stack, before its first preview** (0053). The Pulumi adapter gives, for each stack the scan hands it to create, a preparation titled with the stack id: `pulumi stack ls --json` in the stack's directory, the same read-only question the check asks (0074), then `pulumi stack init <name>` when the list lacks the stack. The init gets the name alone: no `--secrets-provider`, so the tool's default stands, and the passphrase is the one the job already has in its environment, or in the stack's env file (0103). A stack the list holds is left alone. Both commands get the stack's environment minus `INPUT_*` (0013) and the stack's preview time limit. The scan then previews the created stack in the same round, as all creates.
- **Once per stack per job, and each stack alone.** The scan's preparation step runs each preparation before the pool and remembers what it prepared across rounds, so a second round never asks again. Each stack is its own preparation, so a list or an init the tool refuses is a preview failure of that stack alone, with a reason picked from the exit code as a preview's is (0022 as amended in slice 5.9), and the scan goes on. The tool's words go to the preparation's group in the job log and nowhere else.
- **A preparation may give its own words.** `PrepareResult` gains `detail`, Sluiceway's own lines for the group: that the backend did not hold the stack and it was created, or that the backend held it and nothing was created. Never a word of the tool's.
- **Only the scan creates.** The scan hands the preparation step the stacks whose entries ask; `apply` hands it none, whatever the entries say, so a deploy never creates a stack. A stack gone at deploy time fails the fresh preview as it does today.
- **The check names each such stack.** With `backend: true`, a stack the backend lacks whose entry asks is one line in the log and one cell in the summary, `No, the first scan creates it`, not a warning, and it gets no entry in the `ignore` block. Without `backend: true` the check cannot know what the backend holds and says nothing new.
- **The salt stays in the checkout.** `stack init` writes an `encryptionsalt` into the stack file of the checkout. Sluiceway never commits, so the salt lives and dies with the runner, as the `.terraform` directory of an init does. A repo that later sets config secrets with the tool commits the salt itself, as today. A stack whose config needs secrets still gets them from the environment or from a person; the docs say so.

## Considered

- **A top level `scan.createStacks: true`.** Rejected: it would create every stack any stack file names, which is exactly what a typo must not do. One key per entry is one decision per stack, and the check can name each.
- **Creating the stack on a deploy too.** Rejected: a deploy is a tick on a row that a preview made, and a stack that vanished between the preview and the deploy is news the person should hear as a failure, not something to paper over.
- **Running `stack init` without the list first, and reading "already exists" from the tool's words.** Rejected: 0022 picks a reason from facts Sluiceway establishes, never from the tool's message, and the tool documents no exit code for a stack that is there. The list is one quick read, and the check already trusts it.
- **One preparation per project directory.** Rejected: a refused init would then fail the previews of every stack of the directory, and one broken stack must not stop the others (0012).
- **A `secretsProvider` option, or the salt committed by Sluiceway.** Left out (`docs/later.md`): nobody has asked, and Sluiceway commits nothing to a repo.

## Consequences

- Record 0022 is amended: the list of preview reasons does not change, and a stack the backend lacks reaches the reason only when no entry asked the scan to create it.
- Record 0074 is amended: the check's backend part has one more kind of line, and the `ignore` block leaves out the stacks the first scan creates.
- The adapter interface: `prepare` takes `PrepareOptions` with the stacks to create, and `PrepareResult` may carry `detail`. `PrepareContext` of the modes gains `createInBackend`, which the scan sets and `apply` does not. `BackendCheck` carries the entry's ask.
- `CONTEXT.md` amends the preparation. `docs/configuration.md` gains the key, `docs/credentials.md` says where the secrets of a created stack come from, `docs/workflow.md` says what the check prints, and the onboarding log has hurdle 29.
- The recorded `create-stack` scenario holds the list, the init, the preview of the new stack and a second init the tool refuses, on both supported CLI versions.
