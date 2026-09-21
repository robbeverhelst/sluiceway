# Source layout

| Path | What lives there | May import `@actions/*` or GitHub glue |
|---|---|---|
| `main.ts` | Entry point of the action. Reads the `mode` input and dispatches. | Yes |
| `mode.ts` | The list of modes and the dispatch table. | Yes |
| `modes/` | One file per mode. A mode wires core, an adapter, render and the GitHub port together and holds no rules of its own. `scan.ts` takes everything it needs as data and seams, so tests run it against the fake GitHub and a replayed tool. `scan-job.ts` makes those from the runner's environment. `resolve.ts` and `resolve-job.ts` are the same pair for `resolve`, and `settle.ts` and `settle-job.ts` for `settle`. Neither is handed a tool environment or a process runner. `check.ts` and `check-job.ts` are the pair for `check`, which is handed only discovery and the job log, and builds no port. | Yes |
| `core/` | Pure logic: types, config, which discovered stacks exist (`ignore`, one id per stack), the diff hash, the pool a scan previews through, when a scan could not do its work, the claim rule, the scan plan (which stacks a scan previews, when a narrowed scan falls back to a full one, the rule of one row per stack), deployment records (the task, the payload, the deploy facts of a stack and the row it gets at a scan's late read), the walk through the edit history that names the ticker of a tick, the tick rule, the orphan tick rule of a scan (when a tick is carried, swept or previewed first), the matrix that `resolve` hands on and its cap, the open records of its own run that `settle` ends, attribution (which commits are in a stack's range, which pull requests and direct pushes it claims, and the line a row gets), the check (what a scan would make of the repo's files, the hint for an `ignore` glob that names a directory, the files no stack claims and the globs offered for `scan.unrelated`) and the files of the checkout. | No |
| `adapters/` | The adapter interface, the process runner every tool is started through, the tool environment, and one directory per infrastructure tool. | No |
| `github/` | Everything that talks to GitHub or to the runner: the port and its Octokit implementation, the write loop, the dashboard, the bounded reads of deployment records and the ending of one whose run is over, the walk of the lookback and the files of its direct pushes for attribution, the ticks of a run judged against the live permission lookup and the one comment for the refused ones, the action ref, the inputs, the facts of the job, the issue of the event payload, the workflow a rescan dispatches, and the job log with its annotations and summary. | Yes |
| `render/` | Turns scan results into the dashboard body: rows, markers, the body around the rows with its header state and its voice, the size budget. Also the summary of a scan, the log text of a diff, the comment for refused ticks and the clearing of a ticked box on a row that is carried. Also the summary of the check and the text its job log shares with it. | No |

## The boundary

`core/`, `adapters/` and `render/` never import `@actions/*`, `@octokit/*`, anything under `github/` or `modes/`, or the entry point. They never read a GitHub event payload either. What they need is passed in as plain data. This keeps them reusable outside a GitHub Actions run. Rendering is inside the boundary because the core renders the diff itself (record 0002), so a hosted version would reuse it.

Two things enforce it:

- Biome's `noRestrictedImports` rule, scoped to those three directories in `biome.json`.
- `test/boundary.test.ts`, which scans every import in those directories.

