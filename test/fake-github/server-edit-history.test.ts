import { afterEach, describe, expect, test } from "bun:test";
import { createGitHubClient } from "../../src/github/client.ts";
import { createOctokitPort } from "../../src/github/octokit-port.ts";
import { FakeGitHub } from "./fake-github.ts";
import { type FakeGitHubServer, startFakeGitHubServer } from "./server.ts";

// The real Octokit port, real HTTP and the fake, as in server.test.ts: what
// the port reads over the wire is what the fake gives when asked directly.

const servers: FakeGitHubServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

async function served() {
  const fake = new FakeGitHub();
  const server = await startFakeGitHubServer(fake);
  servers.push(server);
  const octokit = createGitHubClient("a-token", { baseUrl: server.url });
  return { fake, port: createOctokitPort(octokit, { owner: "acme", repo: "infra" }) };
}

describe("the edit history over HTTP", () => {
  test("every page reads as the fake gives it, a deleted entry included", async () => {
    const { fake, port } = await served();
    const issue = fake.seedIssue({ body: "original" });
    fake.editBody(issue.number, "ticked", { login: "alice", type: "User" });
    await fake.updateIssueBody(issue.number, "written by a scan");
    fake.editBody(issue.number, "edited again");
    fake.deleteHistoryEntry(issue.number, 2);

    const first = await port.readEditHistory(issue.number, { size: 3, after: undefined });
    const second = await port.readEditHistory(issue.number, { size: 3, after: first.next });

    expect(first).toEqual(await fake.readEditHistory(issue.number, { size: 3, after: undefined }));
    expect(second).toEqual(
      await fake.readEditHistory(issue.number, { size: 3, after: first.next }),
    );
    expect(first.entries.map((entry) => entry.body)).toEqual([
      "edited again",
      "written by a scan",
      null,
    ]);
    expect(first.next).toBeDefined();
    expect(second.entries.map((entry) => entry.body)).toEqual(["original"]);
    expect(second.next).toBeUndefined();
  });

  test("an issue that does not exist is a GraphQL error", async () => {
    const { port } = await served();

    await expect(port.readEditHistory(7, { size: 3, after: undefined })).rejects.toThrow(
      "Not Found",
    );
  });

  test("a page is one request", async () => {
    const { fake, port } = await served();
    const issue = fake.seedIssue();

    await port.readEditHistory(issue.number, { size: 3, after: undefined });

    expect(fake.requests).toEqual(["readEditHistory"]);
  });
});
