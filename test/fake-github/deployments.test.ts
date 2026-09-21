import { afterEach, describe, expect, test } from "bun:test";
import { getOctokit } from "@actions/github";
import { createOctokitPort } from "../../src/github/octokit-port.ts";
import type { GitHubPort } from "../../src/github/port.ts";
import { FakeGitHub } from "./fake-github.ts";
import { type FakeGitHubServer, startFakeGitHubServer } from "./server.ts";

// The fake's deployment records, with what the lab found (issue 27 and the
// pull request of slice 2.1). Each behavior is pinned twice: on the fake
// itself, and through the real Octokit port with real HTTP in between, so the
// server is held to what Sluiceway really sends.

const SHA = "0123456789abcdef0123456789abcdef01234567";
const PAYLOAD = { v: 1, hash: "2b44350653e84a11", ticker: "alice", run: "4242" };

const servers: FakeGitHubServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

async function overHttp(fake: FakeGitHub): Promise<GitHubPort> {
  const server = await startFakeGitHubServer(fake);
  servers.push(server);
  const octokit = getOctokit("a-token", { baseUrl: server.url });
  return createOctokitPort(octokit, { owner: "acme", repo: "infra" });
}

// Every test runs against the fake as it is and against the fake over HTTP.
const ways: [string, (fake: FakeGitHub) => Promise<GitHubPort>][] = [
  ["the fake", async (fake) => fake],
  ["the real port over HTTP", overHttp],
];

function newDeployment(stack: string, environment = "sluiceway") {
  return { sha: SHA, task: `sluiceway:${stack}`, environment, payload: PAYLOAD };
}

for (const [way, portOf] of ways) {
  describe(`one deployment record by its id on ${way}`, () => {
    test("reads back as it was created, payload and all, without its status", async () => {
      const fake = new FakeGitHub();
      const port = await portOf(fake);
      const created = await port.createDeployment(newDeployment("apps/grafana:prod", "production"));
      await port.createDeploymentStatus(created.id, { state: "queued" });

      expect(await port.getDeployment(created.id)).toEqual(created);
      expect(fake.requests.at(-1)).toBe("getDeployment");
    });

    test("a record GitHub does not have is an error", async () => {
      const port = await portOf(new FakeGitHub());
      await expect(port.getDeployment(99)).rejects.toThrow("Not Found");
    });
  });

  describe(`deployment records on ${way}`, () => {
    test("a created record has no status yet and reads back on the page of its environment", async () => {
      const fake = new FakeGitHub();
      const port = await portOf(fake);

      const created = await port.createDeployment(newDeployment("apps/grafana:prod"));
      expect(created).toEqual({
        id: 1,
        task: "sluiceway:apps/grafana:prod",
        environment: "sluiceway",
        sha: SHA,
        payload: PAYLOAD,
        createdAt: "2026-01-01T00:00:01Z",
      });
      expect(await port.listNewestDeployments("sluiceway")).toEqual({
        records: [{ ...created, status: undefined }],
        more: false,
      });
      expect(await port.listNewestDeployments("production")).toEqual({ records: [], more: false });
      expect(fake.requests).toEqual([
        "createDeployment",
        "listNewestDeployments",
        "listNewestDeployments",
      ]);
    });

    test("the page shows only the latest status of a record", async () => {
      const fake = new FakeGitHub();
      const port = await portOf(fake);
      const { id } = await port.createDeployment(newDeployment("a"));

      await port.createDeploymentStatus(id, { state: "queued" });
      const written = await port.createDeploymentStatus(id, {
        state: "failure",
        description: "the tool exited with an error",
        logUrl: "https://github.com/acme/infra/actions/runs/4242",
      });

      expect(written).toEqual({
        state: "failure",
        description: "the tool exited with an error",
        createdAt: "2026-01-01T00:00:03Z",
      });
      expect((await port.listNewestDeployments("sluiceway")).records[0]?.status).toEqual(written);
      expect(fake.deploymentStatuses(id).map((status) => status.state)).toEqual([
        "queued",
        "failure",
      ]);
    });

    test("another stack's success does not flip this one, because auto_inactive is sent as false", async () => {
      const fake = new FakeGitHub();
      const port = await portOf(fake);
      const first = await port.createDeployment(newDeployment("a"));
      const second = await port.createDeployment(newDeployment("b"));

      await port.createDeploymentStatus(first.id, { state: "success" });
      await port.createDeploymentStatus(second.id, { state: "success" });
      // A moment later is where GitHub's default would have landed.
      await port.listNewestDeployments("sluiceway");
      const page = await port.listNewestDeployments("sluiceway");

      expect(page.records.map(({ task, status }) => [task, status?.state])).toEqual([
        ["sluiceway:b", "success"],
        ["sluiceway:a", "success"],
      ]);
    });

    test("with GitHub's default, a later success flips every earlier success in the environment, a moment later", async () => {
      const fake = new FakeGitHub();
      const port = await portOf(fake);
      const a = await port.createDeployment(newDeployment("a"));
      const b = await port.createDeployment(newDeployment("b"));
      const elsewhere = await port.createDeployment(newDeployment("c", "production"));
      const failed = await port.createDeployment(newDeployment("d"));
      for (const { id } of [a, b, elsewhere]) {
        await port.createDeploymentStatus(id, { state: "success" });
      }
      await port.createDeploymentStatus(failed.id, { state: "failure" });

      // Another writer, such as a job level `environment:` key, with the default.
      const outside = fake.seedDeployment({ task: "deploy" });
      fake.addDeploymentStatus(outside.id, { state: "success" });

      const states = async (environment: string) =>
        Object.fromEntries(
          (await port.listNewestDeployments(environment)).records.map(({ task, status }) => [
            task,
            status?.state,
          ]),
        );
      // An immediate read still shows success (issue 27).
      expect(await states("sluiceway")).toMatchObject({
        "sluiceway:a": "success",
        "sluiceway:b": "success",
      });
      // Whatever the task, and only in the same environment. A failure stays.
      expect(await states("sluiceway")).toEqual({
        deploy: "success",
        "sluiceway:a": "inactive",
        "sluiceway:b": "inactive",
        "sluiceway:d": "failure",
      });
      expect(await states("production")).toEqual({ "sluiceway:c": "success" });
    });

    test("a page holds the newest 100 records and says when there are more", async () => {
      const fake = new FakeGitHub();
      const port = await portOf(fake);
      for (let i = 1; i <= 101; i++) fake.seedDeployment({ task: `sluiceway:s${i}` });

      const page = await port.listNewestDeployments("sluiceway");
      expect(page.more).toBe(true);
      expect(page.records).toHaveLength(100);
      expect(page.records[0]?.task).toBe("sluiceway:s101");
      expect(page.records.at(-1)?.task).toBe("sluiceway:s2");
    });

    test("the fall back finds the newest record of a task, and its status with a second request", async () => {
      const fake = new FakeGitHub();
      const port = await portOf(fake);
      fake.seedDeployment({ task: "sluiceway:a", status: { state: "success" } });
      const newest = fake.seedDeployment({ task: "sluiceway:a", status: { state: "queued" } });
      fake.seedDeployment({ task: "sluiceway:b" });

      const found = await port.newestDeploymentOfTask("sluiceway:a");
      expect(found?.id).toBe(newest.id);
      expect(found?.payload).toEqual(PAYLOAD);
      expect((await port.latestDeploymentStatus(newest.id))?.state).toBe("queued");
      expect(await port.newestDeploymentOfTask("sluiceway:nowhere")).toBeUndefined();
      expect(fake.requests).toEqual([
        "newestDeploymentOfTask",
        "latestDeploymentStatus",
        "newestDeploymentOfTask",
      ]);
    });

    test("a status for a record GitHub does not have is refused", async () => {
      const port = await portOf(new FakeGitHub());
      await expect(port.createDeploymentStatus(99, { state: "queued" })).rejects.toThrow(
        "Not Found",
      );
    });

    test("a workflow run is over, still going, or not there", async () => {
      const fake = new FakeGitHub();
      const port = await portOf(fake);
      fake.seedRun("4242", { completed: true });
      fake.seedRun("4243", { completed: false });

      expect(await port.getWorkflowRun("4242")).toEqual({ completed: true });
      expect(await port.getWorkflowRun("4243")).toEqual({ completed: false });
      expect(await port.getWorkflowRun("1")).toBeUndefined();
    });
  });
}

describe("the test's own hands on deployment records", () => {
  test("a seeded record takes the times it is given and costs no request", () => {
    const fake = new FakeGitHub();
    const seeded = fake.seedDeployment({
      task: "sluiceway:a",
      createdAt: "2026-09-21T08:50:00Z",
      status: { state: "success", createdAt: "2026-09-21T08:52:10Z" },
    });
    expect(fake.deployment(seeded.id)).toEqual({
      id: 1,
      task: "sluiceway:a",
      environment: "sluiceway",
      sha: SHA,
      payload: PAYLOAD,
      createdAt: "2026-09-21T08:50:00Z",
      status: { state: "success", description: "", createdAt: "2026-09-21T08:52:10Z" },
    });
    expect(fake.requests).toEqual([]);
  });
});

describe("a writer that is not Sluiceway, over HTTP", () => {
  test("a status sent without auto_inactive gets GitHub's default and flips the earlier success", async () => {
    const fake = new FakeGitHub();
    const server = await startFakeGitHubServer(fake);
    servers.push(server);
    const first = fake.seedDeployment({ task: "sluiceway:a", status: { state: "success" } });
    const second = fake.seedDeployment({ task: "deploy" });

    const answer = await fetch(`${server.url}/repos/acme/infra/deployments/${second.id}/statuses`, {
      method: "POST",
      body: JSON.stringify({ state: "success" }),
    });
    expect(answer.status).toBe(201);
    await fake.listNewestDeployments("sluiceway");
    await fake.listNewestDeployments("sluiceway");
    expect(fake.deployment(first.id).status?.state).toBe("inactive");
  });
});
