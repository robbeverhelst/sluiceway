# Helm drift is what the three-way diff finds beyond the plain one, and the deploy's flags follow the helm it runs

Build plan slice 5.2 is part 2 of Helm: a drift check with the diff plugin's three-way merge against the live objects, `createNamespace`, `--rollback-on-failure` in place of `--atomic`, and subcharts. Record 0058 left all four for later. This record settles them from what helm v3.18.0 with diff plugin v3.15.11, and helm v4.3.0 with plugin v3.15.13, printed against a kind cluster on 2026-09-22, from the plugin's source at v3.15.11, v3.15.12 and v3.15.13 (`cmd/upgrade.go`, `manifest/generate.go`), and from helm's `pkg/cmd/upgrade.go` at v4.3.0 and `cmd/helm/upgrade.go` at v3.19.0 and v3.22.0.

Amends 0055 and 0058.

## Decision

### The drift check

**A Helm stack has the drift check of record 0055.** It is the optional adapter method `detectDrift`, in the same scans, on the same row, with the same marker key, and repaired by a tick. Only how Helm finds drift is new.

**Two diffs, one after the other, in the stack's directory and with its time limit:**

| Diff | Command | Compares the chart with |
|---|---|---|
| Plain | the preview's own `helm diff upgrade ... --output=structured` | the manifest helm stored for the release |
| Three-way | the same with `--three-way-merge --no-hooks` | the live objects, merged the way a deploy merges the chart into them |

The plain diff never sees a change made with kubectl: it reads the release, not the cluster. The three-way diff shows what a deploy would change in the cluster: the code's changes and, next to them, what the deploy would put back. So drift is what the three-way diff finds beyond the plain one:

| Three-way diff | Plain diff | Drift |
|---|---|---|
| `ADD` | no `ADD` of the object | `delete`: the object is gone from the cluster |
| `MODIFY` with paths | the paths it does not have | `update` with those paths |
| `REMOVE` | the same `REMOVE` | nothing: the code removes it |
| `REMOVE` | anything else | the check fails, output Sluiceway cannot read: both diffs read removals from the release |

- **A path both diffs change is the code's change.** The deploy sets it to the code's value either way, and the row already names it. Comparing the old values would catch a field changed both in the code and by hand, but the live value and the stored one can differ in form alone, such as a CPU quantity the API server rewrote, and a row must never claim drift that is not there.
- **A field the chart does not set**, such as a label added by hand, is kept by a deploy and is in neither diff. It is no drift, as for Pulumi a property the program does not set is none.
- **`--no-hooks`.** Hooks are not merged into live objects: every deploy makes them anew. A hook that deletes itself once it ran, such as a migration job with `hook-succeeded`, is never in the cluster between deploys, and without `--no-hooks` the three-way diff adds it every time, which would read as an object gone (recorded as `drift-hooks`).
- **Nothing of a value** leaves the check. The three-way diff holds the live values, the plain one the stored ones, and both stay in the adapter. `dashboard.showValues` does not reach drift (record 0055).
- **A release that is not installed** has no drift: both diffs add everything.
- **The plain diff runs again** inside the check, right after the scan's preview ran it. The adapter interface hands the check no preview, and the preview's diff has no paths of objects it does not change. It is one more run of the tool per checked stack, in the scans that check.
- **Permissions.** The plugin sends each merge to the API server as a dry-run patch, which changes nothing and needs `patch` on the release's objects. From plugin v3.15.13 a refused patch makes it merge locally, with read access only, and say so on stderr, which goes to the job log. Plugin v3.15.11 and v3.15.12 have no such fallback in their source, so their check fails with read access only. The floor stays v3.15.11: the preview does not need it.

### The deploy

**The flag that rolls a failed deploy back follows the helm that runs.** Helm 4 renamed `--atomic` to `--rollback-on-failure` and keeps the old name as a deprecated alias that prints a warning. Helm 3, up to v3.22.0, has only `--atomic`, and it still gets releases next to Helm 4. So the deploy reads `helm version` right before it starts and passes `--rollback-on-failure` to Helm 4 and `--atomic` to Helm 3. It reads it after the render check, so a moved change is still refused before anything else runs. A version it cannot read deploys nothing.

**A deploy that repairs drift on Helm 4 forces conflicts where the release is applied server-side.** Recorded on both versions (`drift-repaired`):

- Helm 3 merges the chart into the live objects on every upgrade, client-side, and that puts drift back by itself. It knows no `--force-conflicts`.
- Helm 4 applies a release it installed itself server-side. A field that kubectl changed now belongs to another field manager, and the upgrade fails on the conflict and rolls back. `--force-conflicts` takes the field back.
- Helm 4 keeps applying a release that Helm 3 installed client-side, and refuses `--force-conflicts` there ("forceConflicts enabled when serverSideApply disabled").

So only a deploy asked to repair drift (record 0055: the approved hash covers drift, and `apply` found it again) on Helm 4 reads `helm get metadata <release> --output=json`, and adds `--force-conflicts` when it says `"applyMethod": "ssa"`. The metadata names the release, its chart, versions and status, and no value. A deploy without drift never forces a conflict: a field another manager owns then fails the deploy with helm's own words, which is what the team would see without Sluiceway.

**`createNamespace`**, a named option of a Helm stack, `false` by default. With it the deploy passes `--create-namespace`, and nothing else changes. Recorded on both versions (`create-namespace`): the diff, with `--dry-run=server`, and the render work when the namespace is not there, and the plugin knows no `--create-namespace` flag, so only the deploy takes it. The namespace is not an object of the release and is not on the row. A repo that turns it on in `sluiceway.yaml` has said that its deploys may make the namespace.

### Subcharts

**A local dependency's own dependencies are built first, down the whole tree.** A dependency with a `file://` repository is a local chart, which `helm dependency build` packages from its directory as it is. If that chart lists dependencies of its own and they were not built, helm renders the release without that subchart's objects, and says nothing: tried with helm v3.18.0 while this record was written, a diff of `worker` whose dependency `web` depended on `base` had no `worker-base` ConfigMap and exited 0. Discovery therefore follows the `file://` dependencies of a local chart, from `Chart.yaml` files alone, and every chart of that tree that lists dependencies gets its own preparation (record 0053): one `helm dependency build .` per chart directory, for every stack that needs it, lowest level first and in path order within a level, where a chart's level is one more than the highest level of the local charts it depends on. Recorded as `dependencies-nested`: `web` is built, then `worker`, and the diff holds `worker-base`.

- **Discovery follows only what it can read.** A `file://` dependency that is not a chart inside the repo, whose `Chart.yaml` is not YAML, or that closes a circle is not followed. It is left to helm: when it cannot work, the build of the chart that lists it fails, which is a preview failure of the stacks that need it (record 0058). It never becomes a config error that stops every stack.
- **A subchart kept in a chart's own `charts/` directory is used as the repo holds it.** `helm dependency build` of a chart does not reach into it, and building it could need a repository that its vendored copy never needed.
- The options bag carries the charts to build and their levels in place of 0058's yes or no, and the chart's directory as before.

## Rejected

- **A drift check from `helm get manifest` and the live objects,** read by Sluiceway. The manifest holds every value in plain text, and Sluiceway would have to merge and compare Kubernetes objects itself. The plugin does both, and it is already a floor.
- **Only the three-way diff,** shown as the row's whole diff with drift left in it. It mixes the code's changes and drift, and a tick would approve both without the row telling them apart (record 0055 keeps them apart).
- **Passing the preview's diff to `detectDrift`.** It changes the adapter interface that four adapters share, to save one run of the tool per checked stack in scheduled scans.
- **Dropping Helm 3** so that one command line serves every deploy. Helm 3 still gets releases, and record 0058 set v3.18.0 as the floor.
- **Forcing conflicts on every Helm 4 deploy,** or passing `--server-side=true --force-conflicts` for a repair. The first takes fields from other managers without a tick that approved it. The second silently moves a release that Helm 3 made to server-side apply.
- **A config error for a `file://` dependency discovery cannot follow.** It would turn one chart's broken dependency into a stop of every stack, where record 0058 made it a failure of that chart's stacks.
- **Building subcharts kept in `charts/`.**

## Consequences

- Amends 0055: Helm stacks are checked for drift, and the tick that repairs it adds `--force-conflicts` on Helm 4 where the release is applied server-side. OpenTofu stacks are still not checked.
- Amends 0058: the deploy passes `--rollback-on-failure` to Helm 4 and `--atomic` to Helm 3 after reading the version, `createNamespace` is a named option, and a preparation builds the local charts a chart depends on before it. The rest of 0058 holds.
- A deploy of a Helm stack runs `helm version` once more, and a repair on Helm 4 runs `helm get metadata` too. Neither reaches past the release.
- The recorder refuses to run the Helm scenarios against a context that is not a kind cluster, as it does for kubectl, because the drift scenarios change and delete objects with kubectl. Its Helm scenarios are made per helm version, because the deploy's command line differs.
- Still in `docs/later.md`: a `kubeContext` option, zero-config discovery from `Chart.yaml`, and `--take-ownership`.
