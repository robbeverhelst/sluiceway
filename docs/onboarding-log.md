# Onboarding log

Every hurdle met while putting Sluiceway into a real repo for the first time, written down when it happens, with what we decided to do about it. The aim is an onboarding that a stranger gets through in one sitting, without reading the decision records.

Rules:

- A hurdle gets a line the moment it is met, before it is fixed or worked around. A workaround that only the first user knows is the thing this file exists to catch.
- Write the hurdle as any new user would meet it. The first real user's repo is the evidence, never the subject.
- Each line ends in a decision: **product** (change the action), **docs** (a recipe or a sentence), **tooling** (something around the action), **accept** (leave it, with the reason), or **open** (not decided yet, with a recommendation).
- A product decision becomes a slice in `docs/build-plan.md` or a line in `docs/later.md`. This file only points.

## Before the first scan

| # | Hurdle | What a new user feels | Decision |
|---|---|---|---|
| 1 | There was no way to check a setup without running it. The first user's config and stack discovery were dry-run with Sluiceway's internal code before the first push. That check caught nothing, but it was the only reason to push with confidence. | "I have to merge a workflow and wait for a run to learn that my config has a typo or that half my stacks were not found." | **open.** Recommended: a `check` mode that needs no credentials and no tool: load `sluiceway.yaml`, list the stacks discovery finds, list files in the repo that no stack claims, and say what a push to each would do. Usable in a pull request. |
| 2 | The workflow is about 50 lines before Sluiceway's own step: checkout, the language runtime, dependencies, the tool, a plugin cache, the secret manager, the secrets. | "Most of this file is not about Sluiceway and I had to work it out myself." | **open.** Recommended: **docs** first, with complete example workflows per setup (Node programs in a monorepo, a secret manager, a cloud with OIDC), then decide on a generator once two or three real setups exist. |
| 3 | Loading secrets from a secret manager's env file into the job needed a 40 line script (one `op run`, mask every value, write to `GITHUB_ENV`). The vendor's own action reads once per reference and drops plain values. | "The scary part of the setup is the part I had to write by hand." | **docs** (slice 2.10, `docs/credentials.md`): ship the script as a tested recipe. **open:** whether to also publish it as a small separate action in the `sluiceway` org. It runs in the user's job and holds nothing, so it keeps the credential promises. |
| 4 | `ignore` matches the stack id and never the bare path, so `apps/grafana` ignores nothing and `apps/grafana:*` is what works. | "I ignored a stack and it is still on the dashboard, with no message." | **open.** Recommended: **product**, a config warning when an `ignore` glob matches no stack but does match a stack's path, naming the glob that would work. |
| 5 | Files that no stack claims (docs, CI files, tool configs) force a full scan until they are listed under `scan.unrelated`. A sensible list had to be guessed up front. | "Every push previews everything and I do not know why." | **open.** Recommended: **product**, the log group that lists unclaimed files already says where they belong; also print a ready-to-paste `scan.unrelated` block in the summary of a scan that fell back for this reason. |
| 6 | The runner needs version 2.328.0 or newer (node24), and the tool needs a minimum version. | "It failed before it started." | **accept.** Both fail with one clear message that names the fix. Listed in the README's requirements. |
| 7 | Before the first release the action has to be pinned to a 40 character commit SHA, and the header image only shows from a real tag or commit. | "The example in the README does not work as written." | **accept.** Goes away with release 0.1.0. The README says it until then. |

## The first scan

Filled in from the first real run.

| # | Hurdle | What a new user feels | Decision |
|---|---|---|---|
| | | | |

## Living with it

Filled in from the days after.

| # | Hurdle | What a new user feels | Decision |
|---|---|---|---|
| | | | |
