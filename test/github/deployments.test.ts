import { describe, expect, test } from "bun:test";
import { readDeploymentRecords, settleEndedRuns } from "../../src/github/deployments.ts";
import { FakeGitHub } from "../fake-github/fake-github.ts";

// The bounded reads of record 0003 and the rule that ties an open deployment
// to its workflow run, against the fake GitHub.

const REPO_URL = "https://github.com/acme/infra";

function payload(run: string, ticker = "alice") {
  return { v: 1, hash: "2b44350653e84a11", ticker, run };
}

describe("reading the deployment records", () => {
  test("one request for one environment, whatever the number of stacks", async () => {
    const github = new FakeGitHub();
    github.seedDeployment({ task: "sluiceway:a", status: { state: "success" } });
    github.seedDeployment({ task: "sluiceway:b", status: { state: "queued" } });

    const records = await readDeploymentRecords(
      github,
      ["sluiceway"],
      [
        { stackId: "a", environment: "sluiceway" },
        { stackId: "c", environment: "sluiceway" },
      ],
    );

    expect(records.map(({ task, status }) => [task, status?.state])).toEqual([
      ["sluiceway:b", "queued"],
      ["sluiceway:a", "success"],
    ]);
    // The page is not full, so it holds every record there is: a stack that
    // is not on it has none, and no fall back is needed.
    expect(github.requests).toEqual(["listNewestDeployments"]);
  });

  test("one page per environment name, each name once", async () => {
    const github = new FakeGitHub();
    github.seedDeployment({ task: "sluiceway:a", environment: "production" });
    github.seedDeployment({ task: "sluiceway:b" });

    const records = await readDeploymentRecords(
      github,
      ["sluiceway", "production", "sluiceway"],
      [],
    );
    expect(records.map(({ task }) => task).sort()).toEqual(["sluiceway:a", "sluiceway:b"]);
    expect(github.requests).toEqual(["listNewestDeployments", "listNewestDeployments"]);
  });

  test("a full page and a stack that is not on it: the REST fall back, two requests", async () => {
    const github = new FakeGitHub();
    github.seedDeployment({ task: "sluiceway:old", status: { state: "failure" } });
    for (let i = 0; i < 100; i++) github.seedDeployment({ task: "sluiceway:busy" });

    const records = await readDeploymentRecords(
      github,
      ["sluiceway"],
      [
        { stackId: "old", environment: "sluiceway" },
        // On the page: no fall back.
        { stackId: "busy", environment: "sluiceway" },
      ],
    );

    expect(records).toHaveLength(101);
    expect(records.find(({ task }) => task === "sluiceway:old")?.status?.state).toBe("failure");
    expect(github.requests).toEqual([
      "listNewestDeployments",
      "newestDeploymentOfTask",
      "latestDeploymentStatus",
    ]);
  });

  test("a stack with no record at all costs one request of the fall back", async () => {
    const github = new FakeGitHub();
    for (let i = 0; i < 101; i++) github.seedDeployment({ task: "sluiceway:busy" });

    await readDeploymentRecords(
      github,
      ["sluiceway"],
      [{ stackId: "new", environment: "sluiceway" }],
    );
    expect(github.requests).toEqual(["listNewestDeployments", "newestDeploymentOfTask"]);
  });

  test("the fall back belongs to the page of the stack's own environment", async () => {
    const github = new FakeGitHub();
    for (let i = 0; i < 101; i++) github.seedDeployment({ task: "sluiceway:busy" });

    await readDeploymentRecords(
      github,
      ["sluiceway", "production"],
      [{ stackId: "calm", environment: "production" }],
    );
    expect(github.requests).toEqual(["listNewestDeployments", "listNewestDeployments"]);
  });
});

describe("an open deployment whose run is over", () => {
  test("becomes `error` with the fixed reason and the link to its run", async () => {
    const github = new FakeGitHub();
    const open = github.seedDeployment({
      task: "sluiceway:a",
      payload: payload("4242"),
      status: { state: "in_progress" },
    });
    github.seedRun("4242", { completed: true });

    const settled = await settleEndedRuns(github, [github.deployment(open.id)], REPO_URL);

    expect(settled.stackIds).toEqual(["a"]);
    expect(settled.records[0]?.status).toMatchObject({
      state: "error",
      description: "the run ended without a result",
    });
    expect(github.deployment(open.id).status).toEqual(settled.records[0]?.status);
    expect(github.requests).toEqual(["getWorkflowRun", "createDeploymentStatus"]);
  });

  test("a run that is still going leaves the record open, however long it waits", async () => {
    const github = new FakeGitHub();
    const open = github.seedDeployment({
      task: "sluiceway:a",
      createdAt: "2020-01-01T00:00:00Z",
      status: { state: "queued", createdAt: "2020-01-01T00:00:01Z" },
    });
    github.seedRun("4242", { completed: false });

    const settled = await settleEndedRuns(github, [github.deployment(open.id)], REPO_URL);
    expect(settled.stackIds).toEqual([]);
    expect(github.deployment(open.id).status?.state).toBe("queued");
    expect(github.requests).toEqual(["getWorkflowRun"]);
  });

  test("a run GitHub no longer has is over", async () => {
    const github = new FakeGitHub();
    const open = github.seedDeployment({ task: "sluiceway:a", payload: payload("77") });

    const settled = await settleEndedRuns(github, [github.deployment(open.id)], REPO_URL);
    expect(settled.stackIds).toEqual(["a"]);
    expect(github.deployment(open.id).status?.state).toBe("error");
  });

  test("only the newest record of a stack is looked at, and only when it is open", async () => {
    const github = new FakeGitHub();
    github.seedDeployment({
      task: "sluiceway:a",
      createdAt: "2026-09-21T08:00:00Z",
      payload: payload("1"),
      status: { state: "queued" },
    });
    github.seedDeployment({
      task: "sluiceway:a",
      createdAt: "2026-09-21T09:00:00Z",
      status: { state: "success" },
    });
    github.seedDeployment({ task: "deploy", payload: {} });
    github.seedDeployment({ task: "sluiceway:b", payload: { v: 2 } });

    const records = [1, 2, 3, 4].map((id) => github.deployment(id));
    const settled = await settleEndedRuns(github, records, REPO_URL);
    expect(settled.stackIds).toEqual([]);
    expect(settled.records).toEqual(records);
    expect(github.requests).toEqual([]);
  });
});
