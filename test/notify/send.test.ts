import { describe, expect, test } from "bun:test";
import type { Notification } from "../../src/core/notify.ts";
import { createNotifier, type Fetch, type NotifyTargets } from "../../src/notify/send.ts";
import { slackMessage, telegramMessage, webhookMessage } from "../../src/render/notification.ts";
import { rememberingLog } from "../modes/harness.ts";

// Slice 5.13 (record 0078): the sender. It posts to every channel the step
// names, only for the events sluiceway.yaml lists, and a failed send is a
// warning in the job log that never fails the job and never shows a secret.

const SLACK = "https://hooks.slack.com/services/T000/B000/SECRETSLACK";
const TOKEN = "123456:SECRET-TELEGRAM";
const CHAT = "-100123";
const WEBHOOK = "https://hooks.example.com/SECRETHOOK";
const ALL: NotifyTargets = {
  slack: SLACK,
  telegram: { token: TOKEN, chatId: CHAT },
  webhook: WEBHOOK,
};
const SECRETS = ["SECRETSLACK", "SECRET-TELEGRAM", "SECRETHOOK"];

const pendingNews: Notification = {
  event: "pending",
  repository: "acme/infra",
  stacks: ["a:prod"],
  dashboardUrl: "https://github.com/acme/infra/issues/1",
};

interface Sent {
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

function recordingFetch(answer: (url: string) => Promise<{ ok: boolean; status: number }>) {
  const sent: Sent[] = [];
  const fetch: Fetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return answer(url);
  };
  return { sent, fetch };
}

const ok = async () => ({ ok: true, status: 200 });

function everything(log: ReturnType<typeof rememberingLog>): string {
  return JSON.stringify([log.lines, log.warnings, log.groups]);
}

describe("sending", () => {
  test("posts each channel its own body, as JSON", async () => {
    const { sent, fetch } = recordingFetch(ok);
    const log = rememberingLog();
    await createNotifier(ALL, { fetch, log }).send([pendingNews], ["pending"]);
    expect(sent).toEqual([
      { url: SLACK, body: slackMessage(pendingNews), headers: expect.any(Object) },
      {
        url: `https://api.telegram.org/bot${TOKEN}/sendMessage`,
        body: telegramMessage(pendingNews, CHAT),
        headers: expect.any(Object),
      },
      { url: WEBHOOK, body: webhookMessage(pendingNews), headers: expect.any(Object) },
    ]);
    for (const { headers } of sent) expect(headers["Content-Type"]).toBe("application/json");
    expect(log.lines).toEqual([
      "Sent the pending notification to Slack.",
      "Sent the pending notification to Telegram.",
      "Sent the pending notification to the webhook.",
    ]);
    expect(log.warnings).toEqual([]);
  });

  test("sends only the events sluiceway.yaml lists", async () => {
    const { sent, fetch } = recordingFetch(ok);
    await createNotifier(ALL, { fetch, log: rememberingLog() }).send([pendingNews], ["failed"]);
    expect(sent).toEqual([]);
  });

  test("sends nothing and says nothing without a channel", async () => {
    const { sent, fetch } = recordingFetch(ok);
    const log = rememberingLog();
    await createNotifier({}, { fetch, log }).send([pendingNews], ["pending"]);
    expect(sent).toEqual([]);
    expect(log.lines).toEqual([]);
  });
});

describe("a send that fails", () => {
  test("an answer that is not a success is a warning with the status, and the others still go", async () => {
    const { sent, fetch } = recordingFetch(async (url) =>
      url === SLACK ? { ok: false, status: 404 } : { ok: true, status: 200 },
    );
    const log = rememberingLog();
    await createNotifier(ALL, { fetch, log }).send([pendingNews], ["pending"]);
    expect(sent).toHaveLength(3);
    expect(log.warnings).toEqual([
      {
        title: "Notification not sent",
        message:
          "Slack answered 404 to the pending notification, so it was not sent. Nothing else changes: the dashboard and any deploy are as they would be without it.",
      },
    ]);
  });

  test("an error never reaches the log with its words, which can hold the address", async () => {
    const { fetch } = recordingFetch(async (url) => {
      throw new TypeError(`fetch failed for ${url}`);
    });
    const log = rememberingLog();
    await createNotifier(ALL, { fetch, log }).send([pendingNews], ["pending"]);
    expect(log.warnings.map(({ message }) => message)).toEqual([
      "Slack could not be reached for the pending notification (TypeError), so it was not sent. Nothing else changes: the dashboard and any deploy are as they would be without it.",
      "Telegram could not be reached for the pending notification (TypeError), so it was not sent. Nothing else changes: the dashboard and any deploy are as they would be without it.",
      "The webhook could not be reached for the pending notification (TypeError), so it was not sent. Nothing else changes: the dashboard and any deploy are as they would be without it.",
    ]);
    for (const secret of SECRETS) expect(everything(log)).not.toContain(secret);
  });

  test("a channel that does not answer is given up after the time limit", async () => {
    const fetch: Fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason));
      });
    const log = rememberingLog();
    await createNotifier({ webhook: WEBHOOK }, { fetch, log, timeoutMs: 20 }).send(
      [pendingNews],
      ["pending"],
    );
    expect(log.warnings.map(({ message }) => message)).toEqual([
      "The webhook could not be reached for the pending notification (TimeoutError), so it was not sent. Nothing else changes: the dashboard and any deploy are as they would be without it.",
    ]);
  });

  test("a Telegram answer never shows the token", async () => {
    const { fetch } = recordingFetch(async () => ({ ok: false, status: 401 }));
    const log = rememberingLog();
    await createNotifier({ telegram: { token: TOKEN, chatId: CHAT } }, { fetch, log }).send(
      [pendingNews],
      ["pending"],
    );
    expect(log.warnings).toHaveLength(1);
    for (const secret of SECRETS) expect(everything(log)).not.toContain(secret);
  });
});
