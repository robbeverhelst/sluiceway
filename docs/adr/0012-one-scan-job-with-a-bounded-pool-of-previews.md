# A scan is one job that previews through a bounded pool, not a matrix of jobs

A scan runs in a single job, and the action previews stacks through a pool of fixed size. A matrix with one job per stack or per chunk was rejected. Every job pays the setup again: a runner pod starting from zero, the checkout, one dependency install at the repo root, the provider plugins, loading secrets. Against previews of seconds to tens of seconds, that setup dominates. On the first user's pool of four runners a matrix of 58 jobs would run in about fifteen waves and starve the repo's own CI, which shares those runners. A matrix also forces three jobs (discover, scan, render) and an artifact hand-off into every consumer workflow, including the zero config user with three stacks.

Parallel previews inside one job are safe: previews of different stacks share nothing, a preview takes no state lock, plugin installs are guarded by lock files, and the adapter always passes the stack and the directory and never selects a stack (0001 and its research).

## Consequences

- The action input `concurrency` sets the pool size. The default is 4. No real timing exists yet for the homelab's runners (1 CPU, 4 Gi), so the right value there is found on the first runs. It is an input and not a config key because it belongs to the runner, not to the repo.
- The pool starts the next preview when one finishes, in stack id order. A stack is never previewed twice at the same time within a scan, so a program that writes into its own directory or a fixed temp path during preview, as two homelab programs do, cannot race itself.
- Every preview runs with the stack's directory as its working directory. Programs resolve files from it.
- Each preview has a time limit: the `preview-timeout` input, default 10 minutes, with an optional per stack override in config. When it expires the whole process group gets SIGINT, then SIGKILL after a short grace period, and the stack gets a preview failure row that says it timed out. Killing a preview is safe because it holds no lock. The worst case length of a scan is the number of stacks, divided by the pool size, times the limit.
- There is no deadline for the scan as a whole. All slow work comes before the one write (0004), so a job that the workflow's own `timeout-minutes` kills writes nothing and moves nothing, and the next scan covers the same range (0011).
- One stack's failed or slow preview never stops the others. It occupies one slot of the pool until it ends or times out.
- The scan job succeeds when it wrote a dashboard that tells the truth, even if previews failed. Each preview failure is a row, a warning annotation on the run and part of the failing count in the header. The job fails only when the scan could not do its work: discovery or config errors, a CLI below the floor (0001), a dashboard write that still fails after its retries (0004), or every attempted preview failing when more than one was attempted. That last case nearly always means the environment is broken, such as missing secrets or an unreachable backend or cluster. The dashboard is still written first, because the rows are true: nothing can be deployed either. A job that went red for one broken stack on every push would teach people to ignore red. There is no strict mode input in v1. It can be added without breaking anything.
- Spreading a scan over several runners is left out of v1 on purpose, and kept possible. It would arrive as a shard input, and each shard would write as a narrowed scan does (0011). The scan concurrency group of 0004 would then need a second look, since shards of one scan must overlap while scans must not.
- Setup stays the user's job, in workflow steps before the action: installing the tool, installing dependencies, caching the plugin directory. One job means it is paid once per scan.

## Settled while building (slice 1.11)

- The order of a scan is: config, discovery, the version check, the pool, the job log and the annotations, the summary, the size budget, the one write, and only then the job result. A summary that cannot be written is a warning and nothing more (0037). A body that does not fit (0028) fails the job before any write, so the old body stays.
- A repo without stacks needs no tool. The version check is skipped when there is nothing to preview, so the first-run dashboard also appears in a repo where the tool is not installed yet.
- "Every attempted preview failing when more than one was attempted" counts the previews of this scan. A repo with a single stack never goes red for a preview failure.
- The warning annotation reads `The preview of <stack id> failed: <failure reason>.` The failure reason has one form everywhere, lower case and without a full stop, the wording of the list in 0022. A row, the summary, an annotation and later a deployment status each build their own sentence around it.
- The job log says how long each preview took, as each one finishes, and then the total, the sum of all previews and the slowest stack. The right `concurrency` and `preview-timeout` for a runner are read from these lines.
- Each stack's group in the job log is printed after the pool is done, in stack id order, so previews that ran side by side never mix their lines. The tool's own words are printed as they are (0022), which includes a line that the runner reads as a workflow command. A stack program is the user's own code and has the same standing in the job as any other step of their workflow.
- An error thrown by the adapter past its own preview failures is a fault of Sluiceway's. It stops the pool from starting new previews and fails the job.

## Settled while building (slice 3.1)

- With a replayed tool that answers at once, a full scan of 100 stacks through the real adapter, ten of them previews of 300 resources, takes about 0.2 s of Sluiceway's own work: discovery, parsing, the body, the budget, the summary and the write. A scan is as long as its previews.
- With every preview taking 40 ms, the pool of 4 previews 100 stacks in 1.0 s, which is 100 divided by 4 times 40 ms. That is the formula for the worst case above, with the time limit in place of the 40 ms.
