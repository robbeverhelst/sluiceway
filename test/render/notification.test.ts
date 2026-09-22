import { describe, expect, test } from "bun:test";
import type { Notification } from "../../src/core/notify.ts";
import {
  notificationText,
  slackMessage,
  telegramMessage,
  webhookMessage,
} from "../../src/render/notification.ts";

// Slice 5.13 (record 0078): plain, short messages with the stack ids and the
// links. The dot is the dot of record 0040 for the same result.

const DASHBOARD = "https://github.com/acme/infra/issues/1";
const RUN = "https://github.com/acme/infra/actions/runs/7";
const base = { repository: "acme/infra", dashboardUrl: DASHBOARD, runUrl: RUN };

function n(event: Notification["event"], stacks: string[], extra = {}): Notification {
  return { ...base, event, stacks, ...extra };
}

describe("the text", () => {
  test("pending, one stack and several, links the dashboard only", () => {
    expect(notificationText(n("pending", ["a:prod"]))).toBe(
      `🟡 Sluiceway in acme/infra: a:prod is pending. Dashboard: ${DASHBOARD}`,
    );
    expect(notificationText(n("pending", ["a:prod", "b:prod"]))).toBe(
      `🟡 Sluiceway in acme/infra: 2 stacks are pending: a:prod, b:prod. Dashboard: ${DASHBOARD}`,
    );
  });

  test("drift", () => {
    expect(notificationText(n("drift", ["a:prod"]))).toBe(
      `🟠 Sluiceway in acme/infra: drift found on a:prod. Dashboard: ${DASHBOARD}`,
    );
    expect(notificationText(n("drift", ["a:prod", "b:prod"]))).toBe(
      `🟠 Sluiceway in acme/infra: drift found on 2 stacks: a:prod, b:prod. Dashboard: ${DASHBOARD}`,
    );
  });

  test("deployed links the run and the dashboard", () => {
    expect(notificationText(n("deployed", ["a:prod"]))).toBe(
      `🟢 Sluiceway in acme/infra: a:prod deployed. Run: ${RUN} Dashboard: ${DASHBOARD}`,
    );
  });

  test("failed, with and without the stack", () => {
    expect(notificationText(n("failed", ["a:prod"]))).toBe(
      `🔴 Sluiceway in acme/infra: a:prod failed to deploy. Run: ${RUN} Dashboard: ${DASHBOARD}`,
    );
    expect(notificationText(n("failed", []))).toBe(
      `🔴 Sluiceway in acme/infra: a deploy failed. Run: ${RUN} Dashboard: ${DASHBOARD}`,
    );
  });

  test("refused, for one tick, several, and one of no stack", () => {
    expect(notificationText(n("refused", ["a:prod"]))).toBe(
      `🟡 Sluiceway in acme/infra: the tick on a:prod was refused, nothing was deployed. Run: ${RUN} Dashboard: ${DASHBOARD}`,
    );
    expect(notificationText(n("refused", ["a:prod", "b:prod"]))).toBe(
      `🟡 Sluiceway in acme/infra: the ticks on 2 stacks were refused, nothing was deployed: a:prod, b:prod. Run: ${RUN} Dashboard: ${DASHBOARD}`,
    );
    expect(notificationText(n("refused", []))).toBe(
      `🟡 Sluiceway in acme/infra: a tick was refused, nothing was deployed. Run: ${RUN} Dashboard: ${DASHBOARD}`,
    );
  });

  test("a link the job does not know is left out", () => {
    expect(notificationText(n("failed", ["a:prod"], { dashboardUrl: undefined }))).toBe(
      `🔴 Sluiceway in acme/infra: a:prod failed to deploy. Run: ${RUN}`,
    );
  });

  test("names ten stacks and counts the rest", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `s${String(i).padStart(2, "0")}:prod`);
    expect(notificationText(n("pending", ids))).toBe(
      `🟡 Sluiceway in acme/infra: 12 stacks are pending: ${ids.slice(0, 10).join(", ")} and 2 more. Dashboard: ${DASHBOARD}`,
    );
  });
});

describe("the payloads", () => {
  test("Slack gets the text with its own links, and <, > and & escaped", () => {
    expect(slackMessage(n("failed", ["a<b>&c:prod"]))).toEqual({
      text: `🔴 Sluiceway in acme/infra: a&lt;b&gt;&amp;c:prod failed to deploy. <${RUN}|Run> · <${DASHBOARD}|Dashboard>`,
      unfurl_links: false,
      unfurl_media: false,
    });
  });

  test("Telegram gets the plain text, for the chat, with no link preview", () => {
    expect(telegramMessage(n("pending", ["a:prod"]), "-100123")).toEqual({
      chat_id: "-100123",
      text: `🟡 Sluiceway in acme/infra: a:prod is pending. Dashboard: ${DASHBOARD}`,
      link_preview_options: { is_disabled: true },
    });
  });

  test("a webhook gets the facts and the text, every stack, with version 1", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `s${i}`);
    const message = webhookMessage(n("pending", ids));
    expect(message).toEqual({
      version: 1,
      event: "pending",
      repository: "acme/infra",
      stacks: ids,
      dashboard: DASHBOARD,
      run: RUN,
      text: notificationText(n("pending", ids)),
    });
  });

  test("a webhook gets null for a link the job does not know", () => {
    const message = webhookMessage(n("failed", [], { dashboardUrl: undefined, runUrl: undefined }));
    expect(message.dashboard).toBeNull();
    expect(message.run).toBeNull();
  });
});
