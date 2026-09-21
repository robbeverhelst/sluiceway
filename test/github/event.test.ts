import { describe, expect, test } from "bun:test";
import { editedIssue, readEventPayload } from "../../src/github/event.ts";

// The payload of the event that woke `resolve`. It is only a wake-up (record
// 0025): all that is read from it is what the cheap check of record 0017 needs.

function payload(issue: Record<string, unknown>): unknown {
  return { action: "edited", issue, sender: { login: "alice", type: "User" } };
}

const DASHBOARD = {
  number: 7,
  state: "open",
  body: '<!-- sluiceway:dashboard v="1" -->\n\nrest',
  labels: [{ name: "sluiceway" }, { name: "infra" }],
  user: { login: "github-actions[bot]", type: "Bot" },
};

describe("the issue of an event payload", () => {
  test("is read into the port's words", () => {
    expect(editedIssue(payload(DASHBOARD))).toEqual({
      number: 7,
      state: "open",
      body: DASHBOARD.body,
      labels: ["sluiceway", "infra"],
      author: { login: "github-actions[bot]", type: "Bot" },
    });
  });

  test("an issue without a body or an author reads as an empty body and nobody", () => {
    expect(editedIssue(payload({ ...DASHBOARD, body: null, user: null }))).toMatchObject({
      body: "",
      author: { login: "", type: "" },
    });
  });

  test("a closed issue is closed, and any other state is not open either", () => {
    expect(editedIssue(payload({ ...DASHBOARD, state: "closed" }))?.state).toBe("closed");
    expect(editedIssue(payload({ ...DASHBOARD, state: "locked" }))?.state).toBe("closed");
  });

  test.each([
    ["no payload", undefined],
    ["a payload that is no object", "text"],
    ["a payload without an issue, as a push or a dispatch has", { ref: "refs/heads/main" }],
    ["an issue without a number", payload({ ...DASHBOARD, number: "7" })],
    [
      "a pull request, which GitHub also calls an issue",
      payload({ ...DASHBOARD, pull_request: {} }),
    ],
  ])("%s holds no issue", (_name, given) => {
    expect(editedIssue(given)).toBeUndefined();
  });
});

describe("the payload file of the runner", () => {
  test("is read from GITHUB_EVENT_PATH as JSON", () => {
    const read = (path: string) => (path === "/runner/event.json" ? '{"action":"edited"}' : "");
    expect(readEventPayload({ GITHUB_EVENT_PATH: "/runner/event.json" }, read)).toEqual({
      action: "edited",
    });
  });

  test("is nothing when the variable is not set, the file is missing or it is not JSON", () => {
    const missing = () => {
      throw new Error("ENOENT");
    };
    expect(readEventPayload({}, () => "{}")).toBeUndefined();
    expect(readEventPayload({ GITHUB_EVENT_PATH: "/gone" }, missing)).toBeUndefined();
    expect(readEventPayload({ GITHUB_EVENT_PATH: "/text" }, () => "not json")).toBeUndefined();
  });
});
