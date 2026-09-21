import { afterEach, describe, expect, test } from "bun:test";
import { getOctokit } from "@actions/github";
import { createOctokitPort } from "../../src/github/octokit-port.ts";
import type { GitHubPort } from "../../src/github/port.ts";
import { BOT, FakeGitHub } from "./fake-github.ts";
import { type FakeGitHubServer, startFakeGitHubServer } from "./server.ts";

// The real Octokit port on one side, the fake on the other, and real HTTP in
// between. So these tests hold the server to what Sluiceway really sends, and
// no test knows a path or a status code that the port does not.

const servers: FakeGitHubServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

async function served(fake = new FakeGitHub()): Promise<{
  fake: FakeGitHub;
  server: FakeGitHubServer;
  port: GitHubPort;
}> {
  const server = await startFakeGitHubServer(fake);
  servers.push(server);
  const octokit = getOctokit("a-token", { baseUrl: server.url });
  return { fake, server, port: createOctokitPort(octokit, { owner: "acme", repo: "infra" }) };
}

describe("the fake GitHub server", () => {
  test("an issue created over HTTP is in the fake, by the bot", async () => {
    const { fake, port } = await served();
    const created = await port.createIssue({
      title: "Sluiceway dashboard",
      body: "the body",
      labels: ["sluiceway"],
    });
    expect(created).toEqual(fake.issue(created.number));
    expect(created).toMatchObject({
      number: 1,
      state: "open",
      closedAt: null,
      title: "Sluiceway dashboard",
      body: "the body",
      labels: ["sluiceway"],
      author: BOT,
    });
  });

  test("issues are listed by label and state, and read one by one", async () => {
    const { fake, port } = await served();
    const open = fake.seedIssue({ title: "open", labels: ["sluiceway"] });
    const closed = fake.seedIssue({ title: "closed", labels: ["sluiceway"], state: "closed" });
    fake.seedIssue({ title: "another label", labels: ["bug"] });

    expect(await port.listIssues({ label: "sluiceway", state: "open" })).toEqual([open]);
    expect(await port.listIssues({ label: "sluiceway", state: "closed" })).toEqual([closed]);
    expect(await port.getIssue(closed.number)).toEqual(closed);
  });

  test("a list of more than 100 issues comes in pages, lowest number first", async () => {
    const { fake, port } = await served();
    for (let i = 0; i < 205; i++) fake.seedIssue({ labels: ["sluiceway"] });
    const listed = await port.listIssues({ label: "sluiceway", state: "open" });
    expect(listed.map((issue) => issue.number)).toEqual(
      Array.from({ length: 205 }, (_, i) => i + 1),
    );
    // One request per page of 100, as against the API budget.
    expect(fake.requests).toEqual(["listIssues", "listIssues", "listIssues"]);
  });

  test("a body is updated, and an issue is closed and reopened", async () => {
    const { fake, port } = await served();
    const { number } = fake.seedIssue({ body: "old", labels: ["sluiceway"] });

    expect((await port.updateIssueBody(number, "new")).body).toBe("new");
    expect(fake.issue(number).body).toBe("new");

    await port.closeIssue(number);
    expect(fake.issue(number).state).toBe("closed");
    expect(fake.issue(number).closedAt).not.toBeNull();
    // Closing sent no body, so the body stays.
    expect(fake.issue(number).body).toBe("new");

    await port.reopenIssue(number);
    expect(fake.issue(number)).toMatchObject({ state: "open", closedAt: null, body: "new" });
  });

  test("an update over the limit is answered with success and stores nothing", async () => {
    const { fake, port } = await served(new FakeGitHub({ updateLimitBytes: 10 }));
    const { number } = fake.seedIssue({ body: "old" });
    expect((await port.updateIssueBody(number, "far too long a body")).body).toBe(
      "far too long a body",
    );
    expect((await port.getIssue(number)).body).toBe("old");
  });

  test("a comment lands on its issue", async () => {
    const { fake, port } = await served();
    const { number } = fake.seedIssue();
    await port.createComment(number, "a plain comment");
    expect(fake.comments(number)).toEqual(["a plain comment"]);
  });

  test("a comparison names its files, a renamed one with its old path", async () => {
    const { fake, port } = await served();
    fake.seedComparison("aaa111", "bbb222", {
      status: "ahead",
      files: [
        { path: "network/Pulumi.yaml" },
        { path: "app/new.txt", previousPath: "app/old.txt" },
      ],
    });
    expect(await port.compareCommits("aaa111", "bbb222")).toEqual({
      status: "ahead",
      files: [
        { path: "network/Pulumi.yaml" },
        { path: "app/new.txt", previousPath: "app/old.txt" },
      ],
    });
  });

  test("an issue is pinned through GraphQL", async () => {
    const { fake, port } = await served();
    const issue = fake.seedIssue();
    await port.pinIssue(issue.nodeId);
    expect(fake.pinned).toEqual([issue.number]);
  });

  test("what the fake refuses comes back as an error with GitHub's status", async () => {
    const { fake, port } = await served();
    await expect(port.getIssue(99)).rejects.toMatchObject({ status: 404 });
    await expect(port.compareCommits("gone", "bbb222")).rejects.toMatchObject({ status: 404 });
    await expect(
      port.createIssue({ title: "t", body: "x".repeat(65_537), labels: [] }),
    ).rejects.toMatchObject({ status: 422 });

    for (let i = 0; i < 3; i++) await port.pinIssue(fake.seedIssue().nodeId);
    await expect(port.pinIssue(fake.seedIssue().nodeId)).rejects.toThrow(
      "Maximum 3 pinned issues per repository",
    );
  });

  test("every request the port makes is counted once", async () => {
    const { fake, port } = await served();
    const { number } = fake.seedIssue({ labels: ["sluiceway"] });
    await port.listIssues({ label: "sluiceway", state: "open" });
    await port.getIssue(number);
    await port.updateIssueBody(number, "new");
    expect(fake.requests).toEqual(["listIssues", "getIssue", "updateIssueBody"]);
  });
});
