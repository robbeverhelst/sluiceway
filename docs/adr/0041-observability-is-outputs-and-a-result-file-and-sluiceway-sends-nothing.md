# Observability is outputs and a result file, and Sluiceway sends nothing

People want to hear about pending and failed deploys in Slack, Telegram or Discord, and to chart deploys in Grafana. A sender inside the action would need the user's webhook secret and a call to a third party, which breaks three promises at once: no backend, no credential held (0014), and no network call that is not the GitHub API or the tool's own. So Sluiceway sends nothing. It hands the workflow what it needs to send: step outputs with the counts, the dashboard URL and the outcome, and a JSON result file for anything richer. The user adds the next step, and the secret stays in that step.

Considered and rejected: a built-in Slack or webhook notifier (the promises above), and a metrics endpoint (an action lives for a minute, there is nothing to scrape).

## Consequences

- The outputs and the result file are named in the build plan, section 3. The result file holds what the job summary holds and nothing more: stack ids, states, ops, resource types and names, property names, counts, timings. No property value (0021) and none of the tool's own words (0022).
- The result file is written under `RUNNER_TEMP`, and its path is an output. Sluiceway does not upload it as an artifact. A user who wants to keep it adds an upload step.
- Deploy facts already live in GitHub deployment records (0003), so two things work with nothing from Sluiceway: GitHub's own Slack and Teams apps can subscribe a channel to a repo's deployments, and any tool that reads the Deployments API can chart deploy frequency and failure rate. The docs say so.
- Metrics are push or read, never scrape: a workflow step pushes numbers from the outputs to a Pushgateway or a hosted push endpoint, or a dashboard reads the deployment records.
- The docs ship recipes for a Slack step, a Telegram step, a generic webhook and a Pushgateway push, each sending only when something is pending or failed.
- A sender built into Sluiceway stays out. `docs/later.md` lists it.
