import { describe, expect, test } from "bun:test";
import { FakeGitHub } from "./fake-github.ts";

// The queued runs of the dashboard's own workflow, as a scan reads them for
// the line about a run that waits for a runner (record 0086).
describe("the queued runs of a workflow", () => {
  test("none, and asking is one request", async () => {
    const fake = new FakeGitHub();
    expect(await fake.listQueuedRuns("sluiceway.yml")).toEqual([]);
    expect(fake.requests).toEqual(["listQueuedRuns"]);
  });

  test("only queued runs of that workflow, newest first", async () => {
    const fake = new FakeGitHub();
    fake.seedWorkflowRun("sluiceway.yml", {
      id: "7",
      status: "queued",
      since: "2026-09-23T14:00:00Z",
    });
    fake.seedWorkflowRun("sluiceway.yml", {
      id: "8",
      status: "in_progress",
      since: "2026-09-23T14:01:00Z",
    });
    fake.seedWorkflowRun("sluiceway.yml", {
      id: "9",
      status: "queued",
      since: "2026-09-23T14:02:00Z",
    });
    fake.seedWorkflowRun("ci.yml", { id: "10", status: "queued", since: "2026-09-23T14:03:00Z" });
    expect(await fake.listQueuedRuns("sluiceway.yml")).toEqual([
      { id: "9", status: "queued", since: "2026-09-23T14:02:00Z" },
      { id: "7", status: "queued", since: "2026-09-23T14:00:00Z" },
    ]);
  });

  test("seeding a run again changes it in place, as when it starts", async () => {
    const fake = new FakeGitHub();
    fake.seedWorkflowRun("sluiceway.yml", {
      id: "7",
      status: "queued",
      since: "2026-09-23T14:00:00Z",
    });
    fake.seedWorkflowRun("sluiceway.yml", {
      id: "7",
      status: "in_progress",
      since: "2026-09-23T14:00:00Z",
    });
    expect(await fake.listQueuedRuns("sluiceway.yml")).toEqual([]);
  });

  test("a read GitHub refuses, as without actions: read, throws", async () => {
    const fake = new FakeGitHub();
    fake.failQueuedRuns(403);
    await expect(fake.listQueuedRuns("sluiceway.yml")).rejects.toThrow();
  });
});
