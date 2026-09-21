import { describe, expect, test } from "bun:test";
import { FakeGitHub } from "./fake-github.ts";

// The runs that an issue edit started, as the orphan tick sweep reads them
// (record 0025). The fake has no events yet, so a test seeds the runs.
describe("the runs of a workflow that an issue edit started", () => {
  test("a workflow that no issue edit ever started has none, and asking is one request", async () => {
    const fake = new FakeGitHub();
    expect(await fake.listIssuesRuns("sluiceway.yml")).toEqual([]);
    expect(fake.requests).toEqual(["listIssuesRuns"]);
  });

  test("newest first, where a run seeded later is newer", async () => {
    const fake = new FakeGitHub();
    fake.seedIssuesRun("sluiceway.yml", { id: "7", completed: true });
    fake.seedIssuesRun("sluiceway.yml", { id: "8", completed: false });
    expect(await fake.listIssuesRuns("sluiceway.yml")).toEqual([
      { id: "8", completed: false },
      { id: "7", completed: true },
    ]);
  });

  test("the runs of another workflow are not on the list", async () => {
    const fake = new FakeGitHub();
    fake.seedIssuesRun("triage.yml", { id: "7", completed: false });
    expect(await fake.listIssuesRuns("sluiceway.yml")).toEqual([]);
  });

  test("seeding a run again changes it in place, as when it ends", async () => {
    const fake = new FakeGitHub();
    fake.seedIssuesRun("sluiceway.yml", { id: "7", completed: false });
    fake.seedIssuesRun("sluiceway.yml", { id: "8", completed: false });
    fake.seedIssuesRun("sluiceway.yml", { id: "7", completed: true });
    expect(await fake.listIssuesRuns("sluiceway.yml")).toEqual([
      { id: "8", completed: false },
      { id: "7", completed: true },
    ]);
  });

  test("one page of 100, as the port reads it", async () => {
    const fake = new FakeGitHub();
    for (let id = 1; id <= 101; id++) {
      fake.seedIssuesRun("sluiceway.yml", { id: String(id), completed: true });
    }
    const runs = await fake.listIssuesRuns("sluiceway.yml");
    expect(runs).toHaveLength(100);
    expect(runs[0]?.id).toBe("101");
    expect(runs.at(-1)?.id).toBe("2");
  });

  test("a seeded run is a run GitHub has", async () => {
    const fake = new FakeGitHub();
    fake.seedIssuesRun("sluiceway.yml", { id: "7", completed: false });
    expect(await fake.getWorkflowRun("7")).toEqual({ completed: false });
  });

  test("what the fake hands out is a copy", async () => {
    const fake = new FakeGitHub();
    fake.seedIssuesRun("sluiceway.yml", { id: "7", completed: false });
    const [run] = await fake.listIssuesRuns("sluiceway.yml");
    if (run) run.completed = true;
    expect(await fake.listIssuesRuns("sluiceway.yml")).toEqual([{ id: "7", completed: false }]);
  });
});
