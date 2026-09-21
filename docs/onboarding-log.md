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
| 8 | Two files with nearly the same name: `.github/workflows/sluiceway.yml` (GitHub's, when and how to run) and `sluiceway.yaml` (Sluiceway's, settings about stacks). The first user asked why there are two. | "Which one do I edit, and did I put it in the right place?" | **open.** Recommended: **docs**, one "what goes where" table at the top of the README's setup, and name the workflow file differently in every example (`deploy-dashboard.yml`). |

## The first scan

First real run, 2026-09-21: 58 stacks, a full scan in 172 s with the default pool of 4 (previews added up to 675 s), median preview 11.9 s, slowest 28.4 s, so the defaults of `concurrency` and `preview-timeout` hold on a 2 CPU self-hosted runner. 14 pending, 36 in sync, 8 preview failed, job green. The body was 18,625 of 65,536 characters with every row in full. Loading 180 names from the secret manager cost one read request. The dashboard was created and pinned on the first try.

| # | Hurdle | What a new user feels | Decision |
|---|---|---|---|
| 9 | Seven stacks had a stack config file but no stack in the state backend. Each became a row that says "preview failed: the tool exited with an error (exit code 6)". The real reason, `no stack named 'dev' found`, is only in the job log. | "Seven red rows on my first dashboard, and the row does not tell me it is a stack I never created." | **open.** Recommended: **product**, a fixed failure reason of its own, "the stack does not exist in the backend", and the first-run summary names the `ignore` glob that takes such stacks off. |
| 10 | A program that pulls from a private registry (a Helm chart in a private package) works on a laptop, where the person is logged in, and fails on the runner. | "It works on my machine. Why is this one stack broken in CI?" | **docs** (slice 2.10): a short list, "what your programs fetch, the runner has to be able to fetch", with the registry login step as a recipe. The failure row already links to the log that names the registry. |
| 11 | A secret whose value is an ordinary word (here a username stored in the secret manager) is masked everywhere, so links in the log read `github.com/***/repo`. | "The log is full of stars and the links are broken." | **docs**: the env loading recipe masks only values that come from a secret reference, so keep non-secrets as plain values in the env file. Say so next to the recipe. |
| 12 | The first dashboard of a real repo showed the plain header: no colour, no mascot, no voice. Four pending rows held a replace or a delete, and three of those were routine replacements of a Kubernetes Secret or ConfigMap, which Pulumi replaces whenever their content changes. In a Kubernetes repo that is the normal state, so the header that sets Sluiceway apart would almost never show. | "Where is the thing from the screenshots?" | **product**, decided by the owner on 2026-09-21: the plain header goes away. A pending or deploying row with a delete or a replace gives an in-brand "careful" header state instead: the mascot and the colours stay, the playful voice does not, and the picture itself carries the warning. The row warnings do not change. `dashboard.personality: false` still removes the image and the voice. Records 0031 to 0033 and 0038 to 0040 get amended with the art, then a renderer slice follows. |
| 13 | The first run spent 2 m 16 s after the scan saving the tool's plugin cache. | "The scan took three minutes and the job took six." | **accept.** First run only. The example workflow keeps the cache step because every later run gains from it. |

## Living with it

Filled in from the days after.

| # | Hurdle | What a new user feels | Decision |
|---|---|---|---|
| | | | |
