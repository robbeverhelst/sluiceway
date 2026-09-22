# A row's link lands on the page that holds the stack, and the summary has an index

> Amended by 0048: with `scan.logDiff` on, a pending row's `preview` link lands on the log of the job, which holds the tool's own diff.
>
> Amended by 0050: a pending row's `preview` link lands on the stack's preview page, a check run with its diff, when the scan could write one. Without it the rule below still holds. Every other link of this record stays.

The first real user clicked `preview` on a row and landed on the overview of the whole run (onboarding log, hurdle 15). Record 0027 fixed the look of a row with its links pointing at the run, and record 0037 made the summary the place where every diff is shown. This record fixes where the links land. It is the closest to one stack's detail that GitHub allows. That was measured, not assumed.

## What GitHub lets a link address

Measured on 2026-09-21 with a workflow in the private lab repo (`joblink.yml`, run 35650741639) that has two jobs: one with `contents: read` and `issues: write` only, the permissions of a scan with no other job, and one that adds `actions: read`. Each job ran a small local action that printed its environment and wrote a summary with five sections, an index and one `<a id>` per section. The run page was then read in a logged-in browser.

| Question | What was seen |
|---|---|
| Does a variable of the job's environment hold the job's id? | No. `GITHUB_JOB` is the key from the workflow file (`scan-only`), not a number. |
| Can an action learn its job's id without a permission? | Yes. `${{ job.check_run_id }}` as the `default` of an action input arrived as `INPUT_JOB-ID=106502264185`, the id in the address of the job's page, in both jobs. |
| What does the jobs API cost? | `GET /actions/runs/{run}/attempts/{attempt}/jobs` answers 403 "Resource not accessible by integration" with `contents: read` and `issues: write`. With `actions: read` it lists the jobs, and the running one can be picked by `runner_name`. The input above makes the call unnecessary. |
| What in a summary can be addressed? | The run page wraps each job's summary in an element with `id="summary-<job id>"`. A heading inside a summary gets no id at all. An `<a id="x">` keeps its id as `user-content-x`. Two job summaries with the same anchor give the page two elements with one id. |
| Does a fragment on the run page's address land? | No. Opened as `/actions/runs/<run>#summary-<job id>`, the page removed the fragment from its address and stayed at the top, with that job's summary more than 6,000 pixels further down. `/actions/runs/<run>/attempts/1#summary-<job id>` lost its fragment the same way. |
| Does an attempt have an address of its own? | Yes. `/actions/runs/<run>/attempts/1` shows that attempt with its summaries. The address without an attempt shows the newest attempt. |
| What does a job's page show? | `/actions/runs/<run>/job/<job id>` shows the job's steps and log, and no summary. `#step:3:57` opens step 3 and scrolls to its log. A job's id belongs to one attempt and is never reused. |

What was not measured: whether a click on an index link inside the summary scrolls, because the scripted browser could not be read reliably after the click. The link changed the address to `#user-content-<anchor>`, and the element with that id was on the page. A same-page fragment with its element present is what a browser scrolls to.

## Decision

A link that shows one stack's diff lands on the summary of the attempt that previewed the stack: `/actions/runs/<run>/attempts/<attempt>`. That is a pending row's `preview` and the `summary` of a shortened or redacted row. Naming the attempt keeps the link valid when someone re-runs the run: without it the address shows the newest attempt, whose summary may not hold the stack.

A link that has to show the tool's own words lands on the log of the job that previewed the stack: `/actions/runs/<run>/job/<job id>`. That is a preview failure's `run`. The words are in the log and nowhere else (0022), and the job's page is one click closer to them than the run's.

The job's id comes from a new input, `job-id`, whose default is `${{ job.check_run_id }}`. It needs no permission, so a scan runs with the permissions it had. Where a runner does not know `job.check_run_id`, the input is empty and the job log link falls back to the summary of the attempt.

The summary holds the rest (0037):

- An index at the top, under the counts: one line for the pending stacks and one for the preview failures, each stack a link to its section, in the order of the dashboard. A stack in sync has no link on its row, so it is not in the index.
- One anchor per stack, on its heading or its list line, as `<a id="sluiceway-<encoded stack id>">`. In the encoding a lower case letter or a digit stays as it is and every other character is written as its code point in hex between two dashes, so two stack ids never share an anchor. The index links to `#user-content-<anchor>`, the id GitHub gives it, so no script of GitHub's is needed to find it.
- A preview failure's entry and every "see the job log" link to the job's page when the job's id is known.

Rejected:

- A fragment on the row's link, such as `#summary-<job id>` or `#user-content-<anchor>`. The run page drops it, so it would cost about forty characters per row and do nothing.
- A link to a line of the job log, `#step:<n>:<line>`. It lands, but the step's number and the line's number are not the action's to know: the runner writes the step's inputs and environment above the action's first line, and the number of the step depends on the workflow. A wrong number lands on another stack's group, which is worse than landing on the job.
- Asking the jobs API for the job's id. It costs a request and `actions: read`, and the input gives the same id for nothing.
- Links to the job for the rows written from a deployment record: a deploying row, a failure line, a line under Recently deployed. The record holds its run (0003) and no job, so these still link to the run. `docs/later.md` has the line.

## Consequences

- `job-id` is a sixth input. Nobody sets it. The README says to leave it at its default.
- `GITHUB_RUN_ATTEMPT` is read with the other facts of the job.
- `apply` writes a fresh row with the same rule: its pending row links to the summary of its own attempt, and its preview failure to its own job's log.
- A row's link now differs between two attempts of one run. That changes nothing about a tick: links are not in the marker and not in the diff hash (0008, 0009).
