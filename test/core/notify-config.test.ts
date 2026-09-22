import { describe, expect, test } from "bun:test";
import { ConfigError, type ConfigIssue, parseConfig } from "../../src/core/config.ts";

// Slice 5.13 (record 0078): which events the built-in notifications send on.
// The channels are inputs, from the repo's own secrets. This list is the
// reviewed part.

// The issues as facts. Their words are test/render/config-problems.test.ts's.
function issues(text: string): ConfigIssue[] {
  try {
    parseConfig(text);
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
  return [];
}

describe("notify.events", () => {
  test("defaults to every event but a deploy that went out", () => {
    expect(parseConfig(undefined).notify).toEqual({
      events: ["pending", "drift", "failed", "refused"],
    });
  });

  test("takes any of the five events, each once, in the order written", () => {
    expect(parseConfig("notify:\n  events: [deployed, failed, deployed]\n").notify.events).toEqual([
      "deployed",
      "failed",
    ]);
  });

  test("an empty list sends nothing", () => {
    expect(parseConfig("notify:\n  events: []\n").notify.events).toEqual([]);
  });

  test("an unknown event is an error that names the five", () => {
    expect(issues("notify:\n  events: [pending, merged]\n")).toEqual([
      {
        kind: "not-an-event",
        value: "merged",
        events: ["pending", "drift", "deployed", "failed", "refused"],
        path: ["notify", "events", 1],
      },
    ]);
  });

  test("a channel in the file is an error that points at the inputs", () => {
    expect(issues("notify:\n  slack: https://hooks.slack.com/services/x\n")).toEqual([
      { kind: "notify-unknown-key", key: "slack", known: ["events"], path: ["notify"] },
    ]);
  });
});
