# A check mode validates a setup with no credentials and no tool

The first real user could only learn whether their setup was right by merging a workflow and waiting for a scan. What gave confidence before that push was a dry run of the config loader and stack discovery, done by hand with Sluiceway's internal code. A stranger cannot do that (onboarding log, hurdle 1). So there is a fifth mode, `check`. It reads files and nothing else: no credentials, no infrastructure tool, no GitHub API, no write of any kind. The owner decided on 2026-09-21 that it is part of v1.

It was weighed against "docs only" (a checklist a person follows by eye). Rejected, because the mistakes it catches are exactly the ones a person does not see: a glob that matches nothing, a stack that discovery does not find, a file nobody claims.

## What it does

- Loads `sluiceway.yaml` and fails with the same messages a scan gives (0006, 0010, 0018).
- Runs discovery and lists every stack id it found, with the settings that apply to each: environment, tick rule, inputs.
- Says which `ignore` globs matched which stacks, and warns about a glob that matched nothing. When such a glob matches a stack's path but not its id, the warning names the glob that would work (onboarding log, hurdle 4).
- Lists the tracked files of the repo that no stack claims and that `scan.unrelated` does not cover, grouped by directory, since a push to any of them is a full scan (0010), and prints a ready-to-paste `scan.unrelated` block for the ones that look like docs and tooling. It never decides that for the user.
- Writes all of it to the job log and the job summary. The job is red only when the config is not valid or discovery fails.

## Consequences

- It needs `contents: read` and nothing else, so it is safe on `pull_request`, also from forks. The README's setup starts with it.
- It can never say that a preview will work. A stack that does not exist in the backend, a missing credential or a private registry only show in a scan. The summary says so in one sentence.
- The mode list of 0003 grows to five. `check` takes no `github-token`.
- Everything it prints is names Sluiceway derived from files in the repo. Nothing from the tool, no values (0021, 0022).

## Settled while building (slice 2.12)

- The check loads config, runs discovery and lays config over the stacks with the code a scan uses, in the same order, so its messages are a scan's messages and its first error is the one a scan would stop at.
- The files of the repo are the files of the checkout, walked from the root without entering `.git` or `node_modules` and without following a link to a directory. Asking git would mean a process. The README says to run the check right after the checkout.
- Unclaimed files are grouped by their directory at the top of the repo, the root first. The summary names up to 20 files per directory and the job log names all of them.
- The globs offered for `scan.unrelated` come from a fixed list: `**/*.md`, `docs/**`, `.github/**`, `LICENSE*`, `**/.gitignore`, `**/.gitattributes` and `.editorconfig`. A glob is offered only when it covers an unclaimed file. The block keeps the globs the config already has, so pasting it loses nothing. Lockfiles, package manifests and `sluiceway.yaml` are never offered: they are the shared files a full scan exists for.
- An `ignore` glob that leaves out nothing is a warning annotation. When the glob matches the directory of a stack, the warning offers the glob with `:*` added, and only when that glob does match the stack's id.
- The job goes red on a config error or a discovery error only, and the summary lists the problems first. Everything else is a line in the log, a group, a warning or a line in the summary.
- The check job is handed discovery and the job log, and nothing else. A test walks every import it can reach and fails when that includes the process runner, anything under `src/github/` but the job log, or a package besides `@actions/core`, `node:fs`, `node:path`, `picomatch`, `yaml` and `zod`. A second test runs the job with a `fetch` that fails on any call.

## Settled while building (slice 2.22)

- The summary of a push that fell back to a full scan because of files no stack claims shows the same block, under "Why this was a full scan", built from the files of that push, not the whole repo: the scan does not walk the checkout. The files are named up to 20, the config file is left out as in the log line of slice 2.13, and the block appears only when a glob of the fixed list covers one of them. A scan that is full for any other reason, or only because `sluiceway.yaml` changed, has no such section (onboarding log, hurdle 5).
