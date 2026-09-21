import { afterEach, describe, expect, test } from "bun:test";
import { getOctokit } from "@actions/github";
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
  const octokit = getOctokit("a-token", { baseUrl: server.url });
  return { fake, port: createOctokitPort(octokit, { owner: "acme", repo: "infra" }) };
}

describe("the runs an issue edit started, over HTTP", () => {
  test("read as the fake gives them, newest first", async () => {
    const { fake, port } = await served();
    fake.seedIssuesRun("sluiceway.yml", { id: "7", completed: true });
    fake.seedIssuesRun("sluiceway.yml", { id: "8", completed: false });
    fake.seedIssuesRun("triage.yml", { id: "9", completed: false });

    expect(await port.listIssuesRuns("sluiceway.yml")).toEqual([
      { id: "8", completed: false },
      { id: "7", completed: true },
    ]);
    expect(await port.listIssuesRuns("sluiceway.yml")).toEqual(
      await fake.listIssuesRuns("sluiceway.yml"),
    );
  });

  test("a workflow without such runs gives an empty list", async () => {
    const { port } = await served();
    expect(await port.listIssuesRuns("sluiceway.yml")).toEqual([]);
  });

  test("the server only knows the filter the port sends", async () => {
    const { fake } = await served();
    fake.seedIssuesRun("sluiceway.yml", { id: "7", completed: false });
    const server = servers[0];
    const answer = await fetch(
      `${server?.url}/repos/acme/infra/actions/workflows/sluiceway.yml/runs?event=push`,
    );
    expect(answer.status).toBe(400);
  });
});
