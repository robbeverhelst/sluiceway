import { describe, expect, test } from "bun:test";
import { getOctokit } from "@actions/github";
import { createOctokitPort } from "../../src/github/octokit-port.ts";

// The real Octokit with its fetch swapped for one that answers from a list, as
// in octokit-port.test.ts.

function portThatAnswers(status: number, json?: unknown) {
  const sent: { method: string; path: string; body: unknown }[] = [];
  const fetch = async (url: string, init: { method?: string; body?: string }) => {
    sent.push({
      method: init.method ?? "GET",
      path: new URL(url).pathname,
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    return new Response(json === undefined ? null : JSON.stringify(json), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  const octokit = getOctokit("a-token", { request: { fetch } });
  return { port: createOctokitPort(octokit, { owner: "acme", repo: "infra" }), sent };
}

describe("dispatching a workflow", () => {
  // Slice 5.9: it asks for the run it started, and gives back its page.
  test("is one POST to the workflow's dispatches, with the ref, asking for the run it starts", async () => {
    const { port, sent } = portThatAnswers(200, {
      workflow_run_id: 99,
      run_url: "https://api.github.com/repos/acme/infra/actions/runs/99",
      html_url: "https://github.com/acme/infra/actions/runs/99",
    });

    expect(await port.dispatchWorkflow("sluiceway.yml", "main")).toBe(
      "https://github.com/acme/infra/actions/runs/99",
    );
    expect(sent).toEqual([
      {
        method: "POST",
        path: "/repos/acme/infra/actions/workflows/sluiceway.yml/dispatches",
        body: { ref: "main", return_run_details: true },
      },
    ]);
  });

  test("a GitHub that answers without the run gives nothing back", async () => {
    const { port } = portThatAnswers(204);
    expect(await port.dispatchWorkflow("sluiceway.yml", "main")).toBeUndefined();
  });

  test("fails with GitHub's words when the token has no `actions: write`", async () => {
    const { port } = portThatAnswers(403, { message: "Resource not accessible by integration" });

    await expect(port.dispatchWorkflow("sluiceway.yml", "main")).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining("Resource not accessible by integration"),
    });
  });
});
