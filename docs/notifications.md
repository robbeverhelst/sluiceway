# Notifications and metrics

Sluiceway sends nothing. It never holds a webhook secret and never calls anything but the GitHub API and your infrastructure tool (record 0041). Instead it hands your workflow what a next step needs: step outputs with the counts, the dashboard address and the result of a deploy, and a JSON result file for anything richer. You add the step that sends, and its secret stays in that step.

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
| `outcome` | `apply` | `deployed`, `in-sync` (the fresh preview had nothing to deploy, so nothing went out and the job is green), `refused` (the change moved since the tick, the deployment record was not one this job may deploy, or `deploys: false`) or `failed` |
| `stack` | `apply` | The stack id the job handled. Empty when it never learned it |
| `result-file` | `scan`, `apply` | The path of the result file |
| `matrix` | `resolve` | The hand-off to the `apply` job. Not for notifications |

The three counts are the counts line of the dashboard as this scan left it, so they include the rows of stacks a narrowed scan did not preview. A scan that fails before it writes the dashboard, for example on a broken `sluiceway.yaml`, sets them to `0` and `dashboard-changed` to `false`, so check the outcome of the step too.

The result file is written under `RUNNER_TEMP` as `sluiceway-scan-result.json` or `sluiceway-apply-result.json`. It holds what the summary of the run holds: stack ids, what each preview found, ops, resource types and names, property paths, counts, failure reasons from Sluiceway's fixed list, and how long each preview took. It never holds a property value, a stack output or any of the tool's own words. Sluiceway does not upload it, and the runner removes it when the job ends. Add an `actions/upload-artifact` step if you want to keep it.

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
      ]
    }
  ]
}
```

`dashboard` is `null` when the scan did not get as far as writing it. `stacks` lists the stacks this run previewed. An `apply` file names the `deployment`, the `outcome`, the `stack`, the `ticker`, the failure `reason`, the fresh `preview` the tick was held against, and the preview `after` a deploy that failed half way. A reader should check `version` first: it goes up when the shape changes in a way that breaks a reader.

Resource names, types and property paths are in the file, as they are on the dashboard. They come from your code, so do not put a secret in a resource name or a map key. Send the file only to a place that people with read access to the repo may see.

## Recipes

Every recipe is one more step in a job of the workflow in the [README](../README.md). Give the Sluiceway step an `id` so the next step can read its outputs:

```yaml
      - id: sluiceway
        uses: sluiceway/sluiceway@v0
        with:
          mode: scan
```

Each step below runs only when there is something to say: a scan that changed the dashboard and left something pending or failed, a scan step that failed, or a deploy that did not go out. The secret is in the `env` of that one step and nowhere else. The outputs reach the script through `env` as well, never pasted into the script with `${{ }}`, so nothing in them can be read as a command. `jq` and `curl` are on GitHub's hosted runners.

### Slack

Create an incoming webhook for the channel and store its address as the secret `SLACK_WEBHOOK_URL`.

```yaml
      - name: Tell Slack
        if: >-
          always() && (steps.sluiceway.outcome == 'failure' ||
          (steps.sluiceway.outputs['dashboard-changed'] == 'true' &&
          (steps.sluiceway.outputs.pending != '0' || steps.sluiceway.outputs['preview-failed'] != '0')))
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
          PENDING: ${{ steps.sluiceway.outputs.pending }}
          PREVIEW_FAILED: ${{ steps.sluiceway.outputs['preview-failed'] }}
          DASHBOARD: ${{ steps.sluiceway.outputs['dashboard-url'] }}
          RUN: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
        run: |
          text="Sluiceway: ${PENDING:-0} pending, ${PREVIEW_FAILED:-0} preview failed. ${DASHBOARD:-$RUN}"
          jq -n --arg text "$text" '{text: $text}' |
            curl -fsS -X POST -H 'Content-Type: application/json' --data @- "$SLACK_WEBHOOK_URL"
```

In the `apply` job, the same step with `if: always() && steps.sluiceway.outputs.outcome != 'deployed'` and the text built from `steps.sluiceway.outputs.stack` and `steps.sluiceway.outputs.outcome` tells the channel about a deploy that did not go out. An empty `outcome` means the step stopped before it read the deployment record, which is a failure too. Slack's own `slackapi/slack-github-action` works as well, if you prefer an action over `curl`.

### Telegram

Create a bot with BotFather, store its token as `TELEGRAM_BOT_TOKEN` and the chat as `TELEGRAM_CHAT_ID`.

```yaml
      - name: Tell Telegram
        if: always() && steps.sluiceway.outputs.outcome != 'deployed'
        env:
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
          STACK: ${{ steps.sluiceway.outputs.stack }}
          OUTCOME: ${{ steps.sluiceway.outputs.outcome }}
          DASHBOARD: ${{ steps.sluiceway.outputs['dashboard-url'] }}
        run: |
          text="Sluiceway: ${STACK:-a stack} was not deployed (${OUTCOME:-failed}). ${DASHBOARD}"
          jq -n --arg chat "$TELEGRAM_CHAT_ID" --arg text "$text" '{chat_id: $chat, text: $text}' |
            curl -fsS -X POST -H 'Content-Type: application/json' --data @- \
              "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage"
```

This one sits in the `apply` job. For the scan job, use the condition of the Slack recipe.

### A generic webhook

Send the whole result file to your own endpoint, which can do anything with it: Discord, a chat bot, a database.

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

In the `apply` job, use `always() && steps.sluiceway.outputs['result-file'] != '' && steps.sluiceway.outputs.outcome != 'deployed'`.

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
