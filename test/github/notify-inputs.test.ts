import { describe, expect, test } from "bun:test";
import { NOTIFY_INPUTS, readNotifyTargets, unusedNotifyInputs } from "../../src/github/inputs.ts";

// Slice 5.13 (record 0078): the channels are inputs, each from the repo's own
// secret. A channel that is set up wrong is a warning and sends nothing: it
// never stops a scan or a deploy. A problem never quotes the value.

function inputs(table: Record<string, string>) {
  return (name: string) => table[name] ?? "";
}

const SLACK = "https://hooks.slack.com/services/T0/B0/SECRET";

describe("the channels", () => {
  test("none set gives no channel and no problem", () => {
    expect(readNotifyTargets(inputs({}))).toEqual({ targets: {}, problems: [], secrets: [] });
  });

  test("every channel set gives all three, and every value is a secret to mask", () => {
    const read = readNotifyTargets(
      inputs({
        "slack-webhook-url": ` ${SLACK} `,
        "telegram-bot-token": "123:abc-DEF_9",
        "telegram-chat-id": "-100123",
        "webhook-url": "http://hooks.internal:8080/sluiceway",
      }),
    );
    expect(read.targets).toEqual({
      slack: SLACK,
      telegram: { token: "123:abc-DEF_9", chatId: "-100123" },
      webhook: "http://hooks.internal:8080/sluiceway",
    });
    expect(read.problems).toEqual([]);
    expect(read.secrets).toEqual([
      SLACK,
      "123:abc-DEF_9",
      "-100123",
      "http://hooks.internal:8080/sluiceway",
    ]);
  });

  test("a Telegram channel name is a chat id or an @ name", () => {
    const read = readNotifyTargets(
      inputs({ "telegram-bot-token": "123:abc", "telegram-chat-id": "@acme_deploys" }),
    );
    expect(read.targets.telegram).toEqual({ token: "123:abc", chatId: "@acme_deploys" });
  });

  test("a Slack address that is not https is refused, and the value is never quoted", () => {
    const read = readNotifyTargets(inputs({ "slack-webhook-url": "hooks.slack.com/SECRET" }));
    expect(read.targets).toEqual({});
    expect(read.problems).toEqual([
      'The "slack-webhook-url" input is not an https:// address, so nothing is sent to Slack. Set it to the address of an incoming webhook, from a secret.',
    ]);
    expect(read.secrets).toEqual(["hooks.slack.com/SECRET"]);
  });

  test("a webhook address that is not http or https is refused", () => {
    const read = readNotifyTargets(inputs({ "webhook-url": "ftp://x/SECRET" }));
    expect(read.targets).toEqual({});
    expect(read.problems).toEqual([
      'The "webhook-url" input is not an http:// or https:// address, so nothing is sent to it.',
    ]);
  });

  test("half a Telegram channel sends nothing to Telegram and says which half is missing", () => {
    expect(readNotifyTargets(inputs({ "telegram-bot-token": "123:abc" })).problems).toEqual([
      'The "telegram-bot-token" input is set and "telegram-chat-id" is not, so nothing is sent to Telegram. Set both.',
    ]);
    expect(readNotifyTargets(inputs({ "telegram-chat-id": "-1" })).problems).toEqual([
      'The "telegram-chat-id" input is set and "telegram-bot-token" is not, so nothing is sent to Telegram. Set both.',
    ]);
  });

  test("a token or chat id that could change the address is refused", () => {
    const read = readNotifyTargets(
      inputs({ "telegram-bot-token": "123:abc/../x", "telegram-chat-id": "-1" }),
    );
    expect(read.targets).toEqual({});
    expect(read.problems).toEqual([
      'The "telegram-bot-token" input is not a bot token as BotFather gives it, so nothing is sent to Telegram.',
    ]);
  });
});

describe("modes that send nothing", () => {
  test("scan, resolve and apply use the inputs", () => {
    const all = inputs(Object.fromEntries(NOTIFY_INPUTS.map((name) => [name, "x"])));
    for (const mode of ["scan", "resolve", "apply"])
      expect(unusedNotifyInputs(mode, all)).toEqual([]);
  });

  test("settle, check and init name the ones set", () => {
    const some = inputs({ "slack-webhook-url": SLACK, "webhook-url": "https://x" });
    for (const mode of ["settle", "check", "init"]) {
      expect(unusedNotifyInputs(mode, some)).toEqual(["slack-webhook-url", "webhook-url"]);
    }
  });
});
