# Source layout

| Path | What lives there | May import `@actions/*` or GitHub glue |
|---|---|---|
| `main.ts` | Entry point of the action. Reads the `mode` input and dispatches. | Yes |
| `mode.ts` | The list of modes and the dispatch table. | Yes |
| `modes/` | One file per mode. A mode wires core, an adapter, render and the GitHub port together and holds no rules of its own. `scan.ts` takes everything it needs as data and seams, so tests run it against the fake GitHub and a replayed tool. `scan-job.ts` makes those from the runner's environment. | Yes |
| `core/` | Pure logic: types, config, which discovered stacks exist (`ignore`, one id per stack), the diff hash, the pool a scan previews through, when a scan could not do its work, the claim rule, the scan plan (which stacks a scan previews, when a narrowed scan falls back to a full one, the rule of one row per stack), the walk through the edit history that names the ticker of a tick, the tick rule, attribution. | No |
| `adapters/` | The adapter interface, the process runner every tool is started through, the tool environment, and one directory per infrastructure tool. | No |
| `github/` | Everything that talks to GitHub or to the runner: the port and its Octokit implementation, the write loop, the dashboard, the ticks of a run judged against the live permission lookup and the one comment for the refused ones, the action ref, the inputs, the facts of the job, and the job log with its annotations and summary. | Yes |
| `render/` | Turns scan results into the dashboard body: rows, markers, the body around the rows with its header state and its voice, the size budget. Also the summary of a scan, the log text of a diff and the comment for refused ticks. | No |

## The boundary

`core/`, `adapters/` and `render/` never import `@actions/*`, `@octokit/*`, anything under `github/` or `modes/`, or the entry point. They never read a GitHub event payload either. What they need is passed in as plain data. This keeps them reusable outside a GitHub Actions run. Rendering is inside the boundary because the core renders the diff itself (record 0002), so a hosted version would reuse it.

Two things enforce it:

- Biome's `noRestrictedImports` rule, scoped to those three directories in `biome.json`.
- `test/boundary.test.ts`, which scans every import in those directories.

