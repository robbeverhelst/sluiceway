import { afterEach, describe, expect, test } from "bun:test";
import { getOctokit } from "@actions/github";
import { createOctokitPort } from "../../src/github/octokit-port.ts";
import { FakeGitHub } from "../fake-github/fake-github.ts";
import { type FakeGitHubServer, startFakeGitHubServer } from "../fake-github/server.ts";

// The check run calls of record 0050: what goes over the wire, pinned against
// a list of answers, and the real Octokit port over HTTP to the fake.

const SHA = "0123456789abcdef0123456789abcdef01234567";
const OUTPUT = { title: "t", summary: "s", text: "x" };

interface Sent {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
}

function portThatAnswers(answers: { status?: number; json: unknown; headers?: object }[]) {
  const sent: Sent[] = [];
  const fetch = async (url: string, init: { method?: string; body?: string }) => {
    const parsed = new URL(url);
    sent.push({
      method: init.method ?? "GET",
      path: parsed.pathname,
      query: Object.fromEntries(parsed.searchParams),
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    const answer = answers.shift();
    if (!answer) throw new Error(`No answer left for ${init.method} ${url}`);
    const response = new Response(JSON.stringify(answer.json), {
      status: answer.status ?? 200,
      headers: { "content-type": "application/json", ...answer.headers },
    });
    // The pager reads the address of a list's answer, which a real fetch sets.
    Object.defineProperty(response, "url", { value: url });
    return response;
  };
  const octokit = getOctokit("a-token", { request: { fetch } });
  return { port: createOctokitPort(octokit, { owner: "acme", repo: "infra" }), sent };
}

function apiRun(id: number, name: string) {
  return { id, name, html_url: `https://github.com/acme/infra/runs/${id}`, status: "completed" };
}

describe("the check run calls on the wire", () => {
  test("the list asks for the newest run of each name, 100 to a page", async () => {
    const { port, sent } = portThatAnswers([
      { json: { total_count: 1, check_runs: [apiRun(7, "sluiceway / a")] } },
    ]);
    expect(await port.listCheckRuns(SHA)).toEqual([
      { id: 7, name: "sluiceway / a", htmlUrl: "https://github.com/acme/infra/runs/7" },
    ]);
    expect(sent).toEqual([
      {
        method: "GET",
        path: `/repos/acme/infra/commits/${SHA}/check-runs`,
        query: { filter: "latest", per_page: "100" },
        body: undefined,
      },
    ]);
  });

  test("a create sends a finished, neutral run with its output and no details_url", async () => {
    const { port, sent } = portThatAnswers([{ status: 201, json: apiRun(8, "sluiceway / a") }]);
    const run = await port.createCheckRun({ sha: SHA, name: "sluiceway / a", output: OUTPUT });
    expect(run).toEqual({
      id: 8,
      name: "sluiceway / a",
      htmlUrl: "https://github.com/acme/infra/runs/8",
    });
    expect(sent[0]?.method).toBe("POST");
    expect(sent[0]?.path).toBe("/repos/acme/infra/check-runs");
    expect(sent[0]?.body).toEqual({
      name: "sluiceway / a",
      head_sha: SHA,
      status: "completed",
      conclusion: "neutral",
      output: OUTPUT,
    });
  });

  test("an update sends the whole output and nothing else", async () => {
    const { port, sent } = portThatAnswers([{ json: apiRun(9, "sluiceway / a") }]);
    await port.updateCheckRun(9, OUTPUT);
    expect(sent[0]?.method).toBe("PATCH");
    expect(sent[0]?.path).toBe("/repos/acme/infra/check-runs/9");
    expect(sent[0]?.body).toEqual({ output: OUTPUT });
  });
});

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

describe("check runs over HTTP", () => {
  test("create, list page by page and update reach the fake", async () => {
    const { fake, port } = await served();
    for (let i = 0; i < 120; i++) fake.seedCheckRun(SHA, `ci / job-${i}`);

    const created = await port.createCheckRun({ sha: SHA, name: "sluiceway / a", output: OUTPUT });
    const listed = await port.listCheckRuns(SHA);
    await port.updateCheckRun(created.id, { ...OUTPUT, text: "y" });

    expect(listed).toHaveLength(121);
    expect(listed).toContainEqual(created);
    expect(fake.checkRuns(SHA).at(-1)?.output.text).toBe("y");
    expect(fake.requests).toEqual([
      "createCheckRun",
      "listCheckRuns",
      "listCheckRuns",
      "updateCheckRun",
    ]);
  });

  test("a token without `checks: write` gets the 403", async () => {
    const { fake, port } = await served();
    fake.withoutChecksWrite();
    await expect(
      port.createCheckRun({ sha: SHA, name: "sluiceway / a", output: OUTPUT }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
