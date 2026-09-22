import { describe, expect, test } from "bun:test";
import { stepNotifier } from "../../src/notify/step.ts";
import { rememberingLog } from "../modes/harness.ts";

// Slice 5.13 (record 0078): the step's notifier, made once from its inputs.
// Every value is masked before anything else, a channel set up wrong is a
// warning, and a step with no channel has no notifier at all.

function inputs(table: Record<string, string>) {
  return (name: string) => table[name] ?? "";
}

describe("the step's notifier", () => {
  test("none without a channel, and nothing masked or said", () => {
    const masked: string[] = [];
    const log = rememberingLog();
    expect(stepNotifier(inputs({}), log, (value) => masked.push(value))).toBeUndefined();
    expect(masked).toEqual([]);
    expect(log.warnings).toEqual([]);
  });

  test("masks every value, a wrong one too, and warns about the wrong one", () => {
    const masked: string[] = [];
    const log = rememberingLog();
    const notifier = stepNotifier(
      inputs({ "slack-webhook-url": "not-an-address", "webhook-url": "https://x/SECRET" }),
      log,
      (value) => masked.push(value),
    );
    expect(notifier).toBeDefined();
    expect(masked).toEqual(["not-an-address", "https://x/SECRET"]);
    expect(log.warnings).toEqual([
      {
        title: "Notification channel not used",
        message:
          'The "slack-webhook-url" input is not an https:// address, so nothing is sent to Slack. Set it to the address of an incoming webhook, from a secret.',
      },
    ]);
  });

  test("a channel set up wrong alone gives no notifier", () => {
    const log = rememberingLog();
    expect(stepNotifier(inputs({ "telegram-chat-id": "-1" }), log, () => {})).toBeUndefined();
    expect(log.warnings).toHaveLength(1);
  });
});
