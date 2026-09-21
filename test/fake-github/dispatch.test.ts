import { describe, expect, test } from "bun:test";
import { FakeGitHub } from "./fake-github.ts";

// The dispatch of a workflow, and the events an edit starts, as GitHub's docs
// and the lab describe them (issues 17 and 28, the Actions research).

const ALICE = { login: "alice", type: "User" };

describe("dispatching a workflow", () => {
  test("is remembered with the workflow's file and the ref, and is one request", async () => {
    const github = new FakeGitHub();

    await github.dispatchWorkflow("sluiceway.yml", "main");

    expect(github.dispatches).toEqual([{ workflow: "sluiceway.yml", ref: "main" }]);
    expect(github.requests).toEqual(["dispatchWorkflow"]);
  });

  test("is refused with GitHub's 403 when the token has no `actions: write`", async () => {
    const github = new FakeGitHub();
    github.withoutActionsWrite();

    await expect(github.dispatchWorkflow("sluiceway.yml", "main")).rejects.toMatchObject({
      status: 403,
      message: "Resource not accessible by integration",
    });
    expect(github.dispatches).toEqual([]);
  });
});

describe("the events of an issue", () => {
  test("an edit by a person starts one, and an edit by the bot starts none", async () => {
    const github = new FakeGitHub();
    const issue = await github.createIssue({ title: "t", body: "original", labels: ["sluiceway"] });
    await github.updateIssueBody(issue.number, "written by a scan");
    expect(github.deliverEvent()).toBeUndefined();

    github.editBody(issue.number, "ticked by alice", ALICE);

    expect(github.deliverEvent()).toEqual({
      action: "edited",
      issue: {
        number: issue.number,
        state: "open",
        body: "ticked by alice",
        labels: [{ name: "sluiceway" }],
        user: { login: "github-actions[bot]", type: "Bot" },
      },
      sender: { login: "alice", type: "User" },
    });
    expect(github.deliverEvent()).toBeUndefined();
  });

  test("a payload carries the newest body, not the body of its own edit", () => {
    const github = new FakeGitHub();
    const issue = github.seedIssue({ body: "original" });
    github.editBody(issue.number, "edit one", ALICE);
    github.editBody(issue.number, "edit two", { login: "bob", type: "User" });

    const first = github.deliverEvent() as { issue: { body: string }; sender: { login: string } };

    expect(first.sender.login).toBe("alice");
    expect(first.issue.body).toBe("edit two");
  });

  test("delivering an event is no request", () => {
    const github = new FakeGitHub();
    const issue = github.seedIssue({ body: "original" });
    github.editBody(issue.number, "edit one", ALICE);

    github.deliverEvent();

    expect(github.requests).toEqual([]);
  });
});
