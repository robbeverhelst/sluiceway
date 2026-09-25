import { afterEach, expect, test } from "bun:test";
import { createGitHubClient } from "../../src/github/client.ts";
import { createOctokitPort } from "../../src/github/octokit-port.ts";
import { countRequests } from "../../src/github/request-count.ts";
import { FakeGitHub } from "../fake-github/fake-github.ts";
import { type FakeGitHubServer, startFakeGitHubServer } from "../fake-github/server.ts";

// The count the scan logs is taken on the wire, so a page of a list and a
// GraphQL query each count once, the way GitHub counts them against the
// budget of record 0017. The fake counts the same way, over real HTTP.

const servers: FakeGitHubServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

test("every request on the wire counts once: two pages of a list, a read and a GraphQL query", async () => {
  const fake = new FakeGitHub();
  for (let i = 0; i < 150; i++) fake.seedIssue({ labels: ["sluiceway"] });
  const server = await startFakeGitHubServer(fake);
  servers.push(server);
  const octokit = createGitHubClient("a-token", { baseUrl: server.url });
  const requests = countRequests(octokit);
  const port = createOctokitPort(octokit, { owner: "acme", repo: "infra" });

  expect(requests()).toBe(0);
  const issues = await port.listIssues({ label: "sluiceway", state: "open" });
  expect(issues).toHaveLength(150);
  await port.getIssue(1);
  await port.pinIssue(issues[0]?.nodeId ?? "");
  expect(requests()).toBe(4);
  expect(requests()).toBe(fake.requests.length);
});

test("a request GitHub refuses counts too", async () => {
  const server = await startFakeGitHubServer(new FakeGitHub());
  servers.push(server);
  const octokit = createGitHubClient("a-token", { baseUrl: server.url });
  const requests = countRequests(octokit);
  await expect(
    createOctokitPort(octokit, { owner: "acme", repo: "infra" }).getIssue(99),
  ).rejects.toThrow();
  expect(requests()).toBe(1);
});
