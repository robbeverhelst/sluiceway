# The preview pool follows the cores of the machine

> Amends 0012 (the default of `concurrency`, fixed at 4) and 0084 (an empty `concurrency` reads as 4). Built as slice 5.21.

Record 0012 gave the pool a fixed size of 4 and left the right number for a small runner to be found on the first runs. Issue 198 found it, on a real repo of 51 Pulumi stacks and a runner with one core:

| previews at once | whole scan | median preview | slowest |
|---|---|---|---|
| 2 | 250 s | 5.6 s | 18.8 s |
| 4 | 243 s | 11.3 s | 27.5 s |
| 6 | 252 s | 17.5 s | 37.1 s |
| 8 | 264 s | 24.7 s | 50.9 s |

The total does not move, and at 8 it gets worse. Previewing is bound by the CPU, so a pool larger than the cores only slices the same cores thinner: every preview takes longer in proportion. GitHub's own runners have 4 cores for a public repo on `ubuntu-latest`, 2 for a private repo, 1 on `ubuntu-slim`, and a self-hosted runner often 1 or 2. So 4 fitted a public repo and was too many almost everywhere else. The cost is not the total, it is the time limit: `preview-timeout` is per preview, so on a runner with two cores every preview took about twice as long and a slow stack moved towards its limit for no gain.

## Decision

- **Without the `concurrency` input, the pool is the number of cores of the machine, from 1 to 8.** The count is Node's `os.availableParallelism()`, read once in the glue of the scan and handed to a pure function in the core with the input.
- **The input wins when it is set**, and is not held to that range. Someone who sets 16 on a large machine, or 2 on a shared one, gets what they wrote.
- **`action.yml` has no default for `concurrency`.** GitHub hands an action's default to the step as if the workflow had set it, so with `default: "4"` the step could never tell the two apart. An empty or white space input still means "not set" (0084), which now leaves the pool to the machine.
- **The scan says which number it used and where it came from**, once a job, on the line before the first `Previewing ...` line, in Sluiceway's own words:
  - `The pool is 3 previews at once, from the concurrency input.`
  - `The pool is 2 previews at once, one for each core of this machine, which has 2. The concurrency input sets another size.`
  - `The pool is 8 previews at once: this machine has 64 cores, and the pool follows them up to 8. The concurrency input sets another size.`
  - `The pool is 1 preview at once: this machine did not say how many cores it has. The concurrency input sets another size.`
  A scan with nothing to preview does not print it, as it prints no `Previewing` line. The same pool reads the tools' histories after the previews (0073), so they follow it too.

### The count, and why 1 to 8

- **What Node counts.** The action runs on Node 24, whose libuv (1.52) counts the cores the process may run on, then lowers that to a container's CPU limit (cgroup v1 and v2 quota), and never gives less than 1. A runner pod limited to one CPU on a large node reads 1, which is what the pool should be. A pod with no CPU limit reads the cores of its node, which the top of the range guards against.
- **1 at the bottom.** A pool cannot be smaller, and on a machine with one core the table above shows more previews buy nothing.
- **8 at the top.** Past the cores, a preview also holds memory (a program's own runtime, often hundreds of megabytes), and calls the backend and the cloud APIs, which have rate limits of their own. A 64 core runner, or a pod that reads its node's cores, would otherwise start 64 tools at once against the same backend. 8 is twice the old default and the largest pool the issue measured. A repo that has checked its backend and its memory can set the input higher.

### When the count cannot be read

The pool is 1, and the line says the machine did not say how many cores it has. That covers `availableParallelism` throwing, and anything that is not a whole number of 1 or more. On Node 24 it does not happen, since libuv gives at least 1, so this is a guard, and the guard picks the size that never has two previews share a core: the risk this record removes is a preview slowed towards its limit, and a slower scan is the lesser harm. The old 4 was rejected for the same reason the default changed.

## The time limit counts from when a preview starts

Issue 198 asked whether `preview-timeout` should count from when a preview starts rather than when it was queued. It already does, and that stays. The pool hands a stack to the adapter only when a slot is free, and the timer is set when the tool's process is spawned (`runProcess`, through the tool run of each adapter). A stack that waits for a place in the pool spends none of its limit there. Preparations (0053) run before the pool with their own limit, and a drift check or the tool's own diff (0048, 0055) takes the same slot with a limit of its own for each run.

What a small runner added was not queueing but sharing: previews that had started ran side by side on too few cores, and each took longer while its clock ran. That is what the new default removes. A limit that left out time spent waiting for a core cannot be measured from inside the job, and would make a timed out preview mean something other than "it ran this long".

The input keeps its meaning, and the docs now say it in words: the limit counts from when the preview starts, never while it waits for a place in the pool.

## Rejected

- **Keeping 4 and telling people to tune it**, as the docs did. The input stays for that, but the right number depends on the runner, which the action can read and a workflow author usually cannot.
- **Twice the cores, or cores plus one**, as build tools do for work that waits on disk. The measurements show previewing is not that: at twice the cores the total stayed the same and the previews got slower.
- **No upper bound.** The CPU is not the only thing a preview uses, and a container without a CPU limit reports its host's cores.
- **Clamping the input.** It belongs to the runner (0012), and the person who sets it knows the runner better than a range does.
