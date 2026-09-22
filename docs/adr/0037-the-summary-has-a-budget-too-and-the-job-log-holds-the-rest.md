# The summary has a budget too, and the job log holds what does not fit

> Amended by 0044: the summary opens with an index of the stacks that rows link to, and every stack has an anchor.

Records 0021 and 0028 call the summary the full version that a shortened or redacted row links to, with no budget. GitHub does set one: a step's summary may be 1 MiB, and a larger one is dropped whole. The upload fails with an error annotation and the step stays green (Actions research). Every link to the summary would then point at nothing, on exactly the scan where the most is happening.

So the summary gets a budget of 1,000,000 UTF-8 bytes, counted on the final text, and the full list moves one step down when it does not fit: Sluiceway also prints every stack's diff to the job log, in its own words, grouped per stack. The job log has no size limit that matters here.

Uploading the full diffs as an artifact was rejected. It is a file to download and open, where the log is one click from the run page, and artifacts are a surface that record 0014 keeps empty. Splitting the summary over several steps was rejected because an action is one step.

## Consequences

- At about 150 bytes per change line the budget holds several thousand changes. Shortening the summary is for a very large repo on the day everything is pending at once.
- The summary shortens the way the dashboard does (0028), with two levels: a stack's changes other than deletes and replaces become one line with their count, biggest stack first, and then a stack's delete and replace lines go, all or none, with the full count in its warning. The pull request list of 0026 is cut before any change line.
- When anything is cut, a note at the top of the summary says so and names the place where nothing is cut: the job log of the same run, under the stack's group.
- The log lines follow 0021 and 0022: addresses by type and name, ops, tracking changes and property names, written by Sluiceway. Never a value and never the tool's own text.
- The diff of every previewed stack is printed to the log on every scan, not only when the summary is over its budget. One rule is easier to test, and a reader always finds the same thing in the same place.
- The diff hash covers the whole diff whatever the summary shows, the same safe direction as 0023 and 0028.
- The summary of an `apply` (0021) is a few lines and needs no budget.
- If writing the summary fails, the scan goes on. The dashboard is the product and the summary is its annex.

## Settled while building (slice 5.9)

- `resolve` writes a job summary too: what its job log says about every tick of the run, one line each, in Sluiceway's own words and escaped as a row is, and a link to the scan it started. `resolve` runs no tool, so none of a tool's words can reach it (0022). It is written only when the run acted on the dashboard or on queued records, so an edit of any other issue leaves no summary, and a summary that cannot be written is a line of the log, never a red job. It is small, so it needs no budget of its own.
