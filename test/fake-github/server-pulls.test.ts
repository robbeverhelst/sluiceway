import { afterEach, expect, test } from "bun:test";
import { createGitHubClient } from "../../src/github/client.ts";
import { createOctokitPort } from "../../src/github/octokit-port.ts";
import { FakeGitHub } from "./fake-github.ts";
import { type FakeGitHubServer, startFakeGitHubServer } from "./server.ts";

// The merge and deploy calls through the real Octokit port and real HTTP
// (slice 4.2), so the e2e can merge on the fake.

const servers: FakeGitHubServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

const HEAD = "4444444444444444444444444444444444444444";

test("the open pull requests, the merge settings and a merge go over HTTP as the port sends them", async () => {
  const fake = new FakeGitHub();
  const server = await startFakeGitHubServer(fake);
  servers.push(server);
  const port = createOctokitPort(createGitHubClient("a-token", { baseUrl: server.url }), {
    owner: "acme",
    repo: "infra",
  });
  const seeded = fake.seedOpenPullRequest({ number: 50, head: HEAD, files: ["shared/motd.txt"] });
  fake.seedOpenPullRequest({ number: 51, head: HEAD, author: "alice", checks: "none" });

  expect(await port.listOpenPullRequests()).toEqual(await fake.listOpenPullRequests());
  expect((await port.listOpenPullRequests()).pullRequests[0]).toEqual(seeded);
  expect(await port.allowedMergeMethods()).toEqual({ squash: true, rebase: true, merge: true });
  expect(await port.mergePullRequest(51, { head: "f".repeat(40), method: "squash" })).toMatchObject(
    {
      merged: false,
      status: 409,
    },
  );
  const merged = await port.mergePullRequest(50, { head: HEAD, method: "squash" });
  expect(merged).toEqual({ merged: true, sha: fake.merges[0]?.sha ?? "" });

  fake.withoutContentsWrite();
  await expect(port.mergePullRequest(51, { head: HEAD, method: "squash" })).rejects.toThrow(
    "Resource not accessible by integration",
  );
});

test("more than 100 open pull requests come in pages over HTTP, one request each (slice 4.13)", async () => {
  const fake = new FakeGitHub();
  const server = await startFakeGitHubServer(fake);
  servers.push(server);
  const port = createOctokitPort(createGitHubClient("a-token", { baseUrl: server.url }), {
    owner: "acme",
    repo: "infra",
  });
  for (let number = 1; number <= 250; number++) fake.seedOpenPullRequest({ number });

  const { pullRequests } = await port.listOpenPullRequests();

  expect(pullRequests.map(({ number }) => number)).toEqual(
    Array.from({ length: 250 }, (_, index) => index + 1),
  );
  expect(fake.requests.filter((request) => request === "listOpenPullRequests")).toHaveLength(3);
});
