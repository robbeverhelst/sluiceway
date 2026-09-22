// The built-in notifications on the wire (record 0078). The one place where
// Sluiceway calls something that is neither the GitHub API nor the tool: the
// channels a repo names in the step's inputs, from its own secrets. What to
// send is decided in core/notify.ts and worded in render/notification.ts.
//
// A send never fails a job. A channel that answers with an error, or does not
// answer in time, is a warning in the job log in Sluiceway's own words: never
// the address, never the token, never the error's own text, which can hold
// either.

import type { Notification, NotifyEvent } from "../core/notify.ts";
import type { JobLog } from "../github/job-log.ts";
import { slackMessage, telegramMessage, webhookMessage } from "../render/notification.ts";

// Where to send, as the step's inputs gave it. Every field is a secret.
export interface NotifyTargets {
  slack?: string | undefined;
  telegram?: { token: string; chatId: string } | undefined;
  webhook?: string | undefined;
}

// The global `fetch`, or a table in a test.
export type Fetch = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number }>;

export interface Notifier {
  // Sends each notification whose event is listed, to every channel. Never
  // throws.
  send(notifications: readonly Notification[], events: readonly NotifyEvent[]): Promise<void>;
}

// How long one channel gets to answer. A notification is not worth holding a
// job for longer.
export const NOTIFY_TIMEOUT_MS = 10_000;

interface Channel {
  // As the job log names it.
  name: string;
  url: string;
  body: (n: Notification) => unknown;
}

function channels(targets: NotifyTargets): Channel[] {
  const { slack, telegram, webhook } = targets;
  return [
    ...(slack ? [{ name: "Slack", url: slack, body: slackMessage }] : []),
    ...(telegram
      ? [
          {
            name: "Telegram",
            url: `https://api.telegram.org/bot${telegram.token}/sendMessage`,
            body: (n: Notification) => telegramMessage(n, telegram.chatId),
          },
        ]
      : []),
    ...(webhook ? [{ name: "the webhook", url: webhook, body: webhookMessage }] : []),
  ];
}

type Result = { ok: true } | { ok: false; status: number } | { ok: false; error: string };

const NOTHING_ELSE =
  "Nothing else changes: the dashboard and any deploy are as they would be without it.";

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function createNotifier(
  targets: NotifyTargets,
  options: { fetch: Fetch; log: JobLog; timeoutMs?: number },
): Notifier {
  const { fetch, log, timeoutMs = NOTIFY_TIMEOUT_MS } = options;
  const all = channels(targets);

  const post = async (channel: Channel, n: Notification): Promise<Result> => {
    try {
      const answer = await fetch(channel.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "sluiceway" },
        body: JSON.stringify(channel.body(n)),
        signal: AbortSignal.timeout(timeoutMs),
      });
      return answer.ok ? { ok: true } : { ok: false, status: answer.status };
    } catch (error) {
      // Only the kind of error: its message can hold the address.
      return { ok: false, error: error instanceof Error ? error.name : "unknown error" };
    }
  };

  return {
    async send(notifications, events) {
      if (all.length === 0) return;
      for (const n of notifications) {
        if (!events.includes(n.event)) continue;
        // Every channel at once, and the log in a fixed order.
        const results = await Promise.all(all.map((channel) => post(channel, n)));
        all.forEach((channel, index) => {
          const result = results[index];
          const what = `the ${n.event} notification`;
          if (!result || result.ok) {
            log.info(`Sent ${what} to ${channel.name}.`);
          } else if ("status" in result) {
            log.warning(
              `${capital(channel.name)} answered ${result.status} to ${what}, so it was not sent. ${NOTHING_ELSE}`,
              "Notification not sent",
            );
          } else {
            log.warning(
              `${capital(channel.name)} could not be reached for ${what} (${result.error}), so it was not sent. ${NOTHING_ELSE}`,
              "Notification not sent",
            );
          }
        });
      }
    },
  };
}
