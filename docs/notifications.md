# Notifications and metrics

Sluiceway can tell a Slack channel, a Telegram chat or a webhook of your own when something needs a person: stacks are waiting for a tick, a scan found drift, a deploy failed, or a tick was refused. It is off until you name a channel, and each channel comes from a secret of your repo (record 0078).

It also hands your workflow step outputs and a JSON result file, so a step of your own can chart numbers or send anything the built-in messages do not.

## Built-in notifications

Give the Sluiceway step of [the workflow](workflow.md#the-workflow) the channels you want, each from a secret. A step with no channel sends nothing.

```yaml
      - uses: sluiceway/sluiceway@v0
        with:
          slack-webhook-url: ${{ secrets.SLACK_WEBHOOK_URL }}
          telegram-bot-token: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          telegram-chat-id: ${{ secrets.TELEGRAM_CHAT_ID }}
          webhook-url: ${{ secrets.SLUICEWAY_WEBHOOK_URL }}
```

That one step scans, resolves a tick and deploys, so it sends every event. In the [split workflow](split-workflow.md) the same inputs go on the `scan`, the `resolve` and the `apply` step, and `settle`, `check` and `init` send nothing: a channel on one of those steps is a warning. Which mode sends which event:

| Event | Sent by | When |
|---|---|---|
| `pending` | `scan` | The scan left stacks pending that were not pending before it. A stack that stays pending is not news again, so a push that changes nothing new sends nothing |
| `drift` | `scan` | The scan found drift on stacks that showed none before it |
| `deployed` | `apply` | A tick deployed its stack. Off by default |
| `failed` | `apply` | A deploy failed, or the job stopped before it could deploy |
| `refused` | `resolve`, `apply` | A tick deployed nothing: the tick rule refused it, the pull request of a merge tick could not be merged, or the change moved since the tick. `resolve` sends one message for every tick its comment on the dashboard is about |

[`notify.events`](configuration.md#notifyevents) in `sluiceway.yaml` picks the events. The default is every event but `deployed`, because the person who ticked is watching that one. An `apply` that ends `in-sync` or `rehearsed` sent nothing out and needs nobody, so it never sends.

### What a message says

One short line with the stack ids and the links, and a dot of the same colour the job log and the dashboard use for that result:

```text
🟡 Sluiceway in acme/infra: 2 stacks are pending: network:prod, app:prod. Dashboard: https://github.com/acme/infra/issues/1
🟠 Sluiceway in acme/infra: drift found on network:prod. Dashboard: https://github.com/acme/infra/issues/1
🟢 Sluiceway in acme/infra: network:prod deployed. Run: https://github.com/acme/infra/actions/runs/7/attempts/1 Dashboard: https://github.com/acme/infra/issues/1
🔴 Sluiceway in acme/infra: network:prod failed to deploy. Run: https://github.com/acme/infra/actions/runs/7/attempts/1 Dashboard: https://github.com/acme/infra/issues/1
🟡 Sluiceway in acme/infra: the tick on network:prod was refused, nothing was deployed. Run: https://github.com/acme/infra/actions/runs/7 Dashboard: https://github.com/acme/infra/issues/1
```

A message never holds a property value, not even one `dashboard.showValues` lets the dashboard show, and never a resource, a failure reason or any of your tool's own words. The dashboard and the run are one click away and say the rest. It names at most ten stacks and counts the rest. Stack ids are named with `dashboard.redact` on too, as they are on the dashboard (record 0023).

### Slack

Create an [incoming webhook](https://api.slack.com/messaging/webhooks) for the channel and store its address as a secret, such as `SLACK_WEBHOOK_URL`. The address has to start with `https://`.

### Telegram

Create a bot with BotFather and store its token as a secret, such as `TELEGRAM_BOT_TOKEN`. Add the bot to the chat, and store the chat's id, or the `@` name of a public channel, as `TELEGRAM_CHAT_ID`. Both inputs are needed. The message is plain text with no link preview.

### A webhook

`webhook-url` gets a `POST` with a small JSON body, for Discord through a bridge, a chat bot, or anything of your own. The address is `http://` or `https://`.

```json
{
  "version": 1,
  "event": "pending",
  "repository": "acme/infra",
  "stacks": ["app:prod", "network:prod"],
  "dashboard": "https://github.com/acme/infra/issues/1",
  "run": null,
  "text": "🟡 Sluiceway in acme/infra: 2 stacks are pending: app:prod, network:prod. Dashboard: https://github.com/acme/infra/issues/1"
}
```

`stacks` lists every stack, in the order of their ids, and is empty when a job failed before it learned its stack. `dashboard` and `run` are `null` when the job does not know them. A reader should check `version` first: it goes up when the shape changes in a way that breaks a reader.

### When a send fails

A notification never changes a job. A channel that answers with an error, or does not answer within 10 seconds, gets a warning in the job log, "Notification not sent", with the status or the kind of error, and the job, the dashboard and any deploy are what they would be without it. A channel that is set up wrong, such as a Slack address that is not `https://` or a Telegram token without a chat id, gets a warning "Notification channel not used" and sends nothing. Neither warning ever shows the address or the token.

### How the secrets are kept

- Each value comes from a secret of your repo, which GitHub masks in the job log. Sluiceway registers every value as a mask as well, a wrong one too, before it does anything else.
- Your infrastructure tool never sees them: Sluiceway passes the tool the job environment without the step's inputs (record 0013).
- The only calls Sluiceway makes besides the GitHub API and your tool are these posts, and only to the addresses you set.
- `settle`, `check` and `init` send nothing. A channel on one of their steps is a warning that says so.
- A pull request from a fork gets no secrets, so a scan there sends nothing.

### What it does not do

- **No ticking from Slack.** A button in a message would need an app that Slack can call back, and a GitHub Action is not running when someone clicks. That belongs to a hosted version.
- **Nothing for a scan that fails before it writes the dashboard**, such as on a broken `sluiceway.yaml`. The step goes red, and [a step of your own](#a-scan-that-failed) can say so.
- **Nothing for a failed preview.** The dashboard shows it, and `strict: true` turns the scan red for it.

## Without Sluiceway

Two things work with nothing from Sluiceway at all, because every deploy is a GitHub deployment record:

- **GitHub's own Slack and Teams apps.** Subscribe a channel to your repo's deployments, for example with `/github subscribe <owner>/<repo> deployments` in Slack. Each tick that deploys shows up as a deployment, with its result.
- **Anything that reads the Deployments API.** Every deploy is a deployment with the task `sluiceway:<stack id>`, the environment of the stack, and a final status of `success`, `failure` or `error`. That is enough to chart how often each stack deploys and how often a deploy fails, for example from `gh api repos/<owner>/<repo>/deployments`.

## What Sluiceway hands over

| Output | Set by | Value |
|---|---|---|
| `dashboard-url` | `scan`, `apply`, `settle` | The web address of the dashboard issue. Empty when the step never got as far as finding it |
| `pending` | `scan` | Pending stacks on the dashboard after this scan |
| `preview-failed` | `scan` | Stacks on the dashboard whose preview failed |
| `in-sync` | `scan` | Stacks on the dashboard that are in sync |
| `dashboard-changed` | `scan` | `true` when this scan wrote a body that differs from the one before |
| `outcome` | `apply` | `deployed`, `in-sync` (the fresh preview had nothing to deploy, so nothing went out and the job is green), `rehearsed` (`dry-run: true`, nothing went out and the job is green), `refused` (the change moved since the tick, the deployment record was not one this job may deploy, or `deploys: false`) or `failed` |
| `stack` | `apply` | The stack id the job handled. Empty when it never learned it |
| `result-file` | `scan`, `apply` | The path of the result file |
| `matrix` | `resolve`, `scan` | The deploys that were started, one `{ stack, environment, deployment }` each. In the split workflow the hand-off to the `apply` job. Not for notifications |

In [the workflow](workflow.md#the-workflow), the one Sluiceway step sets the outputs of every mode it ran. A run that deploys more than one stack sets `outcome`, `stack` and `result-file` once per deploy, so they describe the last one, and the step is red when any of them failed. `matrix` lists every deploy the step started. An edit of any other issue sets no output at all. The [split workflow](split-workflow.md) has one `apply` job per stack, and so one set of outputs per deploy.

The three counts are the counts line of the dashboard as this scan left it, so they include the rows of stacks a narrowed scan did not preview. A scan that fails before it writes the dashboard, for example on a broken `sluiceway.yaml`, sets them to `0` and `dashboard-changed` to `false`, so check the outcome of the step too.

The result file is written under `RUNNER_TEMP` as `sluiceway-scan-result.json` or `sluiceway-apply-result.json`. It holds what the summary of the run holds: stack ids, what each preview found, ops, resource types and names, property paths, counts, failure reasons from Sluiceway's fixed list, how long each preview took, and the pull requests and direct pushes a pending stack claims since its last deploy. Its shape is published as a JSON schema, [`schema/result-file.schema.json`](../schema/result-file.schema.json), which covers both files. It never holds a property value, a stack output or any of the tool's own words. Sluiceway does not upload it, and the runner removes it when the job ends. Add an `actions/upload-artifact` step if you want to keep it.

A scan's file, shortened:

```json
{
  "version": 1,
  "mode": "scan",
  "run": "https://github.com/acme/infra/actions/runs/123",
  "commit": "0123456789abcdef0123456789abcdef01234567",
  "seconds": 41.2,
  "dashboard": {
    "url": "https://github.com/acme/infra/issues/1",
    "changed": true,
    "pending": 1,
    "deploying": 0,
    "previewFailed": 0,
    "inSync": 3,
    "failedDeploys": 0
  },
  "stacks": [
    {
      "stack": "network:prod",
      "state": "pending",
      "seconds": 18.5,
      "counts": { "create": 1, "update": 0, "replace": 0, "delete": 0, "trackingOnly": 0 },
      "changes": [
        { "type": "aws:s3/bucket:Bucket", "name": "logs", "op": "create", "changedKeys": [], "replaceKeys": [] }
      ],
      "attribution": [
        { "kind": "pull-request", "number": 42, "title": "Add a logs bucket", "url": "https://github.com/acme/infra/pull/42", "author": "alice" }
      ]
    }
  ]
}
```

`dashboard` is `null` when the scan did not get as far as writing it. `stacks` lists the stacks this run previewed. `attribution` lists, newest first, what the summary lists for a stack: a pull request with its number, title, address and author, or a direct push with its `commit`, the first line of its message, address and author. It is missing when the lookup failed, and an empty list when nothing the stack claims changed. A pull request title is free text a person wrote, so treat it as such where you send it. An `apply` file names the `deployment`, the `outcome`, the `stack`, the `ticker`, the failure `reason`, how long the job took in `seconds` and the tool's deploy in `deploySeconds` (`null` when nothing was deployed), the fresh `preview` the tick was held against, and the preview `after` a deploy that failed half way. A reader should check `version` first: it goes up when the shape changes in a way that breaks a reader.

Resource names, types and property paths are in the file, as they are on the dashboard. They come from your code, so do not put a secret in a resource name or a map key. Send the file only to a place that people with read access to the repo may see.

## Steps of your own

Every step below is one more step after the Sluiceway step of [the workflow](workflow.md#the-workflow). Give that step an `id` so the next step can read its outputs:

```yaml
      - id: sluiceway
        uses: sluiceway/sluiceway@v0
```

The secret of a step is in the `env` of that one step and nowhere else. The outputs reach the script through `env` as well, never pasted into the script with `${{ }}`, so nothing in them can be read as a command. `jq` and `curl` are on GitHub's hosted runners.

### A scan that failed

The built-in messages come from a scan that wrote the dashboard. This step tells Slack about a scan step that failed before that:

```yaml
      - name: Tell Slack the scan failed
        if: always() && steps.sluiceway.outcome == 'failure' && steps.sluiceway.outputs['dashboard-url'] == ''
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
          RUN: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
        run: |
          jq -n --arg text "🔴 Sluiceway: the scan failed before it wrote the dashboard. $RUN" '{text: $text}' |
            curl -fsS -X POST -H 'Content-Type: application/json' --data @- "$SLACK_WEBHOOK_URL"
```

### Sending the whole result file

The built-in webhook sends a short message. For everything a run found, send the result file to your own endpoint instead, which can do anything with it: Discord, a chat bot, a database.

```yaml
      - name: Send the result
        if: >-
          always() && steps.sluiceway.outputs['result-file'] != '' &&
          (steps.sluiceway.outcome == 'failure' ||
          (steps.sluiceway.outputs['dashboard-changed'] == 'true' &&
          (steps.sluiceway.outputs.pending != '0' || steps.sluiceway.outputs['preview-failed'] != '0')))
        env:
          WEBHOOK_URL: ${{ secrets.SLUICEWAY_WEBHOOK_URL }}
          RESULT_FILE: ${{ steps.sluiceway.outputs['result-file'] }}
        run: |
          curl -fsS -X POST -H 'Content-Type: application/json' \
            --data-binary @"$RESULT_FILE" "$WEBHOOK_URL"
```

For a deploy, use `if: always() && steps.sluiceway.outputs['result-file'] != '' && (steps.sluiceway.outcome == 'failure' || steps.sluiceway.outputs.outcome == 'failed' || steps.sluiceway.outputs.outcome == 'refused')`.

### A Pushgateway push

Metrics are pushed, never scraped: the job lives for a minute and there is nothing to scrape. This step pushes the three counts of every scan to a Prometheus Pushgateway, where Grafana or any Prometheus reader can chart them. It is the one recipe that runs on every scan that wrote the dashboard, because a number that is only pushed when something is pending never goes back to 0.

```yaml
      - name: Push the counts
        if: always() && steps.sluiceway.outputs['dashboard-url'] != ''
        env:
          PUSHGATEWAY_URL: ${{ secrets.PUSHGATEWAY_URL }}
          PENDING: ${{ steps.sluiceway.outputs.pending }}
          PREVIEW_FAILED: ${{ steps.sluiceway.outputs['preview-failed'] }}
          IN_SYNC: ${{ steps.sluiceway.outputs['in-sync'] }}
        run: |
          # A label value in the path may not hold a slash, so the owner is left out.
          repo="${GITHUB_REPOSITORY#*/}"
          cat <<EOF | curl -fsS --data-binary @- "$PUSHGATEWAY_URL/metrics/job/sluiceway/repo/$repo"
          # TYPE sluiceway_pending_stacks gauge
          sluiceway_pending_stacks $PENDING
          # TYPE sluiceway_preview_failed_stacks gauge
          sluiceway_preview_failed_stacks $PREVIEW_FAILED
          # TYPE sluiceway_in_sync_stacks gauge
          sluiceway_in_sync_stacks $IN_SYNC
          EOF
```

A hosted push endpoint that takes the Prometheus text format works the same way. Deploy counts and failure rates are better read from the deployment records than pushed, because the records keep them for as long as the repo exists.
