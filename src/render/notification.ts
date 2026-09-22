// The words of a built-in notification, and the body each channel is sent
// (record 0078). Plain and short: the stack ids and the links, never a value,
// a resource or the tool's own words (records 0021 and 0022). The dot is the
// one the job log and the trail use for the same result (record 0040). The
// voice has no place here (record 0032).

import type { Notification, NotifyEvent } from "../core/notify.ts";
import { COUNT_DOT, RESULT_DOT } from "./dots.ts";

// The most stack ids one message names. The rest is a count, and the
// dashboard lists them all. The webhook body carries every id.
export const NAMES_IN_A_NOTIFICATION = 10;

const DOT: Record<NotifyEvent, string> = {
  pending: COUNT_DOT.pending,
  drift: COUNT_DOT.drift,
  deployed: RESULT_DOT.deployed,
  failed: RESULT_DOT.failed,
  refused: RESULT_DOT.refused,
};

function names(stacks: readonly string[]): string {
  const named = stacks.slice(0, NAMES_IN_A_NOTIFICATION).join(", ");
  const rest = stacks.length - NAMES_IN_A_NOTIFICATION;
  return rest > 0 ? `${named} and ${rest} more` : named;
}

// The sentence after "Sluiceway in owner/repo: ", with the ids written by
// `id`, so Slack can escape them.
function sentence(n: Notification, id: (text: string) => string): string {
  const { stacks } = n;
  const one = stacks.length === 1 ? id(stacks[0] ?? "") : undefined;
  const all = () => names(stacks.map(id));
  switch (n.event) {
    case "pending":
      return one ? `${one} is pending` : `${stacks.length} stacks are pending: ${all()}`;
    case "drift":
      return one ? `drift found on ${one}` : `drift found on ${stacks.length} stacks: ${all()}`;
    case "deployed":
      return `${one ?? all()} deployed`;
    case "failed":
      return stacks.length === 0 ? "a deploy failed" : `${one ?? all()} failed to deploy`;
    case "refused":
      if (stacks.length === 0) return "a tick was refused, nothing was deployed";
      return one
        ? `the tick on ${one} was refused, nothing was deployed`
        : `the ticks on ${stacks.length} stacks were refused, nothing was deployed: ${all()}`;
  }
}

// A scan's news points at the dashboard, where the rows are. A deploy's
// points at its run first.
function links(n: Notification): { label: string; url: string }[] {
  const run = n.event === "pending" || n.event === "drift" ? undefined : n.runUrl;
  return [
    ...(run ? [{ label: "Run", url: run }] : []),
    ...(n.dashboardUrl ? [{ label: "Dashboard", url: n.dashboardUrl }] : []),
  ];
}

function headline(n: Notification, id: (text: string) => string): string {
  return `${DOT[n.event]} Sluiceway in ${id(n.repository)}: ${sentence(n, id)}.`;
}

// The text of Telegram and of the webhook body.
export function notificationText(n: Notification): string {
  const parts = links(n).map(({ label, url }) => `${label}: ${url}`);
  return [headline(n, (text) => text), ...parts].join(" ");
}

// Slack reads `<`, `>` and `&` as markup in any text, so they are escaped as
// its docs say, and a link is written its own way.
function slackEscape(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function slackMessage(n: Notification): {
  text: string;
  unfurl_links: false;
  unfurl_media: false;
} {
  const parts = links(n).map(({ label, url }) => `<${url}|${label}>`);
  const text = [headline(n, slackEscape), parts.join(" · ")].filter(Boolean).join(" ");
  return { text, unfurl_links: false, unfurl_media: false };
}

// Plain text: no `parse_mode`, so nothing in an id can be read as markup.
export function telegramMessage(
  n: Notification,
  chatId: string,
): { chat_id: string; text: string; link_preview_options: { is_disabled: true } } {
  return {
    chat_id: chatId,
    text: notificationText(n),
    link_preview_options: { is_disabled: true },
  };
}

// What a generic webhook receives. `version` goes up when the shape changes in
// a way that breaks a reader, as the result file's does (record 0041).
export interface WebhookMessage {
  version: 1;
  event: NotifyEvent;
  repository: string;
  stacks: string[];
  dashboard: string | null;
  run: string | null;
  text: string;
}

export function webhookMessage(n: Notification): WebhookMessage {
  return {
    version: 1,
    event: n.event,
    repository: n.repository,
    stacks: [...n.stacks],
    dashboard: n.dashboardUrl ?? null,
    run: n.runUrl ?? null,
    text: notificationText(n),
  };
}
