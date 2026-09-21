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
