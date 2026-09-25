import { afterEach, describe, expect, test } from "bun:test";
import { getOctokit } from "@actions/github";
import { createGitHubClient } from "../../src/github/client.ts";
import { createOctokitPort } from "../../src/github/octokit-port.ts";
import { FakeGitHub } from "./fake-github.ts";
import { type FakeGitHubServer, startFakeGitHubServer } from "./server.ts";

// The fake answers only the API version the action pins (issue 266), so a
// call that forgets it fails in every test that goes over HTTP. It keeps what
// it refused, because the port swallows a failed pin and a test would not see
// that one otherwise.

const servers: FakeGitHubServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

async function served() {
  const fake = new FakeGitHub();
  fake.seedIssue({ title: "Sluiceway dashboard", labels: ["sluiceway"] });
  const server = await startFakeGitHubServer(fake);
  servers.push(server);
  return { fake, server };
}

describe("the API version on the fake GitHub server", () => {
  test("a request that names no version is refused, and kept", async () => {
    const { fake, server } = await served();
    const port = createOctokitPort(getOctokit("a-token", { baseUrl: server.url }), {
      owner: "acme",
      repo: "infra",
    });

    await expect(port.getIssue(1)).rejects.toMatchObject({ status: 400 });
    expect(server.refused).toEqual(["GET /repos/acme/infra/issues/1 named no API version"]);
    expect(fake.requests).toEqual([]);
  });

  test("a GraphQL query that names no version is refused too", async () => {
    const { server } = await served();
    const octokit = getOctokit("a-token", { baseUrl: server.url });

    await expect(octokit.graphql("query { viewer { login } }")).rejects.toMatchObject({
      status: 400,
    });
    expect(server.refused).toEqual(["POST /graphql named no API version"]);
  });

  test("another version is refused, with the one it named", async () => {
    const { server } = await served();
    const octokit = getOctokit("a-token", { baseUrl: server.url });

    await expect(
      octokit.request("GET /repos/{owner}/{repo}/issues/{issue_number}", {
        owner: "acme",
        repo: "infra",
        issue_number: 1,
        headers: { "x-github-api-version": "2022-11-28" },
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(server.refused).toEqual(["GET /repos/acme/infra/issues/1 named API version 2022-11-28"]);
  });

  test("the action's client is answered", async () => {
    const { fake, server } = await served();
    const port = createOctokitPort(createGitHubClient("a-token", { baseUrl: server.url }), {
      owner: "acme",
      repo: "infra",
    });

    expect((await port.getIssue(1)).title).toBe("Sluiceway dashboard");
    expect(server.refused).toEqual([]);
    expect(fake.requests).toEqual(["getIssue"]);
  });
});
