import { afterEach, describe, expect, test } from "bun:test";
import { getOctokit } from "@actions/github";
import { createOctokitPort } from "../../src/github/octokit-port.ts";
import { FakeGitHub } from "./fake-github.ts";
import { type FakeGitHubServer, startFakeGitHubServer } from "./server.ts";

// The real Octokit port, real HTTP and the fake, as in server.test.ts.

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

describe("a workflow dispatch over HTTP", () => {
  test("reaches the fake with the workflow's file and the ref", async () => {
    const { fake, port } = await served();

    await port.dispatchWorkflow("sluiceway.yml", "main");

    expect(fake.dispatches).toEqual([{ workflow: "sluiceway.yml", ref: "main" }]);
    expect(fake.requests).toEqual(["dispatchWorkflow"]);
  });

  test("a token without `actions: write` gets the 403", async () => {
    const { fake, port } = await served();
    fake.withoutActionsWrite();

    await expect(port.dispatchWorkflow("sluiceway.yml", "main")).rejects.toMatchObject({
      status: 403,
    });
  });
});
