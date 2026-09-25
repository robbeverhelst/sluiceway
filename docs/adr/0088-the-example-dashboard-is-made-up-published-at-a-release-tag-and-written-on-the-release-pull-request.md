# The example dashboard is made up, published at a release tag, and written on the release pull request

> Amended by 0110: the generator exports the example as data, `EXAMPLE`, and `exampleBody` draws the body from it under the settings a reader gives, so a reader redraws the example whole instead of taking it through the published file's markers.

> Amended by 0097: the README's copy keeps the header picture and the counts line open above the fold, and ends each continued row line in `<br>`.

> Built as slice 5.24. Replaces the line of build plan section 8 that pinned the README's example to `v0.1.1`.

The owner looked at sluiceway.dev on 2026-09-23 and found that its example dashboard was not what Sluiceway ships: the deploying rows at the bottom instead of the top (0063), old pictures, and none of what came after (drift, merge and deploy, the bulk boxes, the trail's shipped lines). The landing site kept its own copy by hand, so it drifted with every release. The README's copy, made by the renderer since slice 2.15, had drifted too: it named `v0.1.1`, whose tag holds no `pending-4-deletes-*.svg` (the delete sign came with 0075), so its header picture did not load, and its attribution lines were hand-written with seven character compare links where the core writes twelve.

## Decision

- **One generator, `scripts/example-dashboard.ts`, gives the whole body** from made-up rows through the real renderer, and `bun run example` writes it to `assets/example-dashboard.md` and into the README. The README's copy is the same body made fit for a README, as before: no markers, headings one level down, `#N` linked to the example repo, in a closed `<details>`.
- **The file is the body as a scan writes it into the issue**, markers included, and a final newline. Another site renders what it wants of it. `assets/` already holds what other pages fetch raw at an exact tag (0033), so the file sits next to the pictures: `https://raw.githubusercontent.com/sluiceway/sluiceway/v<version>/assets/example-dashboard.md`.
- **Every section a reader should see is on it at once**: the header picture with crates and both signs, deploying rows at the top with the spinner and one queued behind its dependency, a merge and deploy row with its branch preview, an update waiting on its checks, pending rows with a shown value, a delete, a replace, a direct push and a change outside the stack, the destroy alert, the bulk box under pending, drift with a resource gone and a confirm box under it, in sync and the ignored stacks folded, the trail with shipped lines, a deploy with no changes, a drift repair, a failed deploy that a later one cleared and an outside deploy, the rescan box and the footer. A test names each of them, so a feature cannot fall off the example without a red test.
- **No preview failure and no failure line.** The header shows one state and bad news wins (0031): either one turns the picture to failing, and the deploying picture with its crates and signs is the one the example is for. The trail still shows a failed deploy, which does not change the header.
- **Attribution comes from the core.** The rows' `from` lines, the fold of changes outside a stack and the trail's shipped lines come from `attributor` over a made-up history of eleven commits, with the claim rule, as a scan works them out. Nothing on the example is written in the core's format by hand.
- **The example names the version of the checkout**, `v` and `package.json`'s version, in its pictures and its footer, as a running action does (build plan, section 3). A test fails when the file or the README is not what the generator gives, and another when a picture it names is not in `assets/mascot/`.

## Why made-up rows and not a real repo's body

A real body would need its repo's permission to publish, and a way to keep its stack ids, logins, pull request titles, resource names and property paths out, which is what `redact` does and what the example exists to show. It would need a run of Sluiceway against that repo on every release, and it would show that repo's day: no real repo has deploying, pending, drifted, merge, waiting, confirm and outside deploy rows at once. Made-up rows have no real names, no values (the one shown value, `2 → 3`, is made up too), nothing to redact, and hold every section on every release. The repo is `example-org/infra`, and the logins are first names.

## How the release keeps it current

The version changes in the release pull request, which release-please writes and which runs no script. release-please's own updater for extra files was read and rejected: it replaces the first version on a line only, and a deploying row names the spinner twice on one line, so the file would come out half updated and the test would turn the release pull request red.

So the release workflow does it. After release-please, when it created or updated the release pull request, the workflow checks out that branch, runs `bun run example`, and when the example changed commits `assets/example-dashboard.md` and `README.md` through GraphQL `createCommitOnBranch`, on the head it checked out. GitHub signs a commit made through the API. A newer push by release-please moves the head, the commit is refused, and the next run of the workflow writes it again. The release tag then holds an example that names itself, and a release pull request whose example is stale is red, so it cannot be released that way.

Between releases the file on `main` names the newest release, whose pictures exist at its tag. A picture that a change on `main` starts to use exists at a tag only from the next release on, so a reader of `main` may see it missing until then. Consumers fetch at a tag, where that does not happen.

## Considered

- **A release asset** (`gh release upload` after the tag), with a stable `releases/latest/download/` address. It needs no commit, but it is not in the repo, so no test can hold it to the renderer, and the slice asked for a committed file.
- **A fixed ref, bumped by hand**, as the README had. That is the drift this record removes.
- **The previous release's version**, so the release pull request needs no commit. The tag would then name the version before it in its footer, and a picture new in that release would be missing from its example.
