import { describe, expect, test } from "bun:test";
import { FakeGitHub } from "./fake-github.ts";

// The numbers are the ones the lab measured on real GitHub (issue 17), written
// out here so that the fake cannot move them without a test going red.

describe("body size, as the lab measured it", () => {
  test("an update of 262,144 bytes is stored", async () => {
    const github = new FakeGitHub();
    const issue = await github.createIssue({ title: "t", body: "old", labels: [] });
    const body = "a".repeat(262_144);

    await github.updateIssueBody(issue.number, body);

    expect((await github.getIssue(issue.number)).body).toBe(body);
  });

  test("an update one byte over answers success, echoes the new body and stores nothing", async () => {
    const github = new FakeGitHub();
    const issue = await github.createIssue({ title: "t", body: "old", labels: [] });
    const body = "a".repeat(262_145);

    const answer = await github.updateIssueBody(issue.number, body);

    expect(answer.body).toBe(body);
    expect((await github.getIssue(issue.number)).body).toBe("old");
  });

  test("the update limit counts bytes: 131,073 two-byte characters are dropped", async () => {
    const github = new FakeGitHub();
    const issue = await github.createIssue({ title: "t", body: "old", labels: [] });

    await github.updateIssueBody(issue.number, "é".repeat(131_073));

    expect((await github.getIssue(issue.number)).body).toBe("old");
  });

  test("an update over 65,536 characters and under the byte limit is stored", async () => {
    const github = new FakeGitHub();
    const issue = await github.createIssue({ title: "t", body: "old", labels: [] });
    const body = "a".repeat(65_537);

    await github.updateIssueBody(issue.number, body);

    expect((await github.getIssue(issue.number)).body).toBe(body);
  });

  test("a create counts characters, not bytes: 65,536 two-byte characters are accepted", async () => {
    const github = new FakeGitHub();
    const body = "é".repeat(65_536);

    const issue = await github.createIssue({ title: "t", body, labels: [] });

    expect((await github.getIssue(issue.number)).body).toBe(body);
  });

  test("a create of 65,537 characters is refused, and no issue exists afterwards", async () => {
    const github = new FakeGitHub();

    const refused = github.createIssue({ title: "t", body: "a".repeat(65_537), labels: ["x"] });

    await expect(refused).rejects.toThrow("body is too long (maximum is 65536 characters)");
    expect(await github.listIssues({ label: "x", state: "open" })).toEqual([]);
  });
});

describe("issues", () => {
  test("an issue made through the port is the bot's, open, with the next number", async () => {
    const github = new FakeGitHub();
    github.seedIssue();

    const issue = await github.createIssue({
      title: "Dashboard",
      body: "b",
      labels: ["sluiceway"],
    });

    expect(issue).toEqual({
      number: 2,
      nodeId: "I_fake2",
      state: "open",
      closedAt: null,
      title: "Dashboard",
      body: "b",
      labels: ["sluiceway"],
      author: { login: "github-actions[bot]", type: "Bot" },
    });
  });

  test("a list holds the issues with the label in that state, lowest number first", async () => {
    const github = new FakeGitHub();
    github.seedIssue({ labels: ["sluiceway"], state: "closed" });
    github.seedIssue({ labels: ["bug"] });
    github.seedIssue({ labels: ["sluiceway", "bug"] });
    github.seedIssue({ labels: ["sluiceway"] });

    const open = await github.listIssues({ label: "sluiceway", state: "open" });
    const closed = await github.listIssues({ label: "sluiceway", state: "closed" });

    expect(open.map((issue) => issue.number)).toEqual([3, 4]);
    expect(closed.map((issue) => issue.number)).toEqual([1]);
  });

  test("closing, reopening and commenting land on the issue", async () => {
    const github = new FakeGitHub();
    const { number } = github.seedIssue();

    await github.closeIssue(number);
    expect(github.issue(number)).toMatchObject({
      state: "closed",
      closedAt: "2026-01-01T00:00:01Z",
    });
    await github.reopenIssue(number);
    expect(github.issue(number)).toMatchObject({ state: "open", closedAt: null });
    await github.createComment(number, "hello");
    expect(github.comments(number)).toEqual(["hello"]);
  });

  test("an issue closed later has a later closedAt", async () => {
    const github = new FakeGitHub();
    const first = github.seedIssue();
    const second = github.seedIssue();

    await github.closeIssue(second.number);
    await github.closeIssue(first.number);

    expect(github.issue(second.number).closedAt).toBe("2026-01-01T00:00:01Z");
    expect(github.issue(first.number).closedAt).toBe("2026-01-01T00:00:02Z");
  });

  test("an issue that does not exist is a 404", async () => {
    const github = new FakeGitHub();
    await expect(github.getIssue(7)).rejects.toMatchObject({ status: 404 });
  });

  test("what the fake hands out is a copy, so a caller cannot edit the repo by accident", async () => {
    const github = new FakeGitHub();
    const issue = await github.createIssue({ title: "t", body: "b", labels: ["x"] });

    issue.body = "changed";
    issue.labels.push("y");

    expect(github.issue(issue.number)).toMatchObject({ body: "b", labels: ["x"] });
  });
});

describe("pinning", () => {
  test("a repo holds three pinned issues and refuses the fourth", async () => {
    const github = new FakeGitHub();
    const issues = [1, 2, 3, 4].map(() => github.seedIssue());

    for (const issue of issues.slice(0, 3)) await github.pinIssue(issue.nodeId);

    await expect(github.pinIssue(issues[3]?.nodeId ?? "")).rejects.toMatchObject({ status: 422 });
    expect(github.pinned).toEqual([1, 2, 3]);
  });
});

describe("the request count", () => {
  test("every call is one request, and the test's own hands are none", async () => {
    const github = new FakeGitHub();
    const { number } = github.seedIssue();
    github.editBody(number, "by a person");
    github.issue(number);

    await github.getIssue(number);
    await github.updateIssueBody(number, "b");

    expect(github.requests).toEqual(["getIssue", "updateIssueBody"]);
  });

  test("a list costs one request per page of 100, and one when it is empty", async () => {
    const github = new FakeGitHub();
    await github.listIssues({ label: "sluiceway", state: "open" });
    expect(github.requests).toHaveLength(1);

    for (let i = 0; i < 101; i++) github.seedIssue({ labels: ["sluiceway"] });
    await github.listIssues({ label: "sluiceway", state: "open" });

    expect(github.requests).toHaveLength(3);
  });

  test("onRequest runs before the request is answered", async () => {
    const github = new FakeGitHub();
    const { number } = github.seedIssue({ body: "first" });
    github.onRequest = () => github.editBody(number, "second");

    expect((await github.getIssue(number)).body).toBe("second");
  });
});

describe("comparing two commits", () => {
  test("a seeded comparison is given back as a copy, and costs one request", async () => {
    const github = new FakeGitHub();
    github.seedComparison("aaa", "bbb", {
      status: "ahead",
      files: [{ path: "new.ts", previousPath: "old.ts" }],
    });

    const comparison = await github.compareCommits("aaa", "bbb");
    expect(comparison).toEqual({
      status: "ahead",
      files: [{ path: "new.ts", previousPath: "old.ts" }],
    });
    comparison.files.pop();
    expect((await github.compareCommits("aaa", "bbb")).files).toHaveLength(1);
    expect(github.requests).toEqual(["compareCommits", "compareCommits"]);
  });

  test("a commit the repo does not have is a 404, as after a force push", async () => {
    const github = new FakeGitHub();
    github.seedComparison("aaa", "bbb", { status: "ahead", files: [] });
    await expect(github.compareCommits("bbb", "aaa")).rejects.toMatchObject({ status: 404 });
  });

  test("like GitHub, it never lists more than 300 files", async () => {
    const github = new FakeGitHub();
    const files = Array.from({ length: 450 }, (_, index) => ({ path: `f${index}` }));
    github.seedComparison("aaa", "bbb", { status: "ahead", files });
    expect((await github.compareCommits("aaa", "bbb")).files).toHaveLength(300);
  });
});

describe("looking up a person's permission", () => {
  test("a seeded person has what was seeded, and the lookup costs one request", async () => {
    const github = new FakeGitHub();
    github.seedPermission("alice", { push: true, maintain: true, admin: false });

    expect(await github.getPermission("alice")).toEqual({
      push: true,
      maintain: true,
      admin: false,
    });
    expect(github.requests).toEqual(["getPermission"]);
  });

  test("like GitHub, it finds a login in any case of the letters", async () => {
    const github = new FakeGitHub();
    github.seedPermission("Alice", { push: true, maintain: false, admin: false });
    expect((await github.getPermission("aLICE")).push).toBe(true);
  });

  test("someone who is not a collaborator is a clean answer with no access", async () => {
    // Real GitHub answers 200 for any account that exists (probed 2026-09-21).
    expect(await new FakeGitHub().getPermission("stranger")).toEqual({
      push: false,
      maintain: false,
      admin: false,
    });
  });

  test("a lookup that was made to fail is an error with GitHub's status", async () => {
    const github = new FakeGitHub();
    github.seedPermission("alice", { push: true, maintain: true, admin: true });
    github.failPermissionLookup("alice", 502);

    await expect(github.getPermission("Alice")).rejects.toMatchObject({ status: 502 });
    expect((await github.getPermission("bob")).push).toBe(false);
    expect(github.requests).toEqual(["getPermission", "getPermission"]);
  });
});
