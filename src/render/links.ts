// Where the links a job writes land (record 0044). GitHub drops a fragment
// from the address of a run's page, so no link can point inside the page of a
// run. The closest a link gets to one stack's detail is the page that holds it:
// the summary of the attempt that previewed the stack, or the page of the job
// whose log holds the stack's group.

export interface RunFacts {
  // `https://github.com/<owner>/<repo>`.
  repoUrl: string;
  runId: string;
  // A re-run of a run is a new attempt with new jobs and new summaries. The
  // address of a run shows its newest attempt.
  runAttempt: string;
  // The id of the running job, from `job.check_run_id`. Absent where the
  // runner does not know it.
  jobId?: string | undefined;
}

export interface RunLinks {
  // The page of the attempt, where the summary of this job is shown.
  summary: string;
  // The page of this job, which shows its log. Job ids are never reused, so
  // the page stays the same after a re-run.
  log: string;
}

export function runLinks(run: RunFacts): RunLinks {
  const base = `${run.repoUrl}/actions/runs/${run.runId}`;
  const summary = `${base}/attempts/${run.runAttempt}`;
  return { summary, log: run.jobId === undefined ? summary : `${base}/job/${run.jobId}` };
}

// The run of a deploy, from its deployment record. With the attempt that
// created the record the link stays on that attempt after a re-run (slice
// 5.9). A record written before attempts were kept links to the run, which
// GitHub shows at its newest attempt.
export function runUrl(repoUrl: string, run: string, attempt: string | undefined): string {
  const base = `${repoUrl}/actions/runs/${run}`;
  return attempt === undefined ? base : `${base}/attempts/${attempt}`;
}

// The issues of the repo with the dashboard's label. A preview page is written
// before the dashboard, whose number a first scan does not know yet, so the
// page links here: the one open issue with that label is the dashboard
// (record 0050).
export function dashboardSearchUrl(repoUrl: string, label: string): string {
  return `${repoUrl}/issues?q=${encodeURIComponent(`is:issue is:open label:"${label}"`)}`;
}
