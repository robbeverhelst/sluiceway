import { describe, expect, test } from "bun:test";
import { createGitHubClient } from "../../src/github/client.ts";
import { createOctokitPort } from "../../src/github/octokit-port.ts";

// The one call of the orphan tick sweep on the wire (record 0025), as
// octokit-port.test.ts holds the rest: the real Octokit with its fetch swapped
// for one that answers from a list. The answers are shaped like the ones
// GitHub gave for this repo's own workflows on 2026-09-21, read only.

interface Sent {
  method: string;
  path: string;
  query: Record<string, string>;
}

interface Answer {
  status?: number;
  json: unknown;
}

function portThatAnswers(answers: Answer[]) {
  const sent: Sent[] = [];
  const fetch = async (url: string, init: { method?: string }) => {
    const parsed = new URL(url);
    sent.push({
      method: init.method ?? "GET",
      path: parsed.pathname,
      query: Object.fromEntries(parsed.searchParams),
    });
    const answer = answers.shift();
    if (!answer) throw new Error(`No answer left for ${init.method} ${url}`);
    return new Response(JSON.stringify(answer.json), {
      status: answer.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  const octokit = createGitHubClient("a-token", { request: { fetch } });
  return { port: createOctokitPort(octokit, { owner: "acme", repo: "infra" }), sent };
}

function apiRun(id: number, status: string, conclusion: string | null = null) {
  return { id, status, conclusion, event: "issues", path: ".github/workflows/sluiceway.yml" };
}

describe("the runs of the workflow that an issue edit started", () => {
  test("one request: the newest 100 runs of one workflow file, filtered by the event", async () => {
    const { port, sent } = portThatAnswers([
      {
        json: {
          total_count: 2,
          workflow_runs: [
            apiRun(35643056254, "in_progress"),
            apiRun(35642186195, "completed", "success"),
          ],
        },
      },
    ]);

    expect(await port.listIssuesRuns("sluiceway.yml")).toEqual([
      { id: "35643056254", completed: false },
      { id: "35642186195", completed: true },
    ]);
    expect(sent).toEqual([
      {
        method: "GET",
        path: "/repos/acme/infra/actions/workflows/sluiceway.yml/runs",
        query: { event: "issues", per_page: "100" },
      },
    ]);
  });

  test("a run that waits, is queued or runs is not over, and a cancelled one is", async () => {
    for (const status of ["queued", "in_progress", "waiting", "requested", "pending"]) {
      const { port } = portThatAnswers([
        { json: { total_count: 1, workflow_runs: [apiRun(7, status)] } },
      ]);
      expect(await port.listIssuesRuns("sluiceway.yml")).toEqual([{ id: "7", completed: false }]);
    }
    const { port } = portThatAnswers([
      { json: { total_count: 1, workflow_runs: [apiRun(7, "completed", "cancelled")] } },
    ]);
    expect(await port.listIssuesRuns("sluiceway.yml")).toEqual([{ id: "7", completed: true }]);
  });

  test("a workflow that no issue edit ever started has none", async () => {
    const { port } = portThatAnswers([{ json: { total_count: 0, workflow_runs: [] } }]);
    expect(await port.listIssuesRuns("sluiceway.yml")).toEqual([]);
  });

  test("a refusal is an error, such as a token without actions: read", async () => {
    const { port } = portThatAnswers([
      { status: 403, json: { message: "Resource not accessible by integration" } },
    ]);
    await expect(port.listIssuesRuns("sluiceway.yml")).rejects.toThrow(
      "Resource not accessible by integration",
    );
  });
});
