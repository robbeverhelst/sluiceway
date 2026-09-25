# A run that waits long for a runner gets a line under the scan line

> Amended by 0108: the line about a scan that is running sits between the scan line and this one, and this line is carried by the scan's first write like any other writer's.
>
> Amended by 0089: the time the line says the run has waited since is in the repo's zone, `dashboard.timeZone`, and ends in its offset from UTC, such as `UTC+2`. Without the key it is `UTC` as written here.

> Amends 0009 (three optional keys on the root marker), 0017 (one more request per scan) and 0029 (a line under the scan line). Built as slice 5.22.

Issue 201, seen on a real repo: a scan started from the dashboard sat `queued` for 30 minutes because GitHub never handed its job to the repo's self-hosted runners. The job never started, so no Sluiceway code ran. From the dashboard that looked exactly like nothing happening: the issue still showed the previous scan, and nothing said a newer run was waiting. A deploy has a row that says `waiting to start`. A scan had nothing.

Sluiceway cannot see anything while none of its runs has a runner. What it can do is say, from the next run that does get one, that an earlier run is still waiting.

## Decision

- **Every scan lists the queued runs of its own workflow, once a job**, after its previews and before it writes the dashboard. The call is `GET /repos/{owner}/{repo}/actions/workflows/{file}/runs?status=queued&per_page=100`, newest first, `listQueuedRuns` on the port. It is the call of 0025 with another filter, the workflow file comes from `GITHUB_WORKFLOW_REF` as there, and it needs `actions: read`, which the scan job already has for the deployment records (0003). Every run of the workflow counts, whatever started it: a push, the schedule, a dispatch from the rescan box or from `settle`, an edit of the dashboard.
- **A run is waiting when its status is `queued` and it has been since at least ten minutes before the scan started.** The scan's own run is never one: it is running. The time is the run's `run_started_at`, which GitHub sets when the run or its newest attempt was asked for, and `created_at` when that is absent. `pending` (waiting for its concurrency group, as the one-step workflow's `queue: max` does) and `waiting` (waiting for a reviewer) are not waiting for a runner and never count.
- **The scan writes it on the root marker**, as `run-waiting` (the run id), `run-waiting-since` (the time, ISO 8601) and `run-waiting-more` (how many other runs waited that long, left out at 0). The keys are optional, so a parser of an older version ignores them, and the marker version stays 1.
- **The line sits right under the scan line**, inside the centered block under a header and as its own paragraph without one:

  `[A run of this dashboard's workflow](…/actions/runs/900) has been waiting for a runner for 32 minutes, since 2026-09-23 14:08 UTC.`

  How long is counted to the time of the scan that the scan line shows, whole minutes, and past an hour in hours and minutes (`1 hour`, `2 hours and 5 minutes`). So the line says the same whoever writes the body later, and it never claims a length the scan did not see.
- **The job log of the scan says it too**: `Run 900 of sluiceway.yml has been waiting for a runner for 32 minutes. The dashboard says so under the scan line until it starts (record 0086): <url>`.

### Why ten minutes, and why a short queue says nothing

A run that waits a minute or two is normal. A runner that is busy with another job, the repo's own CI on the same pool, holds the next job until it is done. An autoscaler, such as a runner scale set that scales from zero, starts a runner for a job and takes a few minutes: a pod to schedule, an image to pull, a runner to register. A line for those would be noise on every busy day, and a line that is usually noise is a line people stop reading.

Ten minutes is past both. A scan takes a few minutes (issue 198 measured four for 51 stacks), so a runner busy with a Sluiceway scan never keeps another run waiting that long: the one-step workflow queues its own runs in its concurrency group, where they are `pending` and never count. Longer than ten minutes and a person watching the dashboard has had time to wonder, which is the moment the line is for. The number is not a setting: a repo whose runners are always slow gets a line that is true, and it goes as soon as the run starts.

### Several runs waiting

The line names the run that has waited longest, because that is the one to open, and counts the others that waited ten minutes or more: `… since 2026-09-23 14:08 UTC. 2 more runs have been waiting for a runner for 10 minutes or more.` Several runs waiting at once usually share a cause, and a list of links would say nothing more. Two runs that started waiting at the same moment are ordered by run id, the lower first.

### When the line goes

- **The next scan writes what it finds**, so the line goes with the first scan after the run started or ended, and names the next run when another one is still waiting.
- **Every other writer carries the line**, as it carries the rest of the root marker, except in the run the line names. `resolve`, `apply` and a bulk tick write the body through the row swap, and a swap in the waiting run itself leaves the line out: that run has a runner now. In the one-step workflow a run that finally starts nearly always writes the body: a push, the schedule and a dispatch scan, and an edit of the dashboard resolves and writes the body whenever it acts on a tick. So the line goes as soon as that run starts, at the run's first write. A `resolve` that finds nothing to act on writes nothing, as before, and does not write the body only to take the line away: the next scan does.
- **A run that ends without starting**, cancelled by a person, or failed by GitHub after a day in the queue, writes nothing. Its line stays until the next scan, which no longer lists it. Asking GitHub about the run in every other writer would cost a request in every `resolve` for a line the next scan corrects anyway.

### It is a line, never a state

It is not a row, not a row state, not a header state and not a count. Nothing is decided from it: no tick is held back, no box is cleared, and the orphan tick sweep keeps its own reading of the runs (0025), which already treats a queued run as one on its way. No notification is sent for it. A read of the runs that fails, such as a workflow whose scan job lacks `actions: read`, leaves the line out and says why in the job log, and the scan goes on. It never turns a job red.

### The words say what is true, not why

The line says a run has been waiting for a runner. That is what GitHub's status says, and all Sluiceway can see. It never says the runners are down, that GitHub lost the job, or that something is wrong: a runner that is busy, offline, labelled differently from `runs-on`, or never handed the job all look the same from the API. The docs for self-hosted runners list what to check.

### A deploy that waits for a runner

A deploy gets no such line. Once `resolve` made its record, the stack's row says `waiting to start` until `apply` runs, and deploying once it does (0027). That row is the stack's own, at the top of the dashboard while it waits (0063), and it is where the person who ticked is looking. Adding "for 32 minutes" to it would need every writer to know the time and would change the row's bytes on every scan without the deploy moving. In the split workflow, a run whose `apply` job waits for a runner is `in_progress`, not `queued`, since its other jobs ran, so it is not counted here either: the row speaks for it. In the one-step workflow a tick whose whole run waits is still `queued`, and the line covers it, while the ticked row waits for that run.

## Consequences

- One request more per scan. The worst case of 0017 and 0050 becomes 406 requests on the first try of a scan of 100 stacks and 808 with three tries, still below 1,000.
- The line cannot help when no run of the workflow gets a runner at all. Then no Sluiceway code runs anywhere, and the dashboard stays as the last run left it. The docs say that a scan line that stops moving is the sign, and what to look at.
- A run of the workflow that another tool started, or a re-run of an old failed run that waits, counts like any other. Both are runs of this workflow waiting for a runner, which is what the line says.

## Rejected

- **A threshold in `sluiceway.yaml`.** One more key for a line that is true at any number. If ten minutes turns out wrong on real repos, the number changes for everyone.
- **A notification.** A run that waits is not an event of 0078, and a channel that pings when a runner is slow is one people mute.
- **A line per waiting run.** Several runs waiting share a cause, and a list grows the body for nothing.
- **Asking GitHub why.** The jobs of a queued run say which labels they wait for, but not why no runner took them, and guessing a cause is the accusation this record avoids.
