import { describe, expect, test } from "bun:test";
import {
  editedIssue,
  mergedBeforeDispatch,
  mergedBy,
  publicRepo,
  readEventPayload,
  startedByPerson,
} from "../../src/github/event.ts";

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

// Record 0048: a scan with scan.logDiff on warns in a public repo. The payload
// of most events names the repository and whether it is private.
describe("whether the repo is public", () => {
  test("a repository that is not private is public", () => {
    expect(publicRepo({ repository: { private: false, visibility: "public" } })).toBe(true);
    expect(publicRepo({ repository: { private: false } })).toBe(true);
  });

  test("a private or internal repository is not", () => {
    expect(publicRepo({ repository: { private: true, visibility: "private" } })).toBe(false);
    expect(publicRepo({ repository: { private: true, visibility: "internal" } })).toBe(false);
  });

  test("a payload that does not say gives nothing, so nothing is guessed", () => {
    expect(publicRepo(undefined)).toBeUndefined();
    expect(publicRepo({ schedule: "0 * * * *" })).toBeUndefined();
    expect(publicRepo({ repository: { private: "no" } })).toBeUndefined();
  });
});

// Record 0055: a dispatch that a person started (Run workflow) checks drift.
// One that the workflow token started, `settle` after a deploy or the rescan
// box, does not.
describe("who started the run", () => {
  test("a person is a sender of type User", () => {
    expect(startedByPerson({ sender: { login: "alice", type: "User" } })).toBe(true);
  });

  test("the workflow token is a bot", () => {
    expect(startedByPerson({ sender: { login: "github-actions[bot]", type: "Bot" } })).toBe(false);
  });

  test("a payload that does not say is nobody", () => {
    expect(startedByPerson(undefined)).toBe(false);
    expect(startedByPerson({ sender: null })).toBe(false);
  });
});

describe("the pull requests resolve merged before it dispatched the scan (slice 4.13)", () => {
  const BOT = { login: "github-actions[bot]", type: "Bot" };

  test("are read from the input of a dispatch by the workflow token", () => {
    expect(
      mergedBeforeDispatch({ inputs: { "sluiceway-merged": "418,421" }, sender: BOT }),
    ).toEqual([418, 421]);
  });

  test("are none for a dispatch a person started, so that run stays a full scan", () => {
    expect(
      mergedBeforeDispatch({
        inputs: { "sluiceway-merged": "418" },
        sender: { login: "alice", type: "User" },
      }),
    ).toEqual([]);
  });

  test("are none without the input, or for a payload that does not say", () => {
    expect(mergedBeforeDispatch({ inputs: { "sluiceway-merged": "" }, sender: BOT })).toEqual([]);
    expect(mergedBeforeDispatch({ sender: BOT })).toEqual([]);
    expect(mergedBeforeDispatch(undefined)).toEqual([]);
  });
});

// Record 0095: the merge a stack set to on-merge deploys on is a push to the
// default branch, and the deploy is attributed to whoever pushed it: the
// person who pressed merge, or an app that merges, as GitHub names them.
describe("mergedBy", () => {
  const push = (over: Record<string, unknown> = {}) => ({
    ref: "refs/heads/main",
    repository: { default_branch: "main" },
    sender: { login: "alice", type: "User" },
    ...over,
  });

  test("names the sender of a push to the default branch", () => {
    expect(mergedBy("push", push())).toBe("alice");
  });

  test("an app that merges is named as GitHub names it", () => {
    expect(mergedBy("push", push({ sender: { login: "renovate[bot]", type: "Bot" } }))).toBe(
      "renovate[bot]",
    );
  });

  test("is nobody for a push to another branch, another event, or a payload that does not say", () => {
    expect(mergedBy("push", push({ ref: "refs/heads/feature" }))).toBeUndefined();
    expect(mergedBy("push", push({ ref: "refs/tags/v1.0.0" }))).toBeUndefined();
    expect(mergedBy("schedule", push())).toBeUndefined();
    expect(mergedBy("workflow_dispatch", push())).toBeUndefined();
    expect(mergedBy("push", push({ repository: {} }))).toBeUndefined();
    expect(mergedBy("push", push({ sender: { login: "" } }))).toBeUndefined();
    expect(mergedBy("push", undefined)).toBeUndefined();
  });
});
