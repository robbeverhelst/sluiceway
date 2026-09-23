# Contributing

Thanks for wanting to help. This page says how to set up, what the rules are and how a change gets merged.

## Before you start

- For anything larger than a small fix, open an issue first so the direction is agreed before you write code.
- Read [CONTEXT.md](CONTEXT.md). It fixes the words used in code, docs and the dashboard. Each term lists words to avoid.
- Skim [docs/adr](docs/adr). A change that goes against a decision record needs a new record, not only a pull request.
- Check [docs/later.md](docs/later.md). It lists what was left out of v1 on purpose.

## Setup

You need [Bun](https://bun.sh). The version is pinned in `.bun-version`. Use that exact version, because it decides the bytes of `dist/`.

```sh
bun install
```

## Commands

| Command | What it does |
|---|---|
| `bun run lint` | Biome lint and format check. |
| `bun run lint:fix` | The same, and writes the fixes. |
| `bun run typecheck` | TypeScript, strict, no emit. |
| `bun run test` | Unit tests with `bun test`. |
| `bun run build:schema` | Writes `schema/sluiceway.schema.json` from the Zod schema in `src/core/config.ts`. |
| `bun run check:schema` | Generates, then fails if `schema/` differs from what is committed. |
| `bun run record:fixtures` | Records `test/fixtures/pulumi/` with the `pulumi` CLI on your PATH. With `--tool opentofu` it records `test/fixtures/opentofu/` with `tofu`, and with `--tool helm` `test/fixtures/helm/` with `helm` and its diff plugin against the cluster `KUBECONFIG` names. See below before you commit its output. |
| `bun run example` | Writes the example dashboard to `assets/example-dashboard.md` and into the README, from the made-up rows of `scripts/example-dashboard.ts`. |
| `bun run build` | Bundles `src/main.ts` into `dist/index.js` for the Node runtime of GitHub Actions, and `src/cli.ts` into `dist/cli.js`, the command line the npm package `sluiceway` runs (record 0094). |
| `bun run check:dist` | Builds, then fails if `dist/` differs from what is committed. |
| `bun run check` | All of the above, as CI runs them. |
| `bun run e2e` | Scans a copy of `examples/pulumi-basic` with the committed bundle, the `pulumi` CLI on your PATH and the fake GitHub server: a full scan and a narrowed one, then the whole loop of ticks, `resolve`, `apply` with the real tool and `settle`, with a refused tick, a cancelled deploy, a moved change and a re-run. `node` on your PATH has to be Node 24, because it stands in for the runner's own. The `e2e` workflow runs it on every pull request. |
| `bun run e2e:mixed` | One repo with `examples/pulumi-basic`, `examples/opentofu-basic` in `infra/` and `examples/helm-basic` in `helm/`, scanned and deployed with the committed bundle, `pulumi`, `tofu` and `helm` with its diff plugin on your PATH, a cluster in `KUBECONFIG`, the plugin's directory in `HELM_PLUGINS`, and the fake GitHub server: a full scan, an OpenTofu deploy of its saved plan, a change that moved, a Pulumi deploy, a Helm release that moved and then deploys, and a last scan. The `mixed` job of the `e2e` workflow runs it with both tofu and helm versions of the fixtures, on a kind cluster. |

## dist/ is committed

GitHub runs a JavaScript action straight from the repository, so the bundle in `dist/` is part of the source. When you change anything under `src/`, or a runtime dependency, or the Bun version:

```sh
bun run build
git add dist
```

CI fails when `dist/` does not match the source. Never edit `dist/` by hand.

The JSON schema of `sluiceway.yaml` works the same way. It is generated from the Zod schema that config loading uses, committed, and checked in CI. When you change `src/core/config.ts`:

```sh
bun run build:schema
git add schema
```

Never edit `schema/sluiceway.schema.json` by hand.

The example dashboard works the same way too (record 0088). `assets/example-dashboard.md` and the example in the README are what the renderer gives for the made-up rows of `scripts/example-dashboard.ts`, at the version in `package.json`, and a test fails when either one is not. Other sites fetch the file raw at a release tag. When a change to `src/render/` changes the body, or you add a feature a reader should see:

```sh
bun run example
git add assets/example-dashboard.md README.md
```

The release workflow runs it on the release pull request, because that is where the version changes. Never edit either copy by hand.

## Recorded fixtures

The adapter tests parse what the real `pulumi` CLI printed, never text written by hand (record 0001). `scripts/record-fixtures.ts` drives `examples/pulumi-basic` through the scenarios in `scripts/fixtures/scenarios.ts` and saves stdout, stderr and the exit code of each recorded command, one directory per scenario, under `test/fixtures/pulumi/<cli version>/`.

There are two sets: one recorded with the minimum CLI version that Sluiceway supports and one with the newest at the time. `scripts/fixtures/versions.ts` names both, and the `fixtures` job in CI runs the recorder with each on every pull request.

The tool prints absolute paths, so the fixtures in the repo come from that CI job and not from a laptop. When you change the example project, a scenario or a version:

1. Push the branch. The `check` job is red until the fixtures fit again, the `fixtures` job is what you need.
2. Download what it recorded and commit it:

```sh
rm -rf test/fixtures/pulumi
gh run download <run id> --pattern 'fixtures-v*' --dir test/fixtures/pulumi
mv test/fixtures/pulumi/fixtures-v*/* test/fixtures/pulumi/ && rmdir test/fixtures/pulumi/fixtures-v*
```

You can run the recorder yourself to try a scenario: `bun run record:fixtures --out /tmp/try --only replace`. It needs `pulumi` on your PATH, and Node.js for the TypeScript program. It runs the tool only in copies inside a temp directory, against a file backend it makes there, with an environment built from nothing. It cannot reach a stack, a backend or an account of yours, and it leaves `examples/` as it was.

Never edit a file under `test/fixtures/pulumi/` by hand.

OpenTofu works the same way (record 0053): `scripts/fixtures/opentofu-scenarios.ts` drives `examples/opentofu-basic`, `FIXTURE_TOFU_VERSIONS` in `scripts/fixtures/versions.ts` names the two versions, and the `fixtures-opentofu` job of CI records them. A recording writes the plan file as `{plan}`, so it holds no path of the machine that made it. To take them from CI:

```sh
rm -rf test/fixtures/opentofu
gh run download <run id> --pattern 'fixtures-opentofu-*' --dir test/fixtures/opentofu
mv test/fixtures/opentofu/fixtures-opentofu-*/* test/fixtures/opentofu/ && rmdir test/fixtures/opentofu/fixtures-opentofu-*
```

Helm works the same way too (record 0058), with one difference: a diff needs a release to compare with, so the recorder needs a cluster. Give it one that holds nothing else, such as `kind create cluster`, in `KUBECONFIG`, and the diff plugin's directory in `HELM_PLUGINS` (`helm env HELM_PLUGINS`). It makes the example's namespaces, and each scenario starts by uninstalling the example's releases. `scripts/fixtures/helm-scenarios.ts` drives `examples/helm-basic`, `FIXTURE_HELM_VERSIONS` names the helm and plugin versions, and the `fixtures-helm` job of CI records them on a kind cluster:

```sh
rm -rf test/fixtures/helm
gh run download <run id> --pattern 'fixtures-helm-*' --dir test/fixtures/helm
mv test/fixtures/helm/fixtures-helm-*/* test/fixtures/helm/ && rmdir test/fixtures/helm/fixtures-helm-*
```

The Pulumi download pattern `fixtures-*` also matches these artifacts, so download the Pulumi ones with `--pattern 'fixtures-v*'`.

Kubernetes manifests need a cluster (record 0060): `scripts/fixtures/kubectl-scenarios.ts` drives `examples/kubernetes-basic` against the cluster that `KUBECONFIG` names, and the recorder refuses to start unless its current context is a kind cluster. Every scenario deletes and makes the namespace `sluiceway-example`. `FIXTURE_KUBECTL_VERSIONS` names the two versions, and the `fixtures-kubectl` job of CI records each against a kind node of its own minor version. A recording writes the rendered set as `{plan}`, and the prune file of a stack with `prune` as `{prune}` (record 0070). To take them from CI:

```sh
rm -rf test/fixtures/kubectl
gh run download <run id> --pattern 'fixtures-kubectl-*' --dir test/fixtures/kubectl
mv test/fixtures/kubectl/fixtures-kubectl-*/* test/fixtures/kubectl/ && rmdir test/fixtures/kubectl/fixtures-kubectl-*
```

To try it on your machine, make a cluster for it and nothing else: `kind create cluster --name sluiceway-fixtures`, then `bun run record:fixtures --tool kubectl --out /tmp/try`.

## Rules for code

- TypeScript, strict, ESM.
- `src/core/`, `src/adapters/` and `src/render/` never import `@actions/*`, `@octokit/*`, anything under `src/github/` or `src/modes/`, or the entry point. They never read a GitHub event payload. A lint rule and `test/boundary.test.ts` enforce this. See [src/README.md](src/README.md).
- No property value ever leaves an adapter. Do not add a field that could hold one. The one exception is the tool's own diff of record 0048, which only the job log takes, and only when a repo turned on `scan.logDiff`.
- Do not print, log or store anything from the environment.
- Ask in an issue before you add a runtime dependency. Everything in `dependencies` ends up in the bundle that every user downloads on every run.
- No license headers in source files. The [LICENSE](LICENSE) file covers the repository.

## Rules for words

This applies to docs, comments, error messages and everything the dashboard shows.

- Plain and direct. Short sentences. No marketing language.
- No em-dashes.
- Use the terms from [CONTEXT.md](CONTEXT.md), and not the words it says to avoid.

## Commits and pull requests

- [Conventional commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:`, `test:`, `build:`, `ci:`, `chore:`, `refactor:`. The release notes and the version number are built from them.
- Small commits that each do one thing.
- One pull request per topic. Say what is in it and how you checked it.
- Workflows pin every third-party action by commit SHA with the version in a comment, and ask for the smallest `permissions:` that work.

## Decision records

A decision that is hard to reverse, surprising without context and the result of a real trade-off gets a short record in `docs/adr/`, numbered in order. When a decision leaves something out of v1, add a line to [docs/later.md](docs/later.md) in the same change.

## Releases

[release-please](https://github.com/googleapis/release-please) keeps a release pull request open on `main`. Merging it creates the tag and the GitHub release, and moves the major tag (such as `v1`) to the new release.

## License

By contributing you agree that your contribution is licensed under [Apache-2.0](LICENSE).
