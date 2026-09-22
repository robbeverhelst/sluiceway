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

  // Slice 5.9: asked for it, GitHub names the run it started.
  test("answers with the page of the run it started", async () => {
    const { port } = await served();

    expect(await port.dispatchWorkflow("sluiceway.yml", "main")).toBe(
      "https://github.com/acme/infra/actions/runs/9000",
    );
  });

  test("carries the inputs of the scan after a merge (slice 4.13)", async () => {
    const { fake, port } = await served();

    await port.dispatchWorkflow("sluiceway.yml", "main", { "sluiceway-merged": "418" });

    expect(fake.dispatches).toEqual([
      { workflow: "sluiceway.yml", ref: "main", inputs: { "sluiceway-merged": "418" } },
    ]);
  });

  test("a token without `actions: write` gets the 403", async () => {
    const { fake, port } = await served();
    fake.withoutActionsWrite();

    await expect(port.dispatchWorkflow("sluiceway.yml", "main")).rejects.toMatchObject({
      status: 403,
    });
  });
});
