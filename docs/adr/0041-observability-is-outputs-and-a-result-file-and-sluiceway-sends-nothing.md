# Observability is outputs and a result file, and Sluiceway sends nothing

> Amended by 0051: `outcome` of `apply` can also be `in-sync` (nothing to deploy) and `rehearsed` (`dry-run: true`). Both are green jobs, and nothing went out.

People want to hear about pending and failed deploys in Slack, Telegram or Discord, and to chart deploys in Grafana. A sender inside the action would need the user's webhook secret and a call to a third party, which breaks three promises at once: no backend, no credential held (0014), and no network call that is not the GitHub API or the tool's own. So Sluiceway sends nothing. It hands the workflow what it needs to send: step outputs with the counts, the dashboard URL and the outcome, and a JSON result file for anything richer. The user adds the next step, and the secret stays in that step.

Considered and rejected: a built-in Slack or webhook notifier (the promises above), and a metrics endpoint (an action lives for a minute, there is nothing to scrape).

## Consequences

- The outputs and the result file are named in the build plan, section 3. The result file holds what the job summary holds and nothing more: stack ids, states, ops, resource types and names, property names, counts, timings. No property value (0021) and none of the tool's own words (0022).
- The result file is written under `RUNNER_TEMP`, and its path is an output. Sluiceway does not upload it as an artifact. A user who wants to keep it adds an upload step.
- Deploy facts already live in GitHub deployment records (0003), so two things work with nothing from Sluiceway: GitHub's own Slack and Teams apps can subscribe a channel to a repo's deployments, and any tool that reads the Deployments API can chart deploy frequency and failure rate. The docs say so.
- Metrics are push or read, never scrape: a workflow step pushes numbers from the outputs to a Pushgateway or a hosted push endpoint, or a dashboard reads the deployment records.
- The docs ship recipes for a Slack step, a Telegram step, a generic webhook and a Pushgateway push, each sending only when something is pending or failed.
- A sender built into Sluiceway stays out. `docs/later.md` lists it.

## Settled while building (slice 2.11)

- The three counts of a scan are the counts line of the body it wrote or found already saying the same, counted from the row markers as the counts line is. They include the carried rows of a narrowed scan. `dashboard-changed` is `true` only when the write loop sent a body.
- A scan sets `pending`, `preview-failed` and `in-sync` to `0` and `dashboard-changed` to `false` before it does anything, the defaults of the build plan. It sets the real values on every way out after the dashboard is written, also when it then goes red because every preview failed. A scan that fails before or during the write keeps the defaults and has no `dashboard-url`. So a notify step also looks at the outcome of the step.
- The result file of a scan exists once the scan wrote its first summary, and lists the stacks it previewed, as the summary does, with the time each preview took and the time of the whole scan. Its `dashboard` is `null` when the write did not happen. It is written on a red scan too.
- The result file of an `apply` is written on every way out, also before the record was read. Its `preview` is the fresh preview the tick was held against, which after a deploy is what went out, and `after` is the preview after a deploy that failed half way, as in the summary of 0035. `reason` is a deploy failure reason from the list of 0022, also for the ways out that write no summary.
- `outcome` is `deployed` when the tool deployed, also when the record could not be given its result: the job is red then and says why. `refused` is a moved change and every record `apply` leaves alone by rule: one that already ended, one that is not Sluiceway's, one it cannot read, one of another run. Everything else is `failed`, including a record that cannot be read and an error nobody planned for. `stack` is set once the record's task named it, so a re-run of an ended record, which reads only the status (0019), has none.
- `dashboard-url` of `apply` and `settle` comes from the payload of the issue edit that started the run, when the issue is the bot's and has a root marker, so it costs no request. `resolve` checked the rest before it handed anything on. `settle` sets it too, as section 3 of the build plan says, though the row of slice 2.11 names only `scan` and `apply`.
- The file is `sluiceway-scan-result.json` or `sluiceway-apply-result.json` directly under `RUNNER_TEMP`. A file that cannot be written, or a runner without `RUNNER_TEMP`, leaves `result-file` unset, writes a warning with Sluiceway's own words and changes nothing else, as for a summary (0037).
- The file has a `version`, 1. Its schema is strict: the renderer checks its own output against it, so a field that is not named there cannot ride along. The JSON schema is held by a snapshot test. The file holds no address, because no summary shows one, and no attribution (later.md).
- The recipes in `docs/notifications.md` stay quiet unless a scan changed the dashboard and left something pending or preview failed, the scan step failed, or a deploy did not go out. The Pushgateway push is the exception and runs on every scan that wrote the dashboard: a gauge that is only pushed when something is pending never goes back to 0.
