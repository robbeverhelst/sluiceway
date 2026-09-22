// The built-in notifications (record 0078): which events there are, and which
// of them a job has to tell. The words are in render/notification.ts, and the
// sending is glue in src/notify/. Nothing here knows a channel or a secret.

import { parseDashboard } from "../render/marker.ts";
import { byCodeUnit } from "../render/row.ts";

// In the order a stack meets them: a change waits, reality drifted, a deploy
// went out, a deploy failed, a tick was refused.
export const NOTIFY_EVENTS = ["pending", "drift", "deployed", "failed", "refused"] as const;

export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

// Everything that needs a person. A deploy that went out is left out: the
// ticker is watching it, and a message for every deploy is the noise that
// slice 2.20 took out of the recipes.
export const DEFAULT_NOTIFY_EVENTS: readonly NotifyEvent[] = [
  "pending",
  "drift",
  "failed",
  "refused",
];

// One message. It holds stack ids, the repo and links, and nothing else: no
// value, no resource, none of the tool's words (records 0021 and 0022).
export interface Notification {
  event: NotifyEvent;
  // `owner/repo`.
  repository: string;
  // In code unit order. Empty when the job never learned the stack.
  stacks: string[];
  dashboardUrl?: string | undefined;
  runUrl?: string | undefined;
}

// What a scan tells: the stacks that are pending now and were not before it,
// and the stacks that show drift now and did not before. A stack that stays
// pending with more changes is not news: its row already asked for a tick.
// Both are dashboard bodies: the live one the write started from ("" for a
// new dashboard) and the one the scan left.
export function scanNotifications(
  before: string,
  after: string,
  links: { repository: string; dashboardUrl: string },
): Notification[] {
  const beforeRows = parseDashboard(before).rows;
  const newly = (state: string): string[] => {
    const was = new Set(beforeRows.filter((row) => row.state === state).map((row) => row.stackId));
    return parseDashboard(after)
      .rows.filter((row) => row.state === state && !was.has(row.stackId))
      .map((row) => row.stackId)
      .sort(byCodeUnit);
  };
  return (["pending", "drift"] as const).flatMap((event) => {
    const stacks = newly(event);
    return stacks.length === 0 ? [] : [{ event, stacks, ...links }];
  });
}

// What an `apply` tells, from its `outcome` (record 0041). A deploy with
// nothing to deploy and a rehearsal sent nothing out and need nobody.
export function applyNotification(
  outcome: "deployed" | "failed" | "refused" | "in-sync" | "rehearsed",
  stack: string | undefined,
  links: { repository: string; dashboardUrl?: string | undefined; runUrl: string },
): Notification | undefined {
  if (outcome === "in-sync" || outcome === "rehearsed") return undefined;
  return { event: outcome, stacks: stack === undefined ? [] : [stack], ...links };
}

// `owner/repo` from `https://github.com/owner/repo`.
export function repositoryOf(repoUrl: string): string {
  return new URL(repoUrl).pathname.split("/").filter(Boolean).slice(0, 2).join("/");
}
