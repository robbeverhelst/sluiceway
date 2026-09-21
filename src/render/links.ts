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
